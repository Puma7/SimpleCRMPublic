import {
  decideAiBudget,
  readAiBudgetLimitsFromEnv,
  evaluateAiBudgetSafe,
} from '../../packages/server/src';

const WS = '11111111-1111-4111-8111-111111111111';

describe('decideAiBudget', () => {
  const limits = { softLimitMicroUsd: 5_000_000, hardLimitMicroUsd: 10_000_000 };

  test('allows below soft', () => {
    expect(decideAiBudget(1_000_000, limits).decision).toBe('allow');
  });

  test('warns at/above soft, below hard', () => {
    expect(decideAiBudget(5_000_000, limits).decision).toBe('warn');
    expect(decideAiBudget(9_999_999, limits).decision).toBe('warn');
  });

  test('blocks at/above hard', () => {
    expect(decideAiBudget(10_000_000, limits).decision).toBe('block');
    expect(decideAiBudget(999_999_999, limits).decision).toBe('block');
  });

  test('null limits always allow', () => {
    expect(
      decideAiBudget(999_999_999, { softLimitMicroUsd: null, hardLimitMicroUsd: null }).decision,
    ).toBe('allow');
  });

  test('clamps non-finite / negative spend to 0 and reports it back', () => {
    const r = decideAiBudget(Number.NaN, limits);
    expect(r.decision).toBe('allow');
    expect(r.spentMicroUsd).toBe(0);
    expect(decideAiBudget(-500, limits).spentMicroUsd).toBe(0);
  });

  test('echoes the configured limits in the result', () => {
    const r = decideAiBudget(7_000_000, limits);
    expect(r).toEqual({
      decision: 'warn',
      spentMicroUsd: 7_000_000,
      softLimitMicroUsd: 5_000_000,
      hardLimitMicroUsd: 10_000_000,
    });
  });
});

describe('readAiBudgetLimitsFromEnv', () => {
  test('unset env yields no limits', () => {
    expect(readAiBudgetLimitsFromEnv({} as NodeJS.ProcessEnv)).toEqual({
      softLimitMicroUsd: null,
      hardLimitMicroUsd: null,
    });
  });

  test('parses a hard limit', () => {
    expect(
      readAiBudgetLimitsFromEnv({ AI_DAILY_HARD_LIMIT_MICRO_USD: '2000000' } as NodeJS.ProcessEnv)
        .hardLimitMicroUsd,
    ).toBe(2_000_000);
  });

  test('parses both limits and ignores non-positive / non-numeric values', () => {
    expect(
      readAiBudgetLimitsFromEnv({
        AI_DAILY_SOFT_LIMIT_MICRO_USD: '1500000',
        AI_DAILY_HARD_LIMIT_MICRO_USD: '3000000',
      } as NodeJS.ProcessEnv),
    ).toEqual({ softLimitMicroUsd: 1_500_000, hardLimitMicroUsd: 3_000_000 });
    expect(
      readAiBudgetLimitsFromEnv({
        AI_DAILY_SOFT_LIMIT_MICRO_USD: '0',
        AI_DAILY_HARD_LIMIT_MICRO_USD: 'not-a-number',
      } as NodeJS.ProcessEnv),
    ).toEqual({ softLimitMicroUsd: null, hardLimitMicroUsd: null });
  });
});

describe('evaluateAiBudgetSafe', () => {
  test('short-circuits to allow with no limits and never touches the db', async () => {
    const db = new Proxy(
      {},
      {
        get() {
          throw new Error('db should not be touched');
        },
      },
    ) as never;
    const r = await evaluateAiBudgetSafe({ db }, WS, {
      softLimitMicroUsd: null,
      hardLimitMicroUsd: null,
    });
    expect(r.decision).toBe('allow');
    expect(r.spentMicroUsd).toBe(0);
  });

  test('fails OPEN (allow) when the spend loader throws', async () => {
    const db = {
      transaction: () => ({
        execute: async () => {
          throw new Error('db unavailable');
        },
      }),
    } as never;
    const r = await evaluateAiBudgetSafe({ db, applyWorkspaceSession: async () => {} }, WS, {
      softLimitMicroUsd: null,
      hardLimitMicroUsd: 10_000_000,
    });
    expect(r.decision).toBe('allow');
    expect(r.hardLimitMicroUsd).toBe(10_000_000);
  });

  test('blocks when loaded spend has reached the hard limit', async () => {
    const captured: { table?: string } = {};
    const db = {
      transaction: () => ({
        execute: async (cb: (t: unknown) => Promise<unknown>) =>
          cb({
            selectFrom: (table: string) => {
              captured.table = table;
              return {
                select: () => ({
                  where: () => ({
                    where: () => ({
                      executeTakeFirst: async () => ({ cost: 12_000_000 }),
                    }),
                  }),
                }),
              };
            },
          }),
      }),
    } as never;
    const r = await evaluateAiBudgetSafe({ db, applyWorkspaceSession: async () => {} }, WS, {
      softLimitMicroUsd: 5_000_000,
      hardLimitMicroUsd: 10_000_000,
    });
    expect(captured.table).toBe('ai_usage_events');
    expect(r.decision).toBe('block');
    expect(r.spentMicroUsd).toBe(12_000_000);
  });
});
