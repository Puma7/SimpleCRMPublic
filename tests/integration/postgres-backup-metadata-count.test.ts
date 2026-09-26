import { spawnSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const repoRoot = join(__dirname, '..', '..');
const RESTORE_ADMIN = 'c_a55_restore_admin';
const RESTORE_ADMIN_PASSWORD = 'c-a55-restore-admin-password';

const psqlAvailable = () => spawnSync('psql', ['--version'], { stdio: 'ignore' }).status === 0;

// C-A55: verify_backup_metadata zaehlte jeden Namen aus der .meta per to_regclass ohne relkind-Pruefung, sodass eine View ueber eine Funktion aus dem Dump mit Superuser-Rechten lief.
describe('backup metadata verification only counts real tables', () => {
  let postgres: EmbeddedPostgres;
  let databaseUrl: string;
  let workDir: string;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('backup-metadata-count');
    // Geprueft wird hier als Superuser: auch dann darf die Zaehlung nichts aus dem Dump auswerten.
    await postgres.admin.query(
      `CREATE ROLE ${RESTORE_ADMIN} LOGIN SUPERUSER PASSWORD '${RESTORE_ADMIN_PASSWORD}'`,
    );
    databaseUrl = `postgresql://${RESTORE_ADMIN}:${RESTORE_ADMIN_PASSWORD}@127.0.0.1:${postgres.port}/postgres`;
    // So koennte ein manipulierter Dump aussehen: eine View, deren Auswertung Code ausfuehrt.
    await postgres.admin.query(`
      CREATE TABLE public.c_a55_marker (who text);
      CREATE FUNCTION public.c_a55_payload() RETURNS SETOF integer LANGUAGE plpgsql AS $fn$
      BEGIN
        INSERT INTO public.c_a55_marker VALUES (current_user);
        RETURN NEXT 1;
      END
      $fn$;
      CREATE VIEW public.c_a55_view AS SELECT * FROM public.c_a55_payload();
      -- Und eine Funktion, die format() aus pg_catalog mit passenderer Signatur ueberdeckt.
      CREATE FUNCTION public.format(text, text) RETURNS text LANGUAGE plpgsql AS $fn$
      BEGIN
        INSERT INTO public.c_a55_marker VALUES ('format:' || current_user);
        RETURN pg_catalog.format($1, $2);
      END
      $fn$;
      CREATE TABLE public.c_a55_real (id integer);
      INSERT INTO public.c_a55_real VALUES (1), (2), (3);
      CREATE TABLE public.c_a55_parted (id integer) PARTITION BY RANGE (id);
      CREATE TABLE public.c_a55_parted_low PARTITION OF public.c_a55_parted FOR VALUES FROM (0) TO (100);
      INSERT INTO public.c_a55_parted VALUES (1), (2);
    `);
    workDir = mkdtempSync(join(tmpdir(), 'simplecrm-c-a55-'));
  });

  afterAll(async () => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
    if (postgres) await postgres.stop();
  });

  const runMetadataShell = (body: string) => spawnSync('sh', ['-c', `. docker/backup-metadata.sh\n${body}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });

  const markerRows = async () =>
    (await postgres.admin.query<{ n: string }>('SELECT count(*)::text AS n FROM public.c_a55_marker')).rows[0]!.n;

  test('a view from the dump is not evaluated and reads as n/a', async () => {
    if (!psqlAvailable()) return;

    const counts = runMetadataShell([
      'for table in c_a55_view c_a55_real c_a55_parted c_a55_missing; do',
      '  printf \'%s=%s\\n\' "$table" "$(backup_metadata_count "$DATABASE_URL" "$table")"',
      'done',
    ].join('\n'));

    expect(counts.status).toBe(0);
    expect(counts.stdout.trim().split('\n')).toEqual([
      'c_a55_view=n/a',
      'c_a55_real=3',
      'c_a55_parted=2',
      'c_a55_missing=n/a',
    ]);
    expect(await markerRows()).toBe('0');
  });

  test('verify_backup_metadata fails loudly for a metadata entry that names a view', async () => {
    if (!psqlAvailable()) return;
    const metaPath = join(workDir, 'backup-c-a55.meta');
    writeFileSync(metaPath, 'row_counts=ok\nrows_c_a55_real=3\nrows_c_a55_view=1\n');

    const verify = runMetadataShell(`verify_backup_metadata '${metaPath}' "$DATABASE_URL" 'restore drill'`);

    expect(verify.status).not.toBe(0);
    expect(verify.stderr).toContain('cannot read c_a55_view after restore');
    expect(verify.stderr).not.toContain('c_a55_real');
    expect(await markerRows()).toBe('0');
  });
});
