/**
 * @jest-environment node
 */
jest.mock('electron', () => ({
  app: { getPath: () => `${process.cwd()}/.tmp-tests/simplecrm-followup-local-date` },
}));

// The Jest sandbox cannot switch the process time zone, so the local clock of a
// user in Europe/Berlin (00:30 on 2026-07-15) is provided through the helper;
// the system clock is 22:30 UTC on 2026-07-14 (see beforeEach).
jest.mock('../../electron/utils/local-date', () => {
  const key = (d: Date) => d.toISOString().slice(0, 10);
  return {
    localDateKey: () => '2026-07-15',
    localDateKeyInDays: (days: number) => key(new Date(Date.UTC(2026, 6, 15 + days))),
  };
});

import Database from 'better-sqlite3';
import {
  bootstrapFreshDatabaseSchema,
  closeDatabase,
  getDashboardStats,
  getFollowUpItems,
  getFollowUpQueueCounts,
} from '../../electron/sqlite-service';

describe('follow-up and dashboard use the local calendar date', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    bootstrapFreshDatabaseSchema(db, { keepDbAssigned: true });
    db.prepare("INSERT INTO customers (id, name) VALUES (1, 'Ada')").run();
    db.prepare(
      `INSERT INTO tasks (id, customer_id, title, due_date, priority, completed)
       VALUES (1, 1, 'Heute lokal', '2026-07-15', 'High', 0), (2, 1, 'Gestern', '2026-07-14', 'High', 0)`,
    ).run();
    // 00:30 MESZ on 2026-07-15 = 22:30 UTC on 2026-07-14.
    jest.useFakeTimers({ now: new Date('2026-07-14T22:30:00.000Z') });
  });

  afterEach(() => {
    jest.useRealTimers();
    closeDatabase();
  });

  // F-A10-13: 'Heute'/'Ueberfaellig' und 'Heute faellig' rechneten mit dem UTC-Datum; kurz nach Mitternacht zeigte 'Heute' die Aufgaben von gestern.
  test('queue counts treat the local date as today', () => {
    expect(getFollowUpQueueCounts()).toMatchObject({ heute: 1, ueberfaellig: 1 });
    expect(getFollowUpItems('heute').map((item: { title: string }) => item.title)).toEqual(['Heute lokal']);
    expect(getFollowUpItems('ueberfaellig').map((item: { title: string }) => item.title)).toEqual(['Gestern']);
  });

  test('dashboard "due today" counts the local date', () => {
    expect(getDashboardStats().dueTodayTasksCount).toBe(1);
    db.prepare('UPDATE tasks SET completed = 1 WHERE id = 1').run();
    expect(getDashboardStats().dueTodayTasksCount).toBe(0);
  });
});
