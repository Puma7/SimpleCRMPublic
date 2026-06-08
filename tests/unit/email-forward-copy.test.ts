const mockSend = jest.fn();
const mockGetAccount = jest.fn();
const mockDbGet = jest.fn();
const mockDbRun = jest.fn();

jest.mock('../../electron/email/email-smtp', () => ({
  sendSmtpForAccount: (...args: unknown[]) => mockSend(...args),
}));

jest.mock('../../electron/email/email-store', () => ({
  getEmailAccountById: (...args: unknown[]) => mockGetAccount(...args),
}));

jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => ({
    prepare: () => ({
      get: (...args: unknown[]) => mockDbGet(...args),
      run: (...args: unknown[]) => mockDbRun(...args),
    }),
  }),
}));

import { sendWorkflowForwardCopy } from '../../electron/email/email-forward-copy';

describe('sendWorkflowForwardCopy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAccount.mockReturnValue({ email_address: 'me@test.de' });
    mockDbGet.mockReturnValue(undefined);
    mockSend.mockResolvedValue(undefined);
  });

  test('sends SMTP without outbound workflow gate (workflow forward bypass)', async () => {
    const r = await sendWorkflowForwardCopy({
      accountId: 1,
      sourceMessageId: 9,
      workflowId: 2,
      to: 'dest@example.com',
      subject: 'Fwd: Hi',
      bodyText: 'body',
      originalFromLine: 'from@x.de',
    });
    expect(r.ok).toBe(true);
    expect(mockSend).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        to: 'dest@example.com',
        headers: { 'Auto-Submitted': 'auto-forwarded' },
      }),
    );
    expect(mockDbRun).toHaveBeenCalled();
  });

  test('dedup skips second send for same recipient set', async () => {
    mockDbGet.mockReturnValue({ 1: 1 });
    const r = await sendWorkflowForwardCopy({
      accountId: 1,
      sourceMessageId: 9,
      workflowId: 2,
      to: 'dest@example.com',
      subject: 'Fwd',
      bodyText: 'body',
      originalFromLine: 'a@b.de',
    });
    expect(r.ok).toBe(true);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
