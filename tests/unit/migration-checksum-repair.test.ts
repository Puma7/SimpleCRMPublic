import {
  checksumMigration,
  planServerMigrations,
  reconcileAppliedChecksums,
  serverMigrations,
  type MigrationDatabase,
  type MigrationMetadataRow,
} from '../../packages/server/src/migrations';
import {
  parseMigrationCliArgs,
  runMigrateCli,
  type MigrationPgClient,
} from '../../packages/server/src/cli/migrate';

// A row for the Nth configured migration, with the correct checksum unless
// overridden (we override to simulate an upstream-redefined, drifted migration).
function appliedRow(index: number, overrides: Partial<MigrationMetadataRow> = {}): MigrationMetadataRow {
  const migration = serverMigrations[index]!;
  return {
    id: migration.id,
    description: migration.description,
    checksum: checksumMigration(migration),
    appliedAt: '2026-06-02T12:00:00.000Z',
    ...overrides,
  };
}

// MigrationDatabase fake that understands the metadata SELECT/INSERT/UPDATE.
function makeRepairDb(seed: readonly MigrationMetadataRow[]): MigrationDatabase & {
  rows(): MigrationMetadataRow[];
  readonly txCount: number;
} {
  const rows = new Map<string, MigrationMetadataRow>();
  for (const row of seed) rows.set(row.id, { ...row });
  let txCount = 0;

  const db: MigrationDatabase & { rows(): MigrationMetadataRow[]; readonly txCount: number } = {
    rows: () => [...rows.values()],
    get txCount() {
      return txCount;
    },
    async execute(sql, params) {
      if (sql.startsWith('UPDATE simplecrm_schema_migrations')) {
        const [id, checksum, description] = params ?? [];
        const existing = rows.get(String(id));
        if (existing) {
          rows.set(String(id), { ...existing, checksum: String(checksum), description: String(description) });
        }
      } else if (sql.includes('INSERT INTO simplecrm_schema_migrations')) {
        const [id, description, checksum] = params ?? [];
        rows.set(String(id), {
          id: String(id),
          description: String(description),
          checksum: String(checksum),
          appliedAt: '2026-06-02T12:00:00.000Z',
        });
      }
      // CREATE TABLE / BEGIN / COMMIT / migration DDL are no-ops for this fake.
    },
    async query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string): Promise<readonly T[]> {
      if (sql.includes('FROM simplecrm_schema_migrations')) {
        return [...rows.values()] as unknown as readonly T[];
      }
      return [];
    },
    async transaction<T>(callback: (transaction: MigrationDatabase) => Promise<T>): Promise<T> {
      txCount += 1;
      return callback(db);
    },
  };
  return db;
}

describe('reconcileAppliedChecksums', () => {
  test('re-stamps a drifted applied migration and leaves matching ones unchanged', async () => {
    // First 8 migrations applied; 0007 (index 6) has a drifted checksum.
    const seed = Array.from({ length: 8 }, (_, i) =>
      i === 6 ? appliedRow(i, { checksum: 'DRIFTED-OLD-CHECKSUM' }) : appliedRow(i));
    const db = makeRepairDb(seed);

    const result = await reconcileAppliedChecksums(db, serverMigrations);

    const expected = checksumMigration(serverMigrations[6]!);
    expect(result.repaired).toEqual([
      { id: serverMigrations[6]!.id, oldChecksum: 'DRIFTED-OLD-CHECKSUM', newChecksum: expected },
    ]);
    // The stored row is now corrected.
    const stored = db.rows().find((r) => r.id === serverMigrations[6]!.id);
    expect(stored?.checksum).toBe(expected);
    // Exactly one transaction wraps the repair writes.
    expect(db.txCount).toBe(1);
    // Everything else is reported unchanged.
    expect(result.unchanged).toHaveLength(7);
    expect(result.unchanged).not.toContain(serverMigrations[6]!.id);
  });

  test('is a no-op (no transaction) when every applied checksum already matches', async () => {
    const seed = Array.from({ length: 8 }, (_, i) => appliedRow(i));
    const db = makeRepairDb(seed);

    const result = await reconcileAppliedChecksums(db, serverMigrations);

    expect(result.repaired).toEqual([]);
    expect(result.unchanged).toHaveLength(8);
    expect(db.txCount).toBe(0);
  });

  test('leaves rows for unknown migration ids untouched (genuine corruption stays visible)', async () => {
    const seed: MigrationMetadataRow[] = [
      appliedRow(0),
      { id: '9999_ghost_migration', description: 'deleted', checksum: 'whatever', appliedAt: '2026-06-02T12:00:00.000Z' },
    ];
    const db = makeRepairDb(seed);

    const result = await reconcileAppliedChecksums(db, serverMigrations);

    expect(result.repaired).toEqual([]);
    expect(result.unchanged).toEqual([serverMigrations[0]!.id]);
    // Ghost row is preserved verbatim.
    const ghost = db.rows().find((r) => r.id === '9999_ghost_migration');
    expect(ghost?.checksum).toBe('whatever');
  });

  test('after reconcile, planServerMigrations no longer throws on the drifted migration', async () => {
    const seed = Array.from({ length: 8 }, (_, i) =>
      i === 6 ? appliedRow(i, { checksum: 'DRIFTED-OLD-CHECKSUM' }) : appliedRow(i));
    const db = makeRepairDb(seed);

    // Before repair: the drift is fatal.
    expect(() => planServerMigrations(serverMigrations, db.rows())).toThrow('Checksum mismatch');

    await reconcileAppliedChecksums(db, serverMigrations);

    // After repair: planning succeeds and the remaining migrations are pending.
    const plan = planServerMigrations(serverMigrations, db.rows());
    expect(plan.appliedIds).toHaveLength(8);
    expect(plan.pendingIds).toEqual(serverMigrations.slice(8).map((m) => m.id));
  });
});

