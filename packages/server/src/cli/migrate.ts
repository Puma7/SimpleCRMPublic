import {
  checksumMigration,
  collectMigrationSql,
  createPgMigrationDatabase,
  inspectServerMigrations,
  reconcileAppliedChecksums,
  runServerMigrations,
  serverMigrations,
  type PgQueryClient,
} from '../migrations';

export type MigrationCliMode = 'apply' | 'check' | 'manifest' | 'sql';
export type MigrationCliDirection = 'up' | 'down';

export type MigrationCliOptions = Readonly<{
  mode: MigrationCliMode;
  direction: MigrationCliDirection;
  databaseUrl?: string;
  repairChecksums: boolean;
  help: boolean;
}>;

export type MigrationPgClient = PgQueryClient & Readonly<{
  connect(): Promise<void>;
  end(): Promise<void>;
}>;

export type MigrationCliIo = Readonly<{
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
}>;

export type MigrationCliRunOptions = Partial<MigrationCliIo> & Readonly<{
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
  createClient?: (databaseUrl: string) => MigrationPgClient;
}>;

export function parseMigrationCliArgs(argv: readonly string[]): MigrationCliOptions {
  let direction: MigrationCliDirection = 'up';
  let databaseUrl: string | undefined;
  let repairChecksums = false;
  let help = false;
  const modes = new Set<MigrationCliMode>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--check':
        modes.add('check');
        break;
      case '--down':
        direction = 'down';
        break;
      case '--repair-checksums':
        repairChecksums = true;
        break;
      case '--help':
      case '-h':
        help = true;
        break;
      case '--manifest':
        modes.add('manifest');
        break;
      case '--sql':
        modes.add('sql');
        break;
      case '--database-url': {
        const value = argv[index + 1];
        if (!value || value.startsWith('--')) {
          throw new Error('--database-url requires a value');
        }
        databaseUrl = value;
        index += 1;
        break;
      }
      default:
        throw new Error(`Unknown migrate option: ${arg}`);
    }
  }

  if (modes.size > 1) {
    throw new Error('Use only one of --check, --manifest, or --sql');
  }

  const mode = modes.values().next().value ?? 'apply';
  if (direction === 'down' && mode !== 'sql') {
    throw new Error('--down is only supported with --sql');
  }
  if (repairChecksums && mode !== 'apply') {
    throw new Error('--repair-checksums can only be combined with the default apply mode');
  }

  return {
    mode,
    direction,
    databaseUrl,
    repairChecksums,
    help,
  };
}

export async function runMigrateCli(options: MigrationCliRunOptions = {}): Promise<number> {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const createClient = options.createClient ?? createDefaultPgClient;

  let parsed: MigrationCliOptions;
  try {
    parsed = parseMigrationCliArgs(argv);
  } catch (error) {
    stderr.write(`${formatCliError(error)}\n\n${migrationCliHelp()}\n`);
    return 2;
  }

  if (parsed.help) {
    stdout.write(`${migrationCliHelp()}\n`);
    return 0;
  }

  if (parsed.mode === 'manifest') {
    stdout.write(`${JSON.stringify(createMigrationManifest(parsed.direction), null, 2)}\n`);
    return 0;
  }

  if (parsed.mode === 'sql') {
    stdout.write(`${collectMigrationSql(parsed.direction)}\n`);
    return 0;
  }

  const databaseUrl = parsed.databaseUrl ?? env.DATABASE_URL;
  if (!databaseUrl) {
    stderr.write('DATABASE_URL is required for server migrations. Use --sql for offline SQL output.\n');
    return 2;
  }

  const client = createClient(databaseUrl);
  let connected = false;
  try {
    await client.connect();
    connected = true;

    const database = createPgMigrationDatabase(client);
    if (parsed.mode === 'check') {
      const plan = await inspectServerMigrations(database, serverMigrations);
      stdout.write(`${JSON.stringify({
        status: plan.pendingIds.length === 0 ? 'current' : 'pending',
        pendingIds: plan.pendingIds,
        appliedIds: plan.appliedIds,
      }, null, 2)}\n`);
      return plan.pendingIds.length === 0 ? 0 : 1;
    }

    let repairedChecksums: readonly { id: string; oldChecksum: string; newChecksum: string }[] = [];
    if (parsed.repairChecksums) {
      const reconcile = await reconcileAppliedChecksums(database, serverMigrations);
      repairedChecksums = reconcile.repaired;
    }

    const result = await runServerMigrations(database, serverMigrations);
    stdout.write(`${JSON.stringify({
      status: 'applied',
      repairedChecksums,
      appliedIds: result.appliedIds,
      skippedIds: result.skippedIds,
      plannedIds: result.plannedIds,
    }, null, 2)}\n`);
    return 0;
  } catch (error) {
    stderr.write(`Migration failed: ${formatCliError(error)}\n`);
    return 1;
  } finally {
    if (connected) {
      await client.end();
    }
  }
}

export function migrationCliHelp(): string {
  return [
    'Usage: node packages/server/dist/cli/migrate.js [options]',
    '',
    'Options:',
    '  --check                 Inspect migration status without applying pending migrations',
    '  --repair-checksums      Re-stamp stored checksums of already-applied migrations whose',
    '                          definition changed upstream, then apply pending migrations.',
    '                          Use this when migrate fails with "Checksum mismatch" after an',
    '                          upstream change re-defined an early migration.',
    '  --database-url <url>    PostgreSQL connection string; defaults to DATABASE_URL',
    '  --down                  Emit down SQL; only valid with --sql',
    '  --manifest             Print migration ids, descriptions, and checksums',
    '  --sql                  Print migration SQL instead of connecting to PostgreSQL',
    '  -h, --help             Show this help',
  ].join('\n');
}

function createMigrationManifest(direction: MigrationCliDirection): unknown {
  return {
    direction,
    migrations: serverMigrations.map((migration) => ({
      id: migration.id,
      description: migration.description,
      checksum: checksumMigration(migration),
    })),
  };
}

function createDefaultPgClient(databaseUrl: string): MigrationPgClient {
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
  void runMigrateCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
