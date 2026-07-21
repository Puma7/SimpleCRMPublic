import type { WorkflowGraphDocument, WorkflowGraphNode } from './graph-types';

function registryType(node: WorkflowGraphNode): string {
  const data = node.data as Record<string, unknown> | undefined;
  return typeof data?.nodeType === 'string' ? data.nodeType : '';
}

function nodeConfig(node: WorkflowGraphNode): Record<string, unknown> {
  const data = node.data as Record<string, unknown> | undefined;
  const config = data?.config;
  return config && typeof config === 'object' ? (config as Record<string, unknown>) : {};
}

/**
 * A node that actually gets the draft SENT (lifting the server outbound hold
 * for good).
 *  - `email.release_outbound` only counts with `autoSend: true` — the
 *    non-autoSend mode clears the hold without scheduling the send, so the
 *    aborted compose send just re-enters review on the next attempt.
 *  - `email.send_draft` only counts when it explicitly targets a draft
 *    (`config.draftId` or a `config.draftIdVariable`); with neither, it falls
 *    back to `context draft.id`, which is not set for a compose-review draft,
 *    and errors at runtime instead of sending.
 */
function isReleaseNode(node: WorkflowGraphNode): boolean {
  const type = registryType(node);
  if (type === 'email.release_outbound') return nodeConfig(node).autoSend === true;
  if (type === 'email.send_draft') {
    const config = nodeConfig(node);
    return (
      typeof config.draftId === 'number' ||
      (typeof config.draftIdVariable === 'string' && config.draftIdVariable.trim() !== '')
    );
  }
  return false;
}

/** An explicit hold is an INTENDED terminal (user chose to hold for review). */
function isHoldNode(node: WorkflowGraphNode): boolean {
  const data = node.data as Record<string, unknown> | undefined;
  return (
    (node.type === 'action' && data?.actionType === 'hold_outbound') ||
    registryType(node) === 'email.hold_outbound'
  );
}

/**
 * Nodes that branch on yes/no at runtime and therefore need BOTH ports wired.
 * Kept in sync with executeServerNode: only the canvas `condition` node and the
 * `logic.threshold` registry node return `port: match ? 'yes' : 'no'`.
 */
function isYesNoBranchNode(node: WorkflowGraphNode): boolean {
  return node.type === 'condition' || registryType(node) === 'logic.threshold';
}

/**
 * Runtime node types that only read state, branch, or produce in-run variables
 * — they never mutate persisted mailbox/CRM state, send mail, or reach an
 * external system. Kept as a fail-closed ALLOWLIST on purpose: any node type
 * NOT listed here is treated as side-effecting, so a newly added node is
 * writing until it is reviewed and added. Cross-check with executeServerNode
 * (packages/server/src/workflow-execution.ts) when node types change. `logic.*`
 * helpers (stop/merge/loop/set_variable/delay/threshold/switch) are covered by
 * the prefix check below and are intentionally not enumerated here.
 */
const READ_ONLY_WORKFLOW_NODE_TYPES: ReadonlySet<string> = new Set<string>([
  'email.auth_check',
  'email.read_tracking_evidence',
  'email.sender_filter',
  'returns.evaluate',
  // jtl.lookup reads the workspace's OWN synced JTL tables (local Postgres, workspace-
  // scoped) — no external reach — so it stays read-only. jtl.order_context is NOT here:
  // it runs a caller-configurable SELECT against the workspace's external MSSQL/ERP
  // connection (executeReadOnlyQuery), so a non-admin live run could read arbitrary ERP
  // tables — reaching an external system counts as side-effecting.
  'jtl.lookup',
  'jtl.prepare_action',
  // NOTE: neither ai.classify NOR ai.reply_suggestion is here. ai.classify persists a
  // tag (addClassificationTag, a mail.triage mutation); ai.reply_suggestion enqueues a
  // child that calls the external AI provider and writes email_messages.reply_suggestion_*
  // under the system role. Both are side-effecting, so a graph containing either must
  // block a non-admin live run.
]);

/** Resolve the runtime type of an action/registry node (mirrors nodeRuntimeType). */
function sideEffectRuntimeType(node: WorkflowGraphNode): string {
  const data = node.data as Record<string, unknown> | undefined;
  if (node.type === 'registry') {
    return typeof data?.nodeType === 'string' ? data.nodeType : 'registry.unknown';
  }
  if (node.type === 'action') {
    if (typeof data?.nodeType === 'string' && data.nodeType) return data.nodeType;
    if (typeof data?.actionType === 'string' && data.actionType) return data.actionType;
    return 'action';
  }
  return node.type;
}

/**
 * True if the graph has at least one node that mutates persisted state, sends
 * mail, or reaches an external system when run live. Triggers and conditions
 * never count; action/registry nodes count unless their runtime type is a known
 * read-only/branch type or a `logic.*` helper. An unknown canvas type fails
 * closed (counts as side-effecting).
 *
 * Scans every node regardless of reachability, so a writing node behind a delay
 * or an unreached branch still trips the guard. Server workflow runs execute
 * under a system role with no per-node ACL, so a live run initiated by a
 * non-admin must be blocked whenever any writing node is present. A null/empty
 * graph returns false: the server executor blocks legacy definition-only
 * workflows, so there is nothing to escalate through.
 */
