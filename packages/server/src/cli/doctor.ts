import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';

import {
  createPgMigrationDatabase,
  inspectServerMigrations,
  serverMigrations,
  type PgQueryClient,
} from '../migrations';

export type DoctorStatus = 'ok' | 'warn' | 'fail';

export type DoctorCheck = Readonly<{
  name: string;
  status: DoctorStatus;
  message: string;
  details?: Record<string, unknown>;
}>;

export type DoctorResult = Readonly<{
  status: DoctorStatus;
  checks: readonly DoctorCheck[];
}>;

export type DoctorCliOptions = Readonly<{
  databaseUrl?: string;
  backupDir?: string;
  json: boolean;
  help: boolean;
  color: boolean;
}>;

export type DoctorPgClient = PgQueryClient & Readonly<{
  connect(): Promise<void>;
  end(): Promise<void>;
}>;

export type DoctorCliIo = Readonly<{
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
}>;

export type DoctorCliRunOptions = Partial<DoctorCliIo> & Readonly<{
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
  createClient?: (databaseUrl: string) => DoctorPgClient;
}>;

export function parseDoctorCliArgs(argv: readonly string[]): DoctorCliOptions {
  let databaseUrl: string | undefined;
  let backupDir: string | undefined;
  let json = false;
  let help = false;
  let color = true;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--database-url': {
        const value = argv[index + 1];
        if (!value || value.startsWith('--')) {
          throw new Error('--database-url requires a value');
        }
        databaseUrl = value;
        index += 1;
        break;
      }
      case '--backup-dir': {
        const value = argv[index + 1];
        if (!value || value.startsWith('--')) {
          throw new Error('--backup-dir requires a value');
        }
        backupDir = value;
        index += 1;
        break;
      }
      case '--json':
        json = true;
        break;
      case '--no-color':
        color = false;
        break;
      case '--help':
      case '-h':
        help = true;
        break;
      default:
        throw new Error(`Unknown doctor option: ${arg}`);
    }
  }

  return {
    databaseUrl,
    backupDir,
    json,
    help,
    color,
  };
}

export async function runDoctorCli(options: DoctorCliRunOptions = {}): Promise<number> {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const createClient = options.createClient ?? createDefaultPgClient;

  let parsed: DoctorCliOptions;
  try {
    parsed = parseDoctorCliArgs(argv);
  } catch (error) {
    stderr.write(`${formatError(error)}\n\n${doctorCliHelp()}\n`);
    return 2;
  }

  if (parsed.help) {
    stdout.write(`${doctorCliHelp()}\n`);
    return 0;
  }

  const databaseUrl = parsed.databaseUrl ?? env.DATABASE_URL;
  if (!databaseUrl) {
    stderr.write('DATABASE_URL is required for simplecrm doctor.\n');
    return 2;
  }

  const client = createClient(databaseUrl);
  let connected = false;
  try {
    await client.connect();
    connected = true;
    const result = await runDoctorChecks(client, {
      backupDir: parsed.backupDir ?? env.BACKUP_DIR,
    });
    if (parsed.json) {
      stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      stdout.write(formatDoctorResult(result, {
        color: parsed.color && env.NO_COLOR !== '1',
      }));
    }
    return result.status === 'fail' ? 1 : 0;
  } catch (error) {
    stderr.write(`Doctor failed before checks could run: ${formatError(error)}\n`);
    return 1;
  } finally {
    if (connected) {
      await client.end();
    }
  }
}

export async function runDoctorChecks(
  client: PgQueryClient,
  options: { backupDir?: string } = {},
): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];

  checks.push(await checkDatabase(client));
  checks.push(await checkMigrations(client));
  checks.push(await checkJobQueue(client));
  checks.push(await checkConversationLocks(client));
  checks.push(await checkBackups(options.backupDir));

  return {
    status: aggregateStatus(checks),
    checks,
  };
}

export function formatDoctorResult(result: DoctorResult, options: { color?: boolean } = {}): string {
  const lines = [
    `SimpleCRM doctor: ${formatStatus(result.status, options.color)}`,
    ...result.checks.map((check) => (
      `${formatStatus(check.status, options.color)} ${check.name}: ${check.message}`
    )),
  ];
  return `${lines.join('\n')}\n`;
}

export function doctorCliHelp(): string {
  return [
    'Usage: node packages/server/dist/cli/doctor.js [options]',
    '',
    'Options:',
    '  --backup-dir <path>     Directory containing db-*.dump backups',
    '  --database-url <url>    PostgreSQL connection string; defaults to DATABASE_URL',
    '  --json                  Print machine-readable JSON',
    '  --no-color              Disable ANSI status colors',
    '  -h, --help              Show this help',
  ].join('\n');
}

