import type {
  BeginSqliteImportRunInput,
  BeginSqliteImportRunResult,
  BeginSqliteImportTableInput,
  CompleteSqliteImportRunInput,
  FailSqliteImportRunInput,
  SqliteImportTableCheckpoint,
  SqliteMigrationTargetPort,
  ValidateSqliteImportTableInput,
  ValidateSqliteImportTableResult,
  UpdateSqliteImportTableCheckpointInput,
  UpsertSqliteMigrationRowsInput,
} from '../sqlite-migration';
import {
  hashSqliteMigrationRow,
  hashSqliteMigrationRowSet,
} from '../sqlite-migration/row-hash';

export type SqliteImportPgClient = Readonly<{
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: readonly T[] }>;
}>;

export function createPostgresSqliteImportTarget(client: SqliteImportPgClient): SqliteMigrationTargetPort {
  return {
    async beginRun(input) {
      return beginRun(client, input);
    },
    async getTableCheckpoint(runId, tableName) {
      const result = await client.query<CheckpointRow>(
        `SELECT run_id, table_name, status, source_row_count, copied_row_count, last_source_pk, error
FROM sqlite_import_table_checkpoints
WHERE run_id = $1 AND table_name = $2`,
        [runId, tableName],
      );
      const row = result.rows[0];
      return row ? mapCheckpointRow(row) : null;
    },
    async beginTable(input) {
      await beginTableCheckpoint(client, input);
    },
    async upsertRows(input) {
      await upsertRows(client, input);
    },
    async validateStagedTable(input) {
      return validateStagedTable(client, input);
    },
    async updateTableCheckpoint(input) {
      await upsertTableCheckpoint(client, input);
    },
    async skipTable(input) {
      await upsertTableCheckpoint(client, input);
    },
    async completeRun(input) {
      await completeRun(client, input);
    },
    async failRun(input) {
      await failRun(client, input);
    },
  };
}

async function beginRun(
  client: SqliteImportPgClient,
  input: BeginSqliteImportRunInput,
): Promise<BeginSqliteImportRunResult> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO sqlite_import_runs (
  workspace_id,
  plan_id,
  source_fingerprint,
  status,
  dry_run,
  metadata,
  started_at,
  finished_at,
  error
)
VALUES ($1, $2, $3, 'running', $4, $5::jsonb, $6, NULL, NULL)
ON CONFLICT (workspace_id, plan_id, source_fingerprint, dry_run)
DO UPDATE SET
  status = 'running',
  metadata = EXCLUDED.metadata,
  started_at = EXCLUDED.started_at,
  finished_at = NULL,
  error = NULL
RETURNING id`,
    [
      input.workspaceId,
      input.planId,
      input.sourceFingerprint,
      input.dryRun,
      JSON.stringify(input.metadata ?? {}),
      input.startedAt,
    ],
  );

  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error('Postgres did not return a sqlite_import_runs id');
  }
  return { runId: id };
}

async function beginTableCheckpoint(
  client: SqliteImportPgClient,
  input: BeginSqliteImportTableInput,
): Promise<void> {
  await client.query(
    `INSERT INTO sqlite_import_table_checkpoints (
  run_id,
  table_name,
  source_row_count,
  copied_row_count,
  last_source_pk,
  status,
  error,
  updated_at
)
VALUES ($1, $2, $3, 0, NULL, $4, NULL, now())
ON CONFLICT (run_id, table_name)
DO UPDATE SET
  source_row_count = EXCLUDED.source_row_count,
  status = EXCLUDED.status,
  error = NULL,
  updated_at = now()`,
    [
      input.runId,
      input.table.name,
      input.sourceRowCount,
      input.status,
    ],
  );
}

async function upsertTableCheckpoint(
  client: SqliteImportPgClient,
  input: UpdateSqliteImportTableCheckpointInput,
): Promise<void> {
  await client.query(
    `INSERT INTO sqlite_import_table_checkpoints (
  run_id,
  table_name,
  source_row_count,
  copied_row_count,
  last_source_pk,
  status,
  error,
  updated_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, now())
