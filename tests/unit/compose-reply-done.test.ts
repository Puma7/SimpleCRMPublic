import {
  getComposeMarkReplyParentDone,
  setComposeMarkReplyParentDone,
} from '../../electron/email/compose-reply-done';

const mockGetSyncInfo = jest.fn();
const mockSetSyncInfo = jest.fn();

jest.mock('../../electron/sqlite-service', () => ({
  getSyncInfo: (...args: unknown[]) => mockGetSyncInfo(...args),
  setSyncInfo: (...args: unknown[]) => mockSetSyncInfo(...args),
}));

describe('compose-reply-done', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('defaults to mark parent done when unset', () => {
    mockGetSyncInfo.mockReturnValue(null);
    expect(getComposeMarkReplyParentDone(42)).toBe(true);
  });

  it('persists opt-out', () => {
    setComposeMarkReplyParentDone(42, false);
    expect(mockSetSyncInfo).toHaveBeenCalledWith('compose_mark_parent_done:42', '0');
    mockGetSyncInfo.mockReturnValue('0');
    expect(getComposeMarkReplyParentDone(42)).toBe(false);
  });
});