async function checkDatabase(client: PgQueryClient): Promise<DoctorCheck> {
  return safeCheck('database', async () => {
    const rows = await client.query<{
      database_name: string;
      database_size: string;
    }>(`SELECT
  current_database() AS database_name,
  pg_size_pretty(pg_database_size(current_database())) AS database_size;`);
    const row = rows.rows[0];
    if (!row) {
      return { status: 'fail', message: 'database query returned no rows' };
    }
    return {
      status: 'ok',
      message: `${row.database_name} (${row.database_size})`,
      details: {
        databaseName: row.database_name,
        databaseSize: row.database_size,
      },
    };
  });
}

async function checkMigrations(client: PgQueryClient): Promise<DoctorCheck> {
  return safeCheck('migrations', async () => {
    const plan = await inspectServerMigrations(createPgMigrationDatabase(client), serverMigrations);
    if (plan.pendingIds.length > 0) {
      return {
        status: 'warn',
        message: `${plan.pendingIds.length} pending migration(s)`,
        details: {
          pendingIds: plan.pendingIds,
          appliedIds: plan.appliedIds,
        },
      };
    }
    return {
      status: 'ok',
      message: `${plan.appliedIds.length} migrations applied`,
      details: {
        appliedIds: plan.appliedIds,
      },
    };
  });
}

async function checkJobQueue(client: PgQueryClient): Promise<DoctorCheck> {
  return safeCheck('job_queue', async () => {
    const rows = await client.query<{
      ready_jobs: string | number;
      queue_lag_seconds: string | number | null;
    }>(`SELECT
  count(*)::integer AS ready_jobs,
  COALESCE(EXTRACT(EPOCH FROM max(now() - run_after))::integer, 0) AS queue_lag_seconds
FROM job_queue
WHERE locked_at IS NULL
  AND run_after <= now();`);
    const row = rows.rows[0];
    if (!row) {
      return { status: 'fail', message: 'job queue query returned no rows' };
    }
    const readyJobs = Number(row.ready_jobs);
    const lagSeconds = Number(row.queue_lag_seconds ?? 0);
    return {
      status: lagSeconds > 300 ? 'warn' : 'ok',
      message: `${readyJobs} ready job(s), lag ${lagSeconds}s`,
      details: {
        readyJobs,
        lagSeconds,
      },
    };
  });
}

async function checkConversationLocks(client: PgQueryClient): Promise<DoctorCheck> {
  return safeCheck('conversation_locks', async () => {
    const rows = await client.query<{
      stale_locks: string | number;
    }>(`SELECT count(*)::integer AS stale_locks
FROM conversation_locks
WHERE last_heartbeat_at < now() - interval '2 minutes';`);
    const row = rows.rows[0];
    if (!row) {
      return { status: 'fail', message: 'conversation lock query returned no rows' };
    }
    const staleLocks = Number(row.stale_locks);
    return {
      status: staleLocks > 0 ? 'warn' : 'ok',
      message: `${staleLocks} stale lock(s)`,
      details: {
        staleLocks,
      },
    };
  });
}

async function checkBackups(backupDir: string | undefined): Promise<DoctorCheck> {
  if (!backupDir) {
    return {
      name: 'backups',
      status: 'warn',
      message: 'backup directory not configured',
    };
  }
  if (!existsSync(backupDir)) {
    return {
      name: 'backups',
      status: 'warn',
      message: `backup directory does not exist: ${backupDir}`,
    };
  }

  try {
    const latest = findLatestBackupSet(backupDir);
    if (!latest) {
      return {
        name: 'backups',
        status: 'warn',
        message: `no db-*.dump files found in ${backupDir}`,
      };
    }

    return await verifyBackupSet(latest);
  } catch (error) {
    return {
      name: 'backups',
      status: 'fail',
      message: formatError(error),
    };
  }
}

export type BackupSet = Readonly<{
  backupDir: string;
  stamp: string;
  database: BackupFile;
  attachments?: BackupFile;
  auditArchive?: BackupFile;
  checksumManifest?: BackupFile;
}>;

export type BackupFile = Readonly<{
  fileName: string;
  path: string;
  modifiedAt: Date;
  sizeBytes: number;
}>;

export async function verifyBackupSet(backupSet: BackupSet): Promise<DoctorCheck> {
  if (backupSet.database.sizeBytes <= 0) {
    return {
      name: 'backups',
      status: 'fail',
      message: `latest database backup is empty: ${backupSet.database.fileName}`,
      details: backupDetails(backupSet),
    };
  }

  if (!backupSet.checksumManifest) {
    return {
      name: 'backups',
      status: 'warn',
      message: `latest database backup ${backupSet.database.fileName} has no checksum manifest`,
      details: backupDetails(backupSet),
    };
  }

  const manifest = parseSha256Manifest(backupSet.checksumManifest.path);
  const files = [
    backupSet.database,
    ...(backupSet.attachments ? [backupSet.attachments] : []),
    ...(backupSet.auditArchive ? [backupSet.auditArchive] : []),
  ];
  for (const file of files) {
    if (file.sizeBytes <= 0) {
      return {
        name: 'backups',
        status: 'fail',
        message: `backup file is empty: ${file.fileName}`,
        details: backupDetails(backupSet),
      };
    }
    const expectedHash = manifest.get(file.fileName);
    if (!expectedHash) {
      return {
        name: 'backups',
        status: 'fail',
        message: `checksum manifest does not include ${file.fileName}`,
        details: backupDetails(backupSet),
      };
    }
    const actualHash = await sha256File(file.path);
    if (actualHash !== expectedHash) {
      return {
        name: 'backups',
        status: 'fail',
        message: `checksum mismatch for ${file.fileName}`,
        details: {
          ...backupDetails(backupSet),
          expectedHash,
          actualHash,
        },
      };
    }
  }

  return {
    name: 'backups',
    status: 'ok',
    message: `latest database backup ${backupSet.database.fileName} verified`,
    details: backupDetails(backupSet),
  };
}

