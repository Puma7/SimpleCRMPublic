import {
  listBuiltinWorkflowNodeCatalog,
  type WorkflowNodeCatalogEntry,
} from '@simplecrm/core';

import type { ServerApiPorts } from './api/types';

const SERVER_UNSUPPORTED_WORKFLOW_NODE_TYPES = new Set([
  'code.javascript',
  'code.python',
  'plugin.custom',
]);

export function createStaticWorkflowNodeCatalogPort(): NonNullable<ServerApiPorts['workflowNodeCatalog']> {
  return {
    list() {
      return listServerWorkflowNodeCatalog();
    },
  };
}

export function listServerWorkflowNodeCatalog(): WorkflowNodeCatalogEntry[] {
  return listBuiltinWorkflowNodeCatalog()
    .filter((entry) => isServerWorkflowNodeTypeSupported(entry.type));
}

export function isServerWorkflowNodeTypeSupported(type: string): boolean {
  return !SERVER_UNSUPPORTED_WORKFLOW_NODE_TYPES.has(type);
}
