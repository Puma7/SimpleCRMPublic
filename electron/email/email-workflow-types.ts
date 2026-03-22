export type WorkflowTrigger =
  | 'inbound'
  | 'outbound'
  | 'draft_created'
  | 'schedule';

export type ConditionField =
  | 'subject'
  | 'body_text'
  | 'snippet'
  | 'from_address'
  | 'combined_text'
  | 'to_address'
  | 'cc_address';

export type ConditionOp = 'contains' | 'equals' | 'regex' | 'domain_ends_with';

export type WorkflowCondition = {
  field: ConditionField;
  op: ConditionOp;
  value: string;
  caseInsensitive?: boolean;
};

export type WorkflowConditionGroup = { all: WorkflowCondition[] };

export type WorkflowThenStep =
  | { type: 'tag'; tag: string }
  | { type: 'mark_seen' }
  | { type: 'archive' }
  | { type: 'hold_outbound'; reason: string }
  | { type: 'set_category'; path: string }
  | { type: 'link_customer' }
  | { type: 'forward_copy'; to: string }
  | { type: 'tag_attachment_meta'; tag: string }
  | { type: 'stop' };

export type WorkflowRule = {
  when: WorkflowCondition | WorkflowConditionGroup | null;
  then: WorkflowThenStep[];
};

export type WorkflowDefinitionV1 = {
  version: 1;
  rules: WorkflowRule[];
};

function matchSingleCondition(cond: WorkflowCondition, ctx: Record<string, string>): boolean {
  let haystack = '';
  switch (cond.field) {
    case 'subject':
      haystack = ctx.subject;
      break;
    case 'body_text':
      haystack = ctx.body_text;
      break;
    case 'snippet':
      haystack = ctx.snippet;
      break;
    case 'from_address':
      haystack = ctx.from_address;
      break;
    case 'to_address':
      haystack = ctx.to_address;
      break;
    case 'cc_address':
      haystack = ctx.cc_address;
      break;
    case 'combined_text':
      haystack = ctx.combined_text;
      break;
    default:
      haystack = ctx.combined_text;
  }
  const needle = cond.value ?? '';
  const ci = cond.caseInsensitive !== false;

  if (cond.op === 'equals') {
    return ci ? haystack.toLowerCase() === needle.toLowerCase() : haystack === needle;
  }
  if (cond.op === 'contains') {
    const h = ci ? haystack.toLowerCase() : haystack;
    const n = ci ? needle.toLowerCase() : needle;
    return h.includes(n);
  }
  if (cond.op === 'domain_ends_with') {
    const src =
      cond.field === 'to_address'
        ? ctx.to_address
        : cond.field === 'cc_address'
          ? ctx.cc_address
          : ctx.from_address;
    const at = src.lastIndexOf('@');
    const domain = at >= 0 ? src.slice(at + 1) : src;
    const d = ci ? domain.toLowerCase() : domain;
    const suf = ci ? needle.toLowerCase() : needle;
    return d.endsWith(suf);
  }
  if (cond.op === 'regex') {
    try {
      const flags = ci ? 'i' : '';
      return new RegExp(needle, flags).test(haystack);
    } catch {
      return false;
    }
  }
  return false;
}

export function evaluateWorkflowWhen(
  when: WorkflowRule['when'],
  ctx: Record<string, string>,
): boolean {
  if (when == null) return true;
  if ('all' in when && Array.isArray(when.all)) {
    return when.all.every((c) => matchSingleCondition(c, ctx));
  }
  return matchSingleCondition(when as WorkflowCondition, ctx);
}

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
