export type SqlMigration = Readonly<{
  id: string;
  description: string;
  upSql: readonly string[];
  downSql: readonly string[];
}>;

export function assertValidMigrationSet(migrations: readonly SqlMigration[]): void {
  const seen = new Set<string>();
  for (const migration of migrations) {
    if (!/^\d{4}_[a-z0-9_]+$/.test(migration.id)) {
      throw new Error(`Invalid migration id: ${migration.id}`);
    }
    if (seen.has(migration.id)) {
      throw new Error(`Duplicate migration id: ${migration.id}`);
    }
    if (migration.upSql.length === 0) {
      throw new Error(`Migration ${migration.id} has no up SQL`);
    }
    if (migration.downSql.length === 0) {
      throw new Error(`Migration ${migration.id} has no down SQL`);
    }
    seen.add(migration.id);
  }
}

export function joinMigrationSql(statements: readonly string[]): string {
  return statements.map((sql) => sql.trim()).filter(Boolean).join('\n\n');
}
