import { dirname, join } from 'node:path';

import {
  buildWorkspaceSessionCommand,
  createPostgresSqliteImportTarget,
  runPostgresSqliteFinalImport,
  type PostgresSqliteFinalImportDomain,
  type PostgresSqliteFinalImportResult,
  type SqliteImportPgClient,
} from '../db';
import {
  computeSqliteFileFingerprint,
  createAttachmentCopyingSqliteSource,
  openBetterSqliteMigrationSource,
  runSqliteToPostgresMigration,
  sqliteServerEditionMigrationPlan,
  type SqliteFileMigrationSourceHandle,
  type SqliteMigrationPlan,
  type SqliteMigrationRunResult,
} from '../sqlite-migration';

export type MigrateFromSqliteCliMode = 'full' | 'stage' | 'finalize';

export type MigrateFromSqliteCliOptions = Readonly<{
  mode: MigrateFromSqliteCliMode;
  databaseUrl?: string;
  sqlitePath?: string;
  workspaceId?: string;
  sourceFingerprint?: string;
  sourceAttachmentsDir?: string;
  attachmentsDir?: string;
  copyAttachments: boolean;
  runId?: string;
  batchSize?: number;
  dryRun: boolean;
  domains?: readonly PostgresSqliteFinalImportDomain[];
  help: boolean;
}>;

export type MigrateFromSqlitePgClient = SqliteImportPgClient & Readonly<{
  connect(): Promise<void>;
  end(): Promise<void>;
}>;

export type MigrateFromSqliteCliIo = Readonly<{
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
}>;

export type MigrateFromSqliteCliRunOptions = Partial<MigrateFromSqliteCliIo> & Readonly<{
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
  createClient?: (databaseUrl: string) => MigrateFromSqlitePgClient;
  openSource?: (sqlitePath: string) => SqliteFileMigrationSourceHandle;
  computeFingerprint?: (sqlitePath: string) => Promise<string>;
  plan?: SqliteMigrationPlan;
}>;

export type MigrateFromSqliteCliResult = Readonly<{
  status: 'succeeded' | 'dry_run';
  runId: string;
  staging: SqliteMigrationRunResult | null;
  finalImport: PostgresSqliteFinalImportResult | null;
}>;

const finalDomains: readonly PostgresSqliteFinalImportDomain[] = [
  'core_crm',
  'core_mail',
  'workflow_security',
];

export function parseMigrateFromSqliteCliArgs(argv: readonly string[]): MigrateFromSqliteCliOptions {
  let mode: MigrateFromSqliteCliMode = 'full';
  let databaseUrl: string | undefined;
  let sqlitePath: string | undefined;
  let workspaceId: string | undefined;
  let sourceFingerprint: string | undefined;
  let sourceAttachmentsDir: string | undefined;
  let attachmentsDir: string | undefined;
  let copyAttachments = false;
  let runId: string | undefined;
  let batchSize: number | undefined;
  let dryRun = false;
  let help = false;
  const domains: PostgresSqliteFinalImportDomain[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--batch-size':
        batchSize = parsePositiveInteger(readOptionValue(argv, index, arg), arg);
        index += 1;
        break;
      case '--database-url':
        databaseUrl = readOptionValue(argv, index, arg);
        index += 1;
        break;
      case '--attachments-dir':
        attachmentsDir = readOptionValue(argv, index, arg);
        index += 1;
        break;
      case '--copy-attachments':
        copyAttachments = true;
        break;
      case '--domain':
        domains.push(parseDomain(readOptionValue(argv, index, arg)));
        index += 1;
        break;
      case '--domains':
        domains.push(...readOptionValue(argv, index, arg).split(',').map((value) => parseDomain(value.trim())));
        index += 1;
        break;
      case '--dry-run':
        dryRun = true;
        break;
      case '--finalize-only':
        mode = setMode(mode, 'finalize');
        break;
      case '--help':
      case '-h':
        help = true;
        break;
      case '--run-id':
        runId = readOptionValue(argv, index, arg);
        index += 1;
        break;
      case '--source-fingerprint':
        sourceFingerprint = readOptionValue(argv, index, arg);
        index += 1;
        break;
      case '--source-attachments-dir':
        sourceAttachmentsDir = readOptionValue(argv, index, arg);
        index += 1;
        break;
      case '--sqlite':
        sqlitePath = readOptionValue(argv, index, arg);
        index += 1;
        break;
      case '--stage-only':
        mode = setMode(mode, 'stage');
        break;
      case '--workspace-id':
        workspaceId = readOptionValue(argv, index, arg);
        index += 1;
        break;
      default:
        throw new Error(`Unknown migrate-from-sqlite option: ${arg}`);
    }
  }

  return {
    mode,
    databaseUrl,
    sqlitePath,
    workspaceId,
    sourceFingerprint,
    sourceAttachmentsDir,
    attachmentsDir,
    copyAttachments,
    runId,
    batchSize,
    dryRun,
    domains: domains.length > 0 ? domains : undefined,
    help,
  };
}

