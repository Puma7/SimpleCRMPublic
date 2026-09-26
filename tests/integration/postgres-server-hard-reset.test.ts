import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { sql, type Kysely } from 'kysely';

import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { executeServerHardReset } from '../../packages/server/src/maintenance/hard-reset';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000d2';

async function countRows(postgres: EmbeddedPostgres, table: string): Promise<number> {
  const result = await postgres.admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
  return result.rows[0]!.n;
}

describe('server hard reset', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;
  let attachmentsRoot: string;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('server-hard-reset');
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  beforeEach(async () => {
    await postgres.admin.query(`
      INSERT INTO workspaces (id, name) VALUES ($1, 'Reset Test') ON CONFLICT (id) DO NOTHING
    `, [WORKSPACE_ID]);
    attachmentsRoot = mkdtempSync(join(tmpdir(), 'hard-reset-attachments-'));
    writeFileSync(join(attachmentsRoot, 'kept.bin'), 'data');
  });

  afterEach(() => {
    rmSync(attachmentsRoot, { recursive: true, force: true });
  });

  // F-A2c-02: the reset truncated table by table without a transaction; a failure midway
  // left some tables empty and others (e.g. workspaces/users) intact.
  test('a failing truncate leaves every table untouched', async () => {
    // Sorts after every application table; its trigger aborts the truncate.
    await sql.raw(`
      CREATE TABLE zzz_reset_probe (id int);
      CREATE FUNCTION zzz_reset_probe_block() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'reset probe blocks truncate'; END $$;
      CREATE TRIGGER zzz_reset_probe_block BEFORE TRUNCATE ON zzz_reset_probe
        FOR EACH STATEMENT EXECUTE FUNCTION zzz_reset_probe_block();
    `).execute(db);
    try {
      await expect(executeServerHardReset(db, { attachmentsRoot })).rejects.toThrow('reset probe blocks truncate');
      expect(await countRows(postgres, 'workspaces')).toBe(1);
      expect(existsSync(join(attachmentsRoot, 'kept.bin'))).toBe(true);
    } finally {
      await sql.raw(`DROP TABLE zzz_reset_probe; DROP FUNCTION zzz_reset_probe_block();`).execute(db);
    }
  });

  // F-A2c-02: queued Graphile jobs lived in their own schema and survived the reset.
  test('the reset also removes waiting Graphile jobs', async () => {
    await sql.raw(`
      CREATE SCHEMA graphile_worker;
      CREATE TABLE graphile_worker._private_jobs (id bigint PRIMARY KEY, locked_at timestamptz);
      INSERT INTO graphile_worker._private_jobs (id, locked_at) VALUES (1, NULL), (2, now());
    `).execute(db);

    await expect(executeServerHardReset(db, { attachmentsRoot })).resolves.toMatchObject({
      truncatedTables: expect.any(Number),
    });

    expect(await countRows(postgres, 'workspaces')).toBe(0);
    // A job a live worker holds right now is left to that worker.
    const jobs = await postgres.admin.query<{ id: string }>(`SELECT id::text AS id FROM graphile_worker._private_jobs`);
    expect(jobs.rows).toEqual([{ id: '2' }]);
    expect(existsSync(join(attachmentsRoot, 'kept.bin'))).toBe(false);
  });
});
