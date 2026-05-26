import { createImapFlowMock } from './helpers/imap-flow-mock';

const { ImapFlow, client } = createImapFlowMock();
jest.mock('imapflow', () => ({ ImapFlow }));

const mockGetAccount = jest.fn();
const mockGetFolder = jest.fn();
const mockResolveAuth = jest.fn();

jest.mock('../../electron/email/email-store', () => ({
  getEmailAccountById: (...a: unknown[]) => mockGetAccount(...a),
  getFolderById: (...a: unknown[]) => mockGetFolder(...a),
}));
jest.mock('../../electron/email/email-imap-auth', () => ({
  resolveImapAuth: (...a: unknown[]) => mockResolveAuth(...a),
}));

import { syncSeenFlagToServer } from '../../electron/email/email-imap-flags';

describe('syncSeenFlagToServer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveAuth.mockResolvedValue({ user: 'u', pass: 'p' });
    mockGetAccount.mockReturnValue({
      protocol: 'imap',
      imap_host: 'h',
      imap_port: 993,
      imap_tls: 1,
    });
    mockGetFolder.mockReturnValue({ path: 'INBOX' });
  });

  test('no-op for pop3 uid or negative uid', async () => {
    await syncSeenFlagToServer({ account_id: 1, folder_id: 2, uid: -1, pop3_uidl: null }, true);
    await syncSeenFlagToServer({ account_id: 1, folder_id: 2, uid: 5, pop3_uidl: 'x' }, true);
    expect(ImapFlow).not.toHaveBeenCalled();
  });

  test('no-op when account missing or not imap', async () => {
    mockGetAccount.mockReturnValue(undefined);
    await syncSeenFlagToServer({ account_id: 1, folder_id: 2, uid: 5, pop3_uidl: null }, true);
    mockGetAccount.mockReturnValue({ protocol: 'pop3' });
    await syncSeenFlagToServer({ account_id: 1, folder_id: 2, uid: 5, pop3_uidl: null }, true);
    expect(ImapFlow).not.toHaveBeenCalled();
  });

  test('adds Seen flag with password auth', async () => {
    await syncSeenFlagToServer({ account_id: 1, folder_id: 2, uid: 5, pop3_uidl: null }, true);
    expect(client.messageFlagsAdd).toHaveBeenCalledWith({ uid: 5 }, ['\\Seen'], { uid: true });
    expect(client.logout).toHaveBeenCalled();
  });

  test('removes Seen with oauth token', async () => {
    mockResolveAuth.mockResolvedValue({ user: 'u', accessToken: 'tok' });
    await syncSeenFlagToServer({ account_id: 1, folder_id: 2, uid: 5, pop3_uidl: null }, false);
    expect(client.messageFlagsRemove).toHaveBeenCalled();
    expect(ImapFlow).toHaveBeenCalledWith(
      expect.objectContaining({ auth: { user: 'u', accessToken: 'tok' } }),
    );
  });

  test('ignores logout errors', async () => {
    client.logout.mockRejectedValueOnce(new Error('bye'));
    await syncSeenFlagToServer({ account_id: 1, folder_id: 2, uid: 5, pop3_uidl: null }, true);
    expect(client.connect).toHaveBeenCalled();
  });

  test('skips when folder path missing', async () => {
    mockGetFolder.mockReturnValue({ path: '' });
    await syncSeenFlagToServer({ account_id: 1, folder_id: 2, uid: 5, pop3_uidl: null }, true);
    expect(ImapFlow).not.toHaveBeenCalled();
  });
});
