const mockGetMessage = jest.fn();
const mockSendCompose = jest.fn();
const mockListDue = jest.fn();
const mockSetScheduled = jest.fn();
const mockGetSyncInfo = jest.fn();
const mockSetSyncInfo = jest.fn();

jest.mock('../../electron/email/email-store', () => ({
  getEmailMessageById: (...args: unknown[]) => mockGetMessage(...args),
}));
jest.mock('../../electron/email/email-compose-send', () => ({
  sendComposeDraft: (...args: unknown[]) => mockSendCompose(...args),
}));
jest.mock('../../electron/email/email-message-features', () => ({
  listDueScheduledDraftIds: (...args: unknown[]) => mockListDue(...args),
  setDraftScheduledSendAt: (...args: unknown[]) => mockSetScheduled(...args),
}));
jest.mock('../../electron/sqlite-service', () => ({
  getSyncInfo: (...args: unknown[]) => mockGetSyncInfo(...args),
  setSyncInfo: (...args: unknown[]) => mockSetSyncInfo(...args),
}));

import { processDueScheduledSends } from '../../electron/email/email-scheduled-send';

describe('email-scheduled-send', () => {
  const logger = { warn: jest.fn(), debug: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSyncInfo.mockReturnValue(null);
    mockSendCompose.mockResolvedValue({ ok: true });
  });

  test('sends due draft and clears schedule', async () => {
    mockListDue.mockReturnValue([10]);
    mockGetMessage.mockReturnValue({
      id: 10,
      uid: -1,
      account_id: 1,
      to_json: JSON.stringify({ value: [{ address: 'to@test.de' }] }),
      subject: 'Subj',
      body_text: 'Body',
      body_html: null,
      cc_json: null,
      bcc_json: null,
      draft_attachment_paths_json: null,
    });
    const sent = await processDueScheduledSends(logger);
    expect(sent).toBe(1);
    expect(mockSetScheduled).toHaveBeenCalledWith(10, null);
    expect(mockSetSyncInfo).toHaveBeenCalledWith('scheduled_send_failures:10', '0');
  });

  test('skips draft without recipient', async () => {
    mockListDue.mockReturnValue([11]);
    mockGetMessage.mockReturnValue({
      id: 11,
      uid: -2,
      account_id: 1,
      to_json: null,
      subject: 'X',
      body_text: '',
    });
    expect(await processDueScheduledSends(logger)).toBe(0);
    expect(mockSetScheduled).toHaveBeenCalledWith(11, null);
    expect(logger.warn).toHaveBeenCalled();
  });

  test('increments failures and gives up after max', async () => {
    mockListDue.mockReturnValue([12]);
    mockGetMessage.mockReturnValue({
      id: 12,
      uid: -3,
      account_id: 1,
      to_json: JSON.stringify({ value: [{ address: 'a@b.de' }] }),
      subject: 'S',
      body_text: 'B',
      cc_json: null,
      bcc_json: null,
    });
    mockSendCompose.mockResolvedValue({ ok: false, error: 'smtp fail' });
    mockGetSyncInfo.mockReturnValue('4');
    await processDueScheduledSends(logger);
    expect(mockSetSyncInfo).toHaveBeenCalledWith('scheduled_send_failures:12', '5');
    expect(mockSetSyncInfo).toHaveBeenCalledWith('scheduled_send_status:12', 'failed');
    expect(mockSetSyncInfo).toHaveBeenCalledWith('scheduled_send_last_error:12', 'smtp fail');
    expect(mockSetScheduled).toHaveBeenCalledWith(12, null);
  });

  test('handles thrown errors with failure counter', async () => {
    mockListDue.mockReturnValue([13]);
    mockGetMessage.mockReturnValue({
      id: 13,
      uid: -4,
      account_id: 1,
      to_json: JSON.stringify({ value: [{ address: 'a@b.de' }] }),
      subject: 'S',
      body_text: 'B',
    });
    mockSendCompose.mockRejectedValue(new Error('boom'));
    await processDueScheduledSends(logger);
    expect(mockSetSyncInfo).toHaveBeenCalledWith('scheduled_send_failures:13', '1');
  });

  test('skips missing or sent drafts', async () => {
    mockListDue.mockReturnValue([14, 15]);
    mockGetMessage.mockReturnValueOnce(undefined).mockReturnValueOnce({ id: 15, uid: 5, account_id: 1 });
    expect(await processDueScheduledSends(logger)).toBe(0);
  });
});
