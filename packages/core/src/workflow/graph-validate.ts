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

function triggerKind(doc: WorkflowGraphDocument): string | null {
  const trigger = doc.nodes.find((node) => node.type === 'trigger');
  if (!trigger) return null;
  const kind = (trigger.data as Record<string, unknown> | undefined)?.kind;
  return typeof kind === 'string' ? kind : '';
}

/** Same label→port mapping the runtime uses (graph-walk-utils edgeIsYes/No). */
function labelIsYes(label: string): boolean {
  const l = label.toLowerCase();
  return l === '' || l === 'yes' || l === 'ja' || l === 'true';
}
function labelIsNo(label: string): boolean {
  const l = label.toLowerCase();
  return l === 'no' || l === 'nein' || l === 'false';
}

export type OutboundGraphIssue =
  | { code: 'dangling_condition_port'; nodeId: string; missing: 'yes' | 'no' }
  | { code: 'no_release_node' };

/**
 * An outbound workflow holds EVERY draft up front (server-side reviewOutbound
 * sets outbound_hold=true the moment an enabled outbound workflow exists) and
 * the draft is only ever sent when a node explicitly releases it
 * (email.release_outbound / email.send_draft). The engine is fail-closed:
 * pickEdge does NOT fall back on the "no" port, so a graph that can reach an
 * end without releasing traps clean mail in the inbox forever.
 *
 * This returns the concrete structural problems that would trap mail; an empty
 * array means the outbound graph always has a way to release. Non-outbound
 * graphs are never flagged.
 */
export function findOutboundGraphTraps(doc: WorkflowGraphDocument): OutboundGraphIssue[] {
  // Defensive: callers pass loosely-typed JSON. A malformed doc can't trap mail
  // (it won't run), so treat it as "nothing to flag" rather than throwing.
  if (!doc || !Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) return [];
  if (triggerKind(doc) !== 'outbound') return [];
  const issues: OutboundGraphIssue[] = [];

  // 1) Every condition must wire BOTH ports. A dangling "no" (as in the shipped
  //    "Sensible Daten" template) silently strands every non-matching mail,
  //    because the walk stops where the missing edge would be.
  for (const node of doc.nodes) {
    if (node.type !== 'condition') continue;
    const labels = doc.edges
      .filter((edge) => edge.source === node.id)
      .map((edge) => edge.label ?? '');
    if (!labels.some(labelIsYes)) {
      issues.push({ code: 'dangling_condition_port', nodeId: node.id, missing: 'yes' });
    }
    if (!labels.some(labelIsNo)) {
      issues.push({ code: 'dangling_condition_port', nodeId: node.id, missing: 'no' });
    }
  }

  // 2) The graph must contain at least one release/send node, otherwise nothing
  //    can ever lift the hold that reviewOutbound places on the draft.
  const hasReleaseNode = doc.nodes.some(isReleaseNode);
  const hasNonTriggerNode = doc.nodes.some((node) => node.type !== 'trigger');
  if (!hasReleaseNode && hasNonTriggerNode) {
    issues.push({ code: 'no_release_node' });
  }

  return issues;
}

/** Human-readable (German) summary for surfacing the issues to the user. */
export function formatOutboundGraphTraps(issues: OutboundGraphIssue[]): string {
  if (issues.length === 0) return '';
  const parts: string[] = [];
  if (issues.some((issue) => issue.code === 'no_release_node')) {
    parts.push(
      'Der Ausgangs-Workflow enthält keinen Freigabe-Knoten (email.release_outbound / email.send_draft). ' +
        'Ohne Freigabe bleibt jede geprüfte Mail dauerhaft im Posteingang gehalten und wird nie versendet.',
    );
  }
  const dangling = issues.filter(
    (issue): issue is Extract<OutboundGraphIssue, { code: 'dangling_condition_port' }> =>
      issue.code === 'dangling_condition_port',
  );
  if (dangling.length > 0) {
    const detail = dangling
      .map((issue) => `Bedingung „${issue.nodeId}" ohne „${issue.missing === 'no' ? 'nein' : 'ja'}"-Zweig`)
      .join('; ');
    parts.push(
      `Mindestens eine Bedingung hat einen offenen Port, der Mails hängen lässt (${detail}). ` +
        'Verbinde den offenen Zweig mit einem Freigabe-Knoten (email.release_outbound, autoSend=true).',
    );
  }
  return parts.join(' ');
}

/** Convenience: true when the outbound graph is safe to enable. */
export function outboundGraphReleasesMail(doc: WorkflowGraphDocument): boolean {
  return findOutboundGraphTraps(doc).length === 0;
}
