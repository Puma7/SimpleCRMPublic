import { createImapFlowMock } from './helpers/imap-flow-mock';

const { ImapFlow, client } = createImapFlowMock();
jest.mock('imapflow', () => ({ ImapFlow }));

const mockGetAccount = jest.fn();
const mockGetFolder = jest.fn();
const mockResolveAuth = jest.fn();

jest.mock('../../electron/email/email-store', () => ({
  getEmailAccountById: (...a: unknown[]) => mockGetAccount(...a),
  getFolderById: (...a: unknown[]) => mockGetFolder(...a),
  setMessageSeenLocal: jest.fn(),
  clearMessageSeenSyncPending: jest.fn(),
}));
jest.mock('../../electron/email/email-imap-auth', () => ({
  resolveImapAuth: (...a: unknown[]) => mockResolveAuth(...a),
}));

import {
  accountWantsImapSeenSync,
  markMessageSeenWithOptionalServerSync,
  syncSeenFlagToServer,
} from '../../electron/email/email-imap-flags';
import { clearMessageSeenSyncPending, setMessageSeenLocal } from '../../electron/email/email-store';

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

describe('accountWantsImapSeenSync', () => {
  test('returns false when account missing or not imap', () => {
    mockGetAccount.mockReturnValue(undefined);
    expect(accountWantsImapSeenSync(1)).toBe(false);
    mockGetAccount.mockReturnValue({ protocol: 'pop3' });
    expect(accountWantsImapSeenSync(1)).toBe(false);
  });

  test('returns false when imap_sync_seen_on_open is disabled', () => {
    mockGetAccount.mockReturnValue({ protocol: 'imap', imap_sync_seen_on_open: 0 });
    expect(accountWantsImapSeenSync(1)).toBe(false);
  });

  test('returns true for imap accounts with seen sync enabled', () => {
    mockGetAccount.mockReturnValue({ protocol: 'imap', imap_sync_seen_on_open: 1 });
    expect(accountWantsImapSeenSync(1)).toBe(true);
    mockGetAccount.mockReturnValue({ protocol: 'imap' });
    expect(accountWantsImapSeenSync(1)).toBe(true);
  });
});

describe('markMessageSeenWithOptionalServerSync', () => {
  const row = { id: 9, account_id: 1, folder_id: 2, uid: 5, pop3_uidl: null as string | null };

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveAuth.mockResolvedValue({ user: 'u', pass: 'p' });
    mockGetAccount.mockReturnValue({
      protocol: 'imap',
      imap_host: 'h',
      imap_port: 993,
      imap_tls: 1,
      imap_sync_seen_on_open: 1,
    });
    mockGetFolder.mockReturnValue({ path: 'INBOX' });
  });

  test('sets pending flag and clears it after successful server sync', async () => {
    await markMessageSeenWithOptionalServerSync(row, true);
    expect(setMessageSeenLocal).toHaveBeenCalledWith(9, true, true);
    expect(client.messageFlagsAdd).toHaveBeenCalled();
    expect(clearMessageSeenSyncPending).toHaveBeenCalledWith(9);
  });

  test('skips server sync when account does not want seen sync', async () => {
    mockGetAccount.mockReturnValue({ protocol: 'pop3' });
    await markMessageSeenWithOptionalServerSync(row, true);
    expect(setMessageSeenLocal).toHaveBeenCalledWith(9, true, false);
    expect(ImapFlow).not.toHaveBeenCalled();
    expect(clearMessageSeenSyncPending).not.toHaveBeenCalled();
  });

  test('keeps pending flag when server sync fails', async () => {
    client.connect.mockRejectedValueOnce(new Error('offline'));
    await markMessageSeenWithOptionalServerSync(row, true);
    expect(setMessageSeenLocal).toHaveBeenCalledWith(9, true, true);
    expect(clearMessageSeenSyncPending).not.toHaveBeenCalled();
  });
});
