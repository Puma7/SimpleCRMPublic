import { sql, type Kysely } from 'kysely';

import { createPostgresTaskReadPort } from '../../packages/server/src/db/postgres-core-crm-read-ports';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { serverMigrations } from '../../packages/server/src/migrations';
import { taskAssignmentScopeResetMigration } from '../../packages/server/src/migrations/0019_task_assignment_scope_reset';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000a9';
const MEMBER_ID = '20000000-0000-4000-8000-0000000000a9';
const BACKFILL_MIGRATION_ID = '0053_task_assignment_scope_orphan_backfill';

// F-A2c-01: the cleanup UPDATE in migration 0019 ran without an RLS context.
// tasks has FORCE ROW LEVEL SECURITY, so as the (non-superuser) table owner it
// matched no row and tasks whose assignee had been deleted stayed on
// scope user/group with a NULL assignee - invisible to every non-admin.
describe('task assignment scope orphan backfill (PostgreSQL, FORCE RLS)', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('task-scope-backfill');
    await postgres.admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Scope Backfill')`, [WORKSPACE_ID]);
    await postgres.admin.query(
      `INSERT INTO users (id, workspace_id, email, display_name, password_hash, role)
       VALUES ($1, $2, 'member@example.test', 'Member', 'hash', 'user')`,
      [MEMBER_ID, WORKSPACE_ID],
    );
    // Orphans as they existed before 0019's trigger: the assignee was deleted
    // (ON DELETE SET NULL) while the scope stayed on user/group.
    await postgres.admin.query(
      `INSERT INTO tasks (workspace_id, source_sqlite_id, customer_source_sqlite_id, title, priority, assignment_scope, assigned_user_id, assigned_group_id) VALUES
        ($1, 1, 0, 'Verwaist Nutzer', 'Medium', 'user', NULL, NULL),
        ($1, 2, 0, 'Verwaist Gruppe', 'Medium', 'group', NULL, NULL),
        ($1, 3, 0, 'Global', 'Medium', 'global', NULL, NULL)`,
      [WORKSPACE_ID],
    );
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  const runAsTableOwner = (statements: readonly string[]) => db.connection().execute(async (connection) => {
    await sql`BEGIN`.execute(connection);
    for (const statement of statements) {
      await sql.raw(statement).execute(connection);
    }
    await sql`COMMIT`.execute(connection);
  });

  const memberTitles = async () => (await createPostgresTaskReadPort({ db }).list({
    workspaceId: WORKSPACE_ID,
    limit: 100,
    viewer: { userId: MEMBER_ID, role: 'user' },
  })).items.map((task) => task.title).sort();

  test('0019 alone leaves orphaned tasks invisible; the backfill migration restores them', async () => {
    // Re-running 0019 as the migration runner does changes nothing under FORCE RLS.
    await runAsTableOwner(taskAssignmentScopeResetMigration.upSql);
    expect(await memberTitles()).toEqual(['Global']);

    const backfill = serverMigrations.find((migration) => migration.id === BACKFILL_MIGRATION_ID);
    expect(backfill).toBeDefined();
    await runAsTableOwner(backfill!.upSql);
    // Idempotent: a second run finds nothing left to change.
    await runAsTableOwner(backfill!.upSql);

    expect(await memberTitles()).toEqual(['Global', 'Verwaist Gruppe', 'Verwaist Nutzer']);
    const scopes = await postgres.admin.query<{ title: string; assignment_scope: string }>(
      `SELECT title, assignment_scope FROM tasks WHERE workspace_id = $1 ORDER BY source_sqlite_id`,
      [WORKSPACE_ID],
    );
    expect(scopes.rows.map((row) => row.assignment_scope)).toEqual(['global', 'global', 'global']);
  });
});
