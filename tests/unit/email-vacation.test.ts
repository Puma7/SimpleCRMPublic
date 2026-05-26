const mockSend = jest.fn();
const mockGetMessage = jest.fn();
const mockGetAccount = jest.fn();
const mockDedupGet = jest.fn();
const mockDedupRun = jest.fn();

jest.mock('../../electron/email/email-smtp', () => ({
  sendSmtpForAccount: (...args: unknown[]) => mockSend(...args),
}));

jest.mock('../../electron/email/email-store', () => ({
  getEmailMessageById: (...args: unknown[]) => mockGetMessage(...args),
  getEmailAccountById: (...args: unknown[]) => mockGetAccount(...args),
}));

jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => ({
    exec: jest.fn(),
    prepare: (sql: string) => ({
      get: (...args: unknown[]) => mockDedupGet(sql, ...args),
      run: (...args: unknown[]) => mockDedupRun(sql, ...args),
    }),
  }),
  getSyncInfo: jest.fn(() => null),
  setSyncInfo: jest.fn(),
}));

import { maybeSendVacationAutoReply } from '../../electron/email/email-vacation';

describe('maybeSendVacationAutoReply', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue(undefined);
    mockDedupGet.mockReturnValue(undefined);
    mockGetAccount.mockReturnValue({
      id: 1,
      email_address: 'me@firma.de',
      vacation_enabled: 1,
      vacation_subject: 'Away',
      vacation_body_text: 'Back soon',
    });
  });

  test('skips when message is spam after reload', async () => {
    const base = {
      id: 5,
      uid: 100,
      account_id: 1,
      from_json: '{"value":[{"address":"guest@example.com"}]}',
      raw_headers: '',
      archived: 0,
      soft_deleted: 0,
      folder_kind: 'inbox',
    };
    mockGetMessage
      .mockReturnValueOnce({ ...base, is_spam: 0 })
      .mockReturnValueOnce({ ...base, is_spam: 1 });

    await maybeSendVacationAutoReply(5);

    expect(mockSend).not.toHaveBeenCalled();
  });

  test('skips auto-submitted inbound mail', async () => {
    mockGetMessage.mockReturnValue({
      id: 6,
      uid: 101,
      account_id: 1,
      from_json: '{"value":[{"address":"guest@example.com"}]}',
      raw_headers: 'Auto-Submitted: auto-replied',
      is_spam: 0,
      archived: 0,
      soft_deleted: 0,
      folder_kind: 'inbox',
    });

    await maybeSendVacationAutoReply(6);

    expect(mockSend).not.toHaveBeenCalled();
  });

  test('sends with Auto-Submitted header when enabled', async () => {
    mockGetMessage.mockReturnValue({
      id: 7,
      uid: 102,
      account_id: 1,
      message_id: '<mid@test>',
      from_json: '{"value":[{"address":"guest@example.com"}]}',
      raw_headers: '',
      is_spam: 0,
      archived: 0,
      soft_deleted: 0,
      folder_kind: 'inbox',
    });

    await maybeSendVacationAutoReply(7);

    expect(mockSend).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        to: 'guest@example.com',
        headers: { 'Auto-Submitted': 'auto-replied' },
      }),
    );
  });
});
