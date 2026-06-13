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
  | 'cc_address'
  | 'has_attachments'
  | 'attachment_names'
  | 'attachment_types';

export type ConditionOp =
  | 'contains'
  | 'equals'
  | 'regex'
  | 'domain_ends_with'
  | 'is_true'
  | 'is_false';

export type WorkflowCondition = {
  field: ConditionField;
  op: ConditionOp;
  value: string;
  caseInsensitive?: boolean;
};

/** Single condition or negated condition (for if/else branches). */
export type WorkflowConditionItem = WorkflowCondition | { not: WorkflowCondition };

export type WorkflowConditionGroup =
  | { all: WorkflowConditionItem[] }
  | { any: WorkflowConditionItem[] };

export type WorkflowRuleWhen = WorkflowCondition | WorkflowConditionGroup | null;

export type WorkflowThenStep =
  | { type: 'tag'; tag: string }
  | { type: 'mark_seen' }
  | { type: 'archive' }
  | { type: 'hold_outbound'; reason: string }
  | { type: 'set_category'; path: string }
  | { type: 'link_customer' }
  | { type: 'forward_copy'; to: string; includeAttachments?: boolean; runOutboundReview?: boolean }
  | { type: 'tag_attachment_meta'; tag: string }
  | { type: 'registry'; nodeType: string; config: Record<string, unknown> }
  | { type: 'ai_review'; promptId: number; blockKeyword?: string }
  | { type: 'stop' };

export type WorkflowRule = {
  when: WorkflowRuleWhen;
  then: WorkflowThenStep[];
};

import safeRegex from 'safe-regex';

export type WorkflowDefinitionV1 = {
  version: 1;
  rules: WorkflowRule[];
};

const MAX_REGEX_PATTERN_LEN = 240;

function splitAddressList(raw: string): string[] {
  return raw
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function domainFromAddress(addr: string): string {
  const at = addr.lastIndexOf('@');
  return at >= 0 ? addr.slice(at + 1).trim() : addr.trim();
}

function isAddressField(field: ConditionField): boolean {
  return field === 'from_address' || field === 'to_address' || field === 'cc_address';
}

function addressFieldValue(field: ConditionField, ctx: Record<string, string>): string {
  if (field === 'to_address') return ctx.to_address;
  if (field === 'cc_address') return ctx.cc_address;
  return ctx.from_address;
}

function domainEndsWithForField(
  field: ConditionField,
  ctx: Record<string, string>,
  suffix: string,
  ci: boolean,
): boolean {
  const src = addressFieldValue(field, ctx);
  const suf = ci ? suffix.toLowerCase() : suffix;
  for (const part of splitAddressList(src)) {
    const d = ci ? domainFromAddress(part).toLowerCase() : domainFromAddress(part);
    if (d.endsWith(suf)) return true;
  }
  return false;
}

function matchAddressListOp(
  field: ConditionField,
  ctx: Record<string, string>,
  op: 'contains' | 'equals' | 'regex',
  needle: string,
  ci: boolean,
): boolean {
  const parts = splitAddressList(addressFieldValue(field, ctx));
  if (parts.length === 0) {
    return op === 'equals' ? needle === '' : false;
  }
  for (const part of parts) {
    const haystack = ci ? part.toLowerCase() : part;
    const n = ci ? needle.toLowerCase() : needle;
    if (op === 'equals' && haystack === n) return true;
    if (op === 'contains' && haystack.includes(n)) return true;
    if (op === 'regex') {
      if (needle.length > MAX_REGEX_PATTERN_LEN) continue;
      try {
        if (!safeRegex(needle)) continue;
        const flags = ci ? 'i' : '';
        if (new RegExp(needle, flags).test(part)) return true;
      } catch {
        /* invalid pattern */
      }
    }
  }
  return false;
}

function matchSingleCondition(cond: WorkflowCondition, ctx: Record<string, string>): boolean {
  if (cond.field === 'has_attachments') {
    const has = ctx.has_attachments === 'true' || ctx.has_attachments === '1';
    if (cond.op === 'is_true') return has;
    if (cond.op === 'is_false') return !has;
    if (cond.op === 'equals') {
      const want = cond.value.toLowerCase() === 'true' || cond.value === '1';
      return has === want;
    }
    return false;
  }

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
    case 'attachment_names':
      haystack = ctx.attachment_names;
      break;
    case 'attachment_types':
      haystack = ctx.attachment_types;
      break;
    default:
      haystack = ctx.combined_text;
  }
  const needle = cond.value ?? '';
  const ci = cond.caseInsensitive !== false;

  if (cond.op === 'equals') {
    if (isAddressField(cond.field)) {
      return matchAddressListOp(cond.field, ctx, 'equals', needle, ci);
    }
    return ci ? haystack.toLowerCase() === needle.toLowerCase() : haystack === needle;
  }
  if (cond.op === 'contains') {
    if (!needle.trim()) return false;
    if (isAddressField(cond.field)) {
      return matchAddressListOp(cond.field, ctx, 'contains', needle, ci);
    }
    const h = ci ? haystack.toLowerCase() : haystack;
    const n = ci ? needle.toLowerCase() : needle;
    return h.includes(n);
  }
  if (cond.op === 'domain_ends_with') {
    const suf = ci ? needle.toLowerCase() : needle;
    return domainEndsWithForField(cond.field, ctx, suf, ci);
  }
  if (cond.op === 'regex') {
    if (isAddressField(cond.field)) {
      return matchAddressListOp(cond.field, ctx, 'regex', needle, ci);
    }
    if (needle.length > MAX_REGEX_PATTERN_LEN) {
      return false;
    }
    try {
      if (!safeRegex(needle)) {
        return false;
      }
      const flags = ci ? 'i' : '';
      return new RegExp(needle, flags).test(haystack);
    } catch {
      return false;
    }
  }
  return false;
}

