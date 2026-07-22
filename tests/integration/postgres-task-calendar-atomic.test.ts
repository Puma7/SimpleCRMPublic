import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { createRequire } from 'module';
import { createServer } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';

import type { TaskViewer } from '../../packages/server/src/api/types';
import {
  createPostgresCalendarEntryPort,
  createPostgresTaskReadPort,
} from '../../packages/server/src/db/postgres-core-crm-read-ports';
import { createPostgresCalendarEventReadPort } from '../../packages/server/src/db/postgres-extended-crm-read-ports';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { serverMigrations } from '../../packages/server/src/migrations';
import { createPgMigrationDatabase, runServerMigrations } from '../../packages/server/src/migrations/runner';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-000000000001';
const OWNER_ID = '20000000-0000-4000-8000-000000000001';
const USER_ID = '20000000-0000-4000-8000-000000000002';
const OTHER_USER_ID = '20000000-0000-4000-8000-000000000003';

const ownerViewer: TaskViewer = { userId: OWNER_ID, role: 'owner' };
const userViewer: TaskViewer = { userId: USER_ID, role: 'user' };
const otherUserViewer: TaskViewer = { userId: OTHER_USER_ID, role: 'user' };

async function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === 'string') {
          reject(new Error('could not allocate PostgreSQL test port'));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function startEmbeddedPostgres(databaseDir: string, port: number): Promise<ChildProcessWithoutNullStreams> {
  const moduleUrl = pathToFileURL(join(
    __dirname,
    '..',
    '..',
    'packages',
    'desktop',
    'node_modules',
    'embedded-postgres',
    'dist',
    'index.js',
  )).href;
  const script = `
import EmbeddedPostgres from ${JSON.stringify(moduleUrl)};
const database = new EmbeddedPostgres({
  databaseDir: ${JSON.stringify(databaseDir)},
  port: ${port},
  user: 'postgres',
  password: 'task-calendar-test-password',
  authMethod: 'scram-sha-256',
  persistent: false,
  onLog() {},
  onError(error) { console.error(error); },
});
await database.initialise();
await database.start();
console.log('TASK_CALENDAR_POSTGRES_READY');
process.stdin.once('data', async () => {
  await database.stop();
  process.exit(0);
});
process.stdin.resume();
`;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', script]);
  await new Promise<void>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => reject(new Error(`PostgreSQL startup timed out: ${stderr}`)), 60_000);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (stdout.includes('TASK_CALENDAR_POSTGRES_READY')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (!stdout.includes('TASK_CALENDAR_POSTGRES_READY')) {
        clearTimeout(timeout);
        reject(new Error(`PostgreSQL exited with ${code}: ${stderr}`));
      }
    });
  });
  return child;
}

