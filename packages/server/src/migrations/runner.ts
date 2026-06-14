import { createHash } from 'crypto';

import { assertValidMigrationSet, joinMigrationSql, type SqlMigration } from './types';

export const SERVER_MIGRATION_TABLE = 'simplecrm_schema_migrations';

export type MigrationMetadataRow = Readonly<{
  id: string;
  description: string;
  checksum: string;
  appliedAt: string | null;
}>;

export type MigrationDatabase = Readonly<{
  execute(sql: string, params?: readonly unknown[]): Promise<void>;
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<readonly T[]>;
  transaction?<T>(callback: (transaction: MigrationDatabase) => Promise<T>): Promise<T>;
}>;

export type PgQueryResult<T extends Record<string, unknown>> = Readonly<{
  rows: readonly T[];
}>;

export type PgQueryClient = Readonly<{
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<PgQueryResult<T>>;
}>;

export type MigrationPlanItem = Readonly<{
  id: string;
  description: string;
  checksum: string;
  status: 'applied' | 'pending';
}>;

export type MigrationPlan = Readonly<{
  tableName: typeof SERVER_MIGRATION_TABLE;
  appliedIds: readonly string[];
  pendingIds: readonly string[];
  items: readonly MigrationPlanItem[];
}>;

export type MigrationRunResult = Readonly<{
  appliedIds: readonly string[];
  skippedIds: readonly string[];
  plannedIds: readonly string[];
}>;

export type ChecksumRepair = Readonly<{
  id: string;
  oldChecksum: string;
  newChecksum: string;
}>;

export type ChecksumReconcileResult = Readonly<{
  /** Applied migrations whose stored checksum was re-stamped to match the code. */
  repaired: readonly ChecksumRepair[];
  /** Applied migrations already matching the code (no change). */
  unchanged: readonly string[];
}>;

export function createMigrationMetadataTableSql(): string {
  return `
CREATE TABLE IF NOT EXISTS ${SERVER_MIGRATION_TABLE} (
  id text PRIMARY KEY,
  description text NOT NULL,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);`.trim();
}

export function selectAppliedMigrationsSql(): string {
  return `
SELECT id, description, checksum, applied_at AS "appliedAt"
FROM ${SERVER_MIGRATION_TABLE}
ORDER BY id ASC;`.trim();
}

export function insertAppliedMigrationSql(): string {
  return `
INSERT INTO ${SERVER_MIGRATION_TABLE} (id, description, checksum)
VALUES ($1, $2, $3);`.trim();
}

export function updateAppliedChecksumSql(): string {
  return `
UPDATE ${SERVER_MIGRATION_TABLE}
SET checksum = $2, description = $3
WHERE id = $1;`.trim();
}

export function checksumMigration(migration: SqlMigration): string {
  const hash = createHash('sha256');
  hash.update(migration.id);
  hash.update('\0');
  hash.update(migration.description);
  hash.update('\0');
  hash.update(joinMigrationSql(migration.upSql));
  return hash.digest('hex');
}

