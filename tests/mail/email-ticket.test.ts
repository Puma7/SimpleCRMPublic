import { createSqliteMock } from './helpers/sqlite-mock';

const { db, stmt } = createSqliteMock();
jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => db,
}));

import {
  assignThreadAndTicketToMessage,
  ensureTicketInSubject,
  extractTicketFromSubject,
  generateTicketCode,
  getOrCreateThreadForTicket,
} from '../../electron/email/email-ticket';

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
    expect(id).toMatch(/^th-/);
    expect(stmt.run).toHaveBeenCalled();
  });

  test('getOrCreateThreadForTicket returns existing', () => {
    stmt.get.mockReturnValueOnce({ id: 'th-existing' });
    expect(getOrCreateThreadForTicket('SCR-ABCDEF')).toBe('th-existing');
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
