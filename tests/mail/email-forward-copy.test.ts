const mockGetAccount = jest.fn();
const mockSendSmtp = jest.fn();
const mockDbGet = jest.fn();
const mockDbRun = jest.fn();
const mockDbPrepare = jest.fn();

jest.mock('../../electron/email/email-store', () => ({
  getEmailAccountById: (...args: unknown[]) => mockGetAccount(...args),
}));
jest.mock('../../electron/email/email-smtp', () => ({
  sendSmtpForAccount: (...args: unknown[]) => mockSendSmtp(...args),
}));
jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => ({
    prepare: (sql: string) => {
      mockDbPrepare(sql);
      return {
        get: (...args: unknown[]) => mockDbGet(...args),
        run: (...args: unknown[]) => mockDbRun(...args),
      };
    },
  }),
}));

import {
  normalizeForwardCopyRecipients,
  sendWorkflowForwardCopy,
} from '../../electron/email/email-forward-copy';

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
    mockSendSmtp.mockResolvedValue(undefined);
    mockDbGet.mockReturnValue(undefined);
    mockDbRun.mockReturnValue({ changes: 1 });
  });

  test('normalizeForwardCopyRecipients splits comma and angle addresses', () => {
    expect(normalizeForwardCopyRecipients('Bank <bank@firma.de>, buchhaltung@firma.de')).toEqual([
      'bank@firma.de',
      'buchhaltung@firma.de',
    ]);
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

  test('deduplicates already forwarded destination set', async () => {
    mockDbGet.mockReturnValue({ 1: 1 });
    expect(await sendWorkflowForwardCopy({ ...input, to: 'a@x.de, b@x.de' })).toEqual({ ok: true });
    expect(mockSendSmtp).not.toHaveBeenCalled();
  });

  test('sends smtp without outbound workflow gate and records dedup before send', async () => {
    const callOrder: string[] = [];
    mockDbRun.mockImplementation((...args: unknown[]) => {
      if (args.length === 3) callOrder.push('dedup-insert');
      if (args.length === 0) callOrder.push('dedup-delete');
      return { changes: 1 };
    });
    mockSendSmtp.mockImplementation(async () => {
      callOrder.push('smtp');
    });

    expect(await sendWorkflowForwardCopy({ ...input, to: 'bank@x.de, buchhaltung@x.de' })).toEqual({
      ok: true,
    });
    expect(callOrder).toEqual(['dedup-insert', 'smtp']);
    expect(mockSendSmtp).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        to: 'bank@x.de, buchhaltung@x.de',
        headers: { 'Auto-Submitted': 'auto-forwarded' },
      }),
    );
    expect(mockDbRun).toHaveBeenCalledWith(10, 3, 'bank@x.de,buchhaltung@x.de');
  });

  test('returns smtp error message and rolls back dedup claim', async () => {
    mockSendSmtp.mockRejectedValue(new Error('smtp down'));
    expect(await sendWorkflowForwardCopy(input)).toEqual({ ok: false, reason: 'smtp down' });
    expect(mockDbPrepare).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM'));
  });
});
