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
    // With no default edge, be conservative and walk all edges.
    const defaultEdge = outs.find((edge) => labelIsDefault(edge.label ?? ''));
    if (defaultEdge) {
      walk(defaultEdge.target, next);
      return;
    }
    for (const edge of outs) walk(edge.target, next);
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
