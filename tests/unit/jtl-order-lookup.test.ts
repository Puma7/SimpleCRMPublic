import type { Kysely } from 'kysely';

import {
  createPostgresJtlOrderLookupPort,
  type JtlOrderLookupSqlExecutor,
  type JtlOrderLookupSettingsResolver,
} from '../../packages/server/src/jtl-order-lookup';
import type { MssqlSettingsInput } from '../../packages/server/src/mssql-settings';
import type { ServerDatabase } from '../../packages/server/src/db';

// Tests never reach the Kysely path — the injected `resolveSettings` skips it
// entirely — so a structural fake is enough to satisfy the type signature.
const FAKE_DB = {} as Kysely<ServerDatabase>;

const FAKE_SETTINGS: MssqlSettingsInput = {
  server: 'wawi.example.test',
  database: 'eazybusiness',
  user: 'sa',
  password: 'pw',
  kBenutzer: 1,
  kShop: 1,
  kPlattform: 1,
  kSprache: 1,
};

function settingsResolver(settings: MssqlSettingsInput = FAKE_SETTINGS): JtlOrderLookupSettingsResolver {
  return async () => ({ ok: true, settings });
}

type CapturedCall = { query: string; params: ReadonlyArray<{ name: string; type: string; value: unknown }> };

function fakeExecutor(
  responses: ReadonlyArray<{ ok: true; rows: readonly Record<string, unknown>[] } | { ok: false; error: string }>,
  captured: CapturedCall[],
): JtlOrderLookupSqlExecutor {
  let i = 0;
  return async ({ query, params }) => {
    captured.push({ query, params: [...params] });
    return responses[i++] ?? { ok: true, rows: [] };
  };
}

