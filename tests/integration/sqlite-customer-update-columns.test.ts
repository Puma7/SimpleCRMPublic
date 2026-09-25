/**
 * @jest-environment node
 */
jest.mock('electron', () => ({
  app: { getPath: () => `${process.cwd()}/.tmp-tests/simplecrm-customer-update-columns` },
}));

import Database from 'better-sqlite3';
import {
  bootstrapFreshDatabaseSchema,
  closeDatabase,
  getCustomerById,
  updateCustomer,
} from '../../electron/sqlite-service';

describe('updateCustomer column allowlist', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    bootstrapFreshDatabaseSchema(db, { keepDbAssigned: true });
    db.prepare("INSERT INTO customers (id, name, notes) VALUES (1, 'Ada', 'alt')").run();
    db.prepare("INSERT INTO customers (id, name, notes) VALUES (2, 'Bob', 'bleibt')").run();
  });

  afterEach(() => {
    closeDatabase();
  });

  // F-A10-02: Objekt-Schlüssel landeten ungeprüft als Spaltennamen im UPDATE-SQL (SQL-Injection über Automation-API/IPC).
  test('rejects keys that are not customer columns instead of interpolating them into SQL', () => {
    const injected = { 'notes=(SELECT 42)--': 1, name: 'x' } as Record<string, unknown>;

    let thrown: unknown;
    try {
      updateCustomer(1, injected);
    } catch (error) {
      thrown = error;
    }

    const row = db.prepare('SELECT name, notes FROM customers WHERE id = 1').get() as { name: string; notes: string };
    expect(row.notes).toBe('alt');
    expect(row.name).toBe('Ada');
    expect(thrown).toBeInstanceOf(Error);
  });

  test('a crafted key cannot replace the WHERE clause and hit other rows', () => {
    // An unterminated block comment swallows the trailing `WHERE id = @id`.
    const injected = { 'notes=99 WHERE id>0/*': 1 } as Record<string, unknown>;

    expect(() => updateCustomer(1, injected)).toThrow();

    const rows = db.prepare('SELECT id, notes FROM customers ORDER BY id').all();
    expect(rows).toEqual([
      { id: 1, notes: 'alt' },
      { id: 2, notes: 'bleibt' },
    ]);
  });

  test('keeps updating regular columns, zip alias and ignores id/jtl_kKunde', () => {
    const before = getCustomerById(1);

    const updated = updateCustomer(1, {
      ...before,
      name: 'Ada Lovelace',
      notes: 'neu',
      zip: '10115',
      id: 2,
      jtl_kKunde: 777,
    });

    expect(updated).toMatchObject({ id: 1, name: 'Ada Lovelace', notes: 'neu', zip: '10115', jtl_kKunde: null });
    const other = db.prepare('SELECT name, notes FROM customers WHERE id = 2').get();
    expect(other).toEqual({ name: 'Bob', notes: 'bleibt' });
  });
});
