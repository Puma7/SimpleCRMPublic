import { createHash } from 'crypto';

import type {
  SqliteMigrationRow,
  SqliteMigrationTable,
} from './types';

export type SqliteMigrationRowHashEntry = Readonly<{
  sourcePk: string;
  rowHash: string;
}>;

export type SqliteMigrationTableDigest = Readonly<{
  rowCount: number;
  tableHash: string;
}>;

export function hashSqliteMigrationRow(row: SqliteMigrationRow): string {
  return sha256Hex(canonicalJson(row));
}

export function hashSqliteMigrationRowSet(entries: readonly SqliteMigrationRowHashEntry[]): string {
  const hash = createHash('sha256');
  const ordered = [...entries].sort((left, right) => left.sourcePk.localeCompare(right.sourcePk));
  for (const entry of ordered) {
    hash.update(entry.sourcePk);
    hash.update('\0');
    hash.update(entry.rowHash);
    hash.update('\n');
  }
  return `sha256:${hash.digest('hex')}`;
}

export function digestSqliteMigrationRows(
  rows: readonly SqliteMigrationRow[],
  table: SqliteMigrationTable,
): SqliteMigrationTableDigest {
  return {
    rowCount: rows.length,
    tableHash: hashSqliteMigrationRowSet(rows.map((row) => ({
      sourcePk: serializeSqliteMigrationSourcePrimaryKey(row[table.primaryKey], table.name, table.primaryKey),
      rowHash: hashSqliteMigrationRow(row),
    }))),
  };
}

export function serializeSqliteMigrationSourcePrimaryKey(
  value: unknown,
  tableName: string,
  primaryKey: string,
): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  throw new Error(`SQLite import table ${tableName} returned a row without primary key ${primaryKey}`);
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('SQLite import row contains a non-finite number');
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    const entries = Object.keys(objectValue)
      .sort()
      .filter((key) => objectValue[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(objectValue[key])}`);
    return `{${entries.join(',')}}`;
  }
  if (value === undefined) return 'null';
  throw new Error(`SQLite import row contains unsupported value type: ${typeof value}`);
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
