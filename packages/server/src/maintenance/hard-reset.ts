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
  await sql`SELECT set_config('app.cross_workspace_access', 'on', true)`.execute(db);

  const tables = await listApplicationTables(db);
  for (const table of tables) {
    await sql.raw(`TRUNCATE TABLE ${quoteIdent(table)} CASCADE`).execute(db);
  }

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

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
