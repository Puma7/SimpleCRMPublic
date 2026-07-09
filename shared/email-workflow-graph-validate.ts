import type { WorkflowGraphDocument, WorkflowGraphNode } from './email-workflow-graph';

// Mirror of packages/core/src/workflow/graph-validate.ts for the electron /
// renderer transport (which uses the shared graph types, not @simplecrm/core).
// Keep both copies in sync.

function registryType(node: WorkflowGraphNode): string {
  const data = node.data as Record<string, unknown> | undefined;
  return typeof data?.nodeType === 'string' ? data.nodeType : '';
}

function nodeConfig(node: WorkflowGraphNode): Record<string, unknown> {
  const data = node.data as Record<string, unknown> | undefined;
  const config = data?.config;
  return config && typeof config === 'object' ? (config as Record<string, unknown>) : {};
}

function isReleaseNode(node: WorkflowGraphNode): boolean {
  const type = registryType(node);
  if (type === 'email.send_draft') return true;
  if (type === 'email.release_outbound') return nodeConfig(node).autoSend === true;
  return false;
}

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

// Mirror of graph-walk-utils.ts edgeIsYes / edgeIsNo (runtime source of truth).
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
  effectiveTrigger?: string;
};

/**
 * Models the SERVER outbound runtime (hold-then-release). Every reachable path
 * that terminates without sending (release_outbound autoSend / send_draft) or
 * an explicit hold traps clean mail. The standalone Electron runtime is
 * run-then-block and must NOT enforce this.
 */
export function findOutboundGraphTraps(
  doc: WorkflowGraphDocument,
  opts?: FindOutboundGraphTrapsOptions,
): OutboundGraphIssue[] {
  if (!doc || !Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) return [];
  const trigger = opts?.effectiveTrigger ?? triggerKind(doc);
  if (trigger !== 'outbound') return [];
  const triggerNode = doc.nodes.find((node) => node.type === 'trigger');
  if (!triggerNode) return [];

  const byId = new Map(doc.nodes.map((node) => [node.id, node]));
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
      add({ code: 'dead_end', nodeId });
      return;
    }
    if (pathVisited.has(nodeId)) {
      add({ code: 'dead_end', nodeId });
      return;
    }
    if (isReleaseNode(node)) return;
    if (isHoldNode(node)) return;
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
      add({ code: 'dead_end', nodeId });
      return;
    }
    for (const edge of outs) walk(edge.target, next);
  };

  const triggerOuts = outgoing(triggerNode.id);
  if (triggerOuts.length === 0) add({ code: 'dead_end', nodeId: triggerNode.id });
  else for (const edge of triggerOuts) walk(edge.target, new Set([triggerNode.id]));

  return issues;
}

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

export function outboundGraphReleasesMail(
  doc: WorkflowGraphDocument,
  opts?: FindOutboundGraphTrapsOptions,
): boolean {
  return findOutboundGraphTraps(doc, opts).length === 0;
}
