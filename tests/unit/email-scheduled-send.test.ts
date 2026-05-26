const mockGetSyncInfo = jest.fn();
const mockSetSyncInfo = jest.fn();
const mockSendComposeDraft = jest.fn();
const mockSetDraftScheduledSendAt = jest.fn();
const mockListDue = jest.fn();

jest.mock('../../electron/sqlite-service', () => ({
  getSyncInfo: (...args: unknown[]) => mockGetSyncInfo(...args),
  setSyncInfo: (...args: unknown[]) => mockSetSyncInfo(...args),
}));

jest.mock('../../electron/email/email-store', () => ({
  getEmailMessageById: jest.fn((id: number) => ({
    id,
    uid: -1,
    account_id: 1,
    to_json: JSON.stringify({ value: [{ address: 'to@example.com' }] }),
    subject: 'Hi',
    body_text: 'Body',
    body_html: null,
    cc_json: null,
    bcc_json: null,
  })),
}));

jest.mock('../../electron/email/email-compose-send', () => ({
  sendComposeDraft: (...args: unknown[]) => mockSendComposeDraft(...args),
}));

jest.mock('../../electron/email/email-message-features', () => ({
  listDueScheduledDraftIds: () => mockListDue(),
  setDraftScheduledSendAt: (...args: unknown[]) => mockSetDraftScheduledSendAt(...args),
}));

import { processDueScheduledSends } from '../../electron/email/email-scheduled-send';

describe('email-scheduled-send', () => {
  const logger = { warn: jest.fn(), debug: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockListDue.mockReturnValue([99]);
    mockGetSyncInfo.mockReturnValue('0');
  });

  test('clears schedule after repeated throws', async () => {
    mockSendComposeDraft.mockRejectedValue(new Error('db locked'));
    mockGetSyncInfo.mockReturnValue('4');

    await processDueScheduledSends(logger);

    expect(mockSetDraftScheduledSendAt).toHaveBeenCalledWith(99, null);
    expect(logger.warn).toHaveBeenCalled();
  });

  test('does not clear schedule on first throw', async () => {
    mockSendComposeDraft.mockRejectedValue(new Error('transient'));
    mockGetSyncInfo.mockReturnValue('0');

    await processDueScheduledSends(logger);

    expect(mockSetDraftScheduledSendAt).not.toHaveBeenCalled();
    expect(mockSetSyncInfo).toHaveBeenCalledWith('scheduled_send_failures:99', '1');
  });
});
