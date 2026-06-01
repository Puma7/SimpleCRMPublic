import { createImapFlowMock } from './helpers/imap-flow-mock';
import { createSqliteMock } from './helpers/sqlite-mock';

const { ImapFlow, client, lock } = createImapFlowMock();
jest.mock('imapflow', () => ({ ImapFlow }));

const { db, stmt } = createSqliteMock();
jest.mock('../../electron/sqlite-service', () => ({ getDb: () => db }));

const mockAccount = {
  id: 1,
  protocol: 'imap',
  imap_host: 'h',
  imap_port: 993,
  imap_tls: 1,
  imap_username: 'u@x.de',
  sent_folder_path: 'Sent',
  sync_spam_folder_path: null,
  sync_archive_folder_path: null,
  imap_sync_sent: 0,
  imap_sync_archive: 0,
  imap_sync_spam: 0,
};
const mockFolder = { id: 10, account_id: 1, path: 'INBOX', last_uid: 0, uidvalidity: 1, uidvalidity_str: '1' };

jest.mock('../../electron/email/email-store', () => ({
  getEmailAccountById: jest.fn(() => mockAccount),
  getFolderByAccountAndPath: jest.fn(() => mockFolder),
  upsertEmailFolder: jest.fn(() => mockFolder),
  updateFolderSyncState: jest.fn(),
  insertOrUpdateEmailMessage: jest.fn(() => ({ id: 99, isNew: true })),
  createImapUpsertContext: jest.fn(() => ({})),
}));
jest.mock('../../electron/email/email-imap-auth', () => ({
  resolveImapAuth: jest.fn().mockResolvedValue({ user: 'u', pass: 'p' }),
}));
jest.mock('../../electron/email/email-imap-auth-notice', () => ({
  clearImapAuthNotice: jest.fn(),
  maybeRecordImapAuthNotice: jest.fn(),
}));
jest.mock('../../electron/email/email-sync-mutex', () => ({
  withEmailAccountSyncLock: (_id: number, fn: () => Promise<unknown>) => fn(),
}));
jest.mock('../../electron/email/email-sync-post-process', () => ({
  processNewMessagesAfterSync: jest.fn().mockResolvedValue(undefined),
}));
const mockBackup = jest.fn(() => []);
const mockRecordNotice = jest.fn();
const mockRestoreMeta = jest.fn();
jest.mock('../../electron/email/email-uidvalidity-reset', () => ({
  backupFolderLocalMetaBeforeUidValidityReset: (...args: unknown[]) => mockBackup(...args),
  recordUidValidityResetNotice: (...args: unknown[]) => mockRecordNotice(...args),
  tryRestoreLocalMetaFromUidValidityBackup: (...args: unknown[]) => mockRestoreMeta(...args),
}));
const mockRecordFailure = jest.fn(() => 1);
const mockShouldSkip = jest.fn(() => false);
const mockClearFailure = jest.fn();
jest.mock('../../electron/email/imap-uid-failure', () => ({
  clearImapUidFetchFailure: (...args: unknown[]) => mockClearFailure(...args),
  recordImapUidFetchFailure: (...args: unknown[]) => mockRecordFailure(...args),
  shouldSkipImapUidAfterFailures: (...args: unknown[]) => mockShouldSkip(...args),
  IMAP_UID_MAX_FAILURES: 3,
}));
jest.mock('mailparser', () => ({
  simpleParser: jest.fn().mockResolvedValue({
    messageId: '<m@x>',
    subject: 'Hi',
    from: { value: [{ address: 'a@b.de' }] },
    to: { value: [] },
    cc: { value: [] },
    date: new Date(),
    text: 'body',
    html: null,
    attachments: [],
    headers: new Map(),
  }),
}));

import { getEmailAccountById } from '../../electron/email/email-store';
import { syncInboxImap, testImapConnection } from '../../electron/email/email-imap-sync';

