import type { Kysely } from 'kysely';

import type { PostgresSecretPort, SecretIdentifier, ServerDatabase } from './db';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
} from './db/workspace-context';

const MSSQL_SETTINGS_KEY = 'mssql_settings_v1';
const MSSQL_PASSWORD_SECRET_KIND = 'mssql.password';
const MSSQL_PASSWORD_SECRET_NAME = 'mssql:default';
const MAX_MSSQL_QUERY_CHARS = 8_000;
const MAX_MSSQL_RESULT_ROWS = 100;
const MAX_MSSQL_RESULT_JSON_CHARS = 256_000;

export type MssqlSettings = {
  server: string;
  database: string;
  user?: string;
  port?: number;
  encrypt?: boolean;
  trustServerCertificate?: boolean;
  forcePort?: boolean;
  kBenutzer?: number;
  kShop?: number;
  kPlattform?: number;
  kSprache?: number;
  cWaehrung?: string;
  fWaehrungFaktor?: number;
};

export type MssqlSettingsInput = MssqlSettings & {
  password?: string | null;
};

export type MssqlSettingsRecord = MssqlSettings & {
  hasPassword: boolean;
};

export type MssqlQueryResult = {
  success: boolean;
  rows?: unknown[];
  rowCount?: number;
  error?: string;
  errorDetails?: unknown;
};

export type MssqlSettingsPort = Readonly<{
  getSettings(input: { workspaceId: string }): Promise<MssqlSettingsRecord | null>;
  saveSettings(input: { workspaceId: string; settings: MssqlSettingsInput }): Promise<{ success: boolean; error?: string }>;
  clearPassword(input: { workspaceId: string }): Promise<{ success: boolean; message: string }>;
  testConnection(input: { workspaceId: string; settings?: MssqlSettingsInput }): Promise<MssqlQueryResult>;
  executeReadOnlyQuery(input: { workspaceId: string; query: string }): Promise<MssqlQueryResult>;
}>;

export type PostgresMssqlSettingsPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  secrets?: PostgresSecretPort;
  connect?: MssqlConnectFunction;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}>;

export type MssqlConnectionConfig = {
  user?: string;
  password: string;
  database: string;
  server: string;
  port?: number;
  options: {
    encrypt: boolean;
    trustServerCertificate: boolean;
    instanceName?: string;
  };
  pool: { max: number; min: number; idleTimeoutMillis: number };
  connectionTimeout: number;
  requestTimeout: number;
};

type MssqlConnectFunction = (config: MssqlConnectionConfig) => Promise<MssqlConnectionLike>;

type MssqlConnectionLike = {
  request(): MssqlRequestLike;
  close(): Promise<void> | void;
};

type MssqlRequestLike = {
  query(query: string): Promise<{ recordset?: unknown[]; rowsAffected?: number[] }>;
};

type ParsedServerInput = {
  host: string;
  instanceName?: string;
  portFromServer?: number;
};

