/**
 * Renderer-Zugriff auf die kanonischen Schema-Typen aus packages/core —
 * reiner Typ-Re-Export (kein Laufzeit-Code), damit es genau EINE Definition
 * gibt und nichts driften kann. Muster: shared/auth-login-security.ts.
 */
export type {
  WorkflowFieldType,
  WorkflowFieldOption,
  WorkflowFieldValidation,
  WorkflowNodeFieldSchema,
  WorkflowNodePortSchema,
  WorkflowNodeOutputSchema,
  WorkflowNodeDocsSchema,
  WorkflowNodeSchemaExtension,
} from '../packages/core/src/workflow/node-schema';
