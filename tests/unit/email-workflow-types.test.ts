import {
  evaluateWorkflowWhen,
  parseWorkflowDefinition,
} from '../../electron/email/email-workflow-types';

describe('email-workflow-types', () => {
  const ctx = {
    subject: 'Rechnung Mai',
    body_text: '',
    snippet: '',
    from_address: 'kunde@example.com',
    to_address: 'info@firma.de, rechnung@firma.de',
    cc_address: '',
    combined_text: 'Rechnung Mai kunde@example.com info@firma.de rechnung@firma.de',
  };

  it('matches to_address contains per recipient (Rechnung routing)', () => {
    expect(
      evaluateWorkflowWhen(
        { field: 'to_address', op: 'contains', value: 'rechnung@', caseInsensitive: true },
        ctx,
      ),
    ).toBe(true);
  });

  it('matches to_address equals on a single recipient in a list', () => {
    expect(
      evaluateWorkflowWhen(
        { field: 'to_address', op: 'equals', value: 'rechnung@firma.de', caseInsensitive: true },
        ctx,
      ),
    ).toBe(true);
    expect(
      evaluateWorkflowWhen(
        { field: 'to_address', op: 'equals', value: 'info@firma.de', caseInsensitive: true },
        ctx,
      ),
    ).toBe(true);
  });

  it('does not false-positive equals on full joined address string', () => {
    expect(
      evaluateWorkflowWhen(
        { field: 'to_address', op: 'equals', value: 'rechnung@firma.de', caseInsensitive: true },
        ctx,
      ),
    ).toBe(true);
    expect(
      evaluateWorkflowWhen(
        {
          field: 'to_address',
          op: 'equals',
          value: 'info@firma.de, rechnung@firma.de',
          caseInsensitive: true,
        },
        ctx,
      ),
    ).toBe(false);
  });

  it('matches domain_ends_with per recipient', () => {
    expect(
      evaluateWorkflowWhen(
        { field: 'to_address', op: 'domain_ends_with', value: 'firma.de', caseInsensitive: true },
        ctx,
      ),
    ).toBe(true);
  });

  it('parses workflow definition v1', () => {
    const def = parseWorkflowDefinition(
      JSON.stringify({ version: 1, rules: [{ when: null, then: [{ type: 'stop' }] }] }),
    );
    expect(def.version).toBe(1);
    expect(def.rules).toHaveLength(1);
  });
});
