import { repeatedCidImageMail } from './helpers/cid-mime';
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
  withEmailAccountSyncLock: (_id: number, fn: (signal: AbortSignal) => Promise<unknown>) =>
    fn(new AbortController().signal),
  assertSyncNotAborted: jest.fn(),
  isEmailSyncAbortedError: jest.fn(() => false),
}));
jest.mock('../../electron/email/email-sync-post-process', () => ({
  processNewMessagesAfterSync: jest.fn().mockResolvedValue(undefined),
}));
const mockPersistAttachments = jest.fn().mockResolvedValue(undefined);
jest.mock('../../electron/email/email-message-attachments-store', () => ({
  persistParsedAttachments: (...args: unknown[]) => mockPersistAttachments(...args),
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

const { getEmailAccountById } = require('../../electron/email/email-store') as typeof import('../../electron/email/email-store');
const { syncInboxImap, testImapConnection } = require('../../electron/email/email-imap-sync') as typeof import('../../electron/email/email-imap-sync');

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

  test('syncInboxImap preserves local bodies during uid validity reset', async () => {
    (mockFolder as { last_uid: number; uidvalidity_str: string }).last_uid = 5;
    (mockFolder as { uidvalidity_str: string }).uidvalidity_str = '1';
    client.status.mockResolvedValueOnce({ uidValidity: 2, uidNext: 3005, messages: 3004 });
    stmt.get.mockReturnValueOnce({ c: 3004 });
    client.search.mockResolvedValueOnce([]);

    await syncInboxImap(1);

    const preparedSql = db.prepare.mock.calls.map(([sql]) => String(sql));
    expect(preparedSql).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/DELETE\s+FROM\s+email_messages\s+WHERE\s+folder_id/i),
      ]),
    );
    expect(preparedSql).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/SET\s+uid\s*=\s*-\(ABS\(id\)\s*\+\s*\(SELECT\s+v\s+FROM\s+negative_uid_offset\)\),[\s\S]*soft_deleted\s*=\s*0,[\s\S]*post_process_done\s*=\s*1/i),
      ]),
    );
    expect(mockRecordNotice).toHaveBeenCalledWith(expect.objectContaining({ messageCount: 3004 }));
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

  // F-A7b-04: Der Erst-Sync eines neuen Ordners lieferte bis zu 2000 Bestandsmails als
  // neu eingegangen an Workflows, KI-Vorschläge und Abwesenheitsantworten.
  test('syncInboxImap marks mail of a never-synced folder as historical', async () => {
    const { getFolderByAccountAndPath, insertOrUpdateEmailMessage } = await import('../../electron/email/email-store');
    const { processNewMessagesAfterSync } = await import('../../electron/email/email-sync-post-process');
    (getFolderByAccountAndPath as jest.Mock).mockReturnValueOnce(undefined);
    client.search.mockResolvedValueOnce([1, 2, 3]);
    client.fetchOne.mockResolvedValue({ source: Buffer.from('From: a@b.de\r\n\r\nx'), flags: new Set() });
    (insertOrUpdateEmailMessage as jest.Mock).mockReturnValue({ id: 99, isNew: true });

    await syncInboxImap(1);

    expect(processNewMessagesAfterSync).toHaveBeenCalledWith(
      1,
      expect.any(Array),
      10,
      expect.objectContaining({ runInboundWorkflows: true, historical: true }),
    );
  });

  test('syncInboxImap treats new mail of an empty but synced folder as live inbound', async () => {
    const { insertOrUpdateEmailMessage } = await import('../../electron/email/email-store');
    const { processNewMessagesAfterSync } = await import('../../electron/email/email-sync-post-process');
    Object.assign(mockFolder, { last_uid: 0, uidvalidity: 1, uidvalidity_str: '1' });
    client.search.mockResolvedValueOnce([1]);
    client.fetchOne.mockResolvedValue({ source: Buffer.from('From: a@b.de\r\n\r\nx'), flags: new Set() });
    (insertOrUpdateEmailMessage as jest.Mock).mockReturnValue({ id: 99, isNew: true });

    await syncInboxImap(1);

    expect(processNewMessagesAfterSync).toHaveBeenCalledWith(
      1,
      expect.any(Array),
      10,
      expect.objectContaining({ runInboundWorkflows: true, historical: false }),
    );
  });

  // F-A5-06 (Desktop-Paritaet): "UID n+1:*" liefert nach RFC 3501 immer die hoechste UID, auch wenn sie <= n ist; sie wurde bei jedem Poll neu geholt.
  test('syncInboxImap does not refetch the already synced highest uid', async () => {
    (mockFolder as { last_uid: number; uidvalidity: number; uidvalidity_str: string }).last_uid = 7;
    (mockFolder as { uidvalidity_str: string }).uidvalidity_str = '1';
    client.search.mockResolvedValueOnce([7]);

    const r = await syncInboxImap(1);

    expect(client.search).toHaveBeenCalledWith({ uid: '8:*' }, { uid: true });
    expect(client.fetchOne).not.toHaveBeenCalled();
    expect(r.fetched).toBe(0);
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

  // C-A71: simpleParser lief mit der Standard-CID-Expansion; ein vielfach referenziertes Inline-Bild blaehte body_html ohne Grenze auf.
  test('syncInboxImap stores html with a bounded cid image expansion', async () => {
    const { simpleParser } = jest.requireMock('mailparser') as { simpleParser: jest.Mock };
    const realSimpleParser = (jest.requireActual('mailparser') as typeof import('mailparser')).simpleParser;
    simpleParser.mockImplementationOnce((source: Buffer, options?: { keepCidLinks?: boolean }) =>
      realSimpleParser(source, options));
    const { source, html } = repeatedCidImageMail(100 * 1024, 200);
    Object.assign(mockFolder, { last_uid: 1, uidvalidity: 1, uidvalidity_str: '1' });
    client.search.mockResolvedValueOnce([2]);
    client.fetchOne.mockResolvedValueOnce({ source, flags: new Set() });
    const { insertOrUpdateEmailMessage } = await import('../../electron/email/email-store');
    (insertOrUpdateEmailMessage as jest.Mock).mockReturnValue({ id: 99, isNew: true });

    const r = await syncInboxImap(1);

    expect(r.fetched).toBe(1);
    const stored = (insertOrUpdateEmailMessage as jest.Mock).mock.calls[0]![0] as { bodyHtml: string };
    expect(stored.bodyHtml.length).toBeLessThanOrEqual(html.length + 16 * 1024 * 1024);
    expect(stored.bodyHtml).toContain('<img src="data:image/png;base64,');
    expect(stored.bodyHtml).toContain('<img src="cid:a">');
    expect(simpleParser).toHaveBeenCalledWith(source, { keepCidLinks: true });
  }, 30_000);

  // C-A59: Die dekodierten Anhaenge aller neuen Mails lagen bis zum Ende der Ordnerschleife in newAfterSync (bis 2000 Mails beim Erst-Sync).
  test('syncInboxImap stores attachments per message and hands no buffers to the post-process', async () => {
    const { simpleParser } = jest.requireMock('mailparser') as { simpleParser: jest.Mock };
    const { insertOrUpdateEmailMessage } = await import('../../electron/email/email-store');
    const { processNewMessagesAfterSync } = await import('../../electron/email/email-sync-post-process');
    const attachment = (n: number) => ({ filename: `a${n}.pdf`, contentType: 'application/pdf', content: Buffer.alloc(1024, n) });
    const parsedWith = (n: number) => ({ messageId: `<m${n}@x>`, subject: `S${n}`, text: 'x', attachments: [attachment(n)] });
    simpleParser.mockResolvedValueOnce(parsedWith(1)).mockResolvedValueOnce(parsedWith(2));
    Object.assign(mockFolder, { last_uid: 1, uidvalidity: 1, uidvalidity_str: '1' });
    client.search.mockResolvedValueOnce([2, 3]);
    client.fetchOne.mockResolvedValue({ source: Buffer.from('From: a@b.de\r\n\r\nx'), flags: new Set() });
    (insertOrUpdateEmailMessage as jest.Mock)
      .mockReturnValueOnce({ id: 21, isNew: true })
      .mockReturnValueOnce({ id: 22, isNew: true });

    const r = await syncInboxImap(1);

    expect(r.fetched).toBe(2);
    expect(mockPersistAttachments.mock.calls).toEqual([[21, [attachment(1)]], [22, [attachment(2)]]]);
    // Stored before the next message is inserted, not after the whole folder.
    expect(mockPersistAttachments.mock.invocationCallOrder[0])
      .toBeLessThan((insertOrUpdateEmailMessage as jest.Mock).mock.invocationCallOrder[1]!);
    const items = (processNewMessagesAfterSync as jest.Mock).mock.calls[0]![1] as { localMsgId: number; parsedAttachments: unknown }[];
    expect(items.map((i) => [i.localMsgId, i.parsedAttachments])).toEqual([[21, []], [22, []]]);
  });

  // C-A59: Scheitert das Speichern im Sync, holt die Nachverarbeitung die Anhaenge aus raw_rfc822_b64 nach, ohne die UID als Fehler zu zaehlen.
  test('syncInboxImap leaves attachments to the post-process recovery when storing fails', async () => {
    const { simpleParser } = jest.requireMock('mailparser') as { simpleParser: jest.Mock };
    const { insertOrUpdateEmailMessage } = await import('../../electron/email/email-store');
    const { processNewMessagesAfterSync } = await import('../../electron/email/email-sync-post-process');
    simpleParser.mockResolvedValueOnce({ messageId: '<m@x>', text: 'x', attachments: [{ filename: 'a.pdf', content: Buffer.from('pdf') }] });
    mockPersistAttachments.mockRejectedValueOnce(new Error('disk full'));
    Object.assign(mockFolder, { last_uid: 1, uidvalidity: 1, uidvalidity_str: '1' });
    client.search.mockResolvedValueOnce([2]);
    client.fetchOne.mockResolvedValue({ source: Buffer.from('From: a@b.de\r\n\r\nx'), flags: new Set() });
    (insertOrUpdateEmailMessage as jest.Mock).mockReturnValueOnce({ id: 31, isNew: true });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const r = await syncInboxImap(1);

    expect(r.fetched).toBe(1);
    expect(mockRecordFailure).not.toHaveBeenCalled();
    const items = (processNewMessagesAfterSync as jest.Mock).mock.calls[0]![1] as { localMsgId: number; parsedAttachments: unknown }[];
    expect(items).toEqual([expect.objectContaining({ localMsgId: 31, parsedAttachments: undefined })]);
    warn.mockRestore();
  });
});
