/**
 * @jest-environment node
 */
const mockTestPop3 = jest.fn();
const mockGetAccount = jest.fn();
const mockGetPassword = jest.fn();

jest.mock('../../electron/email/email-pop3-sync', () => ({
  testPop3Connection: (...args: unknown[]) => mockTestPop3(...args),
}));

jest.mock('../../electron/email/email-store', () => ({
  getEmailAccountById: (...args: unknown[]) => mockGetAccount(...args),
}));

jest.mock('../../electron/email/email-keytar', () => ({
  getEmailPassword: (...args: unknown[]) => mockGetPassword(...args),
}));

import { getEmailAccountById } from '../../electron/email/email-store';
import { testPop3Connection } from '../../electron/email/email-pop3-sync';

describe('TestPop3 IPC handler logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAccount.mockReturnValue({
      id: 1,
      pop3_host: 'old.example.com',
      pop3_port: 995,
      pop3_tls: 1,
      imap_host: 'old.example.com',
      imap_port: 995,
      imap_tls: 1,
      imap_username: 'saved-user',
      keytar_account_key: 'k1',
    });
    mockGetPassword.mockResolvedValue('stored-pw');
    mockTestPop3.mockResolvedValue({ ok: true });
  });

  test('uses form host/user/password when accountId set', async () => {
    const payload = {
      accountId: 1,
      host: 'new.example.com',
      port: 110,
      tls: false,
      user: 'form-user',
      password: 'form-pw',
    };
    const acc = getEmailAccountById(payload.accountId)!;
    const host = payload.host.trim();
    const user = payload.user.trim();
    const testAcc = {
      ...acc,
      pop3_host: host || acc.pop3_host,
      pop3_port: payload.port ?? acc.pop3_port,
      pop3_tls: payload.tls ? 1 : 0,
      imap_host: host || acc.imap_host,
      imap_port: payload.port ?? acc.imap_port,
      imap_tls: payload.tls ? 1 : 0,
      imap_username: user || acc.imap_username,
    };
    const pw =
      payload.password.trim().length > 0
        ? payload.password
        : await mockGetPassword(acc.keytar_account_key);
    await testPop3Connection(testAcc, pw);
    expect(mockTestPop3).toHaveBeenCalledWith(
      expect.objectContaining({
        pop3_host: 'new.example.com',
        imap_username: 'form-user',
        pop3_port: 110,
        pop3_tls: 0,
      }),
      'form-pw',
    );
  });
});
