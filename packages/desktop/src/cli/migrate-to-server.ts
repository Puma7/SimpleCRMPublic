import {
  buildStandaloneToServerMigrationPlan,
  runStandaloneToServerMigration,
  type StandaloneToServerAttachmentSync,
  type StandaloneToServerMigrationExecutor,
} from '../migrate-to-server';

export type MigrateStandaloneToServerCliOptions = Readonly<{
  sourceDatabaseUrl?: string;
  targetDatabaseUrl?: string;
  dumpPath?: string;
  attachmentsMode: 'skip' | 'local-copy' | 'rsync';
  attachmentsSourceDir?: string;
  attachmentsTargetDir?: string;
  attachmentsTarget?: string;
  pgDumpCommand?: string;
  pgRestoreCommand?: string;
  rsyncCommand?: string;
  dryRun: boolean;
  help: boolean;
}>;

export type MigrateStandaloneToServerCliIo = Readonly<{
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
}>;

export type MigrateStandaloneToServerCliRunOptions = Partial<MigrateStandaloneToServerCliIo> & Readonly<{
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
  executor?: StandaloneToServerMigrationExecutor;
}>;

export function parseMigrateStandaloneToServerCliArgs(
  argv: readonly string[],
): MigrateStandaloneToServerCliOptions {
  let sourceDatabaseUrl: string | undefined;
  let targetDatabaseUrl: string | undefined;
  let dumpPath: string | undefined;
  let attachmentsMode: MigrateStandaloneToServerCliOptions['attachmentsMode'] = 'skip';
  let attachmentsSourceDir: string | undefined;
  let attachmentsTargetDir: string | undefined;
  let attachmentsTarget: string | undefined;
  let pgDumpCommand: string | undefined;
  let pgRestoreCommand: string | undefined;
  let rsyncCommand: string | undefined;
  let dryRun = false;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--source-database-url':
        sourceDatabaseUrl = readOptionValue(argv, index, arg);
        index += 1;
        break;
      case '--target-database-url':
        targetDatabaseUrl = readOptionValue(argv, index, arg);
        index += 1;
        break;
      case '--dump-path':
        dumpPath = readOptionValue(argv, index, arg);
        index += 1;
        break;
      case '--attachments-mode':
        attachmentsMode = parseAttachmentsMode(readOptionValue(argv, index, arg));
        index += 1;
        break;
      case '--attachments-source-dir':
        attachmentsSourceDir = readOptionValue(argv, index, arg);
        index += 1;
        break;
      case '--attachments-target-dir':
        attachmentsTargetDir = readOptionValue(argv, index, arg);
        index += 1;
        break;
      case '--attachments-target':
        attachmentsTarget = readOptionValue(argv, index, arg);
        index += 1;
        break;
      case '--pg-dump-command':
        pgDumpCommand = readOptionValue(argv, index, arg);
        index += 1;
        break;
      case '--pg-restore-command':
        pgRestoreCommand = readOptionValue(argv, index, arg);
        index += 1;
        break;
      case '--rsync-command':
        rsyncCommand = readOptionValue(argv, index, arg);
        index += 1;
        break;
      case '--dry-run':
        dryRun = true;
        break;
      case '--help':
      case '-h':
        help = true;
        break;
      default:
        throw new Error(`Unknown migrate-to-server option: ${arg}`);
    }
  }

  return {
    sourceDatabaseUrl,
    targetDatabaseUrl,
    dumpPath,
    attachmentsMode,
    attachmentsSourceDir,
    attachmentsTargetDir,
    attachmentsTarget,
    pgDumpCommand,
    pgRestoreCommand,
    rsyncCommand,
    dryRun,
    help,
  };
}

