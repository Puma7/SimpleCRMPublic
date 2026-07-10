import { createPostgresEmailMessageReadPort } from '../../packages/server/src';

// PERF-03 regression: backfillCustomerLinks must link all matched messages with
// ONE set-based UPDATE, not one UPDATE per row. We fake the query-builder chain
// and assert exactly one updateTable('email_messages') statement is issued for N
// matched messages, and that the returned count reflects the rows updated.

type Captured = {
  updateCalls: Array<{ table: string }>;
};

function fakeDb(options: {
  messages: Array<{ id: number; from_json: unknown }>;
  customers: Array<{ id: number; source_sqlite_id: number; email: string | null }>;
  updatedRows: Array<{ id: number }>;
  captured: Captured;
}) {
  const { messages, customers, updatedRows, captured } = options;

  const makeSelect = (table: string) => {
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.where = () => builder;
    builder.orderBy = () => builder;
    builder.limit = () => builder;
    builder.execute = async () => (table === 'customers' ? customers : messages);
    return builder;
  };

  const makeUpdate = (table: string) => {
    captured.updateCalls.push({ table });
    const builder: Record<string, unknown> = {};
    builder.from = () => builder;
    builder.set = () => builder;
    builder.where = () => builder;
    builder.whereRef = () => builder;
    builder.returning = () => builder;
    builder.execute = async () => updatedRows;
    builder.executeTakeFirst = async () => updatedRows[0];
    return builder;
  };

  const trx = {
    selectFrom: (table: string) => makeSelect(table),
    updateTable: (table: string) => makeUpdate(table),
  };

  return {
    db: {
      transaction: () => ({
        execute: async (cb: (t: typeof trx) => Promise<unknown>) => cb(trx),
      }),
    },
  };
}

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

function fromJson(address: string) {
  return { value: [{ address }] };
}

describe('backfillCustomerLinks issues a single set-based UPDATE', () => {
  test('links N matched messages with exactly one updateTable statement', async () => {
    const captured: Captured = { updateCalls: [] };
    const messages = [
      { id: 1, from_json: fromJson('alice@example.com') },
      { id: 2, from_json: fromJson('bob@example.com') },
      { id: 3, from_json: fromJson('carol@example.com') },
      { id: 4, from_json: fromJson('nomatch@example.com') },
    ];
    const customers = [
      { id: 10, source_sqlite_id: 100, email: 'alice@example.com' },
      { id: 20, source_sqlite_id: 200, email: 'bob@example.com' },
      { id: 30, source_sqlite_id: 300, email: 'carol@example.com' },
    ];
    // Three of the four messages match a customer.
    const updatedRows = [{ id: 1 }, { id: 2 }, { id: 3 }];

    const { db } = fakeDb({ messages, customers, updatedRows, captured });
    const port = createPostgresEmailMessageReadPort({
      db: db as never,
      applyWorkspaceSession: async () => {},
    });

    const result = await port.backfillCustomerLinks!({ workspaceId: WORKSPACE_ID });

    expect(result).toEqual({ count: 3 });
    const emailMessageUpdates = captured.updateCalls.filter((c) => c.table === 'email_messages');
    expect(emailMessageUpdates).toHaveLength(1);
  });

  test('returns { count: 0 } without any UPDATE when no sender matches a customer', async () => {
    const captured: Captured = { updateCalls: [] };
    const { db } = fakeDb({
      messages: [{ id: 1, from_json: fromJson('stranger@example.com') }],
      customers: [{ id: 10, source_sqlite_id: 100, email: 'alice@example.com' }],
      updatedRows: [],
      captured,
    });
    const port = createPostgresEmailMessageReadPort({
      db: db as never,
      applyWorkspaceSession: async () => {},
    });

    const result = await port.backfillCustomerLinks!({ workspaceId: WORKSPACE_ID });

    expect(result).toEqual({ count: 0 });
    expect(captured.updateCalls.filter((c) => c.table === 'email_messages')).toHaveLength(0);
  });
});