describe('email-imap-sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    client.status.mockResolvedValue({ uidValidity: 1, uidNext: 10, messages: 1 });
    client.search.mockResolvedValue([]);
    client.fetch.mockReturnValue((async function* () {})());
    stmt.get.mockReturnValue({ c: 0 });
    stmt.run.mockReturnValue({ changes: 1 });
  });

  test('testImapConnection ok and errors', async () => {
    const ok = await testImapConnection(
      { imap_host: 'h', imap_port: 993, imap_tls: 1, imap_username: 'u' } as never,
      'pass',
    );
    expect(ok.ok).toBe(true);
    const bad = await testImapConnection(
      { imap_host: 'h', imap_port: 993, imap_tls: 1, imap_username: 'u' } as never,
      '  ',
    );
    expect(bad.ok).toBe(false);
    client.connect.mockRejectedValueOnce(new Error('auth fail'));
    const fail = await testImapConnection(
      { imap_host: 'h', imap_port: 993, imap_tls: 1, imap_username: 'u' } as never,
      'pass',
    );
    expect(fail.ok).toBe(false);
  });

  test('syncInboxImap throws for unknown account', async () => {
    (getEmailAccountById as jest.Mock).mockReturnValueOnce(undefined);
    await expect(syncInboxImap(1)).rejects.toThrow(/Unbekanntes/);
  });

  test('syncInboxImap throws for pop3 account', async () => {
    (getEmailAccountById as jest.Mock).mockReturnValueOnce({ ...mockAccount, protocol: 'pop3' });
    await expect(syncInboxImap(1)).rejects.toThrow(/POP3/);
  });

  test('syncInboxImap completes empty inbox', async () => {
    const r = await syncInboxImap(1);
    expect(r.fetched).toBe(0);
    expect(client.connect).toHaveBeenCalled();
    expect(lock.release).toHaveBeenCalled();
  });

  test('syncInboxImap uses oauth access token auth', async () => {
    const { resolveImapAuth } = await import('../../electron/email/email-imap-auth');
    (resolveImapAuth as jest.Mock).mockResolvedValueOnce({ user: 'u', accessToken: 'tok' });
    await syncInboxImap(1);
    expect(ImapFlow).toHaveBeenCalledWith(expect.objectContaining({ auth: { user: 'u', accessToken: 'tok' } }));
  });

  test('syncInboxImap handles uid validity reset and fetches messages', async () => {
    (mockFolder as { last_uid: number; uidvalidity_str: string }).last_uid = 5;
    (mockFolder as { uidvalidity_str: string }).uidvalidity_str = '1';
    client.status.mockResolvedValueOnce({ uidValidity: 2, uidNext: 20, messages: 2 });
    stmt.get.mockReturnValueOnce({ c: 3 });
    mockBackup.mockReturnValueOnce([{ message_id: '<m@x>', uid: 1, tags: [], category_ids: [], workflow_ids: [] }]);
    client.search.mockResolvedValueOnce([6, 7]);
    client.fetchOne.mockResolvedValue({
      source: Buffer.from('From: a@b.de\r\n\r\nHello'),
      flags: new Set(['\\Seen']),
      threadId: 't1',
    });
    const { insertOrUpdateEmailMessage } = await import('../../electron/email/email-store');
    (insertOrUpdateEmailMessage as jest.Mock).mockReturnValue({ id: 50, isNew: true });
    const r = await syncInboxImap(1);
    expect(r.fetched).toBe(2);
    expect(mockRecordNotice).toHaveBeenCalled();
    expect(mockRestoreMeta).toHaveBeenCalled();
  });

  test('syncInboxImap first sync selects newest uids only', async () => {
    (mockFolder as { last_uid: number }).last_uid = 0;
    const many = Array.from({ length: 5 }, (_, i) => i + 1);
    client.search.mockResolvedValueOnce(many);
    client.fetchOne.mockResolvedValue({
      source: Buffer.from('From: a@b.de\r\n\r\nx'),
      flags: new Set(),
    });
    const { insertOrUpdateEmailMessage } = await import('../../electron/email/email-store');
    (insertOrUpdateEmailMessage as jest.Mock).mockReturnValue({ id: 1, isNew: false });
    await syncInboxImap(1);
    expect(client.search).toHaveBeenCalledWith({ all: true }, { uid: true });
  });

  test('syncInboxImap skips uid after repeated failures', async () => {
    (mockFolder as { last_uid: number }).last_uid = 1;
    client.search.mockResolvedValueOnce([2]);
    mockShouldSkip.mockReturnValueOnce(true);
    const r = await syncInboxImap(1);
    expect(r.fetched).toBe(0);
    expect(client.fetchOne).not.toHaveBeenCalled();
  });

  test('syncInboxImap records per-message fetch failure', async () => {
    (mockFolder as { last_uid: number }).last_uid = 1;
    client.search.mockResolvedValueOnce([2]);
    client.fetchOne.mockRejectedValueOnce(new Error('fetch fail'));
    mockRecordFailure.mockReturnValueOnce(3);
    mockShouldSkip.mockReturnValueOnce(false).mockReturnValueOnce(true);
    await syncInboxImap(1);
    expect(mockRecordFailure).toHaveBeenCalled();
  });
});
