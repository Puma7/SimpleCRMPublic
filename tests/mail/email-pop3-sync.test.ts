import { repeatedCidImageMail } from './helpers/cid-mime';

const mockGetSyncInfo = jest.fn(() => null as string | null);
const mockSetSyncInfo = jest.fn();
const mockAssertInboundRfc822Size = jest.fn();

jest.mock('@simplecrm/core', () => ({
  ...jest.requireActual('@simplecrm/core'),
  assertInboundRfc822Size: (...args: unknown[]) => mockAssertInboundRfc822Size(...args),
}));

jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => ({
    prepare: () => ({
      run: jest.fn(),
      get: jest.fn(),
      all: jest.fn(() => []),
    }),
  }),
  getSyncInfo: (...args: unknown[]) => mockGetSyncInfo(...args),
  setSyncInfo: (...args: unknown[]) => mockSetSyncInfo(...args),
  deleteSyncInfo: jest.fn(),
}));

const mockUidl = jest.fn();
const mockRetr = jest.fn();
const mockQuit = jest.fn();

class Pop3ClientMock {
  UIDL = mockUidl;
  RETR = mockRetr;
  QUIT = mockQuit;
}

jest.mock('node-pop3', () => Pop3ClientMock);

const mockAccount = {
  id: 1,
  protocol: 'pop3',
  imap_host: 'pop.example.com',
  imap_username: 'u@x.de',
  pop3_host: null,
  pop3_port: 995,
  pop3_tls: 1,
  keytar_account_key: 'k',
};
const mockFolder = { id: 10, account_id: 1, path: 'INBOX', last_uid: 0 };