export function createPostgresMssqlSettingsPort(
  options: PostgresMssqlSettingsPortOptions,
): MssqlSettingsPort {
  const connect = options.connect ?? defaultMssqlConnect;

  return {
    async getSettings(input) {
      const settings = await loadMssqlSettings(options.db, input.workspaceId, options.applyWorkspaceSession);
      if (!settings) return null;
      return {
        ...settings,
        hasPassword: await hasMssqlPassword(options.secrets, input.workspaceId),
      };
    },

    async saveSettings(input) {
      const normalized = normalizeMssqlSettingsInput(input.settings);
      if (!normalized.ok) return { success: false, error: normalized.error };
      const secrets = options.secrets;
      const passwordToWrite = typeof input.settings.password === 'string' && input.settings.password.length > 0
        ? input.settings.password
        : undefined;
      if (passwordToWrite && !secrets) {
        return { success: false, error: 'MSSQL secret storage is not configured' };
      }
      await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          await trx
            .insertInto('sync_info')
            .values({
              workspace_id: input.workspaceId,
              key: MSSQL_SETTINGS_KEY,
              value: JSON.stringify(normalized.settings),
            })
            .onConflict((oc) => oc.columns(['workspace_id', 'key']).doUpdateSet({
              value: JSON.stringify(normalized.settings),
            }))
            .execute();
        },
        { applySession: options.applyWorkspaceSession },
      );

      if ('password' in input.settings) {
        const password = input.settings.password;
        if (passwordToWrite) {
          if (!secrets) return { success: false, error: 'MSSQL secret storage is not configured' };
          await secrets.writeSecret({
            ...mssqlPasswordSecretIdentifier(input.workspaceId),
            value: passwordToWrite,
          });
        } else if (password === '' || password === null) {
          await options.secrets?.deleteSecret(mssqlPasswordSecretIdentifier(input.workspaceId));
        }
      }

      return { success: true };
    },

    async clearPassword(input) {
      const deleted = await options.secrets?.deleteSecret(mssqlPasswordSecretIdentifier(input.workspaceId));
      return deleted
        ? { success: true, message: 'Password successfully cleared from secure storage.' }
        : { success: true, message: 'No password found in secure storage for the current settings.' };
    },

    async testConnection(input) {
      const resolved = await resolveMssqlSettingsForConnection({
        db: options.db,
        secrets: options.secrets,
        applyWorkspaceSession: options.applyWorkspaceSession,
        workspaceId: input.workspaceId,
        settings: input.settings,
      });
      if (!resolved.ok) return { success: false, error: resolved.error };
      return executeMssqlQuery({
        connect,
        settings: resolved.settings,
        query: 'SELECT 1 AS ok',
      });
    },

    async executeReadOnlyQuery(input) {
      const validation = validateReadOnlyMssqlQuery(input.query);
      if (!validation.ok) return { success: false, error: validation.error };
      const resolved = await resolveMssqlSettingsForConnection({
        db: options.db,
        secrets: options.secrets,
        applyWorkspaceSession: options.applyWorkspaceSession,
        workspaceId: input.workspaceId,
      });
      if (!resolved.ok) return { success: false, error: resolved.error };
      return executeMssqlQuery({
        connect,
        settings: resolved.settings,
        query: validation.query,
      });
    },
  };
}

export function validateReadOnlyMssqlQuery(query: unknown): { ok: true; query: string } | { ok: false; error: string } {
  const text = String(query ?? '').trim();
  if (!text) return { ok: false, error: 'SQL darf nicht leer sein' };
  if (text.length > MAX_MSSQL_QUERY_CHARS) {
    return { ok: false, error: `SQL zu lang (max ${MAX_MSSQL_QUERY_CHARS} Zeichen)` };
  }

  const normalized = text.replace(/^\s*--.*$/gm, '').trim();
  const upper = normalized.toUpperCase();
  if (!upper.startsWith('SELECT') && !upper.startsWith('WITH')) {
    return { ok: false, error: 'Query muss mit SELECT oder WITH beginnen' };
  }
  if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE|MERGE|GRANT|REVOKE|BACKUP|RESTORE)\b/.test(upper)) {
    return { ok: false, error: 'Nur lesende SELECT-Abfragen sind erlaubt' };
  }
  return { ok: true, query: normalized };
}

export function mssqlPasswordSecretIdentifier(workspaceId: string): SecretIdentifier {
  return {
    workspaceId,
    kind: MSSQL_PASSWORD_SECRET_KIND,
    name: MSSQL_PASSWORD_SECRET_NAME,
  };
}

export async function resolveMssqlSettingsForConnection(input: {
  db: Kysely<ServerDatabase>;
  secrets?: PostgresSecretPort;
  applyWorkspaceSession?: WorkspaceSessionApplier;
  workspaceId: string;
  settings?: MssqlSettingsInput;
}): Promise<{ ok: true; settings: MssqlSettingsInput } | { ok: false; error: string }> {
  let base: MssqlSettings | null;
  if (input.settings === undefined) {
    base = await loadMssqlSettings(input.db, input.workspaceId, input.applyWorkspaceSession);
  } else {
    const normalized = normalizeMssqlSettingsInput(input.settings);
    if (!normalized.ok) return { ok: false, error: normalized.error };
    base = normalized.settings;
  }
  if (!base) return { ok: false, error: 'MSSQL-Einstellungen sind nicht konfiguriert' };

  let password = typeof input.settings?.password === 'string' && input.settings.password.length > 0
    ? input.settings.password
    : undefined;
  if (!password) {
    const secret = await input.secrets?.readSecret(mssqlPasswordSecretIdentifier(input.workspaceId));
    password = secret?.toString('utf8');
  }
  if (!password) return { ok: false, error: 'MSSQL-Passwort ist nicht konfiguriert' };

  return { ok: true, settings: { ...base, password } };
}

