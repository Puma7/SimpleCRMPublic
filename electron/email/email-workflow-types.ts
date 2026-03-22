export type WorkflowTrigger = 'inbound' | 'outbound';

export type ConditionField =
  | 'subject'
  | 'body_text'
  | 'snippet'
  | 'from_address'
  | 'combined_text';

export type ConditionOp = 'contains' | 'equals' | 'regex' | 'domain_ends_with';

export type WorkflowCondition = {
  field: ConditionField;
  op: ConditionOp;
  value: string;
  caseInsensitive?: boolean;
};

export type WorkflowThenStep =
  | { type: 'tag'; tag: string }
  | { type: 'mark_seen' }
  | { type: 'archive' }
  | { type: 'hold_outbound'; reason: string }
  | { type: 'set_category'; path: string }
  | { type: 'link_customer' }
  | { type: 'stop' };

export type WorkflowRule = {
  when: WorkflowCondition | null;
  then: WorkflowThenStep[];
};

export type WorkflowDefinitionV1 = {
  version: 1;
  rules: WorkflowRule[];
};

export function parseWorkflowDefinition(json: string): WorkflowDefinitionV1 {
  const parsed = JSON.parse(json) as unknown;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Ungültige Workflow-Definition');
  }
  const p = parsed as WorkflowDefinitionV1;
  if (p.version !== 1 || !Array.isArray(p.rules)) {
    throw new Error('Workflow-Definition: version 1 und rules[] erforderlich');
  }
  return p;
}