ON CONFLICT (run_id, table_name)
DO UPDATE SET
  source_row_count = EXCLUDED.source_row_count,
  copied_row_count = EXCLUDED.copied_row_count,
  last_source_pk = EXCLUDED.last_source_pk,
  status = EXCLUDED.status,
  error = EXCLUDED.error,
  updated_at = now()`,
    [
      input.runId,
      input.tableName,
      input.sourceRowCount,
      input.copiedRowCount,
      input.lastSourcePrimaryKey,
      input.status,
      input.error ?? null,
    ],
  );
}

async function upsertRows(
  client: SqliteImportPgClient,
  input: UpsertSqliteMigrationRowsInput,
): Promise<void> {
  for (const row of input.rows) {
    const sourcePk = serializeSourcePrimaryKey(row[input.table.primaryKey], input.table.name, input.table.primaryKey);
    const sourceRowSha256 = hashSqliteMigrationRow(row);
    await client.query(
      `INSERT INTO sqlite_import_rows (
  workspace_id,
  table_name,
  source_pk,
  source_row,
  source_row_sha256,
  imported_in_run_id,
  imported_at,
  updated_at
)
VALUES ($1, $2, $3, $4::jsonb, $5, $6, now(), now())
ON CONFLICT (workspace_id, table_name, source_pk)
DO UPDATE SET
  source_row = EXCLUDED.source_row,
  source_row_sha256 = EXCLUDED.source_row_sha256,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  updated_at = now()`,
      [
        input.workspaceId,
        input.table.name,
        sourcePk,
        JSON.stringify(row),
        sourceRowSha256,
        input.runId,
      ],
    );
  }
}

async function validateStagedTable(
  client: SqliteImportPgClient,
  input: ValidateSqliteImportTableInput,
): Promise<ValidateSqliteImportTableResult> {
  const result = await client.query<StagedRowHashRow>(
    `SELECT source_pk, source_row_sha256
FROM sqlite_import_rows
WHERE workspace_id = $1
  AND table_name = $2
  AND imported_in_run_id = $3
ORDER BY source_pk ASC`,
    [input.workspaceId, input.table.name, input.runId],
  );
  const stagedRowCount = result.rows.length;
  const stagedTableHash = hashSqliteMigrationRowSet(result.rows.map((row) => ({
    sourcePk: row.source_pk,
    rowHash: row.source_row_sha256 ?? '',
  })));
  const ok = stagedRowCount === input.sourceRowCount && stagedTableHash === input.sourceTableHash;
  return {
    ok,
    stagedRowCount,
    sourceRowCount: input.sourceRowCount,
    sourceTableHash: input.sourceTableHash,
    stagedTableHash,
    ...(ok ? {} : {
      error: `SQLite import validation failed for ${input.table.name}: source ${input.sourceTableHash} (${input.sourceRowCount} rows), staged ${stagedTableHash} (${stagedRowCount} rows)`,
    }),
  };
}

async function completeRun(
  client: SqliteImportPgClient,
  input: CompleteSqliteImportRunInput,
): Promise<void> {
  await client.query(
    `UPDATE sqlite_import_runs
SET status = $2,
    finished_at = $3,
    error = NULL
WHERE id = $1`,
    [input.runId, input.status, input.finishedAt],
  );
}

async function failRun(
  client: SqliteImportPgClient,
  input: FailSqliteImportRunInput,
): Promise<void> {
  await client.query(
    `UPDATE sqlite_import_runs
SET status = 'failed',
    finished_at = $3,
    error = $2
WHERE id = $1`,
    [input.runId, input.error, input.finishedAt],
  );
}

type CheckpointRow = Readonly<{
  run_id: string;
  table_name: string;
  status: SqliteImportTableCheckpoint['status'];
  source_row_count: number;
  copied_row_count: number;
  last_source_pk: string | null;
  error: string | null;
}>;

type StagedRowHashRow = Readonly<{
  source_pk: string;
  source_row_sha256: string | null;
}>;

function mapCheckpointRow(row: CheckpointRow): SqliteImportTableCheckpoint {
  return {
    runId: row.run_id,
    tableName: row.table_name,
    status: row.status,
    sourceRowCount: row.source_row_count,
    copiedRowCount: row.copied_row_count,
    lastSourcePrimaryKey: row.last_source_pk,
    error: row.error,
  };
}

function serializeSourcePrimaryKey(value: unknown, tableName: string, primaryKey: string): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  throw new Error(`SQLite import table ${tableName} returned a row without primary key ${primaryKey}`);
}
