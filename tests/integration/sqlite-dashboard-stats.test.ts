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
  getFollowUpItems,
  getFollowUpQueueCounts,
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

  // F-A10-07: 'Abgeschlossen Gewonnen'/'Abgeschlossen Verloren' galten in Dashboard und Follow-up als offene Deals.
  test('treats "Abgeschlossen Gewonnen/Verloren" as won/lost in dashboard and follow-up', () => {
    db.prepare('DELETE FROM deals').run();
    const insertStaleDeal = db.prepare(
      "INSERT INTO deals (customer_id, name, value, stage, last_modified) VALUES (1, ?, ?, ?, datetime('now', '-30 days'))",
    );
    insertStaleDeal.run('Abgeschlossen gewonnen', 7000, 'Abgeschlossen Gewonnen');
    insertStaleDeal.run('Abgeschlossen verloren', 4000, 'Abgeschlossen Verloren');
    insertStaleDeal.run('Offen', 3000, 'Angebot');
    db.prepare("INSERT INTO tasks (customer_id, title, due_date, priority, completed) VALUES (1, 'Nachfassen', '2000-01-01', 'High', 0)").run();

    const stats = getDashboardStats();
    expect(stats.activeDealsCount).toBe(1);
    expect(stats.activeDealsValue).toBe(3000);
    expect(stats.conversionRate).toBeCloseTo(50);

    expect(getFollowUpQueueCounts()).toMatchObject({ stagnierend: 1, highValueRisk: 1 });
    for (const queue of ['stagnierende_deals', 'high_value_risk']) {
      expect(getFollowUpItems(queue).map((item: { deal_stage: string }) => item.deal_stage)).toEqual(['Angebot']);
    }
    // Task queues attach only an open deal of the customer.
    expect(getFollowUpItems('ueberfaellig').map((item: { deal_stage: string | null }) => item.deal_stage)).toEqual(['Angebot']);
  });
});
