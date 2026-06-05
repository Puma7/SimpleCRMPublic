import type { Kysely } from 'kysely';

import type {
  JtlSyncApiPort,
  JtlSyncRunDetails,
  JtlSyncRunResult,
  JtlSyncStatusRecord,
} from './api/types';
import type { PostgresSecretPort, ServerDatabase } from './db';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
  type WorkspaceTransaction,
} from './db/workspace-context';
import {
  buildConnectionConfig,
  resolveMssqlSettingsForConnection,
  type MssqlConnectionConfig,
} from './mssql-settings';

const STATUS_KEY = 'lastSyncStatus';
const MESSAGE_KEY = 'lastSyncMessage';
const TIMESTAMP_KEY = 'lastSyncTimestamp';
const CHUNK_SIZE = 250;

const CUSTOMER_SQL = `
SELECT
  k.kKunde,
  k.dErstellt AS CustomerDateCreated,
  k.cSperre AS CustomerBlocked,
  k.cKundenNr AS CustomerNumber,
  a.cFirma AS AddressCompany,
  a.cVorname AS AddressFirstName,
  a.cName AS AddressLastName,
  a.cStrasse AS AddressStreet,
  a.cPLZ AS AddressZipCode,
  a.cOrt AS AddressCity,
  a.cLand AS AddressCountry,
  a.cTel AS AddressPhone,
  a.cMobil AS AddressMobile,
  a.cMail AS AddressEmail,
  a.cBundesland AS AddressState,
  a.cISO AS AddressCountryCode,
  a.cUSTID AS AddressVatId
FROM dbo.tKunde k
LEFT JOIN (
  SELECT kKunde, cFirma, cVorname, cName, cStrasse, cPLZ, cOrt, cLand, cTel, cMobil, cMail, cBundesland, cISO, cUSTID
  FROM dbo.tAdresse
  WHERE nStandard = 1
  UNION ALL
  SELECT DISTINCT a1.kKunde, a1.cFirma, a1.cVorname, a1.cName, a1.cStrasse, a1.cPLZ, a1.cOrt, a1.cLand, a1.cTel, a1.cMobil, a1.cMail, a1.cBundesland, a1.cISO, a1.cUSTID
  FROM dbo.tAdresse a1
  WHERE NOT EXISTS (SELECT 1 FROM dbo.tAdresse a2 WHERE a2.kKunde = a1.kKunde AND a2.nStandard = 1)
  AND a1.kAdresse = (SELECT MIN(kAdresse) FROM dbo.tAdresse a3 WHERE a3.kKunde = a1.kKunde)
) a ON k.kKunde = a.kKunde
WHERE (k.cSperre != 'Y' OR k.cSperre IS NULL)
ORDER BY k.kKunde;
`;

const PRODUCT_SQL = `
SELECT
  a.kArtikel,
  a.cArtNr AS Sku,
  tab.cName AS Name,
  tab.cBeschreibung AS Description,
  a.fVKNetto AS PriceNet,
  a.fVKBrutto AS PriceGross,
  a.cBarcode AS Barcode,
  tl.fLagerbestand AS StockLevel,
  a.cAktiv AS IsActive,
  a.dErstelldatum AS ProductDateCreated
FROM dbo.tArtikel a
LEFT JOIN dbo.tArtikelBeschreibung tab ON a.kArtikel = tab.kArtikel AND tab.kSprache = 1
LEFT JOIN dbo.tLagerbestand tl ON a.kArtikel = tl.kArtikel
WHERE a.cAktiv = 'Y'
ORDER BY a.kArtikel;
`;

const FIRMEN_SQL = 'SELECT kFirma, cName FROM dbo.tFirma ORDER BY cName;';
const WARENLAGER_SQL = 'SELECT kWarenlager, cName FROM dbo.tWarenlager WHERE nAktiv = 1 ORDER BY cName;';
const ZAHLUNGSARTEN_SQL = 'SELECT kZahlungsart, cName FROM dbo.tZahlungsart WHERE nAktiv = 1 ORDER BY cName;';
const VERSANDARTEN_SQL = "SELECT kVersandart, cName FROM dbo.tversandart WHERE cAktiv = 'Y' ORDER BY cName;";