describe('createPostgresJtlOrderLookupPort', () => {
  test('rejects an empty order number without touching MSSQL', async () => {
    const captured: CapturedCall[] = [];
    const port = createPostgresJtlOrderLookupPort({
      db: FAKE_DB,
      resolveSettings: settingsResolver(),
      executeSql: fakeExecutor([], captured),
    });
    const result = await port.lookupOrderByNumber({ workspaceId: 'ws-1', orderNumber: '  ' });
    expect(result).toEqual({ ok: false, error: 'orderNumber darf nicht leer sein' });
    expect(captured).toHaveLength(0);
  });

  test('rejects an absurdly long order number (anti-abuse on the public portal)', async () => {
    const captured: CapturedCall[] = [];
    const port = createPostgresJtlOrderLookupPort({
      db: FAKE_DB,
      resolveSettings: settingsResolver(),
      executeSql: fakeExecutor([], captured),
    });
    const result = await port.lookupOrderByNumber({
      workspaceId: 'ws-1',
      orderNumber: 'X'.repeat(100),
    });
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error).toMatch(/zu lang/);
    }
    expect(captured).toHaveLength(0);
  });

  test('propagates settings-resolution errors verbatim', async () => {
    const port = createPostgresJtlOrderLookupPort({
      db: FAKE_DB,
      resolveSettings: async () => ({ ok: false, error: 'MSSQL not configured' }),
      executeSql: fakeExecutor([], []),
    });
    await expect(port.lookupOrderByNumber({ workspaceId: 'ws-1', orderNumber: 'ABC-1' }))
      .resolves.toEqual({ ok: false, error: 'MSSQL not configured' });
  });

  test('returns { order: null } when the order header lookup is empty (no items query)', async () => {
    const captured: CapturedCall[] = [];
    const port = createPostgresJtlOrderLookupPort({
      db: FAKE_DB,
      resolveSettings: settingsResolver(),
      executeSql: fakeExecutor([{ ok: true, rows: [] }], captured),
    });
    const result = await port.lookupOrderByNumber({ workspaceId: 'ws-1', orderNumber: 'NOT-FOUND' });
    expect(result).toEqual({ ok: true, order: null });
    // ONLY the header was queried — no items lookup when the order is absent.
    expect(captured).toHaveLength(1);
    expect(captured[0]!.query).toContain('FROM Verkauf.tAuftrag');
  });

  test('binds the order number as @orderNumber (never concatenated into SQL)', async () => {
    const captured: CapturedCall[] = [];
    const port = createPostgresJtlOrderLookupPort({
      db: FAKE_DB,
      resolveSettings: settingsResolver(),
      executeSql: fakeExecutor([{ ok: true, rows: [] }], captured),
    });
    const dirty = "EXT-42'; DROP TABLE tAuftrag; --";
    await port.lookupOrderByNumber({ workspaceId: 'ws-1', orderNumber: dirty });
    expect(captured).toHaveLength(1);
    // The literal must NEVER appear in the SQL — it can only travel via a param.
    expect(captured[0]!.query).not.toContain(dirty);
    expect(captured[0]!.query).toContain('@orderNumber');
    expect(captured[0]!.params).toEqual([
      expect.objectContaining({ name: 'orderNumber', type: 'NVarChar', value: dirty }),
    ]);
  });

  test('runs the items query with @kAuftrag bound as Int, ordered by sort/position', async () => {
    const captured: CapturedCall[] = [];
    const port = createPostgresJtlOrderLookupPort({
      db: FAKE_DB,
      resolveSettings: settingsResolver(),
      executeSql: fakeExecutor(
        [
          {
            ok: true,
            rows: [{ kAuftrag: 12345, cAuftragsNr: 'EXT-7', kKunde: 99, dErstellt: '2026-05-01T10:00:00' }],
          },
          { ok: true, rows: [] },
        ],
        captured,
      ),
    });
    const result = await port.lookupOrderByNumber({ workspaceId: 'ws-1', orderNumber: 'EXT-7' });
    expect(result.ok).toBe(true);
    expect(captured).toHaveLength(2);
    // Second call is the items query — bound by Int param, ordered correctly.
    expect(captured[1]!.query).toContain('FROM Verkauf.tAuftragPosition');
    expect(captured[1]!.query).toContain('WHERE p.kAuftrag = @kAuftrag');
    expect(captured[1]!.query).toContain('ORDER BY p.nSort, p.kAuftragPosition');
    expect(captured[1]!.params).toEqual([{ name: 'kAuftrag', type: 'Int', value: 12345 }]);
  });

  test('maps line-item rows to the typed JtlOrderLookupItem (with safe number coercion)', async () => {
    const port = createPostgresJtlOrderLookupPort({
      db: FAKE_DB,
      resolveSettings: settingsResolver(),
      executeSql: fakeExecutor(
        [
          {
            ok: true,
            rows: [{ kAuftrag: '1001', cAuftragsNr: 'EXT-1001', kKunde: 5n, dErstellt: '2026-05-02T08:30:00' }],
          },
          {
            ok: true,
            rows: [
              { kAuftragPosition: 1, kArtikel: 900, cArtNr: 'SKU-A', cName: 'Artikel A', fAnzahl: 2, fVKNetto: 19.99 },
              { kAuftragPosition: 2, kArtikel: null, cArtNr: '  ', cName: null, fAnzahl: '3', fVKNetto: '4.5' },
            ],
          },
        ],
        [],
      ),
    });
    const result = await port.lookupOrderByNumber({ workspaceId: 'ws-1', orderNumber: 'EXT-1001' });
    expect(result).toEqual({
      ok: true,
      order: {
        kAuftrag: 1001,
        orderNumber: 'EXT-1001',
        kKunde: 5,
        dateCreated: '2026-05-02T08:30:00',
        items: [
          { kAuftragPosition: 1, kArtikel: 900, sku: 'SKU-A', name: 'Artikel A', quantity: 2, unitPriceNet: 19.99 },
          { kAuftragPosition: 2, kArtikel: null, sku: null, name: null, quantity: 3, unitPriceNet: 4.5 },
        ],
      },
    });
  });

  test('errors on a malformed header row (no parseable kAuftrag) instead of returning garbage', async () => {
    const port = createPostgresJtlOrderLookupPort({
      db: FAKE_DB,
      resolveSettings: settingsResolver(),
      executeSql: fakeExecutor(
        [{ ok: true, rows: [{ kAuftrag: null, cAuftragsNr: 'EXT-?', kKunde: 0, dErstellt: null }] }],
        [],
      ),
    });
    await expect(port.lookupOrderByNumber({ workspaceId: 'ws-1', orderNumber: 'EXT-?' }))
      .resolves.toEqual({ ok: false, error: 'JTL-Auftrag ohne gültige kAuftrag-ID' });
  });

  test('propagates MSSQL errors from either query', async () => {
    const portHeaderFail = createPostgresJtlOrderLookupPort({
      db: FAKE_DB,
      resolveSettings: settingsResolver(),
      executeSql: fakeExecutor([{ ok: false, error: 'connection refused' }], []),
    });
    await expect(portHeaderFail.lookupOrderByNumber({ workspaceId: 'ws-1', orderNumber: 'X' }))
      .resolves.toEqual({ ok: false, error: 'connection refused' });

    const portItemsFail = createPostgresJtlOrderLookupPort({
      db: FAKE_DB,
      resolveSettings: settingsResolver(),
      executeSql: fakeExecutor(
        [
          { ok: true, rows: [{ kAuftrag: 1, cAuftragsNr: 'X', kKunde: null, dErstellt: null }] },
          { ok: false, error: 'timeout' },
        ],
        [],
      ),
    });
    await expect(portItemsFail.lookupOrderByNumber({ workspaceId: 'ws-1', orderNumber: 'X' }))
      .resolves.toEqual({ ok: false, error: 'timeout' });
  });
});
