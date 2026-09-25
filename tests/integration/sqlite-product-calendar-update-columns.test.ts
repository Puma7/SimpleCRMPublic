/**
 * @jest-environment node
 */
jest.mock('electron', () => ({
  app: { getPath: () => `${process.cwd()}/.tmp-tests/simplecrm-product-calendar-update-columns` },
}));

import Database from 'better-sqlite3';
import {
  bootstrapFreshDatabaseSchema,
  closeDatabase,
  updateCalendarEvent,
  updateProduct,
} from '../../electron/sqlite-service';

describe('updateProduct / updateCalendarEvent column allowlist', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    bootstrapFreshDatabaseSchema(db, { keepDbAssigned: true });
    db.prepare("INSERT INTO products (id, name, description, price) VALUES (1, 'Widget', 'alt', 1), (2, 'Gadget', 'bleibt', 2)").run();
    db.prepare(`INSERT INTO calendar_events (id, title, description, start_date, end_date)
      VALUES (1, 'Termin', 'alt', '2026-01-01', '2026-01-01'), (2, 'Anderer', 'bleibt', '2026-01-02', '2026-01-02')`).run();
  });

  afterEach(() => {
    closeDatabase();
  });

  // N-ds-01 (vgl. F-A10-02): Objekt-Schluessel landeten ungeprueft als Spaltennamen im UPDATE-SQL von Produkt und Termin.
  test('updateProduct rejects keys that are not product columns', () => {
    expect(() => updateProduct(1, { 'description=(SELECT 42)--': 1 } as never)).toThrow();
    expect(() => updateProduct(1, { 'description=99 WHERE id>0/*': 1 } as never)).toThrow();

    expect(db.prepare('SELECT id, description FROM products ORDER BY id').all()).toEqual([
      { id: 1, description: 'alt' },
      { id: 2, description: 'bleibt' },
    ]);
  });

  test('updateCalendarEvent rejects keys that are not calendar columns', () => {
    expect(() => updateCalendarEvent(1, { 'description=(SELECT 42)--': 1 } as never)).toThrow();
    expect(() => updateCalendarEvent(1, { 'description=99 WHERE id>0/*': 1 } as never)).toThrow();

    expect(db.prepare('SELECT id, description FROM calendar_events ORDER BY id').all()).toEqual([
      { id: 1, description: 'alt' },
      { id: 2, description: 'bleibt' },
    ]);
  });

  test('regular product and calendar updates keep working', () => {
    expect(updateProduct(1, { name: 'Widget Pro', sku: null, description: 'neu', price: 5, isActive: false }).changes).toBe(1);
    expect(db.prepare('SELECT name, description, price, isActive FROM products WHERE id = 1').get())
      .toEqual({ name: 'Widget Pro', description: 'neu', price: 5, isActive: 0 });

    expect(updateCalendarEvent(1, {
      title: 'Neu',
      description: 'neu',
      start_date: '2026-02-01',
      end_date: '2026-02-01',
      all_day: true,
      color_code: '#fff',
      event_type: 'meeting',
      recurrence_rule: null,
    }).changes).toBe(1);
    expect(db.prepare('SELECT title, description, all_day FROM calendar_events WHERE id = 1').get())
      .toEqual({ title: 'Neu', description: 'neu', all_day: 1 });
    expect(db.prepare('SELECT description FROM calendar_events WHERE id = 2').get()).toEqual({ description: 'bleibt' });
  });
});
