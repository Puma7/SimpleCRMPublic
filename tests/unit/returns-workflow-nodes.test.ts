import {
  decideWorkflowReturnOutcomePort,
  evaluateWorkflowReturn,
  applyWorkflowReturnOutcome,
} from '../../packages/server/src/workflow-execution';

// ---------------------------------------------------------------------------
// Pure decision matrix — no DB. This is the policy that returns.evaluate runs.
// ---------------------------------------------------------------------------

describe('decideWorkflowReturnOutcomePort', () => {
  test('defaults to refund when nothing matches', () => {
    expect(decideWorkflowReturnOutcomePort({ itemConditions: [], itemReasonCodes: [], config: {} }))
      .toBe('refund');
  });

  test('damaged condition wins over everything (safety: needs_review)', () => {
    expect(decideWorkflowReturnOutcomePort({
      itemConditions: ['new', 'damaged'],
      itemReasonCodes: ['size_wrong'], // would otherwise be exchange
      config: {},
    })).toBe('needs_review');
  });

  test('size_wrong / wrong_item route to exchange by default', () => {
    expect(decideWorkflowReturnOutcomePort({
      itemConditions: ['new'],
      itemReasonCodes: ['size_wrong'],
      config: {},
    })).toBe('exchange');
    expect(decideWorkflowReturnOutcomePort({
      itemConditions: ['opened'],
      itemReasonCodes: ['wrong_item'],
      config: {},
    })).toBe('exchange');
  });

  test('credit reason codes are opt-in via config', () => {
    expect(decideWorkflowReturnOutcomePort({
      itemConditions: ['new'],
      itemReasonCodes: ['late_delivery'],
      config: { creditReasonCodes: 'late_delivery' },
    })).toBe('credit');
    // Without config, late_delivery falls through to the default outcome.
    expect(decideWorkflowReturnOutcomePort({
      itemConditions: ['new'],
      itemReasonCodes: ['late_delivery'],
      config: {},
    })).toBe('refund');
  });

  test('exchange precedence beats credit when both match', () => {
    expect(decideWorkflowReturnOutcomePort({
      itemConditions: ['new'],
      itemReasonCodes: ['size_wrong', 'late_delivery'],
      config: { creditReasonCodes: 'late_delivery' },
    })).toBe('exchange');
  });

  test('config can override the default outcome and condition/reason sets', () => {
    expect(decideWorkflowReturnOutcomePort({
      itemConditions: ['used'],
      itemReasonCodes: [],
      config: { reviewConditions: 'damaged,used', defaultOutcome: 'keep' },
    })).toBe('needs_review');
    expect(decideWorkflowReturnOutcomePort({
      itemConditions: ['new'],
      itemReasonCodes: [],
      config: { defaultOutcome: 'keep' },
    })).toBe('keep');
    // An invalid defaultOutcome falls back to refund.
    expect(decideWorkflowReturnOutcomePort({
      itemConditions: ['new'],
      itemReasonCodes: [],
      config: { defaultOutcome: 'banana' },
    })).toBe('refund');
  });

  test('matching is case-insensitive', () => {
    expect(decideWorkflowReturnOutcomePort({
      itemConditions: ['DAMAGED'],
      itemReasonCodes: [],
      config: {},
    })).toBe('needs_review');
    expect(decideWorkflowReturnOutcomePort({
      itemConditions: ['new'],
      itemReasonCodes: ['SIZE_WRONG'],
      config: { exchangeReasonCodes: 'size_wrong' },
    })).toBe('exchange');
  });
});

// ---------------------------------------------------------------------------
// Handlers against a fake trx (same approach as workflow-execution-jsonb.test).
// ---------------------------------------------------------------------------

type ReturnRow = {
  id: number;
  return_number: string;
  status: string;
  outcome: string | null;
  email_message_id: number | null;
};
type ItemRow = { id: number; reason_id: number | null; condition: string | null };
type ReasonRow = { id: number; code: string };

type Captured = { updates: Array<{ table: string; set: Record<string, unknown> }> };

/**
 * Minimal Kysely-shaped fake for the returns tables. Returns are keyed by id
 * AND by email_message_id so we can exercise both resolution paths. The select
 * builder ignores the exact where-columns (the production code's filters are
 * covered by tsc), and resolves rows from the provided fixtures.
 */
function fakeTrx(fixtures: {
  returns: ReturnRow[];
  items: ItemRow[];
  reasons: ReasonRow[];
  captured: Captured;
}) {
  const { returns, items, reasons, captured } = fixtures;

  const selectBuilder = (table: string) => {
    const wheres: Array<{ col: string; val: unknown }> = [];
    const builder: Record<string, unknown> = {};
    builder.selectAll = () => builder;
    builder.select = () => builder;
    builder.where = (col: string, _op: string, val: unknown) => {
      wheres.push({ col, val });
      return builder;
    };
    builder.orderBy = () => builder;
    const find = () => {
      if (table === 'returns') {
        const byId = wheres.find((w) => w.col === 'id');
        const byMsg = wheres.find((w) => w.col === 'email_message_id');
        if (byId) return returns.find((r) => r.id === byId.val);
        if (byMsg) return returns.find((r) => r.email_message_id === byMsg.val);
      }
      return undefined;
    };
    builder.executeTakeFirst = async () => find();
    builder.execute = async () => {
      if (table === 'return_items') return items;
      if (table === 'return_reasons') return reasons;
      return [];
    };
    return builder;
  };

  const updateBuilder = (table: string) => {
    const builder: Record<string, unknown> = {};
    builder.set = (set: Record<string, unknown>) => {
      captured.updates.push({ table, set });
      return builder;
    };
    builder.where = () => builder;
    builder.execute = async () => [];
    return builder;
  };

  return {
    selectFrom: (table: string) => selectBuilder(table),
    updateTable: (table: string) => updateBuilder(table),
  } as never;
}

