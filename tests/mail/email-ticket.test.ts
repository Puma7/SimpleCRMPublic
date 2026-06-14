import { createSqliteMock } from './helpers/sqlite-mock';

const { db, stmt } = createSqliteMock();
jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => db,
}));

import {
  assignThreadAndTicketToMessage,
  createTicketCodeForAccount,
  ensureTicketInSubject,
  extractKnownTicketFromSubject,
  extractTicketFromSubject,
  generateTicketCode,
  getOrCreateThreadForTicket,
} from '../../electron/email/email-ticket';

jest.mock('../../electron/email/account-mail-settings-store', () => ({
  allocateNextTicketCodeForAccount: jest.fn(() => 'SHOP-000001'),
  listKnownTicketPrefixes: jest.fn(() => new Set(['SCR', 'SHOP'])),
}));

describe('email-ticket', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stmt.get.mockReturnValue(undefined);
    stmt.run.mockReturnValue({ changes: 1, lastInsertRowid: 1 });
  });

  test('generateTicketCode and extractTicketFromSubject', () => {
    const code = generateTicketCode();
    expect(code).toMatch(/^SCR-[A-F0-9]+$/);
    const subj = ensureTicketInSubject('Hello', code);
    expect(subj).toContain(`[${code}]`);
    expect(extractTicketFromSubject(subj)).toBe(code);
    expect(extractTicketFromSubject(null)).toBeNull();
  });

  test('getOrCreateThreadForTicket inserts when missing', () => {
    stmt.get.mockReturnValueOnce(undefined);
    const id = getOrCreateThreadForTicket('SCR-ABCDEF');
    expect(id).toMatch(/^th-[a-f0-9]{24}$/);
    expect(id).not.toMatch(/th-\d+-/);
    expect(stmt.run).toHaveBeenCalled();
  });

  test('getOrCreateThreadForTicket returns existing', () => {
    stmt.get.mockReturnValueOnce({ id: 'th-existing' });
    expect(getOrCreateThreadForTicket('SCR-ABCDEF')).toBe('th-existing');
  });

  test('extractKnownTicketFromSubject ignores third-party prefixes', () => {
    expect(extractKnownTicketFromSubject('[JIRA-1234] Deploy failed')).toBeNull();
    expect(extractKnownTicketFromSubject('[SHOP-000042] Order')).toBe('SHOP-000042');
  });

  test('createTicketCodeForAccount rethrows unexpected allocation errors', () => {
    const { allocateNextTicketCodeForAccount } = jest.requireMock(
      '../../electron/email/account-mail-settings-store',
    ) as { allocateNextTicketCodeForAccount: jest.Mock };
    allocateNextTicketCodeForAccount.mockImplementationOnce(() => {
      throw new Error('Konto nicht gefunden.');
    });
    expect(() => createTicketCodeForAccount(9)).toThrow('Konto nicht gefunden.');
  });

  test('createTicketCodeForAccount falls back only when settings table is unavailable', () => {
    const { allocateNextTicketCodeForAccount } = jest.requireMock(
      '../../electron/email/account-mail-settings-store',
    ) as { allocateNextTicketCodeForAccount: jest.Mock };
    allocateNextTicketCodeForAccount.mockImplementationOnce(() => {
      throw new Error('no such table: email_account_mail_settings');
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const code = createTicketCodeForAccount(9);
    expect(code).toMatch(/^SCR-[A-F0-9]+$/);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test('assignThreadAndTicketToMessage updates message', () => {
    assignThreadAndTicketToMessage(9, {
      subject: '[SCR-123456] Hi',
      inReplyTo: null,
      referencesHeader: null,
    });
    expect(stmt.run).toHaveBeenCalled();
  });
});

describe('account-specific ticket namespaces', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stmt.get.mockReturnValue(undefined);
    stmt.run.mockReturnValue({ changes: 1, lastInsertRowid: 1 });
  });

  test('generates account-specific prefix and sequence numbers', () => {
    expect(generateTicketCode({ prefix: 'shopA', sequence: 42 })).toBe('SHOPA-42');
    expect(generateTicketCode({ prefix: 'Shop-B', sequence: '0007' })).toBe('SHOPB-0007');
  });

  test('thread lookup is namespaced by account id', () => {
    getOrCreateThreadForTicket('SHOPA-1', 1);
    getOrCreateThreadForTicket('SHOPA-1', 2);
    expect(stmt.run).toHaveBeenNthCalledWith(1, expect.any(String), 'SHOPA-1', 1);
    expect(stmt.run).toHaveBeenNthCalledWith(2, expect.any(String), 'SHOPA-1', 2);
  });
});
