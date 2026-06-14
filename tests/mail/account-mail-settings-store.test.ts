import { createSqliteMock } from './helpers/sqlite-mock';

const { db, stmt } = createSqliteMock();
jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => db,
}));

import {
  allocateNextTicketCodeForAccount,
  listKnownTicketPrefixes,
} from '../../electron/email/account-mail-settings-store';

describe('account-mail-settings-store', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stmt.all.mockReturnValue([]);
    stmt.get.mockReturnValue(undefined);
    stmt.run.mockReturnValue({ changes: 1, lastInsertRowid: 1 });
  });

  test('allocateNextTicketCodeForAccount uses an immediate transaction', () => {
    stmt.get
      .mockReturnValueOnce({
        id: 1,
        display_name: 'Shop',
        email_address: 'shop@example.com',
      })
      .mockReturnValueOnce(undefined);

    const code = allocateNextTicketCodeForAccount(1);
    expect(code).toBe('SHOP-000001');
    expect(db.transaction).toHaveBeenCalledTimes(1);
    const tx = db.transaction.mock.results[0]?.value as (() => string) & { immediate?: () => string };
    expect(tx.immediate).toBeDefined();
    expect(stmt.run).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'SHOP',
      2,
      6,
      'shop',
      expect.any(String),
      expect.any(String),
    );
  });

  test('listKnownTicketPrefixes includes SCR and registered prefixes', () => {
    stmt.all.mockReturnValueOnce([{ ticket_prefix: 'shop-a' }, { ticket_prefix: 'SHOPB' }]);
    expect(listKnownTicketPrefixes()).toEqual(new Set(['SCR', 'SHOPA', 'SHOPB']));
  });
});
