import { runRlsIsolationCheck, type RlsCheckClient } from '../security';

export type RlsCheckCliOptions = Readonly<{
  databaseUrl?: string;
  help: boolean;
}>;

export type RlsCheckPgClient = RlsCheckClient & Readonly<{
  connect(): Promise<void>;
  end(): Promise<void>;
}>;

export type RlsCheckCliIo = Readonly<{
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
}>;

export type RlsCheckCliRunOptions = Partial<RlsCheckCliIo> & Readonly<{
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
  createClient?: (databaseUrl: string) => RlsCheckPgClient;
}>;

export function parseRlsCheckCliArgs(argv: readonly string[]): RlsCheckCliOptions {
  let databaseUrl: string | undefined;
  let help = false;

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
      case '--help':
      case '-h':
        help = true;
        break;
      default:
        throw new Error(`Unknown rls-check option: ${arg}`);
    }
  }

  return { databaseUrl, help };
}

export async function runRlsCheckCli(options: RlsCheckCliRunOptions = {}): Promise<number> {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const createClient = options.createClient ?? createDefaultPgClient;

  let parsed: RlsCheckCliOptions;
  try {
    parsed = parseRlsCheckCliArgs(argv);
  } catch (error) {
    stderr.write(`${formatCliError(error)}\n\n${rlsCheckCliHelp()}\n`);
    return 2;
  }

  if (parsed.help) {
    stdout.write(`${rlsCheckCliHelp()}\n`);
    return 0;
  }

  const databaseUrl = parsed.databaseUrl ?? env.DATABASE_URL;
  if (!databaseUrl) {
    stderr.write('DATABASE_URL is required for the server RLS isolation check.\n');
    return 2;
  }

  const client = createClient(databaseUrl);
  let connected = false;
  try {
    await client.connect();
    connected = true;
    const result = await runRlsIsolationCheck(client);
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.status === 'passed' ? 0 : 1;
  } catch (error) {
    stderr.write(`RLS isolation check failed: ${formatCliError(error)}\n`);
    return 1;
  } finally {
    if (connected) {
      await client.end();
    }
  }
}

export function rlsCheckCliHelp(): string {
  return [
    'Usage: node packages/server/dist/cli/rls-check.js [options]',
    '',
    'Runs live row-level-security isolation probes against an already migrated PostgreSQL test database.',
    'All probe data is created inside a transaction and removed with ROLLBACK.',
    '',
    'Options:',
    '  --database-url <url>    PostgreSQL connection string; defaults to DATABASE_URL',
    '  -h, --help             Show this help',
  ].join('\n');
}

function createDefaultPgClient(databaseUrl: string): RlsCheckPgClient {
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
  void runRlsCheckCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
