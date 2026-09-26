import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { createRequire } from 'module';
import { createServer } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';

import type { ServerDatabase } from '../../../packages/server/src/db/schema';
import { serverMigrations } from '../../../packages/server/src/migrations';
import { createPgMigrationDatabase, runServerMigrations } from '../../../packages/server/src/migrations/runner';

/**
 * Shared embedded-PostgreSQL harness for regression tests that need real
 * column types, constraints, RLS and pool behaviour. Mirrors the setup of
 * postgres-task-calendar-atomic.test.ts, but connects the application pool as
 * a NOSUPERUSER/NOBYPASSRLS role that owns the tables, so FORCE ROW LEVEL
 * SECURITY applies exactly as in production.
 *
 * Callers must keep `jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'))`
 * in their own test file; jest hoists mocks per file.
 *
 * Initdb refuses to run as root, so these suites only run as a normal user
 * (as in CI).
 */

export type PgClient = {
  connect(): Promise<void>;
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: readonly Row[]; rowCount?: number | null }>;
  end(): Promise<void>;
};

export type EmbeddedPostgres = Readonly<{
  port: number;
  /** Superuser client for seeding and assertions that must bypass RLS. */
  admin: PgClient;
  /** Kysely over a pool of the non-superuser application role. */
  createApplicationDb(options?: Readonly<{ maxConnections?: number }>): Kysely<ServerDatabase>;
  stop(): Promise<void>;
}>;

const SUPERUSER_PASSWORD = 'regression-test-superuser-password';
const APP_ROLE = 'simplecrm_regression_app';
const APP_ROLE_PASSWORD = 'regression-test-app-password';

async function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === 'string') {
          reject(new Error('could not allocate PostgreSQL test port'));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function startProcess(databaseDir: string, port: number): Promise<ChildProcessWithoutNullStreams> {
  const moduleUrl = pathToFileURL(join(
    __dirname, '..', '..', '..', 'packages', 'desktop', 'node_modules', 'embedded-postgres', 'dist', 'index.js',
  )).href;
  const script = `
import EmbeddedPostgres from ${JSON.stringify(moduleUrl)};
const database = new EmbeddedPostgres({
  databaseDir: ${JSON.stringify(databaseDir)},
  port: ${port},
  user: 'postgres',
  password: ${JSON.stringify(SUPERUSER_PASSWORD)},
  authMethod: 'scram-sha-256',
  persistent: false,
  onLog() {},
  onError(error) { console.error(error); },
});
await database.initialise();
await database.start();
console.log('REGRESSION_POSTGRES_READY');
process.stdin.once('data', async () => {
  await database.stop();
  process.exit(0);
});
process.stdin.resume();
`;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', script]);
  await new Promise<void>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => reject(new Error(`PostgreSQL startup timed out: ${stderr}`)), 60_000);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (stdout.includes('REGRESSION_POSTGRES_READY')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (!stdout.includes('REGRESSION_POSTGRES_READY')) {
        clearTimeout(timeout);
        reject(new Error(`PostgreSQL exited with ${code}: ${stderr}`));
      }
    });
  });
  return child;
}

export async function startMigratedEmbeddedPostgres(prefix: string): Promise<EmbeddedPostgres> {
  const databaseDir = mkdtempSync(join(tmpdir(), `simplecrm-${prefix}-`));
  const port = await findAvailablePort();
  const child = await startProcess(databaseDir, port);
  const requireFromServer = createRequire(join(__dirname, '..', '..', '..', 'packages', 'server', 'package.json'));
  const { Client } = requireFromServer('pg') as { Client: new (options: Record<string, unknown>) => PgClient };
  const base = { host: '127.0.0.1', port, database: 'postgres' };

  const admin = new Client({ ...base, user: 'postgres', password: SUPERUSER_PASSWORD });
  await admin.connect();
  await admin.query(`
    CREATE ROLE ${APP_ROLE}
    LOGIN PASSWORD '${APP_ROLE_PASSWORD}'
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS
  `);
  await admin.query(`GRANT CREATE ON DATABASE postgres TO ${APP_ROLE}`);
  await admin.query(`GRANT CREATE ON SCHEMA public TO ${APP_ROLE}`);

  const migrator = new Client({ ...base, user: APP_ROLE, password: APP_ROLE_PASSWORD });
  await migrator.connect();
  await runServerMigrations(createPgMigrationDatabase(migrator), serverMigrations);
  await migrator.end();

  const pools: Pool[] = [];
  return {
    port,
    admin,
    createApplicationDb(options = {}) {
      const pool = new Pool({ ...base, user: APP_ROLE, password: APP_ROLE_PASSWORD, max: options.maxConnections ?? 10 });
      // Stopping the embedded server can surface FATAL 57P01 on idle clients;
      // without a listener pg-pool rethrows it as an unhandled error.
      pool.on('error', () => {});
      pool.on('connect', (client) => client.on('error', () => {}));
      pools.push(pool);
      return new Kysely<ServerDatabase>({ dialect: new PostgresDialect({ pool }) });
    },
    async stop() {
      for (const pool of pools) await pool.end().catch(() => undefined);
      await admin.end().catch(() => undefined);
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null) {
          resolve();
          return;
        }
        child.once('exit', () => resolve());
        child.stdin.write('stop\n');
      });
      rmSync(databaseDir, { recursive: true, force: true });
    },
  };
}
