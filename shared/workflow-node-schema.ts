/**
 * Spiegel von `packages/core/src/workflow/node-schema.ts` für den Renderer
 * (der Renderer darf @simplecrm/core nicht importieren).
 *
 * NICHT eigenständig ändern — beide Dateien müssen strukturell identisch
 * bleiben; tests/unit/workflow-node-catalog-sync.test.ts erzwingt die
 * wechselseitige Zuweisbarkeit.
 */

export type WorkflowFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'boolean'
  | 'select'
  | 'aiProfile'
  | 'promptId'
  | 'knowledgeBase'
  | 'cannedResponse'
  | 'teamMember'
  | 'account'
  | 'workflowRef'
  | 'variableName'
  | 'variableRef'
  | 'categoryPath'
  | 'duration'
  | 'cron'
  | 'code';

export type WorkflowFieldOption = {
  value: string;
  label: string;
  description?: string;
};

export type WorkflowFieldValidation = {
  min?: number;
  max?: number;
  integer?: boolean;
  pattern?: string;
  patternHint?: string;
  maxLength?: number;
};

export type WorkflowNodeFieldSchema = {
  key: string;
  type: WorkflowFieldType;
  label: string;
  help?: string;
  example?: string;
  placeholder?: string;
  required?: boolean;
  options?: WorkflowFieldOption[];
  validation?: WorkflowFieldValidation;
  interpolate?: boolean;
  advanced?: boolean;
  language?: 'javascript' | 'python';
  showIf?: { field: string; equals: unknown };
};

export type WorkflowNodePortSchema = {
  id: string;
  label: string;
  description?: string;
  kind: 'success' | 'branch' | 'failure';
  color?: 'emerald' | 'amber' | 'red' | 'violet' | 'sky';
  synonyms?: string[];
};

export type WorkflowNodeOutputSchema = {
  name: string;
  label: string;
  description?: string;
  example?: string;
  type: 'string' | 'number' | 'boolean';
  dynamicFromField?: string;
};

export type WorkflowNodeDocsSchema = {
  longHelp?: string;
  prerequisites?: string[];
  seeAlso?: string[];
};

export type WorkflowNodeSchemaExtension = {
  fields?: WorkflowNodeFieldSchema[];
  ports?: WorkflowNodePortSchema[];
  outputs?: WorkflowNodeOutputSchema[];
  docs?: WorkflowNodeDocsSchema;
  customWidget?: string;
};
