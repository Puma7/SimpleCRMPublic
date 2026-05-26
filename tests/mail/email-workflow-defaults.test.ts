import {
  DEFAULT_INBOUND_WORKFLOW,
  DEFAULT_OUTBOUND_WORKFLOW,
} from '../../electron/email/email-workflow-defaults';

describe('email-workflow-defaults', () => {
  test('default workflows are valid v1 definitions', () => {
    expect(DEFAULT_INBOUND_WORKFLOW.version).toBe(1);
    expect(DEFAULT_INBOUND_WORKFLOW.rules.length).toBeGreaterThan(0);
    expect(DEFAULT_OUTBOUND_WORKFLOW.rules[0]?.then.some((s) => s.type === 'hold_outbound')).toBe(
      true,
    );
  });
});
