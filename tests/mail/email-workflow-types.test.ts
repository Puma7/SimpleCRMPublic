import {
  attachmentContextFromJson,
  evaluateWorkflowWhen,
  matchConditionItem,
  parseWorkflowDefinition,
} from '../../electron/email/email-workflow-types';
import type { WorkflowCondition, WorkflowConditionItem } from '../../electron/email/email-workflow-types';

const ctx = (over: Record<string, string> = {}): Record<string, string> => ({
  subject: 'Hello World',
  body_text: 'Body content here',
  snippet: 'Hello',
  from_address: 'sender@example.com',
  to_address: 'a@b.de, b@c.de',
  cc_address: 'cc@x.org',
  combined_text: 'Hello Body sender@example.com',
  has_attachments: 'false',
  attachment_names: '',
  attachment_types: '',
  ...over,
});

describe('email-workflow-types', () => {
  describe('evaluateWorkflowWhen', () => {
    test('null when matches', () => {
      expect(evaluateWorkflowWhen(null, ctx())).toBe(true);
    });

    test('all and any groups', () => {
      expect(
        evaluateWorkflowWhen(
          { all: [{ field: 'subject', op: 'contains', value: 'Hello' }] },
          ctx(),
        ),
      ).toBe(true);
      expect(
        evaluateWorkflowWhen(
          { any: [{ field: 'subject', op: 'contains', value: 'Missing' }] },
          ctx(),
        ),
      ).toBe(false);
    });

    test('not wrapper on when', () => {
      expect(
        evaluateWorkflowWhen({ not: { field: 'subject', op: 'contains', value: 'Missing' } }, ctx()),
      ).toBe(true);
    });
  });

  describe('matchConditionItem not', () => {
    test('negates inner condition', () => {
      const item: WorkflowConditionItem = { not: { field: 'subject', op: 'equals', value: 'Hello World' } };
      expect(matchConditionItem(item, ctx())).toBe(false);
    });
  });

  describe('has_attachments ops', () => {
    test('is_true is_false equals', () => {
      expect(matchConditionItem({ field: 'has_attachments', op: 'is_true', value: '' }, ctx({ has_attachments: '1' }))).toBe(true);
      expect(matchConditionItem({ field: 'has_attachments', op: 'is_false', value: '' }, ctx())).toBe(true);
      expect(matchConditionItem({ field: 'has_attachments', op: 'equals', value: 'true' }, ctx({ has_attachments: 'true' }))).toBe(true);
      expect(matchConditionItem({ field: 'has_attachments', op: 'contains', value: 'x' }, ctx())).toBe(false);
    });
  });

  describe('text fields equals contains regex', () => {
    test('subject body snippet combined attachment fields default', () => {
      expect(matchConditionItem({ field: 'subject', op: 'contains', value: 'Hello' }, ctx())).toBe(true);
      expect(matchConditionItem({ field: 'body_text', op: 'contains', value: 'Body' }, ctx())).toBe(true);
      expect(matchConditionItem({ field: 'snippet', op: 'contains', value: 'Hello' }, ctx())).toBe(true);
      expect(matchConditionItem({ field: 'combined_text', op: 'contains', value: 'sender' }, ctx())).toBe(true);
      expect(
        matchConditionItem(
          { field: 'attachment_names', op: 'contains', value: 'pdf' },
          ctx({ attachment_names: 'file.pdf' }),
        ),
      ).toBe(true);
      expect(
        matchConditionItem(
          { field: 'attachment_types', op: 'contains', value: 'pdf' },
          ctx({ attachment_types: 'application/pdf' }),
        ),
      ).toBe(true);
      expect(
        matchConditionItem(
          { field: 'unknown_field' as 'subject', op: 'contains', value: 'Hello' },
          ctx(),
        ),
      ).toBe(true);
      expect(matchConditionItem({ field: 'subject', op: 'equals', value: 'Hello World' }, ctx())).toBe(true);
      expect(matchConditionItem({ field: 'subject', op: 'equals', value: 'hello world', caseInsensitive: true }, ctx())).toBe(true);
      expect(matchConditionItem({ field: 'subject', op: 'contains', value: '  ' }, ctx())).toBe(false);
      expect(matchConditionItem({ field: 'subject', op: 'regex', value: 'Hel+o' }, ctx())).toBe(true);
      expect(matchConditionItem({ field: 'subject', op: 'regex', value: 'x'.repeat(300) }, ctx())).toBe(false);
      expect(matchConditionItem({ field: 'subject', op: 'regex', value: '(unclosed' }, ctx())).toBe(false);
      expect(matchConditionItem({ field: 'subject', op: 'regex', value: 'a{1000000}' }, ctx())).toBe(false);
    });
  });

  describe('address fields', () => {
    test('equals contains regex domain_ends_with for from to cc', () => {
      expect(matchConditionItem({ field: 'from_address', op: 'equals', value: 'sender@example.com' }, ctx())).toBe(true);
      expect(matchConditionItem({ field: 'to_address', op: 'equals', value: 'a@b.de' }, ctx())).toBe(true);
      expect(matchConditionItem({ field: 'cc_address', op: 'equals', value: 'cc@x.org' }, ctx())).toBe(true);
      expect(matchConditionItem({ field: 'from_address', op: 'contains', value: 'example.com' }, ctx())).toBe(true);
      expect(matchConditionItem({ field: 'to_address', op: 'contains', value: 'b.de' }, ctx())).toBe(true);
      expect(
        matchConditionItem(
          { field: 'from_address', op: 'domain_ends_with', value: 'example.com' },
          ctx({ from_address: 'x@mail.example.com' }),
        ),
      ).toBe(true);
      expect(matchConditionItem({ field: 'to_address', op: 'regex', value: '@b\\.de$' }, ctx())).toBe(true);
      expect(matchConditionItem({ field: 'to_address', op: 'equals', value: '' }, ctx({ to_address: '' }))).toBe(true);
      expect(matchConditionItem({ field: 'to_address', op: 'contains', value: 'z' }, ctx({ to_address: '' }))).toBe(false);
      expect(matchConditionItem({ field: 'from_address', op: 'regex', value: 'x'.repeat(300) }, ctx())).toBe(false);
      expect(matchConditionItem({ field: 'from_address', op: 'regex', value: '(bad' }, ctx())).toBe(false);
      expect(matchConditionItem({ field: 'from_address', op: 'domain_ends_with', value: 'ORG' }, ctx({ from_address: 'a@X.ORG' }))).toBe(true);
      expect(
        matchConditionItem(
          { field: 'cc_address', op: 'domain_ends_with', value: 'x.org' },
          ctx({ cc_address: 'cc@x.org' }),
        ),
      ).toBe(true);
      expect(
        matchConditionItem(
          { field: 'subject', op: 'equals', value: 'Hello World', caseInsensitive: false },
          ctx(),
        ),
      ).toBe(true);
    });
  });

  describe('parseWorkflowDefinition', () => {
    test('valid v1', () => {
      const d = parseWorkflowDefinition(JSON.stringify({ version: 1, rules: [] }));
      expect(d.version).toBe(1);
    });

    test('invalid shapes throw', () => {
      expect(() => parseWorkflowDefinition('null')).toThrow(/Ungültige/);
      expect(() => parseWorkflowDefinition(JSON.stringify({ version: 2, rules: [] }))).toThrow(/version 1/);
      expect(() => parseWorkflowDefinition(JSON.stringify({ version: 1 }))).toThrow(/rules/);
    });
  });

  describe('attachmentContextFromJson', () => {
    test('array attachments', () => {
      const r = attachmentContextFromJson(
        JSON.stringify([{ filename: 'a.pdf', contentType: 'application/pdf' }]),
        0,
      );
      expect(r.has_attachments).toBe('true');
      expect(r.attachment_names).toContain('a.pdf');
    });

    test('stored/omitted object shape', () => {
      const r = attachmentContextFromJson(
        JSON.stringify({
          stored: [{ name: 'b.txt', contentType: 'text/plain' }],
          omitted: [{ name: 'big.zip' }],
        }),
        0,
      );
      expect(r.attachment_names).toContain('b.txt');
      expect(r.attachment_names).toContain('big.zip');
    });

    test('invalid json and empty', () => {
      expect(attachmentContextFromJson(null, 1).has_attachments).toBe('true');
      expect(attachmentContextFromJson('{bad', 0).has_attachments).toBe('false');
      expect(attachmentContextFromJson(JSON.stringify({ not: 'array' }), 0).has_attachments).toBe('false');
    });
  });
});
