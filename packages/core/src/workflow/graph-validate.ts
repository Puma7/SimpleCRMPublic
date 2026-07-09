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
 * for good). `email.release_outbound` only counts with `autoSend: true` — the
 * non-autoSend mode merely clears the hold without writing the approval marker
 * or scheduling the send, so the aborted compose send would just re-enter
 * review on the next attempt and be held again. `email.send_draft` always
 * sends.
 */
function isReleaseNode(node: WorkflowGraphNode): boolean {
  const type = registryType(node);
  if (type === 'email.send_draft') return true;
  if (type === 'email.release_outbound') return nodeConfig(node).autoSend === true;
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

function triggerKind(doc: WorkflowGraphDocument): string | null {
  const trigger = doc.nodes.find((node) => node.type === 'trigger');
  if (!trigger) return null;
  const kind = (trigger.data as Record<string, unknown> | undefined)?.kind;
  return typeof kind === 'string' ? kind : '';
}

// Mirror of graph-walk-utils.ts edgeIsYes / edgeIsNo (the runtime pickEdge is
// the source of truth). MUST stay in sync so the validator never rejects a
// graph the engine would happily route.
function labelIsYes(label: string): boolean {
  const l = label.toLowerCase();
  return l === '' || l === 'yes' || l === 'ja' || l === 'true' || l === 'success';
}
function labelIsNo(label: string): boolean {
  const l = label.toLowerCase();
  return l === 'no' || l === 'nein' || l === 'false' || l === 'error';
}

export type OutboundGraphIssue =
  | { code: 'dangling_condition_port'; nodeId: string; missing: 'yes' | 'no' }
  | { code: 'dead_end'; nodeId: string };

export type FindOutboundGraphTrapsOptions = {
  /**
   * Force outbound validation regardless of the graph's trigger node. Pass the
   * workflow's EFFECTIVE trigger name (the stored `trigger_name`, which is what
   * the server's outbound review selects on) so a graph whose trigger node was
   * left as `inbound` but is registered as an outbound workflow is still
   * checked.
   */
  effectiveTrigger?: string;
};

/**
 * An outbound workflow (server edition) holds EVERY draft up front
 * (reviewOutbound sets outbound_hold=true the moment an enabled outbound
 * workflow exists) and the draft is only ever sent when a node explicitly
 * releases it. The engine is fail-closed, so any reachable path that
 * terminates — dead-ends, loops, dangling condition ports, or edges to missing
 * nodes — WITHOUT sending traps clean mail in the inbox forever.
 *
 * This walks every reachable path from the trigger and reports the ones that
 * do not reach a real send (release_outbound autoSend / send_draft) or an
 * explicit hold (an intended hold). Empty array = safe. Non-outbound workflows
 * are never flagged.
 *
 * NOTE: this models the SERVER runtime. The standalone Electron runtime is
 * run-then-block (it never holds up front), so it must NOT enforce this.
 */
export function findOutboundGraphTraps(
  doc: WorkflowGraphDocument,
  opts?: FindOutboundGraphTrapsOptions,
): OutboundGraphIssue[] {
  // Defensive: callers pass loosely-typed JSON. A malformed doc can't run, so
  // treat it as "nothing to flag" rather than throwing.
  if (!doc || !Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) return [];
  const trigger = opts?.effectiveTrigger ?? triggerKind(doc);
  if (trigger !== 'outbound') return [];
  const triggerNode = doc.nodes.find((node) => node.type === 'trigger');
  if (!triggerNode) return [];

  const byId = new Map(doc.nodes.map((node) => [node.id, node]));
  // Sort like the runtime (graph-walk-utils.outgoing) so a condition with
  // duplicate yes/no edges resolves to the SAME edge the engine would pick.
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
      // Edge points at a deleted/missing node — the runtime breaks here and the
      // draft stays held. That is a dead end, not a safe branch.
      add({ code: 'dead_end', nodeId });
      return;
    }
    if (pathVisited.has(nodeId)) {
      // Loop back without ever releasing — the runtime finishes OK but the
      // draft is still held. Flag it instead of silently accepting the cycle.
      add({ code: 'dead_end', nodeId });
      return;
    }
    if (isReleaseNode(node)) return; // this path sends the mail — safe
    if (isHoldNode(node)) return; // explicit, intended hold — safe terminal
    const next = new Set(pathVisited).add(nodeId);
    const outs = outgoing(nodeId);

    if (node.type === 'condition') {
      const yesEdge = outs.find((edge) => labelIsYes(edge.label ?? ''));
      const noEdge = outs.find((edge) => labelIsNo(edge.label ?? ''));
      if (yesEdge) walk(yesEdge.target, next);
      else add({ code: 'dangling_condition_port', nodeId, missing: 'yes' });
      if (noEdge) walk(noEdge.target, next);
      else add({ code: 'dangling_condition_port', nodeId, missing: 'no' });
      return;
    }

    if (outs.length === 0) {
      add({ code: 'dead_end', nodeId }); // pass-through node with nowhere to go
      return;
    }
    for (const edge of outs) walk(edge.target, next);
  };

  const triggerOuts = outgoing(triggerNode.id);
  if (triggerOuts.length === 0) add({ code: 'dead_end', nodeId: triggerNode.id });
  else for (const edge of triggerOuts) walk(edge.target, new Set([triggerNode.id]));

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
      '(email.release_outbound mit autoSend=true, oder email.send_draft).',
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
