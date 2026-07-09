import { resolveScopedAccountOverrides } from '../../shared/mail-account-overrides';

describe('account knowledge slot matching', () => {
  it('resolveScopedAccountOverrides matches account rows with numeric string ids', () => {
    const rows = [
      {
        id: 1,
        name: 'Global inbound',
        account_id: null,
        override_key: 'kb.inbound',
        knowledge_context: 'inbound',
      },
      {
        id: 2,
        name: 'Account inbound',
        account_id: '7' as unknown as number,
        override_key: 'kb.inbound',
        knowledge_context: 'inbound',
      },
    ];
    const merged = resolveScopedAccountOverrides(rows, 7);
    const accountRow = merged.find((r) => r.knowledge_context === 'inbound');
    expect(accountRow?.id).toBe(2);
    expect(accountRow?.account_id).toBe('7');
  });
});
