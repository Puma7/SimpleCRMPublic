import type { WorkflowGraphDocument, WorkflowGraphEdge } from './graph-types';

export function outgoing(edges: WorkflowGraphEdge[], sourceId: string): WorkflowGraphEdge[] {
  return edges.filter((edge) => edge.source === sourceId).sort((a, b) => a.id.localeCompare(b.id));
}

function edgeIsYes(edge: WorkflowGraphEdge): boolean {
  const label = (edge.label ?? '').toLowerCase();
  return !label || label === 'yes' || label === 'ja' || label === 'true' || label === 'success';
}

function edgeIsNo(edge: WorkflowGraphEdge): boolean {
  const label = (edge.label ?? '').toLowerCase();
  return label === 'no' || label === 'nein' || label === 'false' || label === 'error';
}

function edgeIsDone(edge: WorkflowGraphEdge): boolean {
  const label = (edge.label ?? '').toLowerCase();
  return label === 'done' || label === 'fertig' || label === 'end';
}

function edgeIsEach(edge: WorkflowGraphEdge): boolean {
  const label = (edge.label ?? '').toLowerCase();
  return label === 'each' || label === 'je' || label === 'loop';
}

export function edgeIsDefault(edge: WorkflowGraphEdge): boolean {
  const label = (edge.label ?? '').toLowerCase();
  return !label || label === 'default' || label === 'standard' || label === 'fallback';
}

export function pickEdge(
  edges: WorkflowGraphEdge[],
  port: 'yes' | 'no' | 'default' | string,
): WorkflowGraphEdge | undefined {
  if (edges.length === 0) return undefined;

  if (typeof port === 'string' && port !== 'yes' && port !== 'no' && port !== 'default') {
    const lower = port.toLowerCase();
    const byLabel = edges.find((edge) => (edge.label ?? '').toLowerCase() === lower);
    if (byLabel) return byLabel;
    // „ok“ darf auf eine unbeschriftete Default-Kante fallen (Abwärtskompatibilität).
    if (lower === 'ok') {
      return edges.find((edge) => edgeIsDefault(edge));
    }
    // Fail-closed nur für explizite Hold/Block-Ausgänge — andere Ports (z. B. approved,
    // send_tracking-Fallback) fallen wie bisher auf die Default-Kante durch.
    if (lower === 'block' || lower === 'error' || lower === 'hold' || lower === 'send') {
      return undefined;
    }
  }
  if (port === 'yes') return edges.find((edge) => edgeIsYes(edge));
  // Do not fall back to the first/yes edge when the condition failed. That caused
  // inbound workflows to archive every message when only a "ja" branch was wired.
  if (port === 'no') return edges.find((edge) => edgeIsNo(edge));
  if (port === 'done') return edges.find((edge) => edgeIsDone(edge)) ?? undefined;
  if (port === 'each') return edges.find((edge) => edgeIsEach(edge)) ?? edges[0];

  return edges.find((edge) => edgeIsDefault(edge));
}

export function parseGraphDocument(json: string | null): WorkflowGraphDocument | null {
  if (!json?.trim()) return null;

  try {
    const doc = JSON.parse(json) as WorkflowGraphDocument;
    if (doc.version !== 1 || !Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) return null;
    return doc;
  } catch {
    return null;
  }
}

/** Resolve next node id after a delay node for job scheduling. */
export function resolveResumeNodeAfter(
  doc: WorkflowGraphDocument,
  nodeId: string,
): string | null {
  const outs = outgoing(doc.edges, nodeId);
  const okEdge = pickEdge(outs, 'ok');
  if (okEdge) return okEdge.target;
  const next = pickEdge(outs, 'default');
  return next?.target ?? null;
}

/** Resolve the target node id for a named port on a node (e.g. ai.outbound_review). */
export function resolveResumeNodeAfterPort(
  doc: WorkflowGraphDocument,
  nodeId: string,
  port: string,
): string | null {
  const outs = outgoing(doc.edges, nodeId);
  const next = pickEdge(outs, port);
  return next?.target ?? null;
}
