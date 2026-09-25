const mockVerify = jest.fn();
const mockSendMail = jest.fn();
const mockCreateTransport = jest.fn(() => ({
  verify: mockVerify,
  sendMail: mockSendMail,
}));

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: mockCreateTransport },
}));

jest.mock('../../electron/email/email-store', () => ({
  getEmailAccountById: jest.fn(),
}));

jest.mock('../../electron/email/email-keytar', () => ({
  getEmailPassword: jest.fn(async () => 'secret'),
}));

jest.mock('../../electron/email/email-imap-auth', () => ({
  resolveImapAuth: jest.fn(async () => ({ user: 'u', pass: 'p' })),
}));

const { getEmailAccountById } = require('../../electron/email/email-store') as typeof import('../../electron/email/email-store');
const { sendSmtpForAccount, testSmtpConnection } = require('../../electron/email/email-smtp') as typeof import('../../electron/email/email-smtp');

describe('email-smtp', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSendMail.mockResolvedValue({});
  });

  // F-A7b-09: Der SMTP-Test nutzte STARTTLS nur opportunistisch; ein Downgrade im Netz lieferte das Passwort im Klartext.
  test('testSmtpConnection requires STARTTLS unless implicit TLS is used or TLS is switched off', async () => {
    const base = { host: 'smtp.test', user: 'a@b.de', pass: 'x' };

    await testSmtpConnection({ ...base, port: 587, secure: false, tls: true });
    expect(mockCreateTransport).toHaveBeenLastCalledWith(expect.objectContaining({ secure: false, requireTLS: true }));

    await testSmtpConnection({ ...base, port: 587, secure: false });
    expect(mockCreateTransport).toHaveBeenLastCalledWith(expect.objectContaining({ secure: false, requireTLS: true }));

    await testSmtpConnection({ ...base, port: 465, secure: true, tls: true });
    expect(mockCreateTransport).toHaveBeenLastCalledWith(expect.objectContaining({ secure: true, requireTLS: false }));

    // Same rule as the productive send: TLS switched off means no TLS.
    await testSmtpConnection({ ...base, port: 25, secure: false, tls: false });
    expect(mockCreateTransport).toHaveBeenLastCalledWith(expect.objectContaining({ secure: false, requireTLS: false }));
  });

  test('testSmtpConnection ok and error', async () => {
    expect(await testSmtpConnection({
      host: 'smtp.test',
      port: 587,
      secure: false,
      user: 'a@b.de',
      pass: 'x',
    })).toEqual({ ok: true });

    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: 'a@b.de',
      to: 'a@b.de',
      subject: 'SimpleCRM SMTP-Verbindungstest',
    }));

    mockSendMail.mockRejectedValueOnce(new Error('auth'));
    expect(await testSmtpConnection({
      host: 'smtp.test',
      port: 587,
      secure: false,
      user: 'a@b.de',
    })).toEqual({ ok: false, error: 'auth' });

    expect(await testSmtpConnection({
      host: '',
      port: 587,
      secure: false,
      user: 'a@b.de',
    })).toEqual({ ok: false, error: expect.stringContaining('SMTP-Host fehlt') });
  });

  test('sendSmtpForAccount throws without account', async () => {
    (getEmailAccountById as jest.Mock).mockReturnValue(undefined);
    await expect(
      sendSmtpForAccount(1, { from: 'a@b.de', to: 'c@d.de', subject: 's', text: 't' }),
    ).rejects.toThrow('Konto nicht gefunden');
  });

  test('sendSmtpForAccount throws without smtp host', async () => {
    (getEmailAccountById as jest.Mock).mockReturnValue({
      id: 3,
      imap_host: 'imap.test',
      smtp_port: 587,
      smtp_tls: true,
      imap_username: 'u',
      keytar_account_key: 'k',
      smtp_use_imap_auth: true,
    });
    await expect(
      sendSmtpForAccount(3, { from: 'a@b.de', to: 'c@d.de', subject: 's', text: 't' }),
    ).rejects.toThrow('SMTP-Host fehlt');
  });

  test('sendSmtpForAccount sends with password auth', async () => {
    (getEmailAccountById as jest.Mock).mockReturnValue({
      id: 1,
      imap_host: 'imap.test',
      smtp_host: 'smtp.test',
      smtp_port: 587,
      smtp_tls: true,
      imap_username: 'u',
      keytar_account_key: 'k',
      smtp_use_imap_auth: false,
    });
    await sendSmtpForAccount(1, {
      from: 'me@test.de',
      to: 'you@test.de',
      subject: 'Hi',
      text: 'Body',
      headers: { 'X-Test': '1' },
      requestReadReceipt: true,
    });
    expect(mockSendMail).toHaveBeenCalled();
  });

  test('sendSmtpForAccount uses OAuth when smtp_use_imap_auth', async () => {
    const { resolveImapAuth } = await import('../../electron/email/email-imap-auth');
    (resolveImapAuth as jest.Mock).mockResolvedValueOnce({
      user: 'u',
      accessToken: 'tok',
    });
    (getEmailAccountById as jest.Mock).mockReturnValue({
      id: 2,
      imap_host: 'imap.test',
      smtp_host: 'smtp.test',
      smtp_port: 465,
      smtp_tls: true,
      smtp_use_imap_auth: true,
      imap_username: 'u',
      keytar_account_key: 'k',
    });
    await sendSmtpForAccount(2, {
      from: 'me@test.de',
      to: 'you@test.de',
      subject: 'Hi',
      text: 'Body',
    });
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ secure: true }),
    );
  });

  // F-A7b-14: Vorgefertigte MIME-Nachrichten (MDN) gehen unveraendert raus, statt dass nodemailer einen zweiten Content-Type baut.
  test('sendSmtpForAccount sends a prebuilt raw message unchanged with an explicit envelope', async () => {
    (getEmailAccountById as jest.Mock).mockReturnValue({
      id: 3,
      email_address: 'agent@example.org',
      imap_host: 'imap.test',
      smtp_host: 'smtp.test',
      smtp_port: 587,
      smtp_tls: true,
      imap_username: 'u',
      keytar_account_key: 'k',
    });
    const raw = Buffer.from('From: agent@example.org\r\n\r\nbody');
    await sendSmtpForAccount(3, {
      from: 'Agent <agent@example.org>',
      to: 'sender@example.com',
      subject: 'Gelesen',
      text: 'ignored',
      raw,
    });
    expect(mockSendMail).toHaveBeenCalledWith({
      envelope: { from: 'agent@example.org', to: ['sender@example.com'] },
      raw,
    });
  });
});
