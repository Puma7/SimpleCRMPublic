import type { WorkflowGraphDocument, WorkflowGraphNode } from './graph-types';

// Nodes that actually lift the outbound hold (send the draft on). Kept in sync
// with the runtime: workflow-execution.ts only clears outbound_hold in the
// email.release_outbound and email.send_draft handlers.
const RELEASE_NODE_TYPES = new Set(['email.release_outbound', 'email.send_draft']);

function registryType(node: WorkflowGraphNode): string {
  const data = node.data as Record<string, unknown> | undefined;
  return typeof data?.nodeType === 'string' ? data.nodeType : '';
}

function isReleaseNode(node: WorkflowGraphNode): boolean {
  return RELEASE_NODE_TYPES.has(registryType(node));
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

/**
 * An outbound workflow holds EVERY draft up front (server-side reviewOutbound
 * sets outbound_hold=true the moment an enabled outbound workflow exists) and
 * the draft is only ever sent when a node explicitly releases it
 * (email.release_outbound / email.send_draft). The engine is fail-closed:
 * pickEdge does NOT fall back on the "no" port, so a graph that can reach a
 * terminal without releasing traps clean mail in the inbox forever.
 *
 * This walks every reachable path from the trigger and reports the ones that
 * terminate WITHOUT releasing and WITHOUT an explicit hold_outbound (which is
 * an intended hold). A single release node somewhere is NOT enough — every
 * non-blocking path must reach one. Empty array = safe. Non-outbound graphs
 * are never flagged.
 */
export function findOutboundGraphTraps(doc: WorkflowGraphDocument): OutboundGraphIssue[] {
  // Defensive: callers pass loosely-typed JSON. A malformed doc can't run, so
  // treat it as "nothing to flag" rather than throwing.
  if (!doc || !Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) return [];
  if (triggerKind(doc) !== 'outbound') return [];
  const trigger = doc.nodes.find((node) => node.type === 'trigger');
  if (!trigger) return [];

  const byId = new Map(doc.nodes.map((node) => [node.id, node]));
  const outgoing = (id: string) => doc.edges.filter((edge) => edge.source === id);

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
    if (!node) return; // edge points at a missing node (malformed) — ignore
    if (pathVisited.has(nodeId)) return; // cycle — stop, don't re-flag
    if (isReleaseNode(node)) return; // this path releases the mail — safe
    if (isHoldNode(node)) return; // explicit, intended hold — safe terminal
    const next = new Set(pathVisited).add(nodeId);
    const outs = outgoing(nodeId);

    if (node.type === 'condition') {
      // Both ports are statically reachable; each must reach a release/hold.
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

  const triggerOuts = outgoing(trigger.id);
  if (triggerOuts.length === 0) add({ code: 'dead_end', nodeId: trigger.id });
  else for (const edge of triggerOuts) walk(edge.target, new Set([trigger.id]));

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
export function outboundGraphReleasesMail(doc: WorkflowGraphDocument): boolean {
  return findOutboundGraphTraps(doc).length === 0;
}