export function matchConditionItem(item: WorkflowConditionItem, ctx: Record<string, string>): boolean {
  if ('not' in item && item.not) {
    return !matchSingleCondition(item.not, ctx);
  }
  return matchSingleCondition(item as WorkflowCondition, ctx);
}

export function evaluateWorkflowWhen(when: WorkflowRuleWhen, ctx: Record<string, string>): boolean {
  if (when == null) return true;
  if ('all' in when && Array.isArray(when.all)) {
    return when.all.every((c) => matchConditionItem(c, ctx));
  }
  if ('any' in when && Array.isArray(when.any)) {
    return when.any.some((c) => matchConditionItem(c, ctx));
  }
  if (typeof when === 'object' && when !== null && 'not' in when) {
    return matchConditionItem(when as WorkflowConditionItem, ctx);
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

/** Build attachment-related context fields from stored JSON metadata. */
export function attachmentContextFromJson(attachmentsJson: string | null, hasAttachments: number): {
  has_attachments: string;
  attachment_names: string;
  attachment_types: string;
} {
  let names: string[] = [];
  let types: string[] = [];
  if (attachmentsJson) {
    try {
      const parsed = JSON.parse(attachmentsJson) as unknown;
      if (Array.isArray(parsed)) {
        for (const a of parsed) {
          if (a && typeof a === 'object') {
            const row = a as { filename?: string | null; contentType?: string | null };
            if (row.filename) names.push(row.filename);
            if (row.contentType) types.push(row.contentType);
          }
        }
      } else if (parsed && typeof parsed === 'object') {
        const doc = parsed as {
          stored?: { name?: string; filename?: string; contentType?: string | null }[];
          omitted?: { name: string }[];
        };
        for (const a of doc.stored ?? []) {
          const n = a.name ?? a.filename;
          if (n) names.push(n);
          if (a.contentType) types.push(a.contentType);
        }
        for (const o of doc.omitted ?? []) {
          if (o.name) names.push(o.name);
        }
      }
    } catch {
      /* ignore */
    }
  }
  const has = Boolean(hasAttachments) || names.length > 0;
  return {
    has_attachments: has ? 'true' : 'false',
    attachment_names: names.join('\n'),
    attachment_types: types.join('\n'),
  };
}
