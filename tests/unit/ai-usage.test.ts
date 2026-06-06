import {
  estimateAiCostMicroUsd,
  extractChatCompletionUsage,
  recordAiUsageSafe,
} from '../../packages/server/src';

const WS = '11111111-1111-4111-8111-111111111111';

describe('extractChatCompletionUsage', () => {
  test('parses the OpenAI-style usage object', () => {
    const body = JSON.stringify({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
    });
    expect(extractChatCompletionUsage(body)).toEqual({
      promptTokens: 120,
      completionTokens: 30,
      totalTokens: 150,
    });
  });

  test('derives total from prompt+completion when missing', () => {
    const body = JSON.stringify({ usage: { prompt_tokens: 100, completion_tokens: 25 } });
    expect(extractChatCompletionUsage(body)).toEqual({
      promptTokens: 100,
      completionTokens: 25,
      totalTokens: 125,
    });
  });

  test('returns null for non-JSON or missing usage', () => {
    expect(extractChatCompletionUsage('not json')).toBeNull();
    expect(extractChatCompletionUsage(JSON.stringify({ choices: [] }))).toBeNull();
  });
});

describe('estimateAiCostMicroUsd', () => {
  test('estimates cost in micro-USD for a known model (substring match)', () => {
    // gpt-4o-mini: $0.15/M input, $0.60/M output → 1000*0.15 + 500*0.60 = 450 micro-USD
    expect(
      estimateAiCostMicroUsd('gpt-4o-mini-2024-07-18', { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 }),
    ).toBe(450);
  });

  test('returns null for unknown/local models or missing usage', () => {
    expect(estimateAiCostMicroUsd('my-local-llama', { promptTokens: 100, completionTokens: 50, totalTokens: 150 })).toBeNull();
    expect(estimateAiCostMicroUsd('gpt-4o', null)).toBeNull();
  });
});

describe('recordAiUsageSafe', () => {
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
    return {
      transaction: () => ({ execute: async (cb: (t: typeof trx) => Promise<unknown>) => cb(trx) }),
    } as never;
  }

  test('inserts one ai_usage_events row with computed cost', async () => {
    const captured: Array<{ table: string; values: Record<string, unknown> }> = [];
    await recordAiUsageSafe(
      { db: fakeDb(captured), applyWorkspaceSession: async () => {}, now: () => new Date('2026-06-06T00:00:00.000Z') },
      {
        workspaceId: WS,
        aiProfileId: 7,
        model: 'gpt-4o-mini',
        nodeType: 'ai.classify',
        messageId: 42,
        usage: { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 },
        latencyMs: 1234,
      },
    );
    expect(captured).toHaveLength(1);
    expect(captured[0].table).toBe('ai_usage_events');
    expect(captured[0].values).toMatchObject({
      workspace_id: WS,
      ai_profile_id: 7,
      model: 'gpt-4o-mini',
      node_type: 'ai.classify',
      message_id: 42,
      prompt_tokens: 1000,
      completion_tokens: 500,
      total_tokens: 1500,
      est_cost_micro_usd: 450,
      latency_ms: 1234,
    });
  });

  test('never throws (best-effort) when the insert fails', async () => {
    const captured: Array<{ table: string; values: Record<string, unknown> }> = [];
    await expect(
      recordAiUsageSafe(
        { db: fakeDb(captured, { throwOnInsert: true }), applyWorkspaceSession: async () => {} },
        { workspaceId: WS, aiProfileId: null, model: null, nodeType: 'ai.agent', usage: null },
      ),
    ).resolves.toBeUndefined();
    expect(captured).toHaveLength(0);
  });
});
