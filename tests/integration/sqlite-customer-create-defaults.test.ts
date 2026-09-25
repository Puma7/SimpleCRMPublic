/**
 * @jest-environment node
 */
jest.mock('electron', () => ({
  app: { getPath: () => `${process.cwd()}/.tmp-tests/simplecrm-customer-create-defaults` },
}));

import Database from 'better-sqlite3';
import { bootstrapFreshDatabaseSchema, closeDatabase, createCustomer } from '../../electron/sqlite-service';
import { CustomerService } from '../../electron/services/customer-service';

describe('createCustomer with partial data', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    bootstrapFreshDatabaseSchema(db, { keepDbAssigned: true });
  });

  afterEach(() => {
    closeDatabase();
  });

  // F-A10-11: createCustomer band feste benannte Parameter; fehlte ein Feld im Body, warf better-sqlite3 "Missing named parameter".
  test('creates a customer from a minimal automation body', () => {
    const created = createCustomer({ name: 'Muster GmbH', email: 'a@b.de' });

    expect(created).toMatchObject({ name: 'Muster GmbH', email: 'a@b.de', status: 'Active', zip: '' });
    expect(db.prepare('SELECT firstName, phone, zipCode FROM customers WHERE id = ?').get(created.id)).toEqual({
      firstName: null,
      phone: null,
      zipCode: null,
    });
  });

  test('accepts the server field name zipCode as well as zip', () => {
    expect(createCustomer({ name: 'A', zipCode: '10115' })).toMatchObject({ zip: '10115' });
    expect(createCustomer({ name: 'B', zip: '20095' })).toMatchObject({ zip: '20095' });
  });

  test('POST /customers path (CustomerService.create) succeeds with only a name', () => {
    expect(CustomerService.create({ name: 'Nur Name' })).toMatchObject({ success: true });
  });
});
