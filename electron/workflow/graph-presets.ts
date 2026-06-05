import type { WorkflowGraphDocument } from '../../shared/email-workflow-graph';
import type { WorkflowTriggerKind } from '../../shared/workflow-types';
import {
  buildBlankWorkflowGraph as coreBuildBlankWorkflowGraph,
  buildDefaultInboundGraph as coreBuildDefaultInboundGraph,
  buildDefaultOutboundGraph as coreBuildDefaultOutboundGraph,
  graphHasRunnableNodes as coreGraphHasRunnableNodes,
  type WorkflowGraphDocument as CoreWorkflowGraphDocument,
  type WorkflowTriggerKind as CoreWorkflowTriggerKind,
} from '../../packages/core/src/workflow';

function toCoreDocument(doc: WorkflowGraphDocument): CoreWorkflowGraphDocument {
  return doc as unknown as CoreWorkflowGraphDocument;
}

function fromCoreDocument(doc: CoreWorkflowGraphDocument): WorkflowGraphDocument {
  return doc as unknown as WorkflowGraphDocument;
}

export function graphHasRunnableNodes(doc: WorkflowGraphDocument | null): boolean {
  return coreGraphHasRunnableNodes(doc ? toCoreDocument(doc) : null);
}

export function buildBlankWorkflowGraph(trigger: WorkflowTriggerKind): WorkflowGraphDocument {
  return fromCoreDocument(coreBuildBlankWorkflowGraph(trigger as CoreWorkflowTriggerKind));
}

export function buildDefaultInboundGraph(): WorkflowGraphDocument {
  return fromCoreDocument(coreBuildDefaultInboundGraph());
}

export function buildDefaultOutboundGraph(): WorkflowGraphDocument {
  return fromCoreDocument(coreBuildDefaultOutboundGraph());
}
