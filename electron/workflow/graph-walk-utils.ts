import type { WorkflowGraphDocument, WorkflowGraphEdge } from '../../shared/email-workflow-graph';
import {
  outgoing as coreOutgoing,
  parseGraphDocument as coreParseGraphDocument,
  pickEdge as corePickEdge,
  resolveResumeNodeAfter as coreResolveResumeNodeAfter,
  type WorkflowGraphDocument as CoreWorkflowGraphDocument,
  type WorkflowGraphEdge as CoreWorkflowGraphEdge,
} from '../../packages/core/src/workflow';

function toCoreDocument(doc: WorkflowGraphDocument): CoreWorkflowGraphDocument {
  return doc as unknown as CoreWorkflowGraphDocument;
}

function toCoreEdges(edges: WorkflowGraphEdge[]): CoreWorkflowGraphEdge[] {
  return edges as unknown as CoreWorkflowGraphEdge[];
}

export function outgoing(edges: WorkflowGraphEdge[], sourceId: string): WorkflowGraphEdge[] {
  return coreOutgoing(toCoreEdges(edges), sourceId) as unknown as WorkflowGraphEdge[];
}

export function pickEdge(
  edges: WorkflowGraphEdge[],
  port: 'yes' | 'no' | 'default' | string,
): WorkflowGraphEdge | undefined {
  return corePickEdge(toCoreEdges(edges), port) as unknown as WorkflowGraphEdge | undefined;
}

export function parseGraphDocument(json: string | null): WorkflowGraphDocument | null {
  return coreParseGraphDocument(json) as unknown as WorkflowGraphDocument | null;
}

export function resolveResumeNodeAfter(
  doc: WorkflowGraphDocument,
  nodeId: string,
): string | null {
  return coreResolveResumeNodeAfter(toCoreDocument(doc), nodeId);
}

export type { WorkflowGraphDocument, WorkflowGraphEdge };
