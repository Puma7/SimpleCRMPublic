import { listAiPrompts, moveAiPrompt } from '../../electron/email/email-crm-store';

const prompts = [
  { id: 1, label: 'A', user_template: 'a', target: 'full_body', sort_order: 0 },
  { id: 2, label: 'B', user_template: 'b', target: 'full_body', sort_order: 1 },
];

jest.mock('../../electron/sqlite-service', () => {
  const prepare = jest.fn((sql: string) => ({
    all: () =>
      [...prompts].sort(
        (a, b) => a.sort_order - b.sort_order || a.id - b.id,
      ),
    run: (...args: unknown[]) => {
      if (sql.includes('UPDATE') && sql.includes('sort_order')) {
        const row = prompts.find((p) => p.id === args[1]);
        if (row) row.sort_order = args[0] as number;
      }
      return { changes: 1 };
    },
  }));
  return { getDb: () => ({ prepare }) };
});

describe('moveAiPrompt', () => {
  beforeEach(() => {
    prompts[0]!.sort_order = 0;
    prompts[1]!.sort_order = 1;
  });

  it('swaps sort_order with neighbour below', () => {
    expect(moveAiPrompt(1, 'down')).toBe(true);
    expect(listAiPrompts().map((r) => r.label)).toEqual(['B', 'A']);
  });

  it('returns false when already at top', () => {
    expect(moveAiPrompt(1, 'up')).toBe(false);
  });
});
