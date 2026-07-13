import { createImapFlowMock } from './helpers/imap-flow-mock';
import { createSqliteMock } from './helpers/sqlite-mock';

const { ImapFlow, client } = createImapFlowMock();
jest.mock('imapflow', () => ({ ImapFlow }));

const mockGetSyncInfo = jest.fn((k: string) => (k === 'workflow_imap_delete_opt_in' ? 'true' : ''));
const mockSetSyncInfo = jest.fn();
const { db } = createSqliteMock();
jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => db,
  getSyncInfo: (...a: unknown[]) => mockGetSyncInfo(...(a as [string])),
  setSyncInfo: (...a: unknown[]) => mockSetSyncInfo(...a),
}));

const mockGetAccount = jest.fn();
const mockGetFolder = jest.fn();
const mockGetMessage = jest.fn();
const mockResolveAuth = jest.fn();

jest.mock('../../electron/email/email-store', () => ({
  getEmailAccountById: (...a: unknown[]) => mockGetAccount(...a),
  getFolderById: (...a: unknown[]) => mockGetFolder(...a),
  getEmailMessageById: (...a: unknown[]) => mockGetMessage(...a),
}));
jest.mock('../../electron/email/email-imap-auth', () => ({
  resolveImapAuth: (...a: unknown[]) => mockResolveAuth(...a),
}));

const {
  deleteImapMessageOnServer,
  isImapDeleteOptInEnabled,
  moveImapMessage,
  moveMessageToImapFolder,
  setImapDeleteOptIn,
} = require('../../electron/email/email-imap-move') as typeof import('../../electron/email/email-imap-move');

const imapAccount = {
  protocol: 'imap',
  imap_host: 'h',
  imap_port: 993,
  imap_tls: 1,
};
const msg = { id: 1, account_id: 2, folder_id: 3, uid: 10, pop3_uidl: null as string | null };

describe('email-imap-move', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSyncInfo.mockImplementation((k: string) => (k === 'workflow_imap_delete_opt_in' ? 'true' : ''));
    mockResolveAuth.mockResolvedValue({ user: 'u', pass: 'p' });
    mockGetAccount.mockReturnValue(imapAccount);
    mockGetFolder.mockReturnValue({ path: 'INBOX' });
    mockGetMessage.mockReturnValue(msg);
  });

  test('delete opt-in helpers', () => {
    mockGetSyncInfo.mockImplementation((k: string) => (k === 'workflow_imap_delete_opt_in' ? 'yes' : ''));
    expect(isImapDeleteOptInEnabled()).toBe(true);
    setImapDeleteOptIn(false);
    expect(mockSetSyncInfo).toHaveBeenCalledWith('workflow_imap_delete_opt_in', 'false');
  });

  test('moveImapMessage rejects pop3 and empty target', async () => {
    await expect(moveImapMessage({ ...msg, uid: -1 }, 'Trash')).rejects.toThrow(/POP3/);
    await expect(moveImapMessage(msg, '  ')).rejects.toThrow(/Zielordner/);
  });

  test('moveImapMessage connects and moves', async () => {
    await moveImapMessage(msg, 'Trash');
    expect(client.messageMove).toHaveBeenCalledWith({ uid: 10 }, 'Trash', { uid: true });
  });

  test('deleteImapMessageOnServer requires opt-in', async () => {
    mockGetSyncInfo.mockImplementation(() => '');
    await expect(deleteImapMessageOnServer(msg)).rejects.toThrow(/nicht aktiviert/);
  });

  test('deleteImapMessageOnServer deletes on server', async () => {
    await deleteImapMessageOnServer(msg);
    expect(client.messageDelete).toHaveBeenCalled();
  });

  test('moveMessageToImapFolder loads row', async () => {
    await moveMessageToImapFolder(1, 'Archive');
    expect(mockGetMessage).toHaveBeenCalledWith(1);
  });

  test('moveMessageToImapFolder throws when message missing', async () => {
    mockGetMessage.mockReturnValue(undefined);
    await expect(moveMessageToImapFolder(9, 'X')).rejects.toThrow(/nicht gefunden/);
  });

  test('oauth auth branch and logout error ignored', async () => {
    mockResolveAuth.mockResolvedValue({ user: 'u', accessToken: 't' });
    client.logout.mockRejectedValueOnce(new Error('x'));
    await moveImapMessage(msg, 'Trash');
    expect(ImapFlow).toHaveBeenCalledWith(
      expect.objectContaining({ auth: { user: 'u', accessToken: 't' } }),
    );
  });
});
