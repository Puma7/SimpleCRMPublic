const mockGetAccount = jest.fn();
const mockGetMessage = jest.fn();
const mockUpdateDraft = jest.fn();
const mockDbRun = jest.fn();

jest.mock('../../electron/email/email-store', () => ({
  getEmailAccountById: (...args: unknown[]) => mockGetAccount(...args),
  getEmailMessageById: (...args: unknown[]) => mockGetMessage(...args),
  updateComposeDraft: (...args: unknown[]) => mockUpdateDraft(...args),
}));
jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => ({
    prepare: () => ({ run: (...args: unknown[]) => mockDbRun(...args) }),
  }),
}));

import {
  clearOutboundHoldForResend,
  returnOutboundDraftToInbox,
} from '../../electron/email/email-outbound-review';

describe('email-outbound-review', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDbRun.mockReturnValue({ changes: 1 });
  });

  test('returnOutboundDraftToInbox updates draft with banner', () => {
    mockGetMessage.mockReturnValue({
      id: 10,
      uid: -1,
      body_text: 'Draft body',
      body_html: '<p>Draft body</p>',
    });
    returnOutboundDraftToInbox(10, 'Blocked reason', {
      payload: { bodyText: 'Override', bodyHtml: '<p>Override</p>' },
    });
    expect(mockUpdateDraft).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        bodyText: expect.stringContaining('Blocked reason'),
        bodyHtml: expect.stringContaining('Override'),
      }),
    );
    expect(mockDbRun).toHaveBeenCalled();
  });

  test('returnOutboundDraftToInbox plain-only html branch', () => {
    mockGetMessage.mockReturnValue({
      id: 11,
      uid: -2,
      body_text: 'Only plain',
      body_html: null,
    });
    returnOutboundDraftToInbox(11, 'Reason');
    expect(mockUpdateDraft).toHaveBeenCalled();
  });

  test('returnOutboundDraftToInbox skips non-draft', () => {
    mockGetMessage.mockReturnValue({ id: 12, uid: 5 });
    returnOutboundDraftToInbox(12, 'Reason');
    expect(mockUpdateDraft).not.toHaveBeenCalled();
  });

  test('clearOutboundHoldForResend', () => {
    clearOutboundHoldForResend(10);
    expect(mockDbRun).toHaveBeenCalledWith(10);
  });
});
