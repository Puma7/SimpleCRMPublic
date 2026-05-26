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

import { appendSentToImap } from '../../electron/email/email-imap-append';

describe('appendSentToImap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  test('uses oauth access token auth', async () => {
    mockResolveAuth.mockResolvedValue({ user: 'u', accessToken: 't' });
    await appendSentToImap({ accountId: 1, from: 'a@b.de', to: 'c@d.de', subject: 's' });
    expect(ImapFlow).toHaveBeenCalledWith(
      expect.objectContaining({ auth: { user: 'u', accessToken: 't' } }),
    );
  });
});
