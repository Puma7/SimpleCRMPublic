/**
 * @jest-environment node
 */
jest.mock('electron', () => ({
  app: { getPath: () => `${process.cwd()}/.tmp-tests/simplecrm-task-calendar` },
}));

import Database from 'better-sqlite3';
import { mkdirSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import {
  bootstrapFreshDatabaseSchema,
  closeDatabase,
  createCalendarEntry,
  deleteCalendarEntry,
  deleteTask,
  getDb,
  getTaskById,
  initializeDatabase,
  updateCalendarEntry,
  updateTask,
  updateTaskCompletion,
} from '../../electron/sqlite-service';

describe('SQLite atomic task/calendar operations', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    bootstrapFreshDatabaseSchema(db, { keepDbAssigned: true });
    db.prepare("INSERT INTO customers (id, name, company) VALUES (1, 'Ada', 'Analytical Engines')").run();
  });

  afterEach(() => {
    closeDatabase();
  });

  function createLinkedEntry() {
    return createCalendarEntry({
      event: {
        title: 'Angebot nachfassen',
        description: 'Kunde anrufen',
        start_date: '2026-07-23T00:00:00.000Z',
        end_date: '2026-07-24T00:00:00.000Z',
        all_day: true,
        color_code: '#3174ad',
        event_type: 'task',
        recurrence_rule: null,
      },
      schedule: {
        mode: 'create',
        task: {
          customerId: 1,
          title: 'Angebot nachfassen',
          description: 'Kunde anrufen',
          priority: 'High',
        },
      },
    });
  }

  test('creates one linked task and calendar entry in one transaction', () => {
    const result = createLinkedEntry();

    expect(result.success).toBe(true);
    expect(result.event.task_id).toBe(result.task?.id);
    expect(result.task?.calendar_event_id).toBe(result.event.id);
    expect(result.task?.due_date).toBe('2026-07-23');
  });

  test('keeps an enriched event description separate from the raw task description', () => {
    const result = createCalendarEntry({
      event: {
        title: 'Angebot nachfassen',
        description: 'Kunde anrufen\nKunde: Ada',
        start_date: '2026-07-23T00:00:00.000Z',
        end_date: '2026-07-24T00:00:00.000Z',
        all_day: true,
      },
      schedule: {
        mode: 'create',
        task: {
          customerId: 1,
          title: 'Angebot nachfassen',
          description: 'Kunde anrufen',
        },
      },
    });

    expect(result.event.description).toBe('Kunde anrufen\nKunde: Ada');
    expect(result.task?.description).toBe('Kunde anrufen');
  });

  test('updates priority and completion when editing an existing task link', () => {
    const created = createLinkedEntry();
    const updated = updateCalendarEntry(created.event.id, {
      event: {},
      schedule: {
        mode: 'existing',
        taskId: created.task!.id,
        task: { priority: 'Low', completed: true },
      },
    });

    expect(updated.task).toMatchObject({ priority: 'Low', completed: 1 });
    expect(updated.event.color_code).toBe('#94a3b8');
  });

  test('rolls the task back when the calendar insert fails', () => {
    db.exec(`
      CREATE TRIGGER reject_calendar_insert
      BEFORE INSERT ON calendar_events
      BEGIN
        SELECT RAISE(ABORT, 'calendar insert rejected');
      END;
    `);

    expect(() => createLinkedEntry()).toThrow('calendar insert rejected');
    expect(db.prepare('SELECT COUNT(*) AS count FROM tasks').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM calendar_events').get()).toEqual({ count: 0 });
  });

  test('keeps linked event fields and completion color synchronized from the task', () => {
    const created = createLinkedEntry();
    const taskId = created.task!.id;

    expect(updateTask(taskId, {
      title: 'Neuer Titel',
      description: 'Neue Beschreibung',
      due_date: '2026-07-25',
    })).toMatchObject({ success: true });
    expect(updateTaskCompletion(taskId, true)).toMatchObject({ success: true });

    const event = db.prepare('SELECT * FROM calendar_events WHERE task_id = ?').get(taskId) as Record<string, unknown>;
    expect(event).toMatchObject({
      title: 'Neuer Titel',
      description: 'Neue Beschreibung',
      start_date: '2026-07-25T00:00:00.000Z',
      end_date: '2026-07-26T00:00:00.000Z',
      color_code: '#94a3b8',
      event_type: 'task',
      recurrence_rule: null,
    });
  });

  test('moving or deleting a linked entry updates but does not delete the task', () => {
    const created = createLinkedEntry();
    const taskId = created.task!.id;

    const moved = updateCalendarEntry(created.event.id, {
      event: {
        start_date: '2026-08-01T00:00:00.000Z',
        end_date: '2026-08-02T00:00:00.000Z',
      },
    });
    expect(moved.task?.due_date).toBe('2026-08-01');

    expect(deleteCalendarEntry(created.event.id)).toMatchObject({ success: true });
    expect(getTaskById(taskId)).toMatchObject({ id: taskId, due_date: null, calendar_event_id: null });
  });

  test('creates a task atomically when an existing standalone entry is converted', () => {
    const standalone = createCalendarEntry({
      event: {
        title: 'Stand-alone Termin',
        start_date: '2026-08-03T00:00:00.000Z',
        end_date: '2026-08-04T00:00:00.000Z',
        all_day: true,
      },
    });

    const converted = updateCalendarEntry(standalone.event.id, {
      event: { title: 'Verknuepfte Aufgabe' },
      schedule: {
        mode: 'create',
        task: { customerId: 1, title: 'Verknuepfte Aufgabe', priority: 'Medium' },
      },
    });

    expect(converted.task).toMatchObject({
      title: 'Verknuepfte Aufgabe',
      due_date: '2026-08-03',
      calendar_event_id: standalone.event.id,
    });
    expect(converted.event.task_id).toBe(converted.task?.id);
  });

  test('unlinking an entry keeps the task and clears its due date', () => {
    const created = createLinkedEntry();
    const unlinked = updateCalendarEntry(created.event.id, {
      event: {},
      schedule: { mode: 'none' },
    });

    expect(unlinked.event).toMatchObject({ task_id: null, event_type: null });
    expect(getTaskById(created.task!.id)).toMatchObject({
      id: created.task!.id,
      due_date: null,
      calendar_event_id: null,
    });
  });

  test('clearing or deleting a task removes its linked calendar entry', () => {
    const first = createLinkedEntry();
    expect(updateTask(first.task!.id, { due_date: null })).toMatchObject({ success: true });
    expect(db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(first.event.id)).toBeUndefined();

    const second = createLinkedEntry();
    expect(deleteTask(second.task!.id)).toMatchObject({ success: true });
    expect(db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(second.event.id)).toBeUndefined();
  });

  test('enforces at most one calendar entry per task', () => {
    const created = createLinkedEntry();
    expect(() => db.prepare(`
      INSERT INTO calendar_events (title, start_date, end_date, all_day, event_type, task_id)
      VALUES ('Doppelt', '2026-07-23', '2026-07-24', 1, 'task', ?)
    `).run(created.task!.id)).toThrow();
  });

  test('rejects calendar dates that JavaScript would otherwise normalize', () => {
    expect(() => createCalendarEntry({
      event: {
        title: 'Ungueltiges Datum',
        start_date: '2026-02-31T00:00:00.000Z',
        end_date: '2026-03-04T00:00:00.000Z',
        all_day: true,
      },
    })).toThrow('Invalid calendar date range');
  });
});

