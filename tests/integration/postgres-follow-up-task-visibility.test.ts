import type { Kysely } from 'kysely';

import {
  createServerApi,
  type AuthApiPort,
  type AuthenticatedPrincipal,
  type ServerApiPorts,
} from '../../packages/server/src';
import { createPostgresDashboardPort } from '../../packages/server/src/db/postgres-dashboard-port';
import { createPostgresFollowUpPort } from '../../packages/server/src/db/postgres-follow-up-port';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000c3';
const OWNER_ID = '20000000-0000-4000-8000-0000000000c1';
const ASSIGNEE_ID = '20000000-0000-4000-8000-0000000000c2';
const OUTSIDER_ID = '20000000-0000-4000-8000-0000000000c3';
const GROUP_MEMBER_ID = '20000000-0000-4000-8000-0000000000c4';
const GROUP_ID = 7301;

const TASK_GLOBAL = 1;
const TASK_PRIVATE = 2;
const TASK_GROUP = 3;
const TASK_OUTSIDER_OWN = 4;

function principal(userId: string, role: AuthenticatedPrincipal['role']): AuthenticatedPrincipal {
  return {
    userId,
    workspaceId: WORKSPACE_ID,
    role,
    ...(role === 'user' ? { capabilities: ['crm.read', 'crm.write'] } : {}),
  };
}

const owner = principal(OWNER_ID, 'owner');
const outsider = principal(OUTSIDER_ID, 'user');
const groupMember = principal(GROUP_MEMBER_ID, 'user');

function authPort(): AuthApiPort {
  return {
    findUserByEmail: async () => null,
    verifyPassword: async () => false,
    recordFailedLogin: async () => 1,
    recordSuccessfulLogin: async () => undefined,
    issueTokenPair: async () => ({ accessToken: 'access', refreshToken: 'refresh', expiresInSeconds: 900 }),
    rotateRefreshToken: async () => null,
    revokeRefreshToken: async () => false,
  };
}

describe('follow-up queues and dashboard respect task visibility (PostgreSQL)', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;
  let api: ReturnType<typeof createServerApi>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('follow-up-visibility');
    await postgres.admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Follow-up Visibility')`, [WORKSPACE_ID]);
    await postgres.admin.query(
      `INSERT INTO users (id, workspace_id, email, display_name, password_hash, role) VALUES
        ($1, $5, 'owner@example.test', 'Owner', 'hash', 'owner'),
        ($2, $5, 'assignee@example.test', 'Assignee', 'hash', 'user'),
        ($3, $5, 'outsider@example.test', 'Outsider', 'hash', 'user'),
        ($4, $5, 'member@example.test', 'Group Member', 'hash', 'user')`,
      [OWNER_ID, ASSIGNEE_ID, OUTSIDER_ID, GROUP_MEMBER_ID, WORKSPACE_ID],
    );
    await postgres.admin.query(
      `INSERT INTO user_groups (id, workspace_id, name) VALUES ($1, $2, 'Vertrieb')`,
      [GROUP_ID, WORKSPACE_ID],
    );
    await postgres.admin.query(
      `INSERT INTO user_group_members (workspace_id, group_id, user_id) VALUES ($1, $2, $3)`,
      [WORKSPACE_ID, GROUP_ID, GROUP_MEMBER_ID],
    );
    db = postgres.createApplicationDb();
    const ports: ServerApiPorts = {
      auth: authPort(),
      locks: {} as ServerApiPorts['locks'],
      followUp: createPostgresFollowUpPort({ db }),
      dashboard: createPostgresDashboardPort({ db }),
    };
    api = createServerApi(ports);
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  beforeEach(async () => {
    await postgres.admin.query('TRUNCATE tasks RESTART IDENTITY CASCADE');
    await postgres.admin.query(
      `INSERT INTO tasks (
        id, workspace_id, source_sqlite_id, customer_source_sqlite_id, title, description,
        due_date, priority, completed, assignment_scope, assigned_user_id, assigned_group_id
      ) VALUES
        ($1, $5, $1, 0, 'Globale Aufgabe', NULL, now(), 'Medium', false, 'global', NULL, NULL),
        ($2, $5, $2, 0, 'Abmahnung vorbereiten', 'Geheime Personalsache', now(), 'High', false, 'user', $6, NULL),
        ($3, $5, $3, 0, 'Gruppenaufgabe', NULL, now(), 'Low', false, 'group', NULL, $8),
        ($4, $5, $4, 0, 'Eigene Aufgabe', NULL, now(), 'Low', false, 'user', $7, NULL)`,
      [TASK_GLOBAL, TASK_PRIVATE, TASK_GROUP, TASK_OUTSIDER_OWN, WORKSPACE_ID, ASSIGNEE_ID, OUTSIDER_ID, GROUP_ID],
    );
  });

  async function followUpTitles(viewer: AuthenticatedPrincipal, query: Record<string, string>): Promise<string[]> {
    const response = await api.handle({ method: 'GET', path: '/api/v1/follow-up/items', query, principal: viewer });
    expect(response.status).toBe(200);
    return ((response.body as any).data as Array<{ title: string }>).map((item) => item.title).sort();
  }

  // F-A10-03: follow-up queues, queue counts and the dashboard task widgets
  // ran as 'system' without the task visibility filter, so a member saw
  // title, customer and due date of tasks assigned only to other users or
  // groups, and could probe their descriptions via the query parameter.
  test('a member only sees global, own and own-group tasks in follow-up queues', async () => {
    expect(await followUpTitles(outsider, { queue: 'heute' })).toEqual(['Eigene Aufgabe', 'Globale Aufgabe']);
    expect(await followUpTitles(outsider, { queue: 'heute', query: 'Geheime' })).toEqual([]);
    expect(await followUpTitles(groupMember, { queue: 'heute' })).toEqual(['Globale Aufgabe', 'Gruppenaufgabe']);
    expect(await followUpTitles(owner, { queue: 'heute' })).toEqual([
      'Abmahnung vorbereiten',
      'Eigene Aufgabe',
      'Globale Aufgabe',
      'Gruppenaufgabe',
    ]);

    const counts = await api.handle({ method: 'GET', path: '/api/v1/follow-up/queue-counts', principal: outsider });
    expect(counts.status).toBe(200);
    expect((counts.body as any).data).toMatchObject({ heute: 2, dieseWoche: 2 });
    const ownerCounts = await api.handle({ method: 'GET', path: '/api/v1/follow-up/queue-counts', principal: owner });
    expect((ownerCounts.body as any).data).toMatchObject({ heute: 4, dieseWoche: 4 });
  });

  test('the dashboard task widgets only count and list tasks the member may see', async () => {
    const upcoming = await api.handle({
      method: 'GET',
      path: '/api/v1/dashboard/upcoming-tasks',
      query: { limit: '25' },
      principal: outsider,
    });
    expect(upcoming.status).toBe(200);
    expect(((upcoming.body as any).data as Array<{ title: string }>).map((task) => task.title).sort())
      .toEqual(['Eigene Aufgabe', 'Globale Aufgabe']);

    const stats = await api.handle({ method: 'GET', path: '/api/v1/dashboard/stats', principal: outsider });
    expect(stats.status).toBe(200);
    expect((stats.body as any).data).toMatchObject({ pendingTasksCount: 2, dueTodayTasksCount: 2 });

    const ownerUpcoming = await api.handle({
      method: 'GET',
      path: '/api/v1/dashboard/upcoming-tasks',
      query: { limit: '25' },
      principal: owner,
    });
    expect((ownerUpcoming.body as any).data).toHaveLength(4);
  });
});
