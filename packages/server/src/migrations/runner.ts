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
