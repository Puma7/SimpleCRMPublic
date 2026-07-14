import { listBuiltinWorkflowNodeCatalog } from '../../packages/core/src/workflow/node-catalog';
import {
  WORKFLOW_TEMPLATES as ALL_WORKFLOW_TEMPLATES,
  type WorkflowTemplate,
} from '../../packages/core/src/workflow/templates';

const SERVER_ONLY_NODE_TYPES = new Set(
  listBuiltinWorkflowNodeCatalog()
    .filter((entry) => entry.runtime === 'server')
    .map((entry) => entry.type),
);

export const WORKFLOW_TEMPLATES = ALL_WORKFLOW_TEMPLATES.filter((template) => (
  template.graph.nodes.every((node) => (
    typeof node.data.nodeType !== 'string' || !SERVER_ONLY_NODE_TYPES.has(node.data.nodeType)
  ))
));

export function getWorkflowTemplate(id: string): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find((template) => template.id === id);
}

export type { WorkflowTemplate };
