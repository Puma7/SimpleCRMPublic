import { createPostgresReturnsPort } from '../../packages/server/src/db/postgres-returns-port';

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

type ReturnRow = {
  id: number;
  workspace_id: string;
  return_number: string;
  status: string;
  outcome: string | null;
  jtl_order_number: string | null;
  created_at: Date;
  updated_at: Date;
};

type CapturedWhere = { table: string; col: string; op: string; val: unknown };

function fakeDb(seed: {
  returns: ReturnRow[];
  returnItems?: Array<Record<string, unknown>>;
  capturedWheres: CapturedWhere[];
}) {
  const { returns, returnItems = [], capturedWheres } = seed;

  const matchReturns = (wheres: CapturedWhere[]) => {
    const wsId = wheres.find((w) => w.col === 'workspace_id')?.val;
    const returnNumWhere = wheres.find((w) => w.col === 'return_number');
    if (!returnNumWhere) return undefined;
    if (returnNumWhere.op === '=') {
      const needle = String(returnNumWhere.val);
      return returns.find(
        (row) => row.workspace_id === wsId && row.return_number === needle,
      );
    }
    if (returnNumWhere.op === 'ilike') {
      const pattern = String(returnNumWhere.val);
      const regex = new RegExp(
        `^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')}$`,
        'i',
      );
      return returns.find(
        (row) => row.workspace_id === wsId && regex.test(row.return_number),
      );
    }
    return undefined;
  };

  const select = (table: string) => {
    const wheres: CapturedWhere[] = [];
    const b: Record<string, unknown> = {};
    b.selectAll = () => b;
    b.select = () => b;
    b.leftJoin = () => b;
    b.where = (col: string, op: string, val: unknown) => {
      wheres.push({ table, col, op, val });
      return b;
    };
    b.orderBy = () => b;
    b.executeTakeFirst = async () => {
      if (table === 'returns') {
        capturedWheres.push(...wheres);
        return matchReturns(wheres);
      }
      return undefined;
    };
    b.execute = async () => {
      if (table === 'return_items as ri') {
        const returnIdWhere = wheres.find((w) => w.col === 'ri.return_id');
        const returnId = returnIdWhere ? Number(returnIdWhere.val) : null;
        return returnItems.filter((item) => Number(item.return_id) === returnId);
      }
      return [];
    };
    return b;
  };

  const trx = {
    selectFrom: (table: string) => select(table),
  };

  return {
    transaction() {
      return {
        execute: async <T>(operation: (innerTrx: typeof trx) => Promise<T>) => operation(trx),
      };
    },
  } as never;
}

const SAMPLE_RETURN: ReturnRow = {
  id: 1,
  workspace_id: WORKSPACE_ID,
  return_number: 'R-ABCDEF12',
  status: 'pending',
  outcome: null,
  jtl_order_number: null,
  created_at: new Date('2026-06-09T05:00:00.000Z'),
  updated_at: new Date('2026-06-09T05:00:00.000Z'),
};

describe('createPostgresReturnsPort.getPublicByReturnNumber', () => {
  test('wildcard % input does not match the first return in the workspace', async () => {
    const capturedWheres: CapturedWhere[] = [];
    const port = createPostgresReturnsPort({
      db: fakeDb({ returns: [SAMPLE_RETURN], capturedWheres }),
      applyWorkspaceSession: async () => {},
    });

    const result = await port.getPublicByReturnNumber({
      workspaceId: WORKSPACE_ID,
      returnNumber: '%',
    });

    expect(result).toBeNull();
    expect(capturedWheres).toContainEqual({
      table: 'returns',
      col: 'return_number',
      op: '=',
      val: '%',
    });
  });

  test('resolves by exact return number with case normalization', async () => {
    const capturedWheres: CapturedWhere[] = [];
    const port = createPostgresReturnsPort({
      db: fakeDb({ returns: [SAMPLE_RETURN], capturedWheres }),
      applyWorkspaceSession: async () => {},
    });

    const result = await port.getPublicByReturnNumber({
      workspaceId: WORKSPACE_ID,
      returnNumber: 'r-abcdef12',
    });

    expect(result?.returnNumber).toBe('R-ABCDEF12');
    expect(capturedWheres).toContainEqual({
      table: 'returns',
      col: 'return_number',
      op: '=',
      val: 'R-ABCDEF12',
    });
  });
});