export async function runMigrateFromSqliteCli(
  options: MigrateFromSqliteCliRunOptions = {},
): Promise<number> {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const createClient = options.createClient ?? createDefaultPgClient;
  const openSource = options.openSource ?? openBetterSqliteMigrationSource;
  const computeFingerprint = options.computeFingerprint ?? computeSqliteFileFingerprint;
  const plan = options.plan ?? sqliteServerEditionMigrationPlan;

  let parsed: MigrateFromSqliteCliOptions;
  try {
    parsed = parseMigrateFromSqliteCliArgs(argv);
    validateMigrateFromSqliteCliOptions(parsed);
  } catch (error) {
    stderr.write(`${formatCliError(error)}\n\n${migrateFromSqliteCliHelp()}\n`);
    return 2;
  }

  if (parsed.help) {
    stdout.write(`${migrateFromSqliteCliHelp()}\n`);
    return 0;
  }

  const databaseUrl = parsed.databaseUrl ?? env.DATABASE_URL;
  if (!databaseUrl) {
    stderr.write('DATABASE_URL is required for SQLite import. Use --database-url or set DATABASE_URL.\n');
    return 2;
  }
  if (!parsed.workspaceId) {
    stderr.write('--workspace-id is required for SQLite import.\n');
    return 2;
  }

  const client = createClient(databaseUrl);
  let connected = false;
  let sourceHandle: SqliteFileMigrationSourceHandle | null = null;

  try {
    await client.connect();
    connected = true;
    await applyImportWorkspaceSession(client, parsed.workspaceId);

    let runId = parsed.runId;
    let staging: SqliteMigrationRunResult | null = null;
    let finalImport: PostgresSqliteFinalImportResult | null = null;

    if (parsed.mode !== 'finalize') {
      if (!parsed.sqlitePath) {
        throw new Error('--sqlite is required unless --finalize-only is used');
      }
      const sourceFingerprint = parsed.sourceFingerprint ?? await computeFingerprint(parsed.sqlitePath);
      sourceHandle = openSource(parsed.sqlitePath);
      const source = parsed.copyAttachments
        ? createAttachmentCopyingSqliteSource({
          source: sourceHandle.source,
          workspaceId: parsed.workspaceId,
          sourceAttachmentsRoot: parsed.sourceAttachmentsDir ?? join(dirname(parsed.sqlitePath), 'email-attachments'),
          targetAttachmentsRoot: parsed.attachmentsDir ?? env.ATTACHMENTS_DIR ?? '/app/data/attachments',
        })
        : sourceHandle.source;
      staging = await runSqliteToPostgresMigration({
        source,
        target: createPostgresSqliteImportTarget(client),
        plan,
        workspaceId: parsed.workspaceId,
        sourceFingerprint,
        dryRun: parsed.dryRun,
        batchSize: parsed.batchSize,
        metadata: {
          source: 'sqlite-file',
          sourceFingerprint,
          ...(parsed.copyAttachments ? {
            attachments: {
              copied: true,
              sourceRoot: parsed.sourceAttachmentsDir ?? join(dirname(parsed.sqlitePath), 'email-attachments'),
              targetRoot: parsed.attachmentsDir ?? env.ATTACHMENTS_DIR ?? '/app/data/attachments',
            },
          } : {}),
        },
      });
      runId = staging.runId;
    }

    if (parsed.mode !== 'stage' && !parsed.dryRun) {
      if (!runId) {
        throw new Error('--run-id is required with --finalize-only');
      }
      finalImport = await runPostgresSqliteFinalImport(client, {
        workspaceId: parsed.workspaceId,
        runId,
        domains: parsed.domains,
      });
    }

    if (!runId) {
      throw new Error('SQLite import did not produce a run id');
    }

    const result: MigrateFromSqliteCliResult = {
      status: parsed.dryRun ? 'dry_run' : 'succeeded',
      runId,
      staging,
      finalImport,
    };
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    stderr.write(`SQLite import failed: ${formatCliError(error)}\n`);
    return 1;
  } finally {
    sourceHandle?.close();
    if (connected) {
      await client.end();
    }
  }
}

