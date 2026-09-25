import { rm, mkdir } from 'node:fs/promises';
import { sql, type Kysely } from 'kysely';

import { SERVER_MIGRATION_TABLE } from '../migrations';
import type { ServerDatabase } from '../db/schema';

export type ServerHardResetPreview = Readonly<{
  tableCount: number;
  tables: readonly string[];
  attachmentsRoot: string | null;
  auditArchiveRoot: string | null;
  willRequireInitialSetup: true;
}>;

async function listApplicationTables(db: Kysely<ServerDatabase>): Promise<string[]> {
  const result = await sql<{ tablename: string }>`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> ${SERVER_MIGRATION_TABLE}
    ORDER BY tablename ASC
  `.execute(db);
  return result.rows.map((row) => row.tablename);
}

export async function previewServerHardReset(
  db: Kysely<ServerDatabase>,
  options: { attachmentsRoot?: string; auditArchiveRoot?: string },
): Promise<ServerHardResetPreview> {
  const tables = await listApplicationTables(db);
  return {
    tableCount: tables.length,
    tables,
    attachmentsRoot: options.attachmentsRoot ?? null,
    auditArchiveRoot: options.auditArchiveRoot ?? null,
    willRequireInitialSetup: true,
  };
}

export async function executeServerHardReset(
  db: Kysely<ServerDatabase>,
  options: { attachmentsRoot?: string; auditArchiveRoot?: string },
): Promise<{ truncatedTables: number }> {
  // One transaction and one TRUNCATE statement: a failure (deadlock, lock
  // timeout, lost connection) rolls back completely instead of leaving some
  // tables empty and others (workspaces, users) intact. Files are removed only
  // after the commit.
  const tables = await db.transaction().execute(async (trx) => {
    // Fail fast instead of queueing indefinitely behind a running worker.
    await sql`SET LOCAL lock_timeout = '10s'`.execute(trx);
    await sql`SELECT set_config('app.cross_workspace_access', 'on', true)`.execute(trx);
    const applicationTables = await listApplicationTables(trx);
    if (applicationTables.length > 0) {
      await sql.raw(`TRUNCATE TABLE ${applicationTables.map(quoteIdent).join(', ')} CASCADE`).execute(trx);
    }
    await deleteWaitingGraphileJobs(trx);
    return applicationTables;
  });

  if (options.attachmentsRoot) {
    await rm(options.attachmentsRoot, { recursive: true, force: true });
    await mkdir(options.attachmentsRoot, { recursive: true });
  }
  if (options.auditArchiveRoot) {
    await rm(options.auditArchiveRoot, { recursive: true, force: true });
    await mkdir(options.auditArchiveRoot, { recursive: true });
  }

  return { truncatedTables: tables.length };
}

/**
 * Graphile keeps its jobs in its own schema, so the public-table TRUNCATE left
 * queued webhook/workflow/send jobs behind. Jobs a live worker holds right now
 * stay: deleting them would keep their named queue locked until Graphile's
 * 4-hour reset, and they fail on the emptied tables anyway.
 */
async function deleteWaitingGraphileJobs(trx: Kysely<ServerDatabase>): Promise<void> {
  const available = await sql<{ ok: boolean | null }>`
    SELECT to_regclass('graphile_worker._private_jobs') IS NOT NULL
      AND has_table_privilege(to_regclass('graphile_worker._private_jobs'), 'DELETE') AS ok
  `.execute(trx);
  if (available.rows[0]?.ok !== true) return;
  await sql`DELETE FROM graphile_worker._private_jobs WHERE locked_at IS NULL`.execute(trx);
}

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
