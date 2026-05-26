const mockGetSyncInfo = jest.fn();
const mockSetSyncInfo = jest.fn();
const mockGetMessageCategoryId = jest.fn();

jest.mock('../../electron/sqlite-service', () => ({
  getSyncInfo: (key: string) => mockGetSyncInfo(key),
  setSyncInfo: (key: string, value: string) => mockSetSyncInfo(key, value),
}));

jest.mock('../../electron/email/email-crm-store', () => ({
  getMessageCategoryId: (id: number) => mockGetMessageCategoryId(id),
}));

import {
  shouldRunReplySuggestionForTrigger,
  normalizeReplySuggestionSettings,
} from '../../shared/reply-suggestion-settings';
import {
  getReplySuggestionSettings,
  messageMatchesReplySuggestionCategories,
  shouldAutoEnsureReplySuggestion,
  setReplySuggestionSettings,
} from '../../electron/email/reply-suggestion-settings';

describe('reply suggestion settings (shared)', () => {
  it('normalizeReplySuggestionSettings fills defaults', () => {
    expect(normalizeReplySuggestionSettings({ autoEnabled: false })).toMatchObject({
      autoEnabled: false,
      triggerOnInbound: true,
      triggerOnOpen: true,
      categoryMode: 'any',
      categoryIds: [],
    });
  });

  it('shouldRunReplySuggestionForTrigger respects flags', () => {
    const s = normalizeReplySuggestionSettings({
      autoEnabled: true,
      triggerOnInbound: false,
      triggerOnOpen: true,
    });
    expect(shouldRunReplySuggestionForTrigger(s, 'inbound')).toBe(false);
    expect(shouldRunReplySuggestionForTrigger(s, 'open')).toBe(true);
  });
});

describe('reply suggestion settings (electron)', () => {
  beforeEach(() => {
    mockGetSyncInfo.mockReset();
    mockSetSyncInfo.mockReset();
    mockGetMessageCategoryId.mockReset();
    mockGetSyncInfo.mockReturnValue(null);
  });

  it('getReplySuggestionSettings uses defaults when sync_info empty', () => {
    expect(getReplySuggestionSettings()).toEqual({
      autoEnabled: true,
      triggerOnInbound: true,
      triggerOnOpen: true,
      categoryMode: 'any',
      categoryIds: [],
    });
  });

  it('setReplySuggestionSettings persists flags', () => {
    setReplySuggestionSettings({
      autoEnabled: false,
      triggerOnOpen: false,
      categoryMode: 'only_listed',
      categoryIds: [3, 5],
    });
    expect(mockSetSyncInfo).toHaveBeenCalledWith('reply_suggestion_auto_enabled', '0');
    expect(mockSetSyncInfo).toHaveBeenCalledWith('reply_suggestion_trigger_on_open', '0');
    expect(mockSetSyncInfo).toHaveBeenCalledWith(
      'reply_suggestion_category_ids',
      JSON.stringify([3, 5]),
    );
  });

  it('shouldAutoEnsureReplySuggestion blocks when auto disabled', () => {
    mockGetSyncInfo.mockImplementation((key: string) => {
      if (key === 'reply_suggestion_auto_enabled') return '0';
      return null;
    });
    expect(shouldAutoEnsureReplySuggestion(1, 'open')).toBe(false);
    expect(shouldAutoEnsureReplySuggestion(1, 'inbound')).toBe(false);
  });

  it('messageMatchesReplySuggestionCategories with only_listed', () => {
    const settings = normalizeReplySuggestionSettings({
      categoryMode: 'only_listed',
      categoryIds: [2],
    });
    mockGetMessageCategoryId.mockReturnValue(2);
    expect(messageMatchesReplySuggestionCategories(10, settings)).toBe(true);
    mockGetMessageCategoryId.mockReturnValue(9);
    expect(messageMatchesReplySuggestionCategories(10, settings)).toBe(false);
    mockGetMessageCategoryId.mockReturnValue(null);
    expect(messageMatchesReplySuggestionCategories(10, settings)).toBe(false);
  });
});
