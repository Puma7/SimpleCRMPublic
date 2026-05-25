import type { WorkflowGraphDocument, WorkflowGraphEdge } from '../../shared/email-workflow-graph';

export function outgoing(edges: WorkflowGraphEdge[], sourceId: string): WorkflowGraphEdge[] {
  return edges.filter((e) => e.source === sourceId).sort((a, b) => a.id.localeCompare(b.id));
}

function edgeIsYes(e: WorkflowGraphEdge): boolean {
  const l = (e.label ?? '').toLowerCase();
  return !l || l === 'yes' || l === 'ja' || l === 'true' || l === 'success';
}

function edgeIsNo(e: WorkflowGraphEdge): boolean {
  const l = (e.label ?? '').toLowerCase();
  return l === 'no' || l === 'nein' || l === 'false' || l === 'error';
}

function edgeIsDone(e: WorkflowGraphEdge): boolean {
  const l = (e.label ?? '').toLowerCase();
  return l === 'done' || l === 'fertig' || l === 'end';
}

function edgeIsEach(e: WorkflowGraphEdge): boolean {
  const l = (e.label ?? '').toLowerCase();
  return l === 'each' || l === 'je' || l === 'loop';
}

export function pickEdge(
  edges: WorkflowGraphEdge[],
  port: 'yes' | 'no' | 'default' | string,
): WorkflowGraphEdge | undefined {
  if (edges.length === 0) return undefined;
  if (typeof port === 'string' && port !== 'yes' && port !== 'no' && port !== 'default') {
    const lower = port.toLowerCase();
    const byLabel = edges.find((e) => (e.label ?? '').toLowerCase() === lower);
    if (byLabel) return byLabel;
  }
  if (port === 'yes') return edges.find((e) => edgeIsYes(e));
  // Do not fall back to the first/yes edge when the condition failed — that caused
  // inbound workflows to archive every message when only a "ja" branch was wired.
  if (port === 'no') return edges.find((e) => edgeIsNo(e));
  if (port === 'done') return edges.find((e) => edgeIsDone(e)) ?? undefined;
  if (port === 'each') return edges.find((e) => edgeIsEach(e)) ?? edges[0];
  return edges[0];
}

export function parseGraphDocument(json: string | null): WorkflowGraphDocument | null {
  if (!json?.trim()) return null;
  try {
    const doc = JSON.parse(json) as WorkflowGraphDocument;
    if (doc.version !== 1 || !Array.isArray(doc.nodes)) return null;
    return doc;
  } catch {
    return null;
  }
}

/** Resolve next node id after a delay node for job scheduling */
export function resolveResumeNodeAfter(
  doc: WorkflowGraphDocument,
  nodeId: string,
): string | null {
  const outs = outgoing(doc.edges, nodeId);
  const next = pickEdge(outs, 'default');
  return next?.target ?? null;
}
