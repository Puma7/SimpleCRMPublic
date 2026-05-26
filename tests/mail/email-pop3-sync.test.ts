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
  withEmailAccountSyncLock: (_id: number, fn: () => Promise<unknown>) => fn(),
}));
jest.mock('../../electron/email/email-sync-post-process', () => ({
  processNewMessagesAfterSync: jest.fn().mockResolvedValue(undefined),
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

import { getEmailAccountById } from '../../electron/email/email-store';
import { syncInboxPop3, testPop3Connection } from '../../electron/email/email-pop3-sync';

describe('email-pop3-sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUidl.mockResolvedValue([]);
    mockRetr.mockResolvedValue(Buffer.from('From: a@b.de\r\n\r\nbody'));
    mockQuit.mockResolvedValue(undefined);
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
    await expect(syncInboxPop3(1)).rejects.toThrow(/Passwort/);
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
});
