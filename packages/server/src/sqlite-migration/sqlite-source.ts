import { createHash } from 'crypto';
import { createReadStream } from 'fs';

import type {
  SqliteMigrationReadRowsInput,
  SqliteMigrationRow,
  SqliteMigrationSourcePort,
} from './types';

export type SqlitePreparedStatementLike = Readonly<{
  get(...params: readonly unknown[]): unknown;
  all(...params: readonly unknown[]): readonly Record<string, unknown>[];
}>;

export type SqliteDatabaseLike = Readonly<{
  prepare(sql: string): SqlitePreparedStatementLike;
  close?(): void;
}>;

export type SqliteFileMigrationSourceHandle = Readonly<{
  source: SqliteMigrationSourcePort;
  close(): void;
}>;

type BetterSqliteDatabaseConstructor = new (
  filePath: string,
  options: { readonly: boolean; fileMustExist: boolean },
) => SqliteDatabaseLike;

export function createSqliteDatabaseMigrationSource(database: SqliteDatabaseLike): SqliteMigrationSourcePort {
  return {
    async tableExists(tableName) {
      const row = database
        .prepare("SELECT 1 AS present FROM sqlite_master WHERE type IN ('table', 'view') AND name = ? LIMIT 1")
        .get(tableName) as { present?: unknown } | undefined;
      return row?.present === 1;
    },
    async countRows(tableName) {
      const tableIdentifier = quoteSqliteIdentifier(tableName, 'tableName');
      const row = database
        .prepare(`SELECT COUNT(*) AS count FROM ${tableIdentifier}`)
        .get() as { count?: unknown } | undefined;
      return normalizeCount(row?.count, tableName);
    },
    async readRows(input) {
      return readRows(database, input);
    },
  };
}

export function openBetterSqliteMigrationSource(filePath: string): SqliteFileMigrationSourceHandle {
  const normalizedPath = filePath.trim();
  if (!normalizedPath) {
    throw new Error('SQLite file path is required');
  }

  const moduleValue = require('better-sqlite3') as
    | BetterSqliteDatabaseConstructor
    | { default: BetterSqliteDatabaseConstructor };
  const Database = typeof moduleValue === 'function' ? moduleValue : moduleValue.default;
  const database = new Database(normalizedPath, { readonly: true, fileMustExist: true });

  return {
    source: createSqliteDatabaseMigrationSource(database),
    close() {
      database.close?.();
    },
  };
}

export async function computeSqliteFileFingerprint(filePath: string): Promise<string> {
  const normalizedPath = filePath.trim();
  if (!normalizedPath) {
    throw new Error('SQLite file path is required');
  }

  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(normalizedPath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(`sha256:${hash.digest('hex')}`));
  });
}

function readRows(
  database: SqliteDatabaseLike,
  input: SqliteMigrationReadRowsInput,
): readonly SqliteMigrationRow[] {
  const tableIdentifier = quoteSqliteIdentifier(input.tableName, 'tableName');
  const limit = normalizeLimit(input.limit);

  if (input.primaryKey === 'rowid') {
    const where = input.afterPrimaryKey === null ? '' : ' WHERE rowid > ?';
    const params = input.afterPrimaryKey === null ? [limit] : [input.afterPrimaryKey, limit];
    return database
      .prepare(`SELECT rowid AS rowid, * FROM ${tableIdentifier}${where} ORDER BY rowid LIMIT ?`)
      .all(...params)
      .map(normalizeRow);
  }

  const primaryKeyIdentifier = quoteSqliteIdentifier(input.primaryKey, 'primaryKey');
  const where = input.afterPrimaryKey === null ? '' : ` WHERE ${primaryKeyIdentifier} > ?`;
  const params = input.afterPrimaryKey === null ? [limit] : [input.afterPrimaryKey, limit];

  return database
    .prepare(`SELECT * FROM ${tableIdentifier}${where} ORDER BY ${primaryKeyIdentifier} LIMIT ?`)
    .all(...params)
    .map(normalizeRow);
}

function quoteSqliteIdentifier(value: string, key: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid SQLite ${key}: ${value}`);
  }
  return `"${value}"`;
}

function normalizeLimit(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('SQLite import read limit must be a positive integer');
  }
  return value;
}

function normalizeCount(value: unknown, tableName: string): number {
  const count = typeof value === 'bigint' ? Number(value) : value;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
    throw new Error(`SQLite table ${tableName} returned an invalid row count`);
  }
  return count;
}

function normalizeRow(row: Record<string, unknown>): SqliteMigrationRow {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[key] = normalizeValue(value);
  }
  return normalized;
}

function normalizeValue(value: unknown): unknown {
  if (Buffer.isBuffer(value)) {
    return {
      encoding: 'base64',
      type: 'sqlite_blob',
      value: value.toString('base64'),
    };
  }
  if (value instanceof Uint8Array) {
    return {
      encoding: 'base64',
      type: 'sqlite_blob',
      value: Buffer.from(value).toString('base64'),
    };
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
}
