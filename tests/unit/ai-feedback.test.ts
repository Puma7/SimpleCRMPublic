import { computeTextChangeRatio, recordAiReplyFeedbackSafe } from '../../packages/server/src';

const WS = '11111111-1111-4111-8111-111111111111';

describe('computeTextChangeRatio (word-level Jaccard distance)', () => {
  test('0 for identical word sets, 1 for disjoint', () => {
    expect(computeTextChangeRatio('hallo welt', 'hallo welt')).toBe(0);
    expect(computeTextChangeRatio('hallo welt', 'foo bar')).toBe(1);
  });

  test('partial change yields a value between 0 and 1', () => {
    // {sehr,geehrte,frau,meier} vs {sehr,geehrte,frau,meier,danke} -> 1/5
    const ratio = computeTextChangeRatio('Sehr geehrte Frau Meier', 'Sehr geehrte Frau Meier danke');
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThan(1);
    expect(ratio).toBeCloseTo(0.2, 3);
  });

  test('punctuation/case do not count as changes', () => {
    expect(computeTextChangeRatio('Hallo, Welt!', 'hallo welt')).toBe(0);
  });

  test('both empty -> 0, one empty -> 1', () => {
    expect(computeTextChangeRatio('', '')).toBe(0);
    expect(computeTextChangeRatio('hallo', '')).toBe(1);
  });
});

describe('recordAiReplyFeedbackSafe', () => {
  function fakeDb(captured: Array<{ table: string; values: Record<string, unknown> }>, opts: { throwOnInsert?: boolean } = {}) {
    const trx = {
      insertInto: (table: string) => ({
        values: (values: Record<string, unknown>) => ({
          execute: async () => {
            if (opts.throwOnInsert) throw new Error('insert failed');
            captured.push({ table, values });
          },
        }),
      }),
    };
    return { transaction: () => ({ execute: async (cb: (t: typeof trx) => Promise<unknown>) => cb(trx) }) } as never;
  }

  test('records lengths + change ratio', async () => {
    const captured: Array<{ table: string; values: Record<string, unknown> }> = [];
    await recordAiReplyFeedbackSafe(
      { db: fakeDb(captured), applyWorkspaceSession: async () => {}, now: () => new Date('2026-06-06T00:00:00.000Z') },
      { workspaceId: WS, messageId: 42, nodeType: 'compose.send', suggestion: 'Sehr geehrte Frau Meier', sent: 'Sehr geehrte Frau Meier danke' },
    );
    expect(captured).toHaveLength(1);
    expect(captured[0].table).toBe('ai_reply_feedback');
    expect(captured[0].values).toMatchObject({
      workspace_id: WS,
      message_id: 42,
      node_type: 'compose.send',
      suggestion_len: 'Sehr geehrte Frau Meier'.length,
      sent_len: 'Sehr geehrte Frau Meier danke'.length,
    });
    expect(captured[0].values.changed_ratio).toBeCloseTo(0.2, 3);
  });

  test('skips empty suggestions and never throws', async () => {
    const captured: Array<{ table: string; values: Record<string, unknown> }> = [];
    await recordAiReplyFeedbackSafe({ db: fakeDb(captured), applyWorkspaceSession: async () => {} },
      { workspaceId: WS, messageId: 1, nodeType: 'compose.send', suggestion: '   ', sent: 'x' });
    expect(captured).toHaveLength(0);

    await expect(
      recordAiReplyFeedbackSafe({ db: fakeDb(captured, { throwOnInsert: true }), applyWorkspaceSession: async () => {} },
        { workspaceId: WS, messageId: 1, nodeType: 'compose.send', suggestion: 'a b', sent: 'c d' }),
    ).resolves.toBeUndefined();
  });
});
