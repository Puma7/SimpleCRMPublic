const mockGetAccount = jest.fn();
const mockEvaluate = jest.fn();
const mockSendSmtp = jest.fn();
const mockDbGet = jest.fn();
const mockDbRun = jest.fn();

jest.mock('../../electron/email/email-store', () => ({
  getEmailAccountById: (...args: unknown[]) => mockGetAccount(...args),
}));
jest.mock('../../electron/email/email-workflow-engine', () => ({
  evaluateOutboundWorkflows: (...args: unknown[]) => mockEvaluate(...args),
}));
jest.mock('../../electron/email/email-smtp', () => ({
  sendSmtpForAccount: (...args: unknown[]) => mockSendSmtp(...args),
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

describe('email-forward-copy', () => {
  const input = {
    accountId: 1,
    sourceMessageId: 10,
    workflowId: 3,
    to: 'fwd@test.de',
    subject: 'Fwd',
    bodyText: 'Body',
    originalFromLine: 'from@test.de',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAccount.mockReturnValue({ id: 1, email_address: 'me@test.de' });
    mockEvaluate.mockResolvedValue({ allowed: true, reason: null });
    mockSendSmtp.mockResolvedValue(undefined);
    mockDbGet.mockReturnValue(undefined);
  });

  test('returns error when recipient missing', async () => {
    expect(await sendWorkflowForwardCopy({ ...input, to: '  ' })).toEqual({
      ok: false,
      reason: 'Empfänger fehlt',
    });
  });

  test('returns error when account missing', async () => {
    mockGetAccount.mockReturnValue(undefined);
    expect(await sendWorkflowForwardCopy(input)).toEqual({ ok: false, reason: 'Konto fehlt' });
  });

  test('deduplicates already forwarded destination', async () => {
    mockDbGet.mockReturnValue({ 1: 1 });
    expect(await sendWorkflowForwardCopy(input)).toEqual({ ok: true });
    expect(mockSendSmtp).not.toHaveBeenCalled();
  });

  test('blocks when outbound workflow rejects', async () => {
    mockEvaluate.mockResolvedValue({ allowed: false, reason: 'blocked' });
    expect(await sendWorkflowForwardCopy(input)).toEqual({ ok: false, reason: 'blocked' });
  });

  test('sends smtp and records dedup on success', async () => {
    expect(await sendWorkflowForwardCopy(input)).toEqual({ ok: true });
    expect(mockSendSmtp).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ to: 'fwd@test.de', headers: { 'Auto-Submitted': 'auto-forwarded' } }),
    );
    expect(mockDbRun).toHaveBeenCalled();
  });

  test('returns smtp error message', async () => {
    mockSendSmtp.mockRejectedValue(new Error('smtp down'));
    expect(await sendWorkflowForwardCopy(input)).toEqual({ ok: false, reason: 'smtp down' });
  });
});