describe('SQLite task/calendar legacy migration', () => {
  const databasePath = join(process.cwd(), '.tmp-tests', 'simplecrm-task-calendar', 'database.sqlite');

  afterEach(() => {
    closeDatabase();
    rmSync(dirname(databasePath), { recursive: true, force: true });
  });

  test('keeps the newest task link and converts duplicates to standalone events', () => {
    mkdirSync(dirname(databasePath), { recursive: true });
    const seed = new Database(databasePath);
    try {
      bootstrapFreshDatabaseSchema(seed);
      seed.pragma('foreign_keys = OFF');
      seed.exec(`
        DROP INDEX idx_calendar_events_task_unique;
        DELETE FROM sync_info WHERE key = 'atomic_task_calendar_v1';
        INSERT INTO customers (id, name, company) VALUES (1, 'Ada', 'Analytical Engines');
        INSERT INTO tasks (id, customer_id, title, priority, calendar_event_id)
        VALUES (1, 1, 'Legacy task', 'Medium', 10);
        INSERT INTO calendar_events (
          id, title, start_date, end_date, all_day, event_type, recurrence_rule, task_id, updated_at
        ) VALUES
          (10, 'Older', '2026-07-20', '2026-07-21', 1, 'task', NULL, 1, '2026-07-20T00:00:00.000Z'),
          (11, 'Newest', '2026-07-21', '2026-07-22', 1, 'task', NULL, 1, '2026-07-21T00:00:00.000Z');
      `);
    } finally {
      seed.close();
    }

    initializeDatabase();

    const migrated = getDb().prepare(`
      SELECT id, task_id, event_type, recurrence_rule
        FROM calendar_events
       ORDER BY id
    `).all();
    expect(migrated).toEqual([
      { id: 10, task_id: null, event_type: null, recurrence_rule: null },
      { id: 11, task_id: 1, event_type: 'task', recurrence_rule: null },
    ]);
    expect(getTaskById(1)).toMatchObject({ calendar_event_id: 11 });
    expect(() => getDb().prepare(`
      INSERT INTO calendar_events (title, start_date, end_date, all_day, event_type, task_id)
      VALUES ('Duplicate', '2026-07-23', '2026-07-24', 1, 'task', 1)
    `).run()).toThrow();
  });

  test('rebuilds an already-migrated legacy task foreign key with delete cascade', () => {
    mkdirSync(dirname(databasePath), { recursive: true });
    const seed = new Database(databasePath);
    try {
      bootstrapFreshDatabaseSchema(seed);
      seed.pragma('foreign_keys = OFF');
      seed.exec(`
        DROP INDEX idx_calendar_events_task_unique;
        DROP TABLE calendar_events;
        CREATE TABLE calendar_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          description TEXT,
          start_date TEXT NOT NULL,
          end_date TEXT NOT NULL,
          all_day INTEGER NOT NULL DEFAULT 0,
          color_code TEXT,
          event_type TEXT,
          recurrence_rule TEXT,
          task_id INTEGER,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
        );
        CREATE UNIQUE INDEX idx_calendar_events_task_unique
          ON calendar_events(task_id) WHERE task_id IS NOT NULL;
        INSERT INTO customers (id, name, company) VALUES (1, 'Ada', 'Analytical Engines');
        INSERT INTO tasks (id, customer_id, title, priority) VALUES (1, 1, 'Legacy task', 'Medium');
        INSERT INTO calendar_events (
          id, title, start_date, end_date, all_day, event_type, task_id
        ) VALUES (10, 'Legacy event', '2026-07-20', '2026-07-21', 1, 'task', 1);
        INSERT OR REPLACE INTO sync_info (key, value) VALUES ('atomic_task_calendar_v1', '1');
        DELETE FROM sync_info WHERE key = 'atomic_task_calendar_cascade_v2';
      `);
    } finally {
      seed.close();
    }

    initializeDatabase();

    const foreignKeys = getDb().prepare('PRAGMA foreign_key_list(calendar_events)').all() as Array<Record<string, unknown>>;
    expect(foreignKeys).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'task_id', table: 'tasks', on_delete: 'CASCADE' }),
    ]));
    expect(deleteTask(1)).toMatchObject({ success: true });
    expect(getDb().prepare('SELECT id FROM calendar_events WHERE id = 10').get()).toBeUndefined();
  });
});