async function loadMssqlSettings(
  db: Kysely<ServerDatabase>,
  workspaceId: string,
  applyWorkspaceSession?: WorkspaceSessionApplier,
): Promise<MssqlSettings | null> {
  const row = await withWorkspaceTransaction(
    db,
    { workspaceId, role: 'system' },
    (trx) => trx
      .selectFrom('sync_info')
      .select('value')
      .where('workspace_id', '=', workspaceId)
      .where('key', '=', MSSQL_SETTINGS_KEY)
      .executeTakeFirst(),
    { applySession: applyWorkspaceSession },
  );
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(String(row.value));
    const normalized = normalizeMssqlSettingsInput(parsed);
    return normalized.ok ? normalized.settings : null;
  } catch {
    return null;
  }
}

async function hasMssqlPassword(secrets: PostgresSecretPort | undefined, workspaceId: string): Promise<boolean> {
  if (!secrets) return false;
  const secret = await secrets.readSecret(mssqlPasswordSecretIdentifier(workspaceId));
  return Boolean(secret && secret.length > 0);
}

function normalizeMssqlSettingsInput(
  input: MssqlSettingsInput,
): { ok: true; settings: MssqlSettings } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'MSSQL-Einstellungen muessen ein Objekt sein' };
  const server = stringField(input.server);
  const database = stringField(input.database);
  const user = stringField(input.user);
  if (!server) return { ok: false, error: 'server ist erforderlich' };
  if (!database) return { ok: false, error: 'database ist erforderlich' };
  if (!user) return { ok: false, error: 'user ist erforderlich' };

  const port = optionalPort(input.port);
  if (port === null) return { ok: false, error: 'port muss zwischen 1 und 65535 liegen' };

  const cWaehrung = stringField(input.cWaehrung);
  if (cWaehrung && !/^[A-Za-z]{3}$/.test(cWaehrung)) {
    return { ok: false, error: 'cWaehrung muss aus drei Buchstaben bestehen' };
  }

  const kBenutzer = optionalPositiveInteger(input.kBenutzer);
  if (kBenutzer === null) return { ok: false, error: 'kBenutzer muss eine positive Ganzzahl sein' };
  const kShop = optionalPositiveInteger(input.kShop);
  if (kShop === null) return { ok: false, error: 'kShop muss eine positive Ganzzahl sein' };
  const kPlattform = optionalPositiveInteger(input.kPlattform);
  if (kPlattform === null) return { ok: false, error: 'kPlattform muss eine positive Ganzzahl sein' };
  const kSprache = optionalPositiveInteger(input.kSprache);
  if (kSprache === null) return { ok: false, error: 'kSprache muss eine positive Ganzzahl sein' };
  const fWaehrungFaktor = optionalPositiveFloat(input.fWaehrungFaktor);
  if (fWaehrungFaktor === null) return { ok: false, error: 'fWaehrungFaktor muss eine positive Zahl sein' };

  const settings: MssqlSettings = {
    server,
    database,
    user,
    ...(port === undefined ? {} : { port }),
    encrypt: input.encrypt !== false,
    trustServerCertificate: input.trustServerCertificate === true,
    forcePort: input.forcePort === true,
    ...(kBenutzer === undefined ? {} : { kBenutzer }),
    ...(kShop === undefined ? {} : { kShop }),
    ...(kPlattform === undefined ? {} : { kPlattform }),
    ...(kSprache === undefined ? {} : { kSprache }),
    ...(cWaehrung ? { cWaehrung: cWaehrung.toUpperCase() } : {}),
    ...(fWaehrungFaktor === undefined ? {} : { fWaehrungFaktor }),
  };
  return { ok: true, settings };
}