export type JtlSyncSourceData = Readonly<{
  customers: readonly Record<string, unknown>[];
  products: readonly Record<string, unknown>[];
  firmen: readonly Record<string, unknown>[];
  warenlager: readonly Record<string, unknown>[];
  zahlungsarten: readonly Record<string, unknown>[];
  versandarten: readonly Record<string, unknown>[];
}>;

export type NormalizedJtlSyncData = Readonly<{
  customers: readonly NormalizedJtlSyncCustomer[];
  products: readonly NormalizedJtlSyncProduct[];
  firmen: readonly NormalizedJtlReference[];
  warenlager: readonly NormalizedJtlReference[];
  zahlungsarten: readonly NormalizedJtlReference[];
  versandarten: readonly NormalizedJtlReference[];
}>;

type NormalizedJtlSyncCustomer = Readonly<{
  sourceSqliteId: number;
  customerNumber: string | null;
  name: string | null;
  firstName: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  street: string | null;
  zipCode: string | null;
  city: string | null;
  country: string | null;
  jtlDateCreated: Date | null;
  jtlBlocked: boolean;
  sourceRow: unknown;
}>;

type NormalizedJtlSyncProduct = Readonly<{
  sourceSqliteId: number;
  sku: string | null;
  name: string;
  description: string | null;
  price: string;
  isActive: boolean;
  jtlDateCreated: Date | null;
  sourceRow: unknown;
}>;

type NormalizedJtlReference = Readonly<{
  sourceSqliteId: number;
  name: string | null;
  sourceRow: unknown;
}>;

export type JtlSyncReader = Readonly<{
  fetchAll(input: { workspaceId: string }): Promise<JtlSyncSourceData>;
}>;

export type JtlSyncStore = Readonly<{
  getStatus(input: { workspaceId: string }): Promise<JtlSyncStatusRecord>;
  setStatus(input: { workspaceId: string; status: string; message: string; timestamp: string }): Promise<void>;
  upsertData(input: {
    workspaceId: string;
    actorUserId: string;
    data: NormalizedJtlSyncData;
    syncedAt: Date;
  }): Promise<JtlSyncRunDetails>;
}>;

export type JtlSyncPortOptions = Readonly<{
  reader: JtlSyncReader;
  store: JtlSyncStore;
  now?: () => Date;
}>;

export function createJtlSyncPort(options: JtlSyncPortOptions): JtlSyncApiPort {
  const now = options.now ?? (() => new Date());
  const runningWorkspaces = new Set<string>();

  return {
    getStatus(input) {
      return options.store.getStatus(input);
    },

    async run(input): Promise<JtlSyncRunResult> {
      if (runningWorkspaces.has(input.workspaceId)) {
        const timestamp = now().toISOString();
        const message = 'Sync already in progress.';
        await options.store.setStatus({
          workspaceId: input.workspaceId,
          status: 'Skipped',
          message,
          timestamp,
        });
        return { success: false, message };
      }

      runningWorkspaces.add(input.workspaceId);
      const startedAt = now();
      await options.store.setStatus({
        workspaceId: input.workspaceId,
        status: 'Running',
        message: 'Starting data synchronization...',
        timestamp: startedAt.toISOString(),
      });

      try {
        const source = await options.reader.fetchAll({ workspaceId: input.workspaceId });
        await options.store.setStatus({
          workspaceId: input.workspaceId,
          status: 'Running',
          message: jtlSyncFetchedMessage(source),
          timestamp: now().toISOString(),
        });

        const normalized = normalizeJtlSyncData(source);
        const details = await options.store.upsertData({
          workspaceId: input.workspaceId,
          actorUserId: input.actorUserId,
          data: normalized,
          syncedAt: now(),
        });
        const durationSeconds = ((now().getTime() - startedAt.getTime()) / 1000).toFixed(2);
        const message = [
          `Sync completed successfully in ${durationSeconds}s.`,
          `Synced ${details.customersSynced} customers, ${details.productsSynced} products,`,
          `${details.firmenSynced} Firmen, ${details.warenlagerSynced} Warenlager,`,
          `${details.zahlungsartenSynced} Zahlungsarten, ${details.versandartenSynced} Versandarten.`,
        ].join(' ');
        await options.store.setStatus({
          workspaceId: input.workspaceId,
          status: 'Success',
          message,
          timestamp: now().toISOString(),
        });
        return { success: true, message, details };
      } catch (error) {
        const message = `Sync failed: ${errorMessage(error)}`;
        await options.store.setStatus({
          workspaceId: input.workspaceId,
          status: 'Error',
          message,
          timestamp: now().toISOString(),
        });
        return { success: false, message, errorDetails: syncErrorDetails(error) };
      } finally {
        runningWorkspaces.delete(input.workspaceId);
      }
    },
  };
}