export function migrateFromSqliteCliHelp(): string {
  return [
    'Usage: node packages/server/dist/cli/migrate-from-sqlite.js [options]',
    '',
    'Options:',
    '  --sqlite <path>              Source SQLite database file; required unless --finalize-only is used',
    '  --workspace-id <uuid>        Target workspace id used for RLS and imported rows',
    '  --database-url <url>         PostgreSQL connection string; defaults to DATABASE_URL',
    '  --source-fingerprint <id>    Stable source id; defaults to sha256 of the SQLite file',
    '  --copy-attachments           Copy email attachment files and rewrite staged storage paths',
    '  --source-attachments-dir <p> Source email-attachments directory; defaults next to --sqlite',
    '  --attachments-dir <path>     Target attachment root; defaults to ATTACHMENTS_DIR or /app/data/attachments',
    '  --batch-size <count>         Positive staging batch size',
    '  --dry-run                   Count/validate source tables without writing staged rows or final tables',
    '  --stage-only                Copy source rows into sqlite_import_* staging tables only',
    '  --finalize-only             Run final Postgres table mappers for an existing import run',
    '  --run-id <uuid>             Existing sqlite_import_runs id; required with --finalize-only',
    '  --domain <name>             Finalize one domain; repeatable: core_crm, core_mail, workflow_security',
    '  --domains <a,b,c>           Finalize comma-separated domains',
    '  -h, --help                  Show this help',
  ].join('\n');
}

async function applyImportWorkspaceSession(
  client: SqliteImportPgClient,
  workspaceId: string,
): Promise<void> {
  const command = buildWorkspaceSessionCommand({ workspaceId, role: 'system' });
  await client.query(
    [
      "SELECT set_config('app.workspace_id', $1, false),",
      "set_config('app.user_id', $2, false),",
      "set_config('app.role', $3, false),",
      "set_config('app.cross_workspace_access', $4, false);",
    ].join(' '),
    command.params,
  );
}

function validateMigrateFromSqliteCliOptions(options: MigrateFromSqliteCliOptions): void {
  if (options.help) {
    return;
  }
  if (options.mode === 'finalize' && !options.runId) {
    throw new Error('--run-id is required with --finalize-only');
  }
  if (options.mode !== 'finalize' && !options.sqlitePath) {
    throw new Error('--sqlite is required unless --finalize-only is used');
  }
  if (options.dryRun && options.mode === 'finalize') {
    throw new Error('--dry-run cannot be combined with --finalize-only');
  }
  if (options.copyAttachments && options.dryRun) {
    throw new Error('--copy-attachments cannot be combined with --dry-run');
  }
  if (options.copyAttachments && options.mode === 'finalize') {
    throw new Error('--copy-attachments cannot be combined with --finalize-only');
  }
}

function readOptionValue(argv: readonly string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function parsePositiveInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${option} must be a positive integer`);
  }
  return parsed;
}

function setMode(current: MigrateFromSqliteCliMode, next: MigrateFromSqliteCliMode): MigrateFromSqliteCliMode {
  if (current !== 'full' && current !== next) {
    throw new Error('Use only one of --stage-only or --finalize-only');
  }
  return next;
}

function parseDomain(value: string): PostgresSqliteFinalImportDomain {
  if (!finalDomains.includes(value as PostgresSqliteFinalImportDomain)) {
    throw new Error(`Unknown final SQLite import domain: ${value}`);
  }
  return value as PostgresSqliteFinalImportDomain;
}

function createDefaultPgClient(databaseUrl: string): MigrateFromSqlitePgClient {
  const { Client } = require('pg') as typeof import('pg');
  const client = new Client({ connectionString: databaseUrl });
  return {
    async connect() {
      await client.connect();
    },
    async end() {
      await client.end();
    },
    async query(sql, params) {
      const result = await client.query(sql, params ? [...params] : undefined);
      return { rows: result.rows };
    },
  };
}

function formatCliError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (require.main === module) {
  void runMigrateFromSqliteCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