export function buildConnectionConfig(settings: MssqlSettingsInput): MssqlConnectionConfig {
  const parsed = parseServerInput(settings.server);
  const numericPort = typeof settings.port === 'number' ? settings.port : undefined;
  const portFromServer = parsed.portFromServer;
  const hasInstance = Boolean(parsed.instanceName);

  let port: number | undefined;
  let instanceName: string | undefined;
  if ((settings.forcePort && (numericPort || portFromServer)) || (!settings.forcePort && portFromServer)) {
    port = (settings.forcePort ? (numericPort ?? portFromServer) : portFromServer)!;
  } else if (hasInstance) {
    instanceName = parsed.instanceName;
  } else if (numericPort) {
    port = numericPort;
  }

  return {
    user: settings.user,
    password: settings.password ?? '',
    database: settings.database,
    server: parsed.host,
    ...(typeof port === 'number' ? { port } : {}),
    options: {
      encrypt: settings.encrypt !== false,
      trustServerCertificate: settings.trustServerCertificate === true,
      ...(instanceName ? { instanceName } : {}),
    },
    pool: { max: 1, min: 0, idleTimeoutMillis: 1_000 },
    connectionTimeout: 15_000,
    requestTimeout: 15_000,
  };
}

function parseServerInput(raw: string): ParsedServerInput {
  let value = raw.trim();
  if (value.toLowerCase().startsWith('tcp:')) value = value.slice(4);

  const portMatch = value.match(/^(.*?)[,:](\d{1,5})$/);
  if (portMatch) {
    const port = Number(portMatch[2]);
    if (Number.isInteger(port) && port > 0 && port <= 65535) {
      return { host: portMatch[1], portFromServer: port };
    }
  }

  const instanceIndex = value.indexOf('\\');
  if (instanceIndex > -1) {
    return {
      host: value.substring(0, instanceIndex),
      instanceName: value.substring(instanceIndex + 1),
    };
  }

  return { host: value };
}

async function executeMssqlQuery(input: {
  connect: MssqlConnectFunction;
  settings: MssqlSettingsInput;
  query: string;
}): Promise<MssqlQueryResult> {
  let pool: MssqlConnectionLike | null = null;
  try {
    pool = await input.connect(buildConnectionConfig(input.settings));
    const result = await pool.request().query(input.query);
    const rows = sanitizeMssqlRows(result.recordset ?? []);
    return {
      success: true,
      rows,
      rowCount: result.rowsAffected?.reduce((sum, count) => sum + count, 0) ?? rows.length,
    };
  } catch (e) {
    const friendly = friendlyMssqlError(e);
    return {
      success: false,
      error: friendly.description,
      errorDetails: friendly,
    };
  } finally {
    await pool?.close();
  }
}

async function defaultMssqlConnect(config: MssqlConnectionConfig): Promise<MssqlConnectionLike> {
  const sql = await import('mssql');
  const pool = await new sql.ConnectionPool(config).connect();
  return pool;
}

function sanitizeMssqlRows(rows: unknown[]): unknown[] {
  const output: unknown[] = [];
  for (const row of rows.slice(0, MAX_MSSQL_RESULT_ROWS)) {
    const candidate = [...output, row];
    if (JSON.stringify(candidate).length > MAX_MSSQL_RESULT_JSON_CHARS) break;
    output.push(row);
  }
  return output;
}

function friendlyMssqlError(error: unknown): {
  title: string;
  description: string;
  originalMessage: string;
  code?: string;
  category: string;
  severity: string;
} {
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : undefined;
  const originalMessage = error instanceof Error ? error.message : String(error ?? 'Unknown MSSQL error');
  const known: Record<string, { title: string; description: string; category: string; severity: string }> = {
    ETIMEOUT: {
      title: 'Timeout bei der Verbindung',
      description: 'Der Server hat nicht innerhalb der erwarteten Zeit geantwortet.',
      category: 'timeout',
      severity: 'medium',
    },
    ECONNREFUSED: {
      title: 'Verbindung abgelehnt',
      description: 'Der MSSQL-Server hat die Verbindung abgelehnt.',
      category: 'network',
      severity: 'high',
    },
    ELOGIN: {
      title: 'Anmeldefehler',
      description: 'Die Anmeldung am MSSQL-Server ist fehlgeschlagen.',
      category: 'authentication',
      severity: 'high',
    },
  };
  const mapped = code ? known[code] : undefined;
  return {
    title: mapped?.title ?? 'MSSQL-Fehler',
    description: mapped?.description ?? originalMessage,
    originalMessage,
    ...(code ? { code } : {}),
    category: mapped?.category ?? 'unknown',
    severity: mapped?.severity ?? 'medium',
  };
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalPort(value: unknown): number | undefined | null {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : null;
}

function optionalPositiveInteger(value: unknown): number | undefined | null {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function optionalPositiveFloat(value: unknown): number | undefined | null {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