export async function runMigrateStandaloneToServerCli(
  options: MigrateStandaloneToServerCliRunOptions = {},
): Promise<number> {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  let parsed: MigrateStandaloneToServerCliOptions;
  try {
    parsed = parseMigrateStandaloneToServerCliArgs(argv);
    validateMigrateStandaloneToServerCliOptions(parsed);
  } catch (error) {
    stderr.write(`${formatError(error)}\n\n${migrateStandaloneToServerCliHelp()}\n`);
    return 2;
  }

  if (parsed.help) {
    stdout.write(`${migrateStandaloneToServerCliHelp()}\n`);
    return 0;
  }

  const sourceDatabaseUrl = parsed.sourceDatabaseUrl ?? env.STANDALONE_DATABASE_URL;
  const targetDatabaseUrl = parsed.targetDatabaseUrl ?? env.DATABASE_URL;
  if (!sourceDatabaseUrl) {
    stderr.write('Source database URL is required. Use --source-database-url or STANDALONE_DATABASE_URL.\n');
    return 2;
  }
  if (!targetDatabaseUrl) {
    stderr.write('Target database URL is required. Use --target-database-url or DATABASE_URL.\n');
    return 2;
  }
  if (!parsed.dumpPath) {
    stderr.write('--dump-path is required for standalone to server migration.\n');
    return 2;
  }

  try {
    const plan = buildStandaloneToServerMigrationPlan({
      sourceDatabaseUrl,
      targetDatabaseUrl,
      dumpPath: parsed.dumpPath,
      pgDumpCommand: parsed.pgDumpCommand,
      pgRestoreCommand: parsed.pgRestoreCommand,
      attachments: buildAttachmentSync(parsed),
    });

    if (parsed.dryRun) {
      stdout.write(`${JSON.stringify({ status: 'dry_run', plan: redactPlan(plan) }, null, 2)}\n`);
      return 0;
    }

    const result = await runStandaloneToServerMigration(plan, options.executor);
    stdout.write(`${JSON.stringify({ ...result, plan: redactPlan(plan) }, null, 2)}\n`);
    return 0;
  } catch (error) {
    stderr.write(`Standalone to server migration failed: ${formatError(error)}\n`);
    return 1;
  }
}

export function migrateStandaloneToServerCliHelp(): string {
  return [
    'Usage: node packages/desktop/dist/cli/migrate-to-server.js [options]',
    '',
    'Options:',
    '  --source-database-url <url>   Embedded/standalone PostgreSQL URL; defaults to STANDALONE_DATABASE_URL',
    '  --target-database-url <url>   Target server PostgreSQL URL; defaults to DATABASE_URL',
    '  --dump-path <path>            Temporary custom-format dump path',
    '  --attachments-mode <mode>     skip, local-copy, or rsync; defaults to skip',
    '  --attachments-source-dir <p>  Source attachments directory for local-copy or rsync',
    '  --attachments-target-dir <p>  Local target directory for local-copy',
    '  --attachments-target <target> Rsync target for rsync mode',
    '  --pg-dump-command <cmd>       pg_dump command path/name',
    '  --pg-restore-command <cmd>    pg_restore command path/name',
    '  --rsync-command <cmd>         rsync command path/name',
    '  --dry-run                    Print the redacted migration plan without executing commands',
    '  -h, --help                   Show this help',
  ].join('\n');
}

function buildAttachmentSync(options: MigrateStandaloneToServerCliOptions): StandaloneToServerAttachmentSync {
  if (options.attachmentsMode === 'skip') return { mode: 'skip' };
  if (options.attachmentsMode === 'local-copy') {
    return {
      mode: 'local-copy',
      sourceDir: options.attachmentsSourceDir ?? '',
      targetDir: options.attachmentsTargetDir ?? '',
    };
  }
  return {
    mode: 'rsync',
    sourceDir: options.attachmentsSourceDir ?? '',
    target: options.attachmentsTarget ?? '',
    rsyncCommand: options.rsyncCommand,
  };
}

function validateMigrateStandaloneToServerCliOptions(options: MigrateStandaloneToServerCliOptions): void {
  if (options.help) return;
  if (options.attachmentsMode === 'local-copy') {
    if (!options.attachmentsSourceDir) throw new Error('--attachments-source-dir is required with local-copy');
    if (!options.attachmentsTargetDir) throw new Error('--attachments-target-dir is required with local-copy');
  }
  if (options.attachmentsMode === 'rsync') {
    if (!options.attachmentsSourceDir) throw new Error('--attachments-source-dir is required with rsync');
    if (!options.attachmentsTarget) throw new Error('--attachments-target is required with rsync');
  }
}

function redactPlan(plan: ReturnType<typeof buildStandaloneToServerMigrationPlan>): unknown {
  return {
    sourceDatabaseUrl: '<source-database-url>',
    targetDatabaseUrl: '<target-database-url>',
    dumpPath: plan.dumpPath,
    steps: plan.steps.map((step) => {
      if ('redactedArgs' in step) {
        return {
          type: step.type,
          command: step.command,
          args: step.redactedArgs,
        };
      }
      return step;
    }),
  };
}

function parseAttachmentsMode(value: string): MigrateStandaloneToServerCliOptions['attachmentsMode'] {
  if (value === 'skip' || value === 'local-copy' || value === 'rsync') return value;
  throw new Error('--attachments-mode must be skip, local-copy, or rsync');
}

function readOptionValue(argv: readonly string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'unknown error');
}

if (require.main === module) {
  runMigrateStandaloneToServerCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`Standalone to server migration failed: ${formatError(error)}\n`);
      process.exitCode = 1;
    });
}