export function createPgMigrationDatabase(client: PgQueryClient): MigrationDatabase {
  const execute = async (sql: string, params?: readonly unknown[]): Promise<void> => {
    await client.query(sql, params);
  };
  const query = async <T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<readonly T[]> => {
    const result = await client.query<T>(sql, params);
    return result.rows;
  };

  return {
    execute,
    query,
    async transaction<T>(callback: (transaction: MigrationDatabase) => Promise<T>): Promise<T> {
      await client.query('BEGIN');
      try {
        const result = await callback({ execute, query });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    },
  };
}

export function planServerMigrations(
  migrations: readonly SqlMigration[],
  appliedRows: readonly Partial<MigrationMetadataRow>[],
): MigrationPlan {
  assertValidMigrationSet(migrations);

  const checksums = new Map(migrations.map((migration) => [
    migration.id,
    checksumMigration(migration),
  ]));
  const descriptions = new Map(migrations.map((migration) => [
    migration.id,
    migration.description,
  ]));
  const appliedIds = appliedRows.map((row) => {
    if (typeof row.id !== 'string' || row.id.length === 0) {
      throw new Error('Migration metadata row is missing id');
    }
    return row.id;
  });

  const seenAppliedIds = new Set<string>();
  for (const row of appliedRows) {
    const id = String(row.id);
    if (seenAppliedIds.has(id)) {
      throw new Error(`Duplicate applied migration in metadata table: ${id}`);
    }
    seenAppliedIds.add(id);

    const expectedChecksum = checksums.get(id);
    if (!expectedChecksum) {
      throw new Error(`Database contains unknown server migration: ${id}`);
    }
    if (row.checksum !== expectedChecksum) {
      throw new Error(`Checksum mismatch for server migration ${id}`);
    }
  }

  const canonicalAppliedIds = migrations
    .filter((migration) => seenAppliedIds.has(migration.id))
    .map((migration) => migration.id);
  for (let index = 0; index < canonicalAppliedIds.length; index += 1) {
    if (canonicalAppliedIds[index] !== migrations[index]?.id) {
      throw new Error('Applied server migrations must form a prefix of the configured migration list');
    }
  }

  const appliedSet = new Set(appliedIds);
  const items = migrations.map<MigrationPlanItem>((migration) => ({
    id: migration.id,
    description: descriptions.get(migration.id) ?? migration.description,
    checksum: checksums.get(migration.id) ?? checksumMigration(migration),
    status: appliedSet.has(migration.id) ? 'applied' : 'pending',
  }));

  return {
    tableName: SERVER_MIGRATION_TABLE,
    appliedIds: items.filter((item) => item.status === 'applied').map((item) => item.id),
    pendingIds: items.filter((item) => item.status === 'pending').map((item) => item.id),
    items,
  };
}

export async function inspectServerMigrations(
  database: MigrationDatabase,
  migrations: readonly SqlMigration[],
): Promise<MigrationPlan> {
  await database.execute(createMigrationMetadataTableSql());
  const appliedRows = await database.query<MigrationMetadataRow>(selectAppliedMigrationsSql());
  return planServerMigrations(migrations, appliedRows);
}

export async function runServerMigrations(
  database: MigrationDatabase,
  migrations: readonly SqlMigration[],
): Promise<MigrationRunResult> {
  await database.execute(createMigrationMetadataTableSql());
  const appliedRows = await database.query<MigrationMetadataRow>(selectAppliedMigrationsSql());
  const plan = planServerMigrations(migrations, appliedRows);
  const pendingMigrations = migrations.filter((migration) => plan.pendingIds.includes(migration.id));
  const appliedIds: string[] = [];

  for (const migration of pendingMigrations) {
    await executeInMigrationTransaction(database, async (transaction) => {
      for (const statement of migration.upSql) {
        await transaction.execute(statement);
      }
      await transaction.execute(insertAppliedMigrationSql(), [
        migration.id,
        migration.description,
        checksumMigration(migration),
      ]);
    });
    appliedIds.push(migration.id);
  }

  return {
    appliedIds,
    skippedIds: plan.appliedIds,
    plannedIds: plan.items.map((item) => item.id),
  };
}

/**
 * Re-stamps the stored checksums of already-applied migrations whose *definition*
 * changed in code but whose effect on existing databases is delivered elsewhere
 * (the canonical case: an upstream change edits an early baseline migration for
 * fresh installs, and a later migration re-applies the same delta idempotently
 * for existing installs). Without this, planServerMigrations() correctly refuses
 * to proceed with "Checksum mismatch", blocking every subsequent migration.
 *
 * Safety: only migrations that STILL EXIST in the configured list are reconciled.
 * Rows referencing an unknown id (a deleted/renamed migration) are left untouched
 * so planServerMigrations() still surfaces them as genuine corruption. All updates
 * commit in a single transaction. This is an explicit, opt-in operation — callers
 * gate it behind a flag and log every change.
 */
export async function reconcileAppliedChecksums(
  database: MigrationDatabase,
  migrations: readonly SqlMigration[],
): Promise<ChecksumReconcileResult> {
  assertValidMigrationSet(migrations);
  await database.execute(createMigrationMetadataTableSql());
  const appliedRows = await database.query<MigrationMetadataRow>(selectAppliedMigrationsSql());

  const knownChecksums = new Map(migrations.map((migration) => [migration.id, checksumMigration(migration)]));
  const knownDescriptions = new Map(migrations.map((migration) => [migration.id, migration.description]));

  const repaired: ChecksumRepair[] = [];
  const unchanged: string[] = [];
  for (const row of appliedRows) {
    const id = typeof row.id === 'string' ? row.id : '';
    if (!id) continue;
    const expected = knownChecksums.get(id);
    if (expected === undefined) continue; // unknown migration — leave for the integrity check
    const stored = typeof row.checksum === 'string' ? row.checksum : '';
    if (stored === expected) {
      unchanged.push(id);
      continue;
    }
    repaired.push({ id, oldChecksum: stored, newChecksum: expected });
  }

  if (repaired.length > 0) {
    await executeInMigrationTransaction(database, async (transaction) => {
      for (const item of repaired) {
        await transaction.execute(updateAppliedChecksumSql(), [
          item.id,
          item.newChecksum,
          knownDescriptions.get(item.id) ?? '',
        ]);
      }
    });
  }

  return { repaired, unchanged };
}

async function executeInMigrationTransaction<T>(
  database: MigrationDatabase,
  callback: (transaction: MigrationDatabase) => Promise<T>,
): Promise<T> {
  if (database.transaction) {
    return database.transaction(callback);
  }

  await database.execute('BEGIN');
  try {
    const result = await callback(database);
    await database.execute('COMMIT');
    return result;
  } catch (error) {
    await database.execute('ROLLBACK');
    throw error;
  }
}
