import { spawnSync } from 'child_process';
import { join } from 'path';

import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const repoRoot = join(__dirname, '..', '..');
const ADMIN_LOGIN = 'c_a61_admin';
const MEMBER_LOGIN = 'c_a61_member';
const RESTORE_LOGIN = 'c_a61_restore';
const PASSWORD = 'c-a61-test-password';

const psqlAvailable = () => spawnSync('psql', ['--version'], { stdio: 'ignore' }).status === 0;

// C-A61: restore.sh und restore-drill.sh spielten den Dump in einer Superuser-Sitzung ein und verliessen sich auf --role, das SQL aus dem Dump per RESET ROLE zuruecknehmen kann.
describe('restore scripts only hand dump SQL to a restricted login', () => {
  let postgres: EmbeddedPostgres;
  let appRole: string;

  const urlFor = (login: string) => `postgresql://${login}:${PASSWORD}@127.0.0.1:${postgres.port}/postgres`;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('restore-session');
    appRole = (await postgres.admin.query<{ owner: string }>(
      "SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid = 'public.workspaces'::regclass",
    )).rows[0]!.owner;
    await postgres.admin.query(`CREATE ROLE ${ADMIN_LOGIN} LOGIN SUPERUSER PASSWORD '${PASSWORD}'`);
    // Selbst kein Superuser, darf aber per SET ROLE einer werden.
    await postgres.admin.query(`CREATE ROLE ${MEMBER_LOGIN} LOGIN NOSUPERUSER PASSWORD '${PASSWORD}'`);
    await postgres.admin.query(`GRANT ${ADMIN_LOGIN} TO ${MEMBER_LOGIN}`);
    // Wie simplecrm_app: kein Superuser, kein BYPASSRLS, mit den Rechten des Eigentuemers.
    await postgres.admin.query(`CREATE ROLE ${RESTORE_LOGIN} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${PASSWORD}'`);
    await postgres.admin.query(`GRANT ${appRole} TO ${RESTORE_LOGIN}`);
    // Zwei Workspaces: Row Level Security ist erzwungen, ohne Systemkontext
    // saehe die eingeschraenkte Anmeldung keine davon.
    await postgres.admin.query(`
      INSERT INTO public.workspaces (name) VALUES ('c-a61 one'), ('c-a61 two');
    `);
  });

  afterAll(async () => {
    if (postgres) await postgres.stop();
  });

  const runMetadataShell = (body: string, databaseUrl: string) => spawnSync('sh', ['-c', `. docker/backup-metadata.sh\n${body}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, RESTORE_URL: databaseUrl },
  });

  test.each([
    ['a superuser login', ADMIN_LOGIN],
    ['a login that can SET ROLE to a superuser', MEMBER_LOGIN],
  ])('refuses %s', (_label, login) => {
    if (!psqlAvailable()) return;

    const guard = runMetadataShell('assert_restricted_restore_session "$RESTORE_URL" restore', urlFor(login));

    expect(guard.status).not.toBe(0);
    expect(guard.stderr).toContain('refusing to run pg_restore');
  });

  test('accepts the restricted login', () => {
    if (!psqlAvailable()) return;

    const guard = runMetadataShell('assert_restricted_restore_session "$RESTORE_URL" restore', urlFor(RESTORE_LOGIN));

    expect(guard.stderr).toBe('');
    expect(guard.status).toBe(0);
  });

  test('the restricted login counts every row despite forced row level security', async () => {
    if (!psqlAvailable()) return;
    const expected = (await postgres.admin.query<{ n: string }>('SELECT count(*)::text AS n FROM public.workspaces')).rows[0]!.n;
    expect(Number(expected)).toBeGreaterThanOrEqual(2);

    const count = runMetadataShell('backup_metadata_count "$RESTORE_URL" workspaces', urlFor(RESTORE_LOGIN));

    expect(count.status).toBe(0);
    expect(count.stdout.trim()).toBe(expected);
  });
});
