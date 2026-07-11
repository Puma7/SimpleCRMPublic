import type { WorkflowNodeSchemaExtension } from '../node-schema';
import { AI_NODE_SCHEMAS } from './ai';
import { CODE_NODE_SCHEMAS } from './code';
import { CRM_NODE_SCHEMAS } from './crm';
import { EMAIL_NODE_SCHEMAS } from './email';
import { INTEGRATION_NODE_SCHEMAS } from './integration';
import { LOGIC_NODE_SCHEMAS } from './logic';

/** Alle Knoten-Schemata, keyed nach Knotentyp. Kategorie-Dateien daneben pflegen. */
export const WORKFLOW_NODE_SCHEMAS: Record<string, WorkflowNodeSchemaExtension> = {
  ...EMAIL_NODE_SCHEMAS,
  ...AI_NODE_SCHEMAS,
  ...LOGIC_NODE_SCHEMAS,
  ...CRM_NODE_SCHEMAS,
  ...INTEGRATION_NODE_SCHEMAS,
  ...CODE_NODE_SCHEMAS,
};

export function getWorkflowNodeSchema(type: string): WorkflowNodeSchemaExtension | undefined {
  return WORKFLOW_NODE_SCHEMAS[type];
}
