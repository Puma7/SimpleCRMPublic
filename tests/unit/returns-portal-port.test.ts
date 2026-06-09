import { createPostgresReturnsPortalPort } from '../../packages/server/src/db/postgres-returns-portal-port';
import type { WorkspacePortalSettingsRow } from '../../packages/server/src/db/schema';

const VALID_TOKEN = 'a'.repeat(64);
const OTHER_VALID_TOKEN = 'b'.repeat(64);

type Captured = {
  inserts: Array<{ table: string; values: Record<string, unknown> }>;
  updates: Array<{ table: string; set: Record<string, unknown> }>;
};

function fakeDb(seed: {
  rows: WorkspacePortalSettingsRow[];
  captured: Captured;
}) {
  const { rows, captured } = seed;

  const select = (table: string) => {
    const wheres: Array<{ col: string; val: unknown }> = [];
    const b: Record<string, unknown> = {};
    b.selectAll = () => b;
    b.select = () => b;
    b.where = (col: string, _op: string, val: unknown) => {
      wheres.push({ col, val });
      return b;
    };
    b.limit = () => b;
    const find = () => {
      if (table !== 'workspace_portal_settings') return [];
      const wsCol = wheres.find((w) => w.col === 'workspace_id');
      const tokenCol = wheres.find((w) => w.col === 'returns_portal_token');
      if (wsCol) return rows.filter((r) => r.workspace_id === wsCol.val);
      if (tokenCol) return rows.filter((r) => r.returns_portal_token === tokenCol.val);
      return [];
    };
    b.executeTakeFirst = async () => find()[0];
    b.execute = async () => find();
    return b;
  };

  const insert = (table: string) => {
    const b: Record<string, unknown> = {};
    b.values = (values: Record<string, unknown>) => {
      captured.inserts.push({ table, values });
      // Mirror into the in-memory rows so subsequent loadRow() returns the new row.
      if (table === 'workspace_portal_settings') {
        rows.push({
          workspace_id: String(values.workspace_id),
          returns_portal_token: (values.returns_portal_token as string | null) ?? null,
          returns_portal_enabled: Boolean(values.returns_portal_enabled),
          created_at: new Date(),
          updated_at: new Date(),
        });
      }
      return b;
    };
    b.execute = async () => [];
    return b;
  };

  const update = (table: string) => {
    let pendingSet: Record<string, unknown> = {};
    const wheres: Array<{ col: string; val: unknown }> = [];
    const b: Record<string, unknown> = {};
    b.set = (set: Record<string, unknown>) => {
      pendingSet = set;
      captured.updates.push({ table, set });
      return b;
    };
    b.where = (col: string, _op: string, val: unknown) => {
      wheres.push({ col, val });
      return b;
    };
    b.execute = async () => {
      if (table === 'workspace_portal_settings') {
        const wsCol = wheres.find((w) => w.col === 'workspace_id');
        if (wsCol) {
          for (const row of rows) {
            if (row.workspace_id === wsCol.val) {
              if ('returns_portal_token' in pendingSet) row.returns_portal_token = pendingSet.returns_portal_token as string | null;
              if ('returns_portal_enabled' in pendingSet) row.returns_portal_enabled = Boolean(pendingSet.returns_portal_enabled);
              row.updated_at = new Date();
            }
          }
        }
      }
      return [];
    };
    return b;
  };

  return {
    selectFrom: (table: string) => select(table),
    insertInto: (table: string) => insert(table),
    updateTable: (table: string) => update(table),
  } as never;
}