describe('PostgreSQL atomic task/calendar operations', () => {
  let postgresProcess: ChildProcessWithoutNullStreams;
  let postgresDir: string;
  let pool: Pool;
  let db: Kysely<ServerDatabase>;

  beforeAll(async () => {
    postgresDir = mkdtempSync(join(tmpdir(), 'simplecrm-task-calendar-'));
    const port = await findAvailablePort();
    postgresProcess = await startEmbeddedPostgres(postgresDir, port);
    const requireFromServer = createRequire(join(__dirname, '..', '..', 'packages', 'server', 'package.json'));
    const { Client } = requireFromServer('pg') as {
      Client: new (options: Record<string, unknown>) => {
        connect(): Promise<void>;
        query<Row extends Record<string, unknown> = Record<string, unknown>>(
          sql: string,
          params?: readonly unknown[],
        ): Promise<{ rows: readonly Row[]; rowCount?: number | null }>;
        end(): Promise<void>;
      };
    };
    const connection = {
      host: '127.0.0.1',
      port,
      user: 'postgres',
      password: 'task-calendar-test-password',
      database: 'postgres',
    };
    const migrationClient = new Client(connection);
    await migrationClient.connect();
    await runServerMigrations(createPgMigrationDatabase(migrationClient), serverMigrations);
    await migrationClient.query(
      `INSERT INTO workspaces (id, name) VALUES ($1, 'Task Calendar Test')`,
      [WORKSPACE_ID],
    );
    await migrationClient.query(
      `INSERT INTO users (id, workspace_id, email, display_name, password_hash, role) VALUES
        ($1, $4, 'owner@example.test', 'Owner', 'hash', 'owner'),
        ($2, $4, 'user@example.test', 'User', 'hash', 'user'),
        ($3, $4, 'other@example.test', 'Other User', 'hash', 'user')`,
      [OWNER_ID, USER_ID, OTHER_USER_ID, WORKSPACE_ID],
    );
    await migrationClient.end();

    pool = new Pool(connection);
    db = new Kysely<ServerDatabase>({ dialect: new PostgresDialect({ pool }) });
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgresProcess) {
      postgresProcess.stdin.write('stop\n');
      await new Promise<void>((resolve) => postgresProcess.once('exit', () => resolve()));
    }
    if (postgresDir) rmSync(postgresDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE calendar_events, tasks RESTART IDENTITY CASCADE');
  });

  test('commits task and event together and rolls both back after an event insert failure', async () => {
    const entries = createPostgresCalendarEntryPort({ db });
    const created = await entries.create({
      workspaceId: WORKSPACE_ID,
      actorUserId: OWNER_ID,
      viewer: ownerViewer,
      event: {
        title: 'Angebot nachfassen',
        startDate: '2026-07-23T00:00:00.000Z',
        endDate: '2026-07-24T00:00:00.000Z',
        allDay: true,
      },
      schedule: {
        mode: 'create',
        task: { title: 'Angebot nachfassen', priority: 'High' },
      },
    });

    expect(created).toMatchObject({ ok: true, event: { taskId: 1 }, task: { id: 1, calendarEventId: 1 } });

    await pool.query(`
      CREATE OR REPLACE FUNCTION reject_atomic_calendar_insert() RETURNS trigger AS $$
      BEGIN
        IF NEW.title = 'Reject me' THEN RAISE EXCEPTION 'calendar insert rejected'; END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_atomic_calendar_insert
      BEFORE INSERT ON calendar_events
      FOR EACH ROW EXECUTE FUNCTION reject_atomic_calendar_insert();
    `);

    await expect(entries.create({
      workspaceId: WORKSPACE_ID,
      actorUserId: OWNER_ID,
      viewer: ownerViewer,
      event: {
        title: 'Reject me',
        startDate: '2026-07-25T00:00:00.000Z',
        endDate: '2026-07-26T00:00:00.000Z',
      },
      schedule: { mode: 'create', task: { title: 'Reject me' } },
    })).rejects.toThrow('calendar insert rejected');

    const rejectedTasks = await pool.query(`SELECT id FROM tasks WHERE title = 'Reject me'`);
    expect(rejectedTasks.rowCount).toBe(0);
  });

  test('returns the canonical link when a standalone event creates a task', async () => {
    const entries = createPostgresCalendarEntryPort({ db });
    const standalone = await entries.create({
      workspaceId: WORKSPACE_ID,
      actorUserId: OWNER_ID,
      viewer: ownerViewer,
      event: {
        title: 'Stand-alone',
        startDate: '2026-07-27T00:00:00.000Z',
        endDate: '2026-07-28T00:00:00.000Z',
      },
    });
    expect(standalone.ok).toBe(true);
    if (!standalone.ok) return;

    const linked = await entries.update({
      workspaceId: WORKSPACE_ID,
      actorUserId: OWNER_ID,
      viewer: ownerViewer,
      id: standalone.event.id,
      event: { title: 'Verknuepft' },
      schedule: { mode: 'create', task: { title: 'Verknuepft' } },
    });

    expect(linked).toMatchObject({
      ok: true,
      event: { id: standalone.event.id },
      task: { calendarEventId: standalone.event.id },
    });
  });

  test('allows only one concurrent calendar link for a task', async () => {
    const tasks = createPostgresTaskReadPort({ db });
    const entries = createPostgresCalendarEntryPort({ db });
    const taskResult = await tasks.create!({
      workspaceId: WORKSPACE_ID,
      actorUserId: OWNER_ID,
      values: { title: 'Konkurrenztest', priority: 'Medium' },
    });
    expect(taskResult.ok).toBe(true);
    const taskId = taskResult.ok ? taskResult.task.id : 0;

    const results = await Promise.all([
      entries.create({
        workspaceId: WORKSPACE_ID,
        actorUserId: OWNER_ID,
        viewer: ownerViewer,
        event: {
          title: 'Erster Termin',
          startDate: '2026-08-01T00:00:00.000Z',
          endDate: '2026-08-02T00:00:00.000Z',
        },
        schedule: { mode: 'existing', taskId },
      }),
      entries.create({
        workspaceId: WORKSPACE_ID,
        actorUserId: OWNER_ID,
        viewer: ownerViewer,
        event: {
          title: 'Zweiter Termin',
          startDate: '2026-08-03T00:00:00.000Z',
          endDate: '2026-08-04T00:00:00.000Z',
        },
        schedule: { mode: 'existing', taskId },
      }),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, code: 'task_already_scheduled' },
    ]);
    const links = await pool.query('SELECT id FROM calendar_events WHERE task_id = $1', [taskId]);
    expect(links.rowCount).toBe(1);
  });

  test('serializes concurrent task and calendar updates without lock inversion', async () => {
    const entries = createPostgresCalendarEntryPort({ db });
    const tasks = createPostgresTaskReadPort({ db });
    const created = await entries.create({
      workspaceId: WORKSPACE_ID,
      actorUserId: OWNER_ID,
      viewer: ownerViewer,
      event: {
        title: 'Parallel',
        startDate: '2026-08-11T00:00:00.000Z',
        endDate: '2026-08-12T00:00:00.000Z',
      },
      schedule: { mode: 'create', task: { title: 'Parallel' } },
    });
    expect(created.ok).toBe(true);
    if (!created.ok || !created.task) return;

    await pool.query(`
      CREATE OR REPLACE FUNCTION delay_task_update() RETURNS trigger AS $$
      BEGIN
        IF NEW.title = 'Task side' THEN PERFORM pg_sleep(0.2); END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER delay_task_update
      BEFORE UPDATE ON tasks
      FOR EACH ROW EXECUTE FUNCTION delay_task_update();
    `);

    const [taskResult, eventResult] = await Promise.all([
      tasks.update!({
        workspaceId: WORKSPACE_ID,
        actorUserId: OWNER_ID,
        viewer: ownerViewer,
        id: created.task.id,
        values: { title: 'Task side' },
      }),
      entries.update({
        workspaceId: WORKSPACE_ID,
        actorUserId: OWNER_ID,
        viewer: ownerViewer,
        id: created.event.id,
        event: {
          startDate: '2026-08-13T00:00:00.000Z',
          endDate: '2026-08-14T00:00:00.000Z',
        },
      }),
    ]);

    expect(taskResult).toMatchObject({ ok: true });
    expect(eventResult).toMatchObject({ ok: true });
    const finalTask = await tasks.get({ workspaceId: WORKSPACE_ID, id: created.task.id, viewer: ownerViewer });
    expect(finalTask).toMatchObject({
      title: 'Task side',
      dueDate: '2026-08-13T00:00:00.000Z',
      calendarEventId: created.event.id,
    });
  });

  test('hides linked events with private task assignments while owners retain access', async () => {
    const entries = createPostgresCalendarEntryPort({ db });
    const calendarEvents = createPostgresCalendarEventReadPort({ db });
    const created = await entries.create({
      workspaceId: WORKSPACE_ID,
      actorUserId: OWNER_ID,
      viewer: ownerViewer,
      event: {
        title: 'Privater Termin',
        startDate: '2026-08-05T00:00:00.000Z',
        endDate: '2026-08-06T00:00:00.000Z',
      },
      schedule: {
        mode: 'create',
        task: {
          title: 'Private Aufgabe',
          assignmentScope: 'user',
          assignedUserId: USER_ID,
        },
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const visible = await calendarEvents.list({
      workspaceId: WORKSPACE_ID,
      viewer: userViewer,
      limit: 20,
    });
    const hidden = await calendarEvents.list({
      workspaceId: WORKSPACE_ID,
      viewer: otherUserViewer,
      limit: 20,
    });
    expect(visible.items.map((item) => item.id)).toContain(created.event.id);
    expect(hidden.items.map((item) => item.id)).not.toContain(created.event.id);

    await expect(entries.update({
      workspaceId: WORKSPACE_ID,
      actorUserId: OTHER_USER_ID,
      viewer: otherUserViewer,
      id: created.event.id,
      event: { title: 'Nicht erlaubt' },
    })).resolves.toEqual({ ok: false, code: 'forbidden' });
    await expect(entries.update({
      workspaceId: WORKSPACE_ID,
      actorUserId: OWNER_ID,
      viewer: ownerViewer,
      id: created.event.id,
      event: { title: 'Owner-Aenderung' },
    })).resolves.toMatchObject({ ok: true, event: { title: 'Owner-Aenderung' } });
  });

  test('unschedules without deleting the task and cascades the event when the task is deleted', async () => {
    const entries = createPostgresCalendarEntryPort({ db });
    const tasks = createPostgresTaskReadPort({ db });
    const first = await entries.create({
      workspaceId: WORKSPACE_ID,
      actorUserId: OWNER_ID,
      viewer: ownerViewer,
      event: {
        title: 'Entkoppeln',
        startDate: '2026-08-07T00:00:00.000Z',
        endDate: '2026-08-08T00:00:00.000Z',
      },
      schedule: { mode: 'create', task: { title: 'Entkoppeln' } },
    });
    expect(first.ok).toBe(true);
    if (!first.ok || !first.task) return;

    const unlinkedEntry = await entries.update({
      workspaceId: WORKSPACE_ID,
      actorUserId: OWNER_ID,
      viewer: ownerViewer,
      id: first.event.id,
      event: { title: 'Entkoppelt' },
      schedule: { mode: 'none' },
    });
    expect(unlinkedEntry).toMatchObject({
      ok: true,
      event: { taskId: null, eventType: null },
      task: null,
      detachedTask: { id: first.task.id, dueDate: null, calendarEventId: null },
    });
    await entries.delete({
      workspaceId: WORKSPACE_ID,
      actorUserId: OWNER_ID,
      viewer: ownerViewer,
      id: first.event.id,
    });
    await expect(tasks.get({ workspaceId: WORKSPACE_ID, id: first.task.id, viewer: ownerViewer }))
      .resolves.toMatchObject({ id: first.task.id });

    const second = await entries.create({
      workspaceId: WORKSPACE_ID,
      actorUserId: OWNER_ID,
      viewer: ownerViewer,
      event: {
        title: 'Kaskade',
        startDate: '2026-08-09T00:00:00.000Z',
        endDate: '2026-08-10T00:00:00.000Z',
      },
      schedule: { mode: 'create', task: { title: 'Kaskade' } },
    });
    expect(second.ok).toBe(true);
    if (!second.ok || !second.task) return;

    await tasks.delete!({
      workspaceId: WORKSPACE_ID,
      actorUserId: OWNER_ID,
      id: second.task.id,
      viewer: ownerViewer,
    });
    const remainingEvent = await pool.query('SELECT id FROM calendar_events WHERE id = $1', [second.event.id]);
    expect(remainingEvent.rowCount).toBe(0);
  });
});