export type PostgresJtlSyncPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  secrets?: PostgresSecretPort;
  connect?: JtlSyncMssqlConnect;
  applyWorkspaceSession?: WorkspaceSessionApplier;
  now?: () => Date;
}>;

export function createPostgresJtlSyncPort(options: PostgresJtlSyncPortOptions): JtlSyncApiPort {
  return createJtlSyncPort({
    now: options.now,
    reader: createMssqlJtlSyncReader(options),
    store: createPostgresJtlSyncStore(options),
  });
}

export type JtlSyncMssqlConnect = (config: MssqlConnectionConfig) => Promise<JtlSyncMssqlConnection>;

type JtlSyncMssqlConnection = Readonly<{
  request(): {
    query(query: string): Promise<{ recordset?: unknown[] }>;
  };
  close(): Promise<void> | void;
}>;

export function createMssqlJtlSyncReader(options: {
  db: Kysely<ServerDatabase>;
  secrets?: PostgresSecretPort;
  connect?: JtlSyncMssqlConnect;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}): JtlSyncReader {
  const connect = options.connect ?? defaultJtlSyncMssqlConnect;

  return {
    async fetchAll(input) {
      const resolved = await resolveMssqlSettingsForConnection({
        db: options.db,
        secrets: options.secrets,
        applyWorkspaceSession: options.applyWorkspaceSession,
        workspaceId: input.workspaceId,
      });
      if (!resolved.ok) throw new Error(resolved.error);

      const baseConfig = buildConnectionConfig(resolved.settings);
      const config: MssqlConnectionConfig = {
        ...baseConfig,
        pool: { ...baseConfig.pool, max: 5 },
        requestTimeout: 120_000,
      };
      let connection: JtlSyncMssqlConnection | null = null;
      try {
        connection = await connect(config);
        return {
          customers: await queryMssqlRows(connection, CUSTOMER_SQL),
          products: await queryMssqlRows(connection, PRODUCT_SQL),
          firmen: await queryMssqlRows(connection, FIRMEN_SQL),
          warenlager: await queryMssqlRows(connection, WARENLAGER_SQL),
          zahlungsarten: await queryMssqlRows(connection, ZAHLUNGSARTEN_SQL),
          versandarten: await queryMssqlRows(connection, VERSANDARTEN_SQL),
        };
      } finally {
        await connection?.close();
      }
    },
  };
}