describe('createPostgresReturnsPortalPort.resolveByToken', () => {
  test('rejects empty / malformed tokens BEFORE touching the database', async () => {
    const captured: Captured = { inserts: [], updates: [] };
    const port = createPostgresReturnsPortalPort({
      db: fakeDb({ rows: [], captured }),
    });
    for (const token of ['', 'too-short', 'g'.repeat(64), '../etc/passwd', 'a'.repeat(63), 'a'.repeat(65)]) {
      const r = await port.resolveByToken({ token });
      expect(r).toEqual({ ok: false, reason: 'unknown_token' });
    }
  });

  test('returns unknown_token for a valid-shaped but unseeded token', async () => {
    const captured: Captured = { inserts: [], updates: [] };
    const port = createPostgresReturnsPortalPort({
      db: fakeDb({ rows: [], captured }),
    });
    const r = await port.resolveByToken({ token: VALID_TOKEN });
    expect(r).toEqual({ ok: false, reason: 'unknown_token' });
  });

  test('resolves a known + enabled token to the workspace id', async () => {
    const captured: Captured = { inserts: [], updates: [] };
    const port = createPostgresReturnsPortalPort({
      db: fakeDb({
        rows: [{
          workspace_id: 'ws-A',
          returns_portal_token: VALID_TOKEN,
          returns_portal_enabled: true,
          created_at: new Date(),
          updated_at: new Date(),
        }],
        captured,
      }),
    });
    const r = await port.resolveByToken({ token: VALID_TOKEN });
    expect(r).toEqual({ ok: true, workspaceId: 'ws-A', enabled: true });
  });

  test('returns portal_disabled when the token is known but the flag is off', async () => {
    const captured: Captured = { inserts: [], updates: [] };
    const port = createPostgresReturnsPortalPort({
      db: fakeDb({
        rows: [{
          workspace_id: 'ws-A',
          returns_portal_token: VALID_TOKEN,
          returns_portal_enabled: false,
          created_at: new Date(),
          updated_at: new Date(),
        }],
        captured,
      }),
    });
    const r = await port.resolveByToken({ token: VALID_TOKEN });
    expect(r).toEqual({ ok: false, reason: 'portal_disabled' });
  });
});

describe('createPostgresReturnsPortalPort lifecycle', () => {
  test('get returns an empty record for an unseeded workspace', async () => {
    const captured: Captured = { inserts: [], updates: [] };
    const port = createPostgresReturnsPortalPort({ db: fakeDb({ rows: [], captured }) });
    const settings = await port.get({ workspaceId: 'ws-A' });
    expect(settings).toEqual({ enabled: false, token: null, hasToken: false, updatedAt: null });
  });

  test('rotate first-time inserts and reveals the token; second rotate updates it', async () => {
    const captured: Captured = { inserts: [], updates: [] };
    const tokens = [VALID_TOKEN, OTHER_VALID_TOKEN];
    const port = createPostgresReturnsPortalPort({
      db: fakeDb({ rows: [], captured }),
      generateToken: () => tokens.shift()!,
    });
    const first = await port.rotate({ workspaceId: 'ws-A' });
    expect(first.token).toBe(VALID_TOKEN);
    expect(first.enabled).toBe(true);
    expect(captured.inserts).toHaveLength(1);

    const second = await port.rotate({ workspaceId: 'ws-A' });
    expect(second.token).toBe(OTHER_VALID_TOKEN);
    expect(captured.updates[0]!.set.returns_portal_token).toBe(OTHER_VALID_TOKEN);
  });

  test('revoke clears the token and disables the portal', async () => {
    const captured: Captured = { inserts: [], updates: [] };
    const port = createPostgresReturnsPortalPort({
      db: fakeDb({
        rows: [{
          workspace_id: 'ws-A',
          returns_portal_token: VALID_TOKEN,
          returns_portal_enabled: true,
          created_at: new Date(),
          updated_at: new Date(),
        }],
        captured,
      }),
    });
    const result = await port.revoke({ workspaceId: 'ws-A' });
    expect(result.enabled).toBe(false);
    expect(result.token).toBe(null);
    expect(result.hasToken).toBe(false);
    expect(captured.updates[0]!.set.returns_portal_token).toBe(null);
  });
});
