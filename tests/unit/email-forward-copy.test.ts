const mockEvaluate = jest.fn();
const mockSend = jest.fn();
const mockGetAccount = jest.fn();
const mockDbGet = jest.fn();
const mockDbRun = jest.fn();

jest.mock('../../electron/email/email-workflow-engine', () => ({
  evaluateOutboundWorkflows: (...args: unknown[]) => mockEvaluate(...args),
}));

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
    mockEvaluate.mockResolvedValue({ allowed: true, reason: null });
    mockSend.mockResolvedValue(undefined);
  });

  test('runs outbound gate before SMTP', async () => {
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
    expect(mockEvaluate).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 9, to: 'dest@example.com' }),
      { sideEffects: 'none' },
    );
    expect(mockSend).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        headers: { 'Auto-Submitted': 'auto-forwarded' },
      }),
    );
    expect(mockDbRun).toHaveBeenCalled();
  });

  test('skips SMTP when outbound blocked', async () => {
    mockEvaluate.mockResolvedValue({ allowed: false, reason: 'blocked' });
    const r = await sendWorkflowForwardCopy({
      accountId: 1,
      sourceMessageId: 9,
      workflowId: 2,
      to: 'dest@example.com',
      subject: 'Fwd',
      bodyText: 'body',
      originalFromLine: 'a@b.de',
    });
    expect(r.ok).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