export function createPostgresJtlSyncStore(options: {
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}): JtlSyncStore {
  return {
    async getStatus(input) {
      const rows = await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => trx
          .selectFrom('sync_info')
          .select(['key', 'value'])
          .where('workspace_id', '=', input.workspaceId)
          .where('key', 'in', [STATUS_KEY, MESSAGE_KEY, TIMESTAMP_KEY])
          .execute(),
        { applySession: options.applyWorkspaceSession },
      );
      const values = new Map(rows.map((row) => [row.key, row.value]));
      return {
        status: values.get(STATUS_KEY) ?? 'Unknown',
        message: values.get(MESSAGE_KEY) ?? '',
        timestamp: values.get(TIMESTAMP_KEY) ?? '',
      };
    },

    async setStatus(input) {
      await setJtlSyncStatus({
        db: options.db,
        applyWorkspaceSession: options.applyWorkspaceSession,
        ...input,
      });
    },

    async upsertData(input) {
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          await upsertJtlCustomers(trx, input.workspaceId, input.data.customers, input.syncedAt);
          await upsertJtlProducts(trx, input.workspaceId, input.data.products, input.syncedAt);
          await upsertJtlReferences(trx, 'jtl_firmen', input.workspaceId, input.data.firmen, input.syncedAt);
          await upsertJtlReferences(trx, 'jtl_warenlager', input.workspaceId, input.data.warenlager, input.syncedAt);
          await upsertJtlReferences(trx, 'jtl_zahlungsarten', input.workspaceId, input.data.zahlungsarten, input.syncedAt);
          await upsertJtlReferences(trx, 'jtl_versandarten', input.workspaceId, input.data.versandarten, input.syncedAt);
          const found = (
            input.data.customers.length +
            input.data.products.length +
            input.data.firmen.length +
            input.data.warenlager.length +
            input.data.zahlungsarten.length +
            input.data.versandarten.length
          );
          return {
            found,
            synced: found,
            customersFound: input.data.customers.length,
            customersSynced: input.data.customers.length,
            productsFound: input.data.products.length,
            productsSynced: input.data.products.length,
            firmenFound: input.data.firmen.length,
            firmenSynced: input.data.firmen.length,
            warenlagerFound: input.data.warenlager.length,
            warenlagerSynced: input.data.warenlager.length,
            zahlungsartenFound: input.data.zahlungsarten.length,
            zahlungsartenSynced: input.data.zahlungsarten.length,
            versandartenFound: input.data.versandarten.length,
            versandartenSynced: input.data.versandarten.length,
          };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

export function normalizeJtlSyncData(source: JtlSyncSourceData): NormalizedJtlSyncData {
  return {
    customers: source.customers.flatMap(normalizeJtlCustomerRow),
    products: source.products.flatMap(normalizeJtlProductRow),
    firmen: source.firmen.flatMap((row) => normalizeJtlReferenceRow(row, 'kFirma')),
    warenlager: source.warenlager.flatMap((row) => normalizeJtlReferenceRow(row, 'kWarenlager')),
    zahlungsarten: source.zahlungsarten.flatMap((row) => normalizeJtlReferenceRow(row, 'kZahlungsart')),
    versandarten: source.versandarten.flatMap((row) => normalizeJtlReferenceRow(row, 'kVersandart')),
  };
}

async function queryMssqlRows(connection: JtlSyncMssqlConnection, query: string): Promise<Record<string, unknown>[]> {
  const result = await connection.request().query(query);
  return (result.recordset ?? []).filter(isRecord);
}

async function defaultJtlSyncMssqlConnect(config: MssqlConnectionConfig): Promise<JtlSyncMssqlConnection> {
  const sql = await import('mssql');
  return new sql.ConnectionPool(config).connect();
}

async function setJtlSyncStatus(input: {
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
  workspaceId: string;
  status: string;
  message: string;
  timestamp: string;
}): Promise<void> {
  const updatedAt = new Date(input.timestamp);
  const values = {
    [STATUS_KEY]: input.status,
    [MESSAGE_KEY]: input.message,
    [TIMESTAMP_KEY]: input.timestamp,
  };
  await withWorkspaceTransaction(
    input.db,
    { workspaceId: input.workspaceId, role: 'system' },
    async (trx) => {
      await trx
        .insertInto('sync_info')
        .values(Object.entries(values).map(([key, value]) => ({
          workspace_id: input.workspaceId,
          key,
          value,
          last_updated: updatedAt,
          source_row: { origin: 'server_jtl_sync' },
          imported_in_run_id: null,
          updated_at: updatedAt,
        })))
        .onConflict((oc) => oc.columns(['workspace_id', 'key']).doUpdateSet({
          value: (eb: any) => eb.ref('excluded.value'),
          last_updated: updatedAt,
          updated_at: updatedAt,
        }))
        .execute();
    },
    { applySession: input.applyWorkspaceSession },
  );
}

async function upsertJtlCustomers(
  trx: WorkspaceTransaction,
  workspaceId: string,
  rows: readonly NormalizedJtlSyncCustomer[],
  syncedAt: Date,
): Promise<void> {
  for (const chunk of chunks(rows, CHUNK_SIZE)) {
    await trx
      .insertInto('customers')
      .values(chunk.map((row) => ({
        workspace_id: workspaceId,
        source_sqlite_id: row.sourceSqliteId,
        jtl_kkunde: row.sourceSqliteId,
        customer_number: row.customerNumber,
        name: row.name,
        first_name: row.firstName,
        company: row.company,
        email: row.email,
        phone: row.phone,
        mobile: row.mobile,
        street: row.street,
        zip_code: row.zipCode,
        city: row.city,
        country: row.country,
        jtl_date_created: row.jtlDateCreated,
        jtl_blocked: row.jtlBlocked,
        status: 'Active',
        notes: null,
        affiliate_link: null,
        date_added: row.jtlDateCreated,
        last_synced: syncedAt,
        source_row: row.sourceRow,
        imported_in_run_id: null,
        created_at: syncedAt,
        updated_at: syncedAt,
      })))
      .onConflict((oc) => oc.columns(['workspace_id', 'source_sqlite_id']).doUpdateSet({
        jtl_kkunde: (eb: any) => eb.ref('excluded.jtl_kkunde'),
        customer_number: (eb: any) => eb.ref('excluded.customer_number'),
        name: (eb: any) => eb.ref('excluded.name'),
        first_name: (eb: any) => eb.ref('excluded.first_name'),
        company: (eb: any) => eb.ref('excluded.company'),
        email: (eb: any) => eb.ref('excluded.email'),
        phone: (eb: any) => eb.ref('excluded.phone'),
        mobile: (eb: any) => eb.ref('excluded.mobile'),
        street: (eb: any) => eb.ref('excluded.street'),
        zip_code: (eb: any) => eb.ref('excluded.zip_code'),
        city: (eb: any) => eb.ref('excluded.city'),
        country: (eb: any) => eb.ref('excluded.country'),
        jtl_date_created: (eb: any) => eb.ref('excluded.jtl_date_created'),
        jtl_blocked: (eb: any) => eb.ref('excluded.jtl_blocked'),
        last_synced: syncedAt,
        source_row: (eb: any) => eb.ref('excluded.source_row'),
        updated_at: syncedAt,
      }))
      .execute();
  }
}

async function upsertJtlProducts(
  trx: WorkspaceTransaction,
  workspaceId: string,
  rows: readonly NormalizedJtlSyncProduct[],
  syncedAt: Date,
): Promise<void> {
  for (const chunk of chunks(rows, CHUNK_SIZE)) {
    await trx
      .insertInto('products')
      .values(chunk.map((row) => ({
        workspace_id: workspaceId,
        source_sqlite_id: row.sourceSqliteId,
        jtl_kartikel: row.sourceSqliteId,
        name: row.name,
        sku: row.sku,
        description: row.description,
        price: row.price,
        is_active: row.isActive,
        date_created: row.jtlDateCreated,
        last_modified: syncedAt,
        jtl_date_created: row.jtlDateCreated,
        last_synced: syncedAt,
        source_row: row.sourceRow,
        imported_in_run_id: null,
        created_at: syncedAt,
        updated_at: syncedAt,
      })))
      .onConflict((oc) => oc.columns(['workspace_id', 'source_sqlite_id']).doUpdateSet({
        jtl_kartikel: (eb: any) => eb.ref('excluded.jtl_kartikel'),
        name: (eb: any) => eb.ref('excluded.name'),
        sku: (eb: any) => eb.ref('excluded.sku'),
        description: (eb: any) => eb.ref('excluded.description'),
        price: (eb: any) => eb.ref('excluded.price'),
        is_active: (eb: any) => eb.ref('excluded.is_active'),
        last_modified: syncedAt,
        jtl_date_created: (eb: any) => eb.ref('excluded.jtl_date_created'),
        last_synced: syncedAt,
        source_row: (eb: any) => eb.ref('excluded.source_row'),
        updated_at: syncedAt,
      }))
      .execute();
  }
}

type JtlReferenceTableName = 'jtl_firmen' | 'jtl_warenlager' | 'jtl_zahlungsarten' | 'jtl_versandarten';

async function upsertJtlReferences(
  trx: WorkspaceTransaction,
  tableName: JtlReferenceTableName,
  workspaceId: string,
  rows: readonly NormalizedJtlReference[],
  syncedAt: Date,
): Promise<void> {
  for (const chunk of chunks(rows, CHUNK_SIZE)) {
    await trx
      .insertInto(tableName)
      .values(chunk.map((row) => ({
        workspace_id: workspaceId,
        source_sqlite_id: row.sourceSqliteId,
        name: row.name,
        source_row: row.sourceRow,
        imported_in_run_id: null,
        updated_at: syncedAt,
      })))
      .onConflict((oc) => oc.columns(['workspace_id', 'source_sqlite_id']).doUpdateSet({
        name: (eb: any) => eb.ref('excluded.name'),
        source_row: (eb: any) => eb.ref('excluded.source_row'),
        updated_at: syncedAt,
      }))
      .execute();
  }
}

function normalizeJtlCustomerRow(row: Record<string, unknown>): NormalizedJtlSyncCustomer[] {
  const sourceSqliteId = positiveInteger(row.kKunde);
  if (sourceSqliteId === null) return [];
  return [{
    sourceSqliteId,
    customerNumber: stringOrNull(row.CustomerNumber),
    name: stringOrNull(row.AddressLastName),
    firstName: stringOrNull(row.AddressFirstName),
    company: stringOrNull(row.AddressCompany),
    email: stringOrNull(row.AddressEmail),
    phone: stringOrNull(row.AddressPhone),
    mobile: stringOrNull(row.AddressMobile),
    street: stringOrNull(row.AddressStreet),
    zipCode: stringOrNull(row.AddressZipCode),
    city: stringOrNull(row.AddressCity),
    country: stringOrNull(row.AddressCountry),
    jtlDateCreated: dateOrNull(row.CustomerDateCreated),
    jtlBlocked: booleanFlag(row.CustomerBlocked),
    sourceRow: jsonSafe(row),
  }];
}

function normalizeJtlProductRow(row: Record<string, unknown>): NormalizedJtlSyncProduct[] {
  const sourceSqliteId = positiveInteger(row.kArtikel);
  if (sourceSqliteId === null) return [];
  const price = finiteNumber(row.PriceNet) ?? finiteNumber(row.PriceGross) ?? 0;
  return [{
    sourceSqliteId,
    sku: stringOrNull(row.Sku),
    name: stringOrNull(row.Name) ?? 'Unknown Product',
    description: stringOrNull(row.Description),
    price: price.toFixed(2),
    isActive: booleanFlag(row.IsActive),
    jtlDateCreated: dateOrNull(row.ProductDateCreated),
    sourceRow: jsonSafe(row),
  }];
}

function normalizeJtlReferenceRow(row: Record<string, unknown>, idKey: string): NormalizedJtlReference[] {
  const sourceSqliteId = positiveInteger(row[idKey]);
  if (sourceSqliteId === null) return [];
  return [{
    sourceSqliteId,
    name: stringOrNull(row.cName),
    sourceRow: jsonSafe(row),
  }];
}

function jtlSyncFetchedMessage(source: JtlSyncSourceData): string {
  return [
    `Fetched ${source.customers.length} customers, ${source.products.length} products,`,
    `and ${source.firmen.length + source.warenlager.length + source.zahlungsarten.length + source.versandarten.length}`,
    'auxiliary records. Processing...',
  ].join(' ');
}

function chunks<T>(rows: readonly T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    output.push(rows.slice(index, index + size));
  }
  return output;
}

function positiveInteger(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function stringOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function dateOrNull(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function booleanFlag(value: unknown): boolean {
  if (value === true || value === 1) return true;
  const text = String(value ?? '').trim().toLowerCase();
  return text === 'y' || text === 'yes' || text === 'true' || text === '1';
}

function jsonSafe(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'Unknown error');
}

function syncErrorDetails(error: unknown): unknown {
  if (error && typeof error === 'object' && 'detailedError' in error) {
    return (error as { detailedError?: unknown }).detailedError;
  }
  return undefined;
}
