const mockGetMessage = jest.fn();
const mockGetSyncInfo = jest.fn();

jest.mock('../../electron/email/email-store', () => ({
  getEmailMessageById: (...args: unknown[]) => mockGetMessage(...args),
}));
jest.mock('../../electron/sqlite-service', () => ({
  getSyncInfo: (...args: unknown[]) => mockGetSyncInfo(...args),
  getDb: () => ({
    prepare: () => ({ run: jest.fn(), get: jest.fn() }),
  }),
}));

import { getComposeDraftRecoveryState } from '../../electron/email/email-compose-send';

describe('getComposeDraftRecoveryState', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('needsResendFinalize when smtp committed and draft still open', () => {
    mockGetSyncInfo.mockReturnValue('1');
    mockGetMessage.mockReturnValue({ id: 5, uid: -1, folder_kind: 'draft' });
    const s = getComposeDraftRecoveryState(5);
    expect(s.smtpCommitted).toBe(true);
    expect(s.needsResendFinalize).toBe(true);
  });

  test('no recovery when draft already sent', () => {
    mockGetSyncInfo.mockReturnValue('1');
    mockGetMessage.mockReturnValue({ id: 5, uid: -1, folder_kind: 'sent' });
    expect(getComposeDraftRecoveryState(5).needsResendFinalize).toBe(false);
  });
});