export function workflowGraphHasSideEffectNode(graph: unknown): boolean {
  let candidate: unknown = graph;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate) as unknown;
    } catch {
      return false;
    }
  }
  if (!candidate || typeof candidate !== 'object') return false;
  const nodes = (candidate as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return false;
  for (const raw of nodes) {
    if (!raw || typeof raw !== 'object') continue;
    const node = raw as WorkflowGraphNode;
    if (node.type === 'trigger' || node.type === 'condition') continue;
    if (node.type !== 'action' && node.type !== 'registry') return true;
    const type = sideEffectRuntimeType(node);
    if (type.startsWith('logic.')) continue;
    if (READ_ONLY_WORKFLOW_NODE_TYPES.has(type)) continue;
    return true;
  }
  return false;
}

/**
 * True if the graph contains at least one action/registry node whose runtime
 * type matches `nodeType`. Scans every node regardless of reachability (like
 * workflowGraphHasSideEffectNode), so a matching node behind a delay or an
 * unreached branch still counts. Used by the async job enforcer to recheck a
 * per-node permission (e.g. mail.delete for an email.delete_server node) at
 * workflow.execute time, since server workflow runs execute under a system role
 * with no per-node ACL. A null/empty graph returns false.
 */
export function workflowGraphHasNodeType(graph: unknown, nodeType: string): boolean {
  let candidate: unknown = graph;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate) as unknown;
    } catch {
      return false;
    }
  }
  if (!candidate || typeof candidate !== 'object') return false;
  const nodes = (candidate as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return false;
  for (const raw of nodes) {
    if (!raw || typeof raw !== 'object') continue;
    const node = raw as WorkflowGraphNode;
    if (node.type !== 'action' && node.type !== 'registry') continue;
    if (sideEffectRuntimeType(node) === nodeType) return true;
  }
  return false;
}

function triggerKind(doc: WorkflowGraphDocument): string | null {
  const trigger = doc.nodes.find((node) => node.type === 'trigger');
  if (!trigger) return null;
  const kind = (trigger.data as Record<string, unknown> | undefined)?.kind;
  return typeof kind === 'string' ? kind : '';
}

function nodeTriggerKind(node: WorkflowGraphNode): string {
  const kind = (node.data as Record<string, unknown> | undefined)?.kind;
  return typeof kind === 'string' ? kind : '';
}

// Mirror of graph-walk-utils.ts edge label helpers (the runtime pickEdge is the
// source of truth). MUST stay in sync so the validator routes like the engine.
function labelIsYes(label: string): boolean {
  const l = label.toLowerCase();
  return l === '' || l === 'yes' || l === 'ja' || l === 'true' || l === 'success';
}
function labelIsNo(label: string): boolean {
  const l = label.toLowerCase();
  return l === 'no' || l === 'nein' || l === 'false' || l === 'error';
}
function labelIsDefault(label: string): boolean {
  const l = label.toLowerCase();
  return l === '' || l === 'default' || l === 'standard' || l === 'fallback';
}

export type OutboundGraphIssue =
  | { code: 'dangling_condition_port'; nodeId: string; missing: 'yes' | 'no' }
  | { code: 'dead_end'; nodeId: string };

export type FindOutboundGraphTrapsOptions = {
  /**
   * Force outbound validation regardless of the graph's trigger node. Pass the
   * workflow's EFFECTIVE trigger name (the stored `trigger_name`, which is what
   * the server's outbound review selects on). The DFS then starts at the
   * trigger node whose kind matches — like the runtime — so a multi-trigger
   * graph is validated from the outbound entry point.
   */
  effectiveTrigger?: string;
};

/**
 * An outbound workflow (server edition) holds EVERY draft up front and the
 * draft is only ever sent when a node explicitly releases it. The engine is
 * fail-closed, so any reachable path that terminates — dead-ends, loops,
 * dangling yes/no ports, or edges to missing nodes — WITHOUT sending traps
 * clean mail. This walks every reachable path from the matching trigger and
 * reports the ones that never reach a real send or an explicit hold. Empty =
 * safe. Non-outbound workflows are never flagged.
 *
 * Best-effort by design: it models the common node port semantics (condition /
 * logic.threshold branch on yes/no; other nodes follow their `default` edge).
 * Exotic multi-port graphs it can't model fail SAFE at runtime (the draft is
 * held with a visible banner, not lost).
 */