describe('migrate CLI --repair-checksums', () => {
  test('parses the flag and rejects combining it with non-apply modes', () => {
    expect(parseMigrationCliArgs(['--repair-checksums'])).toMatchObject({
      mode: 'apply',
      repairChecksums: true,
    });
    expect(parseMigrationCliArgs([])).toMatchObject({ repairChecksums: false });
    expect(() => parseMigrationCliArgs(['--repair-checksums', '--check']))
      .toThrow('--repair-checksums can only be combined with the default apply mode');
  });

  test('repairs drifted checksums then applies pending migrations end-to-end', async () => {
    // PG-client fake seeded with the first 8 migrations applied, 0007 drifted.
    const rows = new Map<string, MigrationMetadataRow>();
    for (let i = 0; i < 8; i += 1) {
      const row = i === 6 ? appliedRow(i, { checksum: 'DRIFTED-OLD-CHECKSUM' }) : appliedRow(i);
      rows.set(row.id, { ...row });
    }
    const seenSql: string[] = [];

    const client: MigrationPgClient = {
      async connect() {},
      async end() {},
      async query<T extends Record<string, unknown> = Record<string, unknown>>(
        sql: string,
        params?: readonly unknown[],
      ): Promise<{ rows: readonly T[] }> {
        seenSql.push(sql);
        if (sql.includes('FROM simplecrm_schema_migrations')) {
          return { rows: [...rows.values()] as unknown as readonly T[] };
        }
        if (sql.startsWith('UPDATE simplecrm_schema_migrations')) {
          const [id, checksum, description] = params ?? [];
          const existing = rows.get(String(id));
          if (existing) rows.set(String(id), { ...existing, checksum: String(checksum), description: String(description) });
        }
        if (sql.includes('INSERT INTO simplecrm_schema_migrations')) {
          const [id, description, checksum] = params ?? [];
          rows.set(String(id), {
            id: String(id),
            description: String(description),
            checksum: String(checksum),
            appliedAt: '2026-06-02T12:00:00.000Z',
          });
        }
        return { rows: [] };
      },
    };

    let out = '';
    const exitCode = await runMigrateCli({
      argv: ['--repair-checksums'],
      env: { DATABASE_URL: 'postgres://app:secret@postgres:5432/simplecrm' },
      stdout: { write: (chunk: string) => { out += chunk; return true; } },
      stderr: { write: () => true },
      createClient: () => client,
    });

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(out);
    expect(parsed.status).toBe('applied');
    // The drifted 0007 was repaired, reported with old + new checksum.
    expect(parsed.repairedChecksums).toEqual([
      {
        id: serverMigrations[6]!.id,
        oldChecksum: 'DRIFTED-OLD-CHECKSUM',
        newChecksum: checksumMigration(serverMigrations[6]!),
      },
    ]);
    // Pending migrations (index 8..) were then applied.
    expect(parsed.appliedIds).toEqual(serverMigrations.slice(8).map((m) => m.id));
    // No credentials leaked.
    expect(out).not.toContain('secret');
    // An UPDATE was actually issued for the repair.
    expect(seenSql.some((s) => s.startsWith('UPDATE simplecrm_schema_migrations'))).toBe(true);
  });
});
