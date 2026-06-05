import {
  sqliteServerEditionMigrationPlan,
  validateSqliteMigrationPlan,
} from './manifest';
import {
  hashSqliteMigrationRow,
  hashSqliteMigrationRowSet,
  serializeSqliteMigrationSourcePrimaryKey,
  type SqliteMigrationTableDigest,
} from './row-hash';
import type {
  RunSqliteToPostgresMigrationInput,
  SqliteImportTableCheckpoint,
  SqliteMigrationRow,
  SqliteMigrationRunResult,
  SqliteMigrationTable,
  SqliteMigrationTableResult,
} from './types';

export const DEFAULT_SQLITE_IMPORT_BATCH_SIZE = 500;

export async function runSqliteToPostgresMigration(
  input: RunSqliteToPostgresMigrationInput,
): Promise<SqliteMigrationRunResult> {
  const plan = input.plan ?? sqliteServerEditionMigrationPlan;
  validateSqliteMigrationPlan(plan);

  if (!input.workspaceId.trim()) {
    throw new Error('workspaceId is required for SQLite import');
  }
  if (!input.sourceFingerprint.trim()) {
    throw new Error('sourceFingerprint is required for SQLite import');
  }

  const batchSize = input.batchSize ?? DEFAULT_SQLITE_IMPORT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error('SQLite import batchSize must be a positive integer');
  }

  const now = input.now ?? (() => new Date());
  const dryRun = input.dryRun ?? false;
  const run = await input.target.beginRun({
    workspaceId: input.workspaceId,
    planId: plan.id,
    sourceFingerprint: input.sourceFingerprint,
    dryRun,
    startedAt: now(),
    metadata: input.metadata,
  });
  const runId = run.runId;
  const tableResults: SqliteMigrationTableResult[] = [];

  input.reporter?.onRunStarted?.({ runId, planId: plan.id, dryRun });

  try {
    for (const table of plan.tables) {
      const tableResult = await migrateTable({
        input,
        table,
        runId,
        batchSize,
        dryRun,
      });
      tableResults.push(tableResult);
    }

    const status = dryRun ? 'dry_run' : 'succeeded';
    await input.target.completeRun({ runId, status, finishedAt: now() });
    input.reporter?.onRunCompleted?.({ runId, status });

    return {
      runId,
      status,
      tables: tableResults,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await input.target.failRun({ runId, error: message, finishedAt: now() });
    input.reporter?.onRunFailed?.({ runId, error: message });
    throw error;
  }
}

async function migrateTable(context: Readonly<{
  input: RunSqliteToPostgresMigrationInput;
  table: SqliteMigrationTable;
  runId: string;
  batchSize: number;
  dryRun: boolean;
}>): Promise<SqliteMigrationTableResult> {
  const { input, table, runId, batchSize, dryRun } = context;
  const exists = await input.source.tableExists(table.name);

  if (!exists) {
    const status = 'skipped';
    const error = table.required ? `Required SQLite table missing: ${table.name}` : null;
    const skipped = {
      runId,
      tableName: table.name,
      sourceRowCount: 0,
      copiedRowCount: 0,
      lastSourcePrimaryKey: null,
      status,
      error,
    } as const;

    await input.target.skipTable(skipped);
    input.reporter?.onTableSkipped?.({
      runId,
      tableName: table.name,
      reason: error ?? 'source table not present',
    });

    if (table.required) {
      throw new Error(error ?? `Required SQLite table missing: ${table.name}`);
    }

    return {
      tableName: table.name,
      status,
      sourceRowCount: 0,
      copiedRowCount: 0,
      lastSourcePrimaryKey: null,
    };
  }

  const sourceRowCount = await input.source.countRows(table.name);
  const existingCheckpoint = await input.target.getTableCheckpoint(runId, table.name);

  if (existingCheckpoint && isAlreadyComplete(existingCheckpoint, sourceRowCount)) {
    const validation = await validateStagedTableIfSupported({
      input,
      table,
      runId,
      batchSize,
      sourceRowCount,
      copiedRowCount: existingCheckpoint.copiedRowCount,
      lastSourcePrimaryKey: existingCheckpoint.lastSourcePrimaryKey,
    });
    return {
      tableName: table.name,
      status: 'succeeded',
      sourceRowCount,
      copiedRowCount: existingCheckpoint.copiedRowCount,
      lastSourcePrimaryKey: existingCheckpoint.lastSourcePrimaryKey,
      ...validation,
    };
  }

  if (dryRun) {
    await input.target.beginTable({
      runId,
      table,
      sourceRowCount,
      status: 'dry_run',
    });
    await input.target.updateTableCheckpoint({
      runId,
      tableName: table.name,
      sourceRowCount,
      copiedRowCount: 0,
      lastSourcePrimaryKey: null,
      status: 'dry_run',
      error: null,
    });

    return {
      tableName: table.name,
      status: 'dry_run',
      sourceRowCount,
      copiedRowCount: 0,
      lastSourcePrimaryKey: null,
    };
  }

  await input.target.beginTable({
    runId,
    table,
    sourceRowCount,
    status: 'running',
  });
  input.reporter?.onTableStarted?.({ runId, tableName: table.name, sourceRowCount });

  let copiedRowCount = existingCheckpoint?.copiedRowCount ?? 0;
  let lastSourcePrimaryKey = existingCheckpoint?.lastSourcePrimaryKey ?? null;

  while (true) {
    const rows = await input.source.readRows({
      tableName: table.name,
      primaryKey: table.primaryKey,
      afterPrimaryKey: lastSourcePrimaryKey,
      limit: batchSize,
    });

    if (rows.length === 0) {
      break;
    }

    await input.target.upsertRows({
      runId,
      workspaceId: input.workspaceId,
      table,
      rows,
    });

    copiedRowCount += rows.length;
    lastSourcePrimaryKey = serializePrimaryKey(rows[rows.length - 1]?.[table.primaryKey], table);

    await input.target.updateTableCheckpoint({
      runId,
      tableName: table.name,
      sourceRowCount,
      copiedRowCount,
      lastSourcePrimaryKey,
      status: 'running',
      error: null,
    });
    input.reporter?.onBatchCopied?.({
      runId,
      tableName: table.name,
      copiedRowCount,
      lastSourcePrimaryKey,
    });
  }

  const validation = await validateStagedTableIfSupported({
    input,
    table,
    runId,
    batchSize,
    sourceRowCount,
    copiedRowCount,
    lastSourcePrimaryKey,
  });

  await input.target.updateTableCheckpoint({
    runId,
    tableName: table.name,
    sourceRowCount,
    copiedRowCount,
    lastSourcePrimaryKey,
    status: 'succeeded',
    error: null,
  });

  return {
    tableName: table.name,
    status: 'succeeded',
    sourceRowCount,
    copiedRowCount,
    lastSourcePrimaryKey,
    ...validation,
  };
}

