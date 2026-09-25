/**
 * @jest-environment node
 */
jest.mock('electron', () => ({
  app: { getPath: () => `${process.cwd()}/.tmp-tests/simplecrm-dashboard-stats` },
}));

import Database from 'better-sqlite3';
import {
  bootstrapFreshDatabaseSchema,
  closeDatabase,
  getDashboardStats,
} from '../../electron/sqlite-service';

// F-A10-07: the dashboard only knew the legacy stages 'Closed Won'/'Closed Lost',
// so the conversion rate stayed at 0 % for the German stages the UI writes and
// won or lost deals still counted as active pipeline.
describe('SQLite dashboard stats with German deal stages', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    bootstrapFreshDatabaseSchema(db, { keepDbAssigned: true });
    db.prepare("INSERT INTO customers (id, name, company) VALUES (1, 'Ada', 'Analytical Engines')").run();
    const insertDeal = db.prepare('INSERT INTO deals (customer_id, name, value, stage) VALUES (1, ?, ?, ?)');
    insertDeal.run('Gewonnen', 100, 'Gewonnen');
    insertDeal.run('Verloren', 50, 'Verloren');
    insertDeal.run('Legacy gewonnen', 20, 'Closed Won');
    insertDeal.run('Offen', 30, 'Angebot');
  });

  afterEach(() => {
    closeDatabase();
  });

  test('counts German won/lost stages as closed for pipeline and conversion rate', () => {
    const stats = getDashboardStats();

    expect(stats.activeDealsCount).toBe(1);
    expect(stats.activeDealsValue).toBe(30);
    expect(stats.conversionRate).toBeCloseTo((2 / 3) * 100);
  });
});
