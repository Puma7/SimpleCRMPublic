import type { Kysely } from 'kysely';

import type { PostgresSecretPort, ServerDatabase } from './db';
import type { WorkspaceSessionApplier } from './db/workspace-context';
import {
  buildConnectionConfig,
  resolveMssqlSettingsForConnection,
  type MssqlSettingsInput,
} from './mssql-settings';

/**
 * Read-side lookup of a single JTL Wawi sales order by its order number.
 *
 * This is intentionally separated from `jtl-order.ts` (which only writes new
 * orders) and from `MssqlSettingsPort.executeReadOnlyQuery` (which accepts
 * raw user SQL and cannot bind parameters): the order number arrives from a
 * customer-facing context, so it MUST travel through a bound parameter
 * (`@orderNumber`), never through string concatenation. The default executor
 * uses the standard `mssql` package's parameter-binding API for that.
 *
 * The implementation deliberately runs ONLY hard-coded SELECT statements
 * against `Verkauf.tAuftrag` / `Verkauf.tAuftragPosition`. There is no path
 * here that can mutate JTL — write-back is a separate, explicitly later phase.
 */

export type JtlOrderLookupItem = Readonly<{
  kAuftragPosition: number;
  kArtikel: number | null;
  sku: string | null;
  name: string | null;
  quantity: number;
  unitPriceNet: number | null;
}>;

export type JtlOrderLookupRecord = Readonly<{
  kAuftrag: number;
  orderNumber: string;
  kKunde: number | null;
  dateCreated: string | null;
  items: readonly JtlOrderLookupItem[];
}>;

export type JtlOrderLookupResult =
  | { ok: true; order: JtlOrderLookupRecord | null }
  | { ok: false; error: string };

export type JtlOrderLookupApiPort = Readonly<{
  lookupOrderByNumber(input: {
    workspaceId: string;
    orderNumber: string;
  }): Promise<JtlOrderLookupResult>;
}>;

export type JtlOrderLookupSqlParam = Readonly<
  | { name: string; type: 'Int'; value: number }
  | { name: string; type: 'NVarChar'; length: number; value: string }
>;

export type JtlOrderLookupSqlExecutor = (input: {
  settings: MssqlSettingsInput;
  query: string;
  params: readonly JtlOrderLookupSqlParam[];
}) => Promise<{ ok: true; rows: readonly Record<string, unknown>[] } | { ok: false; error: string }>;

/**
 * Resolves MSSQL connection settings for a workspace. The production wiring
 * uses `resolveMssqlSettingsForConnection` (Kysely + secret store); tests
 * inject a fake that returns canned settings, so they don't need a real DB.
 */
export type JtlOrderLookupSettingsResolver = (
  workspaceId: string,
) => Promise<{ ok: true; settings: MssqlSettingsInput } | { ok: false; error: string }>;

export type PostgresJtlOrderLookupPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  secrets?: PostgresSecretPort;
  applyWorkspaceSession?: WorkspaceSessionApplier;
  /** Inject for tests; production uses the bundled `mssql`-backed executor. */
  executeSql?: JtlOrderLookupSqlExecutor;
  /** Inject for tests; production uses the Kysely-backed settings resolver. */
  resolveSettings?: JtlOrderLookupSettingsResolver;
}>;

/** Maximum length we accept for an order number — well above any real JTL value. */
const ORDER_NUMBER_MAX_LEN = 64;

/** Order-header query. `@orderNumber` is bound as NVarChar — never concatenated. */
const ORDER_HEADER_SQL = `SELECT TOP 1
  CAST(a.kAuftrag AS BIGINT) AS kAuftrag,
  a.cAuftragsNr AS cAuftragsNr,
  CAST(a.kKunde AS BIGINT) AS kKunde,
  CONVERT(VARCHAR(33), a.dErstellt, 126) AS dErstellt
FROM Verkauf.tAuftrag a
WHERE a.cAuftragsNr = @orderNumber`;

/** Line-items query, also fully parameterized via `@kAuftrag`. */
const ORDER_ITEMS_SQL = `SELECT
  CAST(p.kAuftragPosition AS BIGINT) AS kAuftragPosition,
  CAST(p.kArtikel AS BIGINT) AS kArtikel,
  art.cArtNr AS cArtNr,
  p.cName AS cName,
  CAST(p.fAnzahl AS FLOAT) AS fAnzahl,
  CAST(p.fVKNetto AS FLOAT) AS fVKNetto
FROM Verkauf.tAuftragPosition p
LEFT JOIN dbo.tArtikel art ON art.kArtikel = p.kArtikel
WHERE p.kAuftrag = @kAuftrag
ORDER BY p.nSort, p.kAuftragPosition`;