async function validateStagedTableIfSupported(context: Readonly<{
  input: RunSqliteToPostgresMigrationInput;
  table: SqliteMigrationTable;
  runId: string;
  batchSize: number;
  sourceRowCount: number;
  copiedRowCount: number;
  lastSourcePrimaryKey: string | null;
}>): Promise<Pick<SqliteMigrationTableResult, 'sourceTableHash' | 'stagedTableHash'>> {
  const { input, table, runId, batchSize, sourceRowCount, copiedRowCount, lastSourcePrimaryKey } = context;
  if (!input.target.validateStagedTable) return {};

  const sourceDigest = await computeSourceTableDigest(input.source, table, batchSize);
  if (sourceDigest.rowCount !== sourceRowCount) {
    const error = `SQLite import validation failed for ${table.name}: source row count changed from ${sourceRowCount} to ${sourceDigest.rowCount}`;
    await input.target.updateTableCheckpoint({
      runId,
      tableName: table.name,
      sourceRowCount,
      copiedRowCount,
      lastSourcePrimaryKey,
      status: 'failed',
      error,
    });
    throw new Error(error);
  }

  const validation = await input.target.validateStagedTable({
    runId,
    workspaceId: input.workspaceId,
    table,
    sourceRowCount: sourceDigest.rowCount,
    sourceTableHash: sourceDigest.tableHash,
  });
  if (!validation.ok) {
    const error = validation.error
      ?? `SQLite import validation failed for ${table.name}: source ${validation.sourceTableHash} (${validation.sourceRowCount} rows), staged ${validation.stagedTableHash} (${validation.stagedRowCount} rows)`;
    await input.target.updateTableCheckpoint({
      runId,
      tableName: table.name,
      sourceRowCount,
      copiedRowCount,
      lastSourcePrimaryKey,
      status: 'failed',
      error,
    });
    throw new Error(error);
  }

  return {
    sourceTableHash: validation.sourceTableHash,
    stagedTableHash: validation.stagedTableHash,
  };
}

async function computeSourceTableDigest(
  source: RunSqliteToPostgresMigrationInput['source'],
  table: SqliteMigrationTable,
  batchSize: number,
): Promise<SqliteMigrationTableDigest> {
  let afterPrimaryKey: string | null = null;
  const entries: Array<{ sourcePk: string; rowHash: string }> = [];

  while (true) {
    const rows: readonly SqliteMigrationRow[] = await source.readRows({
      tableName: table.name,
      primaryKey: table.primaryKey,
      afterPrimaryKey,
      limit: batchSize,
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      entries.push({
        sourcePk: serializePrimaryKey(row[table.primaryKey], table),
        rowHash: hashSqliteMigrationRow(row),
      });
    }
    afterPrimaryKey = serializePrimaryKey(rows[rows.length - 1]?.[table.primaryKey], table);
  }

  return {
    rowCount: entries.length,
    tableHash: hashSqliteMigrationRowSet(entries),
  };
}

function isAlreadyComplete(
  checkpoint: SqliteImportTableCheckpoint,
  sourceRowCount: number,
): boolean {
  return checkpoint?.status === 'succeeded'
    && checkpoint.sourceRowCount === sourceRowCount
    && checkpoint.copiedRowCount === sourceRowCount;
}

function serializePrimaryKey(value: unknown, table: SqliteMigrationTable): string {
  return serializeSqliteMigrationSourcePrimaryKey(value, table.name, table.primaryKey);
}