jest.mock('../../electron/email/email-store', () => ({
  getEmailAccountById: jest.fn(() => mockAccount),
  getFolderByAccountAndPath: jest.fn(() => mockFolder),
  upsertEmailFolder: jest.fn(() => mockFolder),
  updateFolderSyncState: jest.fn(),
  insertOrUpdateEmailMessage: jest.fn(() => ({ id: 50, isNew: true })),
  loadPop3UidlsForFolder: jest.fn(() => new Set<string>()),
  createPop3UpsertContext: jest.fn(() => ({ pop3UidlToId: new Map(), nextPop3Uid: -1_000_000 })),
}));
jest.mock('../../electron/email/email-keytar', () => ({
  getEmailPassword: jest.fn().mockResolvedValue('pw'),
}));
jest.mock('../../electron/email/email-imap-auth', () => ({
  resolveImapAuth: jest.fn().mockRejectedValue(new Error('no oauth')),
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
jest.mock('mailparser', () => ({
  simpleParser: jest.fn().mockResolvedValue({
    messageId: '<p@x>',
    subject: 'Pop',
    from: { value: [{ address: 'a@b.de' }] },
    to: { value: [] },
    date: new Date(),
    text: 't',
    attachments: [],
    headers: new Map(),
  }),
}));

const { getEmailAccountById } = require('../../electron/email/email-store') as typeof import('../../electron/email/email-store');
const { syncInboxPop3, testPop3Connection } = require('../../electron/email/email-pop3-sync') as typeof import('../../electron/email/email-pop3-sync');

describe('email-pop3-sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUidl.mockResolvedValue([]);
    mockRetr.mockResolvedValue(Buffer.from('From: a@b.de\r\n\r\nbody'));
    mockQuit.mockResolvedValue(undefined);
    mockGetSyncInfo.mockReturnValue(null);
    mockAssertInboundRfc822Size.mockImplementation(() => undefined);
  });

  test('testPop3Connection succeeds with mocked client', async () => {
    const r = await testPop3Connection(
      {
        imap_username: 'u',
        pop3_host: 'p',
        pop3_port: 995,
        pop3_tls: 1,
        imap_host: 'p',
      } as never,
      'secret',
    );
    expect(r.ok).toBe(true);
  });

  test('throws for unknown account', async () => {
    (getEmailAccountById as jest.Mock).mockReturnValueOnce(undefined);
    await expect(syncInboxPop3(1)).rejects.toThrow(/Unbekanntes/);
  });

  test('throws for imap account', async () => {
    (getEmailAccountById as jest.Mock).mockReturnValueOnce({ ...mockAccount, protocol: 'imap' });
    await expect(syncInboxPop3(1)).rejects.toThrow(/kein POP3/);
  });

  test('sync completes with no new messages', async () => {
    const r = await syncInboxPop3(1);
    expect(r.fetched).toBe(0);
    expect(mockUidl).toHaveBeenCalled();
  });

  test('fetches new uidl messages', async () => {
    mockUidl.mockResolvedValue([['1', 'uidl-a']]);
    const r = await syncInboxPop3(1);
    expect(r.fetched).toBe(1);
    expect(mockRetr).toHaveBeenCalledWith(1);
  });

  // F-A7b-04: Der Erst-Sync eines POP3-Postfachs (unbegrenzt) lief komplett durch
  // Inbound-Workflows, KI-Vorschläge und Abwesenheitsantworten.
  test('marks mail as historical while no UIDL of the mailbox is known yet', async () => {
    const { processNewMessagesAfterSync } = await import('../../electron/email/email-sync-post-process');
    mockUidl.mockResolvedValue([['1', 'uidl-old-1'], ['2', 'uidl-old-2']]);

    await syncInboxPop3(1);

    expect(processNewMessagesAfterSync).toHaveBeenCalledWith(
      1,
      expect.any(Array),
      10,
      expect.objectContaining({ historical: true }),
    );
  });

  test('treats new mail as live inbound once the mailbox was synced before', async () => {
    const { getFolderByAccountAndPath } = await import('../../electron/email/email-store');
    const { processNewMessagesAfterSync } = await import('../../electron/email/email-sync-post-process');
    // Leeres Postfach, aber schon synchronisiert: die UIDL-Liste ist gespeichert.
    (getFolderByAccountAndPath as jest.Mock).mockReturnValueOnce({ ...mockFolder, pop3_uidl_str: '[]' });
    mockUidl.mockResolvedValue([['1', 'uidl-new']]);

    await syncInboxPop3(1);

    expect(processNewMessagesAfterSync).toHaveBeenCalledWith(
      1,
      expect.any(Array),
      10,
      expect.objectContaining({ historical: false }),
    );
  });

  test('testPop3Connection returns error on failure', async () => {
    mockUidl.mockRejectedValueOnce(new Error('auth failed'));
    const r = await testPop3Connection(
      {
        imap_username: 'u',
        pop3_host: 'p',
        pop3_port: 995,
        pop3_tls: 1,
        imap_host: 'p',
      } as never,
      'pw',
    );
    expect(r.ok).toBe(false);
  });

  test('sync skips known uidl and handles retr errors', async () => {
    const { loadPop3UidlsForFolder } = await import('../../electron/email/email-store');
    (loadPop3UidlsForFolder as jest.Mock).mockReturnValueOnce(new Set(['uidl-known']));
    mockUidl.mockResolvedValue([
      ['1', 'uidl-known'],
      ['2', 'uidl-new'],
    ]);
    mockRetr.mockResolvedValueOnce(Buffer.from('From: a@b.de\r\n\r\nx'));
    const r = await syncInboxPop3(1);
    expect(r.fetched).toBe(1);
  });

  test('sync throws without password when auth and keytar fail', async () => {
    const { resolveImapAuth } = await import('../../electron/email/email-imap-auth');
    const { getEmailPassword } = await import('../../electron/email/email-keytar');
    (resolveImapAuth as jest.Mock).mockRejectedValueOnce(new Error('no oauth'));
    (getEmailPassword as jest.Mock).mockResolvedValueOnce('');
    await expect(syncInboxPop3(1)).rejects.toThrow(/no oauth|Passwort/);
  });

  test('sync creates folder when missing', async () => {
    const { getFolderByAccountAndPath, upsertEmailFolder } = await import('../../electron/email/email-store');
    (getFolderByAccountAndPath as jest.Mock).mockReturnValueOnce(undefined);
    (upsertEmailFolder as jest.Mock).mockReturnValueOnce(mockFolder);
    await syncInboxPop3(1);
    expect(upsertEmailFolder).toHaveBeenCalled();
  });

  test('sync logs and skips message when retr fails', async () => {
    mockUidl.mockResolvedValue([['3', 'uidl-fail']]);
    mockRetr.mockRejectedValueOnce(new Error('retr fail'));
    const r = await syncInboxPop3(1);
    expect(r.fetched).toBe(0);
  });

  test('sync remembers oversized UIDLs and does not retrieve them again', async () => {
    let persisted: string | null = null;
    mockGetSyncInfo.mockImplementation(() => persisted);
    mockSetSyncInfo.mockImplementation((_key: string, value: string) => {
      persisted = value;
    });
    mockUidl.mockResolvedValue([['4', 'uidl-oversized']]);
    mockAssertInboundRfc822Size.mockImplementation(() => {
      const { InboundMessageTooLargeError } = jest.requireActual('@simplecrm/core');
      throw new InboundMessageTooLargeError(81, 80);
    });

    await syncInboxPop3(1);
    await syncInboxPop3(1);

    expect(mockRetr).toHaveBeenCalledTimes(1);
    expect(persisted).toBe(JSON.stringify(['uidl-oversized']));
  });

  // C-A71: simpleParser lief mit der Standard-CID-Expansion; ein vielfach referenziertes Inline-Bild blaehte body_html ohne Grenze auf.
  test('stores html with a bounded cid image expansion', async () => {
    const { simpleParser } = jest.requireMock('mailparser') as { simpleParser: jest.Mock };
    const realSimpleParser = (jest.requireActual('mailparser') as typeof import('mailparser')).simpleParser;
    simpleParser.mockImplementationOnce((source: Buffer, options?: { keepCidLinks?: boolean }) =>
      realSimpleParser(source, options));
    const { source, html } = repeatedCidImageMail(100 * 1024, 200);
    mockUidl.mockResolvedValue([['1', 'uidl-cid']]);
    mockRetr.mockResolvedValueOnce(source);
    const { insertOrUpdateEmailMessage } = await import('../../electron/email/email-store');

    const r = await syncInboxPop3(1);

    expect(r.fetched).toBe(1);
    const stored = (insertOrUpdateEmailMessage as jest.Mock).mock.calls[0]![0] as { bodyHtml: string };
    expect(stored.bodyHtml.length).toBeLessThanOrEqual(html.length + 16 * 1024 * 1024);
    expect(stored.bodyHtml).toContain('<img src="data:image/png;base64,');
    expect(stored.bodyHtml).toContain('<img src="cid:a">');
    expect(simpleParser).toHaveBeenCalledWith(source, { keepCidLinks: true });
  }, 30_000);

  // C-A59: Die dekodierten Anhaenge aller neuen Mails lagen bis zum Ende der Schleife in newAfterSync (ohne Mengengrenze).
  test('stores attachments per message and hands no buffers to the post-process', async () => {
    const { simpleParser } = jest.requireMock('mailparser') as { simpleParser: jest.Mock };
    const { insertOrUpdateEmailMessage } = await import('../../electron/email/email-store');
    const { processNewMessagesAfterSync } = await import('../../electron/email/email-sync-post-process');
    const attachment = (n: number) => ({ filename: `a${n}.pdf`, contentType: 'application/pdf', content: Buffer.alloc(1024, n) });
    const parsedWith = (n: number) => ({ messageId: `<p${n}@x>`, subject: `P${n}`, text: 't', attachments: [attachment(n)] });
    simpleParser.mockResolvedValueOnce(parsedWith(1)).mockResolvedValueOnce(parsedWith(2));
    mockUidl.mockResolvedValue([['1', 'uidl-att-1'], ['2', 'uidl-att-2']]);
    (insertOrUpdateEmailMessage as jest.Mock)
      .mockReturnValueOnce({ id: 61, isNew: true })
      .mockReturnValueOnce({ id: 62, isNew: true });

    const r = await syncInboxPop3(1);

    expect(r.fetched).toBe(2);
    expect(mockPersistAttachments.mock.calls).toEqual([[61, [attachment(1)]], [62, [attachment(2)]]]);
    // Stored before the next message is inserted, not after the whole mailbox.
    expect(mockPersistAttachments.mock.invocationCallOrder[0])
      .toBeLessThan((insertOrUpdateEmailMessage as jest.Mock).mock.invocationCallOrder[1]!);
    const items = (processNewMessagesAfterSync as jest.Mock).mock.calls[0]![1] as { localMsgId: number; parsedAttachments: unknown }[];
    expect(items.map((i) => [i.localMsgId, i.parsedAttachments])).toEqual([[61, []], [62, []]]);
  });

  // C-A59: Scheitert das Speichern im Sync, holt die Nachverarbeitung die Anhaenge aus raw_rfc822_b64 nach; die Mail bleibt abgerufen.
  test('leaves attachments to the post-process recovery when storing fails', async () => {
    const { simpleParser } = jest.requireMock('mailparser') as { simpleParser: jest.Mock };
    const { insertOrUpdateEmailMessage } = await import('../../electron/email/email-store');
    const { processNewMessagesAfterSync } = await import('../../electron/email/email-sync-post-process');
    simpleParser.mockResolvedValueOnce({ messageId: '<p@x>', text: 't', attachments: [{ filename: 'a.pdf', content: Buffer.from('pdf') }] });
    mockPersistAttachments.mockRejectedValueOnce(new Error('disk full'));
    mockUidl.mockResolvedValue([['1', 'uidl-att-fail']]);
    (insertOrUpdateEmailMessage as jest.Mock).mockReturnValueOnce({ id: 71, isNew: true });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const r = await syncInboxPop3(1);

    expect(r.fetched).toBe(1);
    const items = (processNewMessagesAfterSync as jest.Mock).mock.calls[0]![1] as { localMsgId: number; parsedAttachments: unknown }[];
    expect(items).toEqual([expect.objectContaining({ localMsgId: 71, parsedAttachments: undefined })]);
    warn.mockRestore();
  });
});
