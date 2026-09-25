const mockGetSyncInfo = jest.fn();
const mockSetSyncInfo = jest.fn();
const mockListMessageCategoryAssignments = jest.fn();

jest.mock('../../electron/sqlite-service', () => ({
  getSyncInfo: (key: string) => mockGetSyncInfo(key),
  setSyncInfo: (key: string, value: string) => mockSetSyncInfo(key, value),
}));

jest.mock('../../electron/email/email-crm-store', () => ({
  listMessageCategoryAssignments: (id: number) => mockListMessageCategoryAssignments(id),
}));

const mockGetEmailMessageById = jest.fn();
jest.mock('../../electron/email/email-store', () => ({
  getEmailMessageById: (id: number) => mockGetEmailMessageById(id),
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
  clearReplySuggestionAccountOverrides,
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
    mockGetEmailMessageById.mockReset();
    mockListMessageCategoryAssignments.mockReset();
    mockGetSyncInfo.mockReturnValue(null);
    mockListMessageCategoryAssignments.mockReturnValue([]);
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

  it('clears only one account overrides and restores global settings', () => {
    const values = new Map<string, string>([
      ['reply_suggestion_auto_enabled', 'false'],
      ['reply_suggestion_category_mode', 'only_listed'],
      ['reply_suggestion_category_ids', '[2, 9]'],
      ['reply_suggestion_auto_enabled@7', 'true'],
      ['reply_suggestion_category_mode@7', 'any'],
      ['reply_suggestion_category_ids@7', '[3]'],
      ['reply_suggestion_auto_enabled@8', 'true'],
    ]);
    mockGetSyncInfo.mockImplementation((key: string) => values.get(key) ?? null);
    mockSetSyncInfo.mockImplementation((key: string, value: string) => values.set(key, value));
    expect(getReplySuggestionSettings(7)).toMatchObject({ autoEnabled: true, categoryMode: 'any', categoryIds: [3] });
    clearReplySuggestionAccountOverrides(7);
    expect(getReplySuggestionSettings(7)).toMatchObject({ autoEnabled: false, categoryMode: 'only_listed', categoryIds: [2, 9] });
    expect(getReplySuggestionSettings(8).autoEnabled).toBe(true);
    expect(mockSetSyncInfo).toHaveBeenCalledTimes(5);
  });

  it.each(['{invalid', '{}', '  '])('rejects malformed stored category lists: %s', (raw) => {
    mockGetSyncInfo.mockImplementation((key: string) => key === 'reply_suggestion_category_ids' ? raw : null);
    expect(getReplySuggestionSettings().categoryIds).toEqual([]);
  });

  it('keeps valid category IDs and excludes nonpositive and fractional IDs', () => {
    mockGetSyncInfo.mockImplementation((key: string) => key === 'reply_suggestion_category_ids' ? '[2, "3", -1, 0, 1.5, "bad", 2]' : null);
    expect(getReplySuggestionSettings().categoryIds).toEqual([2, 3, 2]);
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

  it('setReplySuggestionSettings persists per-account keys', () => {
    setReplySuggestionSettings({ autoEnabled: false }, 7);
    expect(mockSetSyncInfo).toHaveBeenCalledWith('reply_suggestion_auto_enabled@7', '0');
  });

  it('getReplySuggestionSettings merges account overrides over global', () => {
    mockGetSyncInfo.mockImplementation((key: string) => {
      if (key === 'reply_suggestion_auto_enabled@3') return '0';
      if (key === 'reply_suggestion_auto_enabled') return '1';
      return null;
    });
    expect(getReplySuggestionSettings(3).autoEnabled).toBe(false);
    expect(getReplySuggestionSettings().autoEnabled).toBe(true);
  });

  it('shouldAutoEnsureReplySuggestion blocks when auto disabled', () => {
    mockGetEmailMessageById.mockReturnValue({ account_id: 2 });
    mockGetSyncInfo.mockImplementation((key: string) => {
      if (key === 'reply_suggestion_auto_enabled') return '0';
      return null;
    });
    expect(shouldAutoEnsureReplySuggestion(1, 'open')).toBe(false);
    expect(shouldAutoEnsureReplySuggestion(1, 'inbound')).toBe(false);
  });

  it('shouldAutoEnsureReplySuggestion uses per-account settings', () => {
    mockGetEmailMessageById.mockReturnValue({ account_id: 5 });
    mockGetSyncInfo.mockImplementation((key: string) => {
      if (key === 'reply_suggestion_auto_enabled@5') return '0';
      if (key === 'reply_suggestion_auto_enabled') return '1';
      return null;
    });
    expect(shouldAutoEnsureReplySuggestion(1, 'open')).toBe(false);
  });

  it('uses a preloaded message and falls back from empty account flags to global defaults', () => {
    mockGetSyncInfo.mockImplementation((key: string) => key.includes('@5') ? '' : null);
    const row = { account_id: 5 } as NonNullable<Parameters<typeof shouldAutoEnsureReplySuggestion>[2]>;
    expect(shouldAutoEnsureReplySuggestion(10, 'open', row)).toBe(true);
    expect(mockGetEmailMessageById).not.toHaveBeenCalled();
  });

  it('an empty category allowlist never triggers automatic replies', () => {
    const settings = normalizeReplySuggestionSettings({ categoryMode: 'only_listed', categoryIds: [] });
    expect(messageMatchesReplySuggestionCategories(10, settings)).toBe(false);
    expect(mockListMessageCategoryAssignments).not.toHaveBeenCalled();
  });

  it('messageMatchesReplySuggestionCategories with only_listed matches ANY assigned category', () => {
    const settings = normalizeReplySuggestionSettings({
      categoryMode: 'only_listed',
      categoryIds: [2],
    });
    // Single assigned, hits allowlist.
    mockListMessageCategoryAssignments.mockReturnValue([2]);
    expect(messageMatchesReplySuggestionCategories(10, settings)).toBe(true);
    // Single assigned, misses allowlist.
    mockListMessageCategoryAssignments.mockReturnValue([9]);
    expect(messageMatchesReplySuggestionCategories(10, settings)).toBe(false);
    // None assigned.
    mockListMessageCategoryAssignments.mockReturnValue([]);
    expect(messageMatchesReplySuggestionCategories(10, settings)).toBe(false);
    // Regression for the multi-category bug (Codex P2 on PR #120): a message
    // in BOTH an unlisted (9) and a listed (2) category must still pass.
    mockListMessageCategoryAssignments.mockReturnValue([9, 2]);
    expect(messageMatchesReplySuggestionCategories(10, settings)).toBe(true);
    // Order independent.
    mockListMessageCategoryAssignments.mockReturnValue([2, 9]);
    expect(messageMatchesReplySuggestionCategories(10, settings)).toBe(true);
  });
});