const CTX = { workspaceId: 'ws-1', messageId: 42, variables: {} as Record<string, unknown> } as never;

describe('evaluateWorkflowReturn', () => {
  test('routes to no_return when no return is linked to the message', async () => {
    const captured: Captured = { updates: [] };
    const trx = fakeTrx({ returns: [], items: [], reasons: [], captured });
    const result = await evaluateWorkflowReturn(trx, CTX, {});
    expect(result.port).toBe('no_return');
    expect(result.variables?.['returns.found']).toBe(false);
  });

  test('resolves the return by email_message_id and suggests exchange', async () => {
    const captured: Captured = { updates: [] };
    const trx = fakeTrx({
      returns: [{ id: 7, return_number: 'R-AAAA', status: 'pending', outcome: null, email_message_id: 42 }],
      items: [{ id: 1, reason_id: 100, condition: 'new' }],
      reasons: [{ id: 100, code: 'size_wrong' }],
      captured,
    });
    const result = await evaluateWorkflowReturn(trx, CTX, {});
    expect(result.port).toBe('exchange');
    expect(result.variables?.['returns.id']).toBe(7);
    expect(result.variables?.['returns.number']).toBe('R-AAAA');
    expect(result.variables?.['returns.suggested_outcome']).toBe('exchange');
  });

  test('a damaged item forces needs_review regardless of reason', async () => {
    const captured: Captured = { updates: [] };
    const trx = fakeTrx({
      returns: [{ id: 8, return_number: 'R-BBBB', status: 'pending', outcome: null, email_message_id: 42 }],
      items: [{ id: 1, reason_id: 100, condition: 'damaged' }],
      reasons: [{ id: 100, code: 'size_wrong' }],
      captured,
    });
    const result = await evaluateWorkflowReturn(trx, CTX, {});
    expect(result.port).toBe('needs_review');
  });
});

describe('applyWorkflowReturnOutcome', () => {
  const now = new Date('2026-06-09T00:00:00.000Z');

  test('skips to no_return when no return is found', async () => {
    const captured: Captured = { updates: [] };
    const trx = fakeTrx({ returns: [], items: [], reasons: [], captured });
    const result = await applyWorkflowReturnOutcome(trx, CTX, {}, 'exchange', now);
    expect(result.status).toBe('skipped');
    expect(result.port).toBe('no_return');
    expect(captured.updates).toHaveLength(0);
  });

  test('writes outcome=exchange and emits the variable', async () => {
    const captured: Captured = { updates: [] };
    const trx = fakeTrx({
      returns: [{ id: 7, return_number: 'R-AAAA', status: 'pending', outcome: null, email_message_id: 42 }],
      items: [],
      reasons: [],
      captured,
    });
    const result = await applyWorkflowReturnOutcome(trx, CTX, {}, 'exchange', now);
    expect(result.status).toBe('ok');
    expect(result.variables?.['returns.outcome']).toBe('exchange');
    expect(captured.updates).toHaveLength(1);
    expect(captured.updates[0]!.table).toBe('returns');
    expect(captured.updates[0]!.set.outcome).toBe('exchange');
  });

  test('is idempotent: no write when outcome already matches', async () => {
    const captured: Captured = { updates: [] };
    const trx = fakeTrx({
      returns: [{ id: 7, return_number: 'R-AAAA', status: 'pending', outcome: 'credit', email_message_id: 42 }],
      items: [],
      reasons: [],
      captured,
    });
    const result = await applyWorkflowReturnOutcome(trx, CTX, {}, 'credit', now);
    expect(result.status).toBe('ok');
    expect(result.message).toContain('unchanged');
    expect(captured.updates).toHaveLength(0);
  });

  test('applies an optional status transition and rejects an invalid status', async () => {
    const captured: Captured = { updates: [] };
    const trx = fakeTrx({
      returns: [{ id: 7, return_number: 'R-AAAA', status: 'pending', outcome: null, email_message_id: 42 }],
      items: [],
      reasons: [],
      captured,
    });
    const ok = await applyWorkflowReturnOutcome(trx, CTX, { status: 'exchanged' }, 'exchange', now);
    expect(ok.status).toBe('ok');
    expect(captured.updates[0]!.set.status).toBe('exchanged');

    const bad = await applyWorkflowReturnOutcome(trx, CTX, { status: 'nonsense' }, 'exchange', now);
    expect(bad.status).toBe('error');
  });
});