export function createPostgresJtlOrderLookupPort(
  options: PostgresJtlOrderLookupPortOptions,
): JtlOrderLookupApiPort {
  const executeSql = options.executeSql ?? defaultExecuteJtlLookupSql;
  const resolveSettings: JtlOrderLookupSettingsResolver = options.resolveSettings ?? ((workspaceId) =>
    resolveMssqlSettingsForConnection({
      db: options.db,
      secrets: options.secrets,
      applyWorkspaceSession: options.applyWorkspaceSession,
      workspaceId,
    }));

  return {
    async lookupOrderByNumber(input) {
      const orderNumber = normalizeOrderNumber(input.orderNumber);
      if (!orderNumber) {
        return { ok: false, error: 'orderNumber darf nicht leer sein' };
      }
      if (orderNumber.length > ORDER_NUMBER_MAX_LEN) {
        return { ok: false, error: `orderNumber zu lang (max ${ORDER_NUMBER_MAX_LEN} Zeichen)` };
      }

      const resolved = await resolveSettings(input.workspaceId);
      if (!resolved.ok) return { ok: false, error: resolved.error };

      const headerResult = await executeSql({
        settings: resolved.settings,
        query: ORDER_HEADER_SQL,
        params: [{ name: 'orderNumber', type: 'NVarChar', length: ORDER_NUMBER_MAX_LEN, value: orderNumber }],
      });
      if (!headerResult.ok) return { ok: false, error: headerResult.error };

      const headerRow = headerResult.rows[0];
      if (!headerRow) return { ok: true, order: null };

      const kAuftrag = toPositiveInteger(headerRow.kAuftrag);
      if (kAuftrag === null) {
        return { ok: false, error: 'JTL-Auftrag ohne gültige kAuftrag-ID' };
      }
      const resolvedOrderNumber = typeof headerRow.cAuftragsNr === 'string' ? headerRow.cAuftragsNr : orderNumber;

      const itemsResult = await executeSql({
        settings: resolved.settings,
        query: ORDER_ITEMS_SQL,
        params: [{ name: 'kAuftrag', type: 'Int', value: kAuftrag }],
      });
      if (!itemsResult.ok) return { ok: false, error: itemsResult.error };

      return {
        ok: true,
        order: {
          kAuftrag,
          orderNumber: resolvedOrderNumber,
          kKunde: toPositiveInteger(headerRow.kKunde),
          dateCreated: typeof headerRow.dErstellt === 'string' ? headerRow.dErstellt : null,
          items: itemsResult.rows.map((row) => mapLineItem(row)),
        },
      };
    },
  };
}

function mapLineItem(row: Record<string, unknown>): JtlOrderLookupItem {
  const kAuftragPosition = toPositiveInteger(row.kAuftragPosition);
  return {
    // kAuftragPosition is the primary key of the line — must always be present
    // for a row returned by tAuftragPosition. Fall back to 0 only to satisfy
    // the type contract; callers should never see this for real JTL data.
    kAuftragPosition: kAuftragPosition ?? 0,
    kArtikel: toPositiveInteger(row.kArtikel),
    sku: stringOrNull(row.cArtNr),
    name: stringOrNull(row.cName),
    quantity: toFiniteNumber(row.fAnzahl) ?? 0,
    unitPriceNet: toFiniteNumber(row.fVKNetto),
  };
}

function normalizeOrderNumber(value: unknown): string {
  return String(value ?? '').trim();
}

function toPositiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0 && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  if (typeof value === 'bigint' && value > 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(value);
  }
  return null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

async function defaultExecuteJtlLookupSql(input: {
  settings: MssqlSettingsInput;
  query: string;
  params: readonly JtlOrderLookupSqlParam[];
}): Promise<{ ok: true; rows: readonly Record<string, unknown>[] } | { ok: false; error: string }> {
  let pool: { request(): unknown; close(): Promise<void> | void } | null = null;
  try {
    const sql = await import('mssql');
    pool = await new sql.ConnectionPool(buildConnectionConfig(input.settings)).connect();
    const request = pool.request() as {
      input(name: string, type: unknown, value: unknown): void;
      query(query: string): Promise<{ recordset?: unknown[] }>;
    };
    for (const param of input.params) {
      if (param.type === 'Int') {
        request.input(param.name, sql.Int, param.value);
      } else {
        request.input(param.name, sql.NVarChar(param.length), param.value);
      }
    }
    const result = await request.query(input.query);
    const recordset = Array.isArray(result.recordset) ? result.recordset : [];
    const rows = recordset.filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null);
    return { ok: true, rows };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (pool) {
      try {
        await pool.close();
      } catch {
        // best effort — connection close failures should not mask the real result
      }
    }
  }
}
