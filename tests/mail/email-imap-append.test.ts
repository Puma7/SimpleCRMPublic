import { createImapFlowMock } from './helpers/imap-flow-mock';

const { ImapFlow, client } = createImapFlowMock();
jest.mock('imapflow', () => ({ ImapFlow }));

const mockGetAccount = jest.fn();
const mockResolveAuth = jest.fn();
const mockBuild = jest.fn();

jest.mock('../../electron/email/email-store', () => ({
  getEmailAccountById: (...a: unknown[]) => mockGetAccount(...a),
}));
jest.mock('../../electron/email/email-imap-auth', () => ({
  resolveImapAuth: (...a: unknown[]) => mockResolveAuth(...a),
}));
jest.mock('../../electron/email/mail-rfc822-compose', () => ({
  buildComposeRfc822: (...a: unknown[]) => mockBuild(...a),
}));

import {
  appendSentToImap,
  imapTimeoutsForMessageBytes,
  resolveSentMailboxCandidates,
} from '../../electron/email/email-imap-append';

describe('appendSentToImap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    client.connect.mockResolvedValue(undefined);
    client.logout.mockResolvedValue(undefined);
    client.list.mockResolvedValue([]);
    client.mailboxOpen.mockResolvedValue(undefined);
    client.append.mockResolvedValue(undefined);
    mockBuild.mockReturnValue(Buffer.from('raw'));
    mockResolveAuth.mockResolvedValue({ user: 'u', pass: 'p' });
    mockGetAccount.mockReturnValue({
      protocol: 'imap',
      imap_host: 'h',
      imap_port: 993,
      imap_tls: 0,
      sent_folder_path: 'Sent',
    });
  });

  test('returns early for non-imap account', async () => {
    mockGetAccount.mockReturnValue(null);
    await appendSentToImap({ accountId: 1, from: 'a@b.de', to: 'c@d.de', subject: 's' });
    expect(ImapFlow).not.toHaveBeenCalled();
  });

  test('appends to Sent and marks seen', async () => {
    await appendSentToImap({
      accountId: 1,
      from: 'a@b.de',
      to: 'c@d.de',
      subject: 'Hi',
      includeBccInHeaders: false,
      bcc: 'hidden@x.de',
    });
    expect(mockBuild).toHaveBeenCalledWith(expect.objectContaining({ bcc: undefined }));
    expect(client.append).toHaveBeenCalledWith('Sent', expect.any(Buffer), ['\\Seen']);
  });

  test('falls back to INBOX.Sent when folder open fails', async () => {
    client.mailboxOpen.mockRejectedValueOnce(new Error('no folder'));
    await appendSentToImap({ accountId: 1, from: 'a@b.de', to: 'c@d.de', subject: 's' });
    expect(client.append).toHaveBeenCalledWith('INBOX.Sent', expect.any(Buffer), ['\\Seen']);
  });

  test('uses server advertised sent mailbox before generic fallbacks', async () => {
    client.list.mockResolvedValue([
      {
        path: 'INBOX/Gesendet',
        pathAsListed: 'INBOX/Gesendet',
        name: 'Gesendet',
        delimiter: '/',
        parent: ['INBOX'],
        parentPath: 'INBOX',
        flags: new Set(['\\Sent']),
        specialUse: '\\Sent',
        listed: true,
        subscribed: true,
      },
    ]);
    client.mailboxOpen.mockImplementation(async (path: string) => {
      if (path === 'Sent') throw new Error('no folder');
      return undefined;
    });
    await appendSentToImap({ accountId: 1, from: 'a@b.de', to: 'c@d.de', subject: 's' });
    expect(client.append).toHaveBeenCalledWith('INBOX/Gesendet', expect.any(Buffer), ['\\Seen']);
  });

  test('reports all attempted sent folders when append target can not be opened', async () => {
    client.list.mockResolvedValue([]);
    client.mailboxOpen.mockRejectedValue(new Error('no folder'));
    await expect(
      appendSentToImap({ accountId: 1, from: 'a@b.de', to: 'c@d.de', subject: 's' }),
    ).rejects.toThrow(/Kein beschreibbarer IMAP-Gesendet-Ordner gefunden/);
  });

  test('resolves localized sent-folder candidates', () => {
    expect(
      resolveSentMailboxCandidates('Sent', [
        {
          path: 'INBOX/Gesendete Objekte',
          pathAsListed: 'INBOX/Gesendete Objekte',
          name: 'Gesendete Objekte',
          delimiter: '/',
          parent: ['INBOX'],
          parentPath: 'INBOX',
          flags: new Set(),
          listed: true,
          subscribed: true,
        },
      ]),
    ).toEqual(expect.arrayContaining(['Sent', 'INBOX/Gesendete Objekte']));
  });

  test('imapTimeoutsForMessageBytes scales with payload size', () => {
    const small = imapTimeoutsForMessageBytes(100_000);
    const large = imapTimeoutsForMessageBytes(15 * 1024 * 1024);
    expect(large.socketTimeout).toBeGreaterThan(small.socketTimeout);
    expect(large.connectionTimeout).toBeGreaterThan(small.connectionTimeout);
  });

  test('uses oauth access token auth', async () => {
    mockResolveAuth.mockResolvedValue({ user: 'u', accessToken: 't' });
    await appendSentToImap({ accountId: 1, from: 'a@b.de', to: 'c@d.de', subject: 's' });
    expect(ImapFlow).toHaveBeenCalledWith(
      expect.objectContaining({ auth: { user: 'u', accessToken: 't' } }),
    );
  });
});
