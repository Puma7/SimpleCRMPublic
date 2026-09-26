/**
 * @jest-environment node
 */
jest.mock('electron', () => ({
  app: { getPath: () => `${process.cwd()}/.tmp-tests/simplecrm-customer-delete` },
}));

import Database from 'better-sqlite3';
import {
  bootstrapFreshDatabaseSchema,
  closeDatabase,
  deleteCustomer,
} from '../../electron/sqlite-service';

// F-A10-10: deleting a customer silently cascaded to all of its deals (with
// positions), tasks and their calendar entries. It now refuses while such
// records exist and only cascades after an explicit confirmation.
describe('SQLite customer delete with dependent records', () => {
  let db: Database.Database;

  const count = (sql: string) => (db.prepare(sql).get() as { count: number }).count;

  beforeEach(() => {
    db = new Database(':memory:');
    bootstrapFreshDatabaseSchema(db, { keepDbAssigned: true });
    db.prepare("INSERT INTO customers (id, name) VALUES (1, 'Ada'), (2, 'Ohne Daten')").run();
    db.prepare("INSERT INTO products (id, name, price) VALUES (1, 'Produkt', 10)").run();
    db.prepare("INSERT INTO deals (id, customer_id, name, value, stage) VALUES (1, 1, 'Deal', 10, 'Angebot')").run();
    db.prepare('INSERT INTO deal_products (deal_id, product_id, quantity, price_at_time_of_adding) VALUES (1, 1, 1, 10)').run();
    db.prepare("INSERT INTO tasks (id, customer_id, title, priority) VALUES (1, 1, 'Anrufen', 'High')").run();
    db.prepare(`INSERT INTO calendar_events (id, title, start_date, end_date, task_id)
      VALUES (1, 'Anrufen', '2026-07-01T09:00:00.000Z', '2026-07-01T10:00:00.000Z', 1)`).run();
  });

  afterEach(() => {
    closeDatabase();
  });

  test('refuses without confirmation and reports the dependent records', () => {
    expect(() => deleteCustomer(1)).toThrow(expect.objectContaining({
      code: 'customer_has_dependents',
      dependents: { deals: 1, tasks: 1, appointments: 1 },
    }));

    expect(count('SELECT COUNT(*) AS count FROM customers WHERE id = 1')).toBe(1);
    expect(count('SELECT COUNT(*) AS count FROM deals WHERE customer_id = 1')).toBe(1);
    expect(count('SELECT COUNT(*) AS count FROM tasks WHERE customer_id = 1')).toBe(1);
    expect(count('SELECT COUNT(*) AS count FROM calendar_events')).toBe(1);
  });

  test('deletes a customer without dependents directly and cascades after confirmation', () => {
    expect(deleteCustomer(2)).toBe(true);

    expect(deleteCustomer(1, { cascade: true })).toBe(true);
    expect(count('SELECT COUNT(*) AS count FROM customers')).toBe(0);
    expect(count('SELECT COUNT(*) AS count FROM deals')).toBe(0);
    expect(count('SELECT COUNT(*) AS count FROM deal_products')).toBe(0);
    expect(count('SELECT COUNT(*) AS count FROM tasks')).toBe(0);
    expect(count('SELECT COUNT(*) AS count FROM calendar_events')).toBe(0);
  });
});