export function findOutboundGraphTraps(
  doc: WorkflowGraphDocument,
  opts?: FindOutboundGraphTrapsOptions,
): OutboundGraphIssue[] {
  if (!doc || !Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) return [];
  const effTrigger = opts?.effectiveTrigger ?? triggerKind(doc);
  if (effTrigger !== 'outbound') return [];
  // Mirror the runtime: pick the trigger whose kind matches, else the first.
  const triggerNode =
    doc.nodes.find((node) => node.type === 'trigger' && nodeTriggerKind(node) === effTrigger) ??
    doc.nodes.find((node) => node.type === 'trigger');
  if (!triggerNode) return [];

  const byId = new Map(doc.nodes.map((node) => [node.id, node]));
  // Sort like graph-walk-utils.outgoing so duplicate edges resolve to the same
  // one the engine would pick.
  const outgoing = (id: string) =>
    doc.edges
      .filter((edge) => edge.source === id)
      .sort((a, b) => a.id.localeCompare(b.id));

  const issues: OutboundGraphIssue[] = [];
  const seen = new Set<string>();
  const add = (issue: OutboundGraphIssue) => {
    const key =
      issue.code === 'dangling_condition_port'
        ? `d:${issue.nodeId}:${issue.missing}`
        : `e:${issue.nodeId}`;
    if (!seen.has(key)) {
      seen.add(key);
      issues.push(issue);
    }
  };

  const walk = (nodeId: string, pathVisited: Set<string>): void => {
    const node = byId.get(nodeId);
    if (!node) {
      add({ code: 'dead_end', nodeId }); // edge to a missing/deleted node
      return;
    }
    if (pathVisited.has(nodeId)) {
      add({ code: 'dead_end', nodeId }); // loop that never releases
      return;
    }
    if (isReleaseNode(node)) return; // sends the mail — safe
    if (isHoldNode(node)) return; // explicit, intended hold — safe terminal
    const next = new Set(pathVisited).add(nodeId);
    const outs = outgoing(nodeId);

    if (isYesNoBranchNode(node)) {
      const yesEdge = outs.find((edge) => labelIsYes(edge.label ?? ''));
      const noEdge = outs.find((edge) => labelIsNo(edge.label ?? ''));
      if (yesEdge) walk(yesEdge.target, next);
      else add({ code: 'dangling_condition_port', nodeId, missing: 'yes' });
      if (noEdge) walk(noEdge.target, next);
      else add({ code: 'dangling_condition_port', nodeId, missing: 'no' });
      return;
    }

    if (outs.length === 0) {
      add({ code: 'dead_end', nodeId }); // nothing to route to
      return;
    }
    // Non-branch node: the runtime follows pickEdge(..., 'default'). When a
    // default edge exists, follow ONLY it — auxiliary edges (e.g. an "error"
    // branch) are not taken, so they must not be treated as reachable traps.
    const defaultEdge = outs.find((edge) => labelIsDefault(edge.label ?? ''));
    if (defaultEdge) {
      walk(defaultEdge.target, next);
      return;
    }
    // Every outgoing edge is labeled (e.g. success/error) and none is a
    // default/unlabeled edge, so pickEdge(..., 'default') returns undefined:
    // the runtime stops here and the draft is never released — a dead end.
    add({ code: 'dead_end', nodeId });
  };

  for (const edge of outgoing(triggerNode.id)) walk(edge.target, new Set([triggerNode.id]));
  if (outgoing(triggerNode.id).length === 0) add({ code: 'dead_end', nodeId: triggerNode.id });

  return issues;
}

/** Human-readable (German) summary for surfacing the issues to the user. */
export function formatOutboundGraphTraps(issues: OutboundGraphIssue[]): string {
  if (issues.length === 0) return '';
  const parts: string[] = [];

  const dangling = issues.filter(
    (issue): issue is Extract<OutboundGraphIssue, { code: 'dangling_condition_port' }> =>
      issue.code === 'dangling_condition_port',
  );
  if (dangling.length > 0) {
    const detail = dangling
      .map((issue) => `Bedingung „${issue.nodeId}" ohne „${issue.missing === 'no' ? 'nein' : 'ja'}"-Zweig`)
      .join('; ');
    parts.push(
      `Mindestens eine Bedingung hat einen offenen Port, der Mails hängen lässt (${detail}).`,
    );
  }

  const deadEnds = issues.filter(
    (issue): issue is Extract<OutboundGraphIssue, { code: 'dead_end' }> => issue.code === 'dead_end',
  );
  if (deadEnds.length > 0) {
    const ids = deadEnds.map((issue) => `„${issue.nodeId}"`).join(', ');
    parts.push(
      `Mindestens ein Pfad endet ohne Freigabe (${ids}) und lässt die Mail dauerhaft im ` +
        'Posteingang hängen.',
    );
  }

  parts.push(
    'Verbinde jeden offenen/endenden Zweig mit einem Freigabe-Knoten ' +
      '(email.release_outbound mit autoSend=true, oder ein konfiguriertes email.send_draft).',
  );
  return parts.join(' ');
}

/** Convenience: true when the outbound graph is safe to enable. */
export function outboundGraphReleasesMail(
  doc: WorkflowGraphDocument,
  opts?: FindOutboundGraphTrapsOptions,
): boolean {
  return findOutboundGraphTraps(doc, opts).length === 0;
}