function findLatestBackupSet(backupDir: string): BackupSet | null {
  return readdirSync(backupDir)
    .filter((fileName) => /^db-.+\.dump$/.test(fileName))
    .map((fileName) => {
      const stamp = /^db-(.+)\.dump$/.exec(fileName)?.[1] ?? '';
      const path = join(backupDir, fileName);
      const stat = statSync(path);
      const attachmentsPath = join(backupDir, `attachments-${stamp}.tar`);
      const auditArchivePath = join(backupDir, `audit-archive-${stamp}.tar`);
      const manifestPath = join(backupDir, `backup-${stamp}.sha256`);
      return {
        backupDir,
        stamp,
        database: {
          fileName,
          path,
          modifiedAt: stat.mtime,
          sizeBytes: stat.size,
        },
        ...(existsSync(attachmentsPath) ? {
          attachments: fileInfo(backupDir, `attachments-${stamp}.tar`),
        } : {}),
        ...(existsSync(auditArchivePath) ? {
          auditArchive: fileInfo(backupDir, `audit-archive-${stamp}.tar`),
        } : {}),
        ...(existsSync(manifestPath) ? {
          checksumManifest: fileInfo(backupDir, `backup-${stamp}.sha256`),
        } : {}),
      } satisfies BackupSet;
    })
    .sort((left, right) => right.database.modifiedAt.getTime() - left.database.modifiedAt.getTime())[0] ?? null;
}

function fileInfo(dir: string, fileName: string): BackupFile {
  const path = join(dir, fileName);
  const stat = statSync(path);
  return {
    fileName,
    path,
    modifiedAt: stat.mtime,
    sizeBytes: stat.size,
  };
}

function parseSha256Manifest(path: string): Map<string, string> {
  const content = readFileSync(path, 'utf8');
  const entries = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = /^([a-fA-F0-9]{64})\s+\*?([^/\\]+)$/.exec(trimmed);
    if (!match) {
      throw new Error(`invalid checksum manifest line: ${trimmed}`);
    }
    entries.set(match[2], match[1].toLowerCase());
  }
  return entries;
}

function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('error', reject);
    stream.on('data', (chunk) => {
      hash.update(chunk);
    });
    stream.on('end', () => {
      resolve(hash.digest('hex'));
    });
  });
}

function backupDetails(backupSet: BackupSet): Record<string, unknown> {
  return {
    stamp: backupSet.stamp,
    database: fileDetails(backupSet.database),
    ...(backupSet.attachments ? { attachments: fileDetails(backupSet.attachments) } : {}),
    ...(backupSet.auditArchive ? { auditArchive: fileDetails(backupSet.auditArchive) } : {}),
    ...(backupSet.checksumManifest ? { checksumManifest: fileDetails(backupSet.checksumManifest) } : {}),
  };
}

function fileDetails(file: BackupFile): Record<string, unknown> {
  return {
    path: file.path,
    modifiedAt: file.modifiedAt.toISOString(),
    sizeBytes: file.sizeBytes,
  };
}

async function safeCheck(
  name: string,
  callback: () => Promise<Omit<DoctorCheck, 'name'>>,
): Promise<DoctorCheck> {
  try {
    return { name, ...await callback() };
  } catch (error) {
    return {
      name,
      status: 'fail',
      message: formatError(error),
    };
  }
}

function aggregateStatus(checks: readonly DoctorCheck[]): DoctorStatus {
  if (checks.some((check) => check.status === 'fail')) return 'fail';
  if (checks.some((check) => check.status === 'warn')) return 'warn';
  return 'ok';
}

function formatStatus(status: DoctorStatus, color = true): string {
  const label = status.toUpperCase();
  if (!color) return `[${label}]`;
  if (status === 'ok') return `\u001b[32m[${label}]\u001b[0m`;
  if (status === 'warn') return `\u001b[33m[${label}]\u001b[0m`;
  return `\u001b[31m[${label}]\u001b[0m`;
}

function createDefaultPgClient(databaseUrl: string): DoctorPgClient {
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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (require.main === module) {
  void runDoctorCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
