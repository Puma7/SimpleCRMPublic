import { createSqliteMock } from './helpers/sqlite-mock';

const { db, stmt } = createSqliteMock();
const mockAccount = {
  id: 1,
  email_address: 'user@test.de',
  display_name: 'User',
};

jest.mock('../../electron/sqlite-service', () => ({ getDb: () => db }));
jest.mock('../../electron/email/email-store', () => ({
  getEmailAccountById: jest.fn(() => mockAccount),
}));
jest.mock('electron-log', () => ({ warn: jest.fn() }));

import { getEmailAccountById } from '../../electron/email/email-store';
import {
  previewInboxArchiveRecovery,
  restoreInboxMessagesFromArchive,
  restoreInboxMessagesFromArchiveSafe,
} from '../../electron/email/email-inbox-recovery';

describe('email-inbox-recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stmt.get.mockReturnValue({ c: 2 });
    stmt.run.mockReturnValue({ changes: 2 });
  });

  test('previewInboxArchiveRecovery returns null for unknown account', () => {
    (getEmailAccountById as jest.Mock).mockReturnValueOnce(undefined);
    expect(previewInboxArchiveRecovery(1)).toBeNull();
  });

  test('previewInboxArchiveRecovery returns counts', () => {
    expect(previewInboxArchiveRecovery(1)).toEqual({
      accountId: 1,
      count: 2,
      accountEmail: 'user@test.de',
      accountLabel: 'User',
    });
  });

  test('restoreInboxMessagesFromArchiveSafe validates confirmation', async () => {
    expect(
      restoreInboxMessagesFromArchiveSafe({
        accountId: 1,
        expectedCount: 2,
        confirmPhrase: 'wrong',
      }),
    ).toEqual({ ok: false, error: expect.stringContaining('Bestätigung') });
  });

  test('restoreInboxMessagesFromArchiveSafe rejects count mismatch', () => {
    expect(
      restoreInboxMessagesFromArchiveSafe({
        accountId: 1,
        expectedCount: 99,
        confirmPhrase: 'user@test.de',
      }),
    ).toEqual({ ok: false, error: expect.stringContaining('Anzahl') });
  });

  test('restoreInboxMessagesFromArchiveSafe restores messages', () => {
    expect(
      restoreInboxMessagesFromArchiveSafe({
        accountId: 1,
        expectedCount: 2,
        confirmPhrase: 'user@test.de',
      }),
    ).toEqual({ ok: true, restored: 2 });
  });

  test('restoreInboxMessagesFromArchiveSafe zero count', () => {
    stmt.get.mockReturnValue({ c: 0 });
    expect(
      restoreInboxMessagesFromArchiveSafe({
        accountId: 1,
        expectedCount: 0,
        confirmPhrase: 'user@test.de',
      }),
    ).toEqual({ ok: true, restored: 0 });
  });

  test('restoreInboxMessagesFromArchiveSafe rejects too many messages', () => {
    stmt.get.mockReturnValue({ c: 20_000 });
    expect(
      restoreInboxMessagesFromArchiveSafe({
        accountId: 1,
        expectedCount: 20_000,
        confirmPhrase: 'user@test.de',
      }),
    ).toEqual({ ok: false, error: expect.stringContaining('Zu viele') });
  });

  test('restoreInboxMessagesFromArchive deprecated wrapper', () => {
    expect(restoreInboxMessagesFromArchive(1)).toBe(2);
    stmt.get.mockReturnValue({ c: 0 });
    expect(restoreInboxMessagesFromArchive(1)).toBe(0);
  });
});
