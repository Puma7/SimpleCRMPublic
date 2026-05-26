import {
  DEFAULT_REPLY_SUGGESTION_SETTINGS,
  normalizeReplySuggestionSettings,
  shouldRunReplySuggestionForTrigger,
  type ReplySuggestionAutoTrigger,
  type ReplySuggestionSettings,
} from '../../shared/reply-suggestion-settings';
import { getSyncInfo, setSyncInfo } from '../sqlite-service';
import { getMessageCategoryId } from './email-crm-store';
import { getEmailMessageById } from './email-store';
import type { EmailMessageRow } from './email-store';

const KEY_ENABLED = 'reply_suggestion_auto_enabled';
const KEY_TRIGGER_INBOUND = 'reply_suggestion_trigger_inbound';
const KEY_TRIGGER_OPEN = 'reply_suggestion_trigger_on_open';
const KEY_CATEGORY_MODE = 'reply_suggestion_category_mode';
const KEY_CATEGORY_IDS = 'reply_suggestion_category_ids';

const SETTINGS_KEYS = [
  KEY_ENABLED,
  KEY_TRIGGER_INBOUND,
  KEY_TRIGGER_OPEN,
  KEY_CATEGORY_MODE,
  KEY_CATEGORY_IDS,
] as const;

function scopedKey(base: string, accountId?: number): string {
  return accountId != null ? `${base}@${accountId}` : base;
}

function flagFromRaw(raw: string | null | undefined, defaultValue: boolean): boolean {
  if (raw === null || raw === undefined || raw === '') return defaultValue;
  return raw === '1' || raw.toLowerCase() === 'true';
}

function flagFromSyncKey(key: string, defaultValue: boolean): boolean {
  return flagFromRaw(getSyncInfo(key), defaultValue);
}

function parseCategoryIds(raw: string | null): number[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0);
  } catch {
    return [];
  }
}

/** Global defaults or per-account overrides (account keys win when set). */
export function getReplySuggestionSettings(accountId?: number): ReplySuggestionSettings {
  const defaults = DEFAULT_REPLY_SUGGESTION_SETTINGS;

  const readFlag = (base: string, fallback: boolean): boolean => {
    if (accountId != null) {
      const scoped = getSyncInfo(scopedKey(base, accountId));
      if (scoped !== null && scoped !== '') return flagFromRaw(scoped, fallback);
    }
    return flagFromSyncKey(base, fallback);
  };

  const categoryModeRaw =
    accountId != null
      ? (() => {
          const scoped = getSyncInfo(scopedKey(KEY_CATEGORY_MODE, accountId));
          if (scoped !== null && scoped !== '') return scoped;
          return getSyncInfo(KEY_CATEGORY_MODE);
        })()
      : getSyncInfo(KEY_CATEGORY_MODE);

  const categoryIdsRaw =
    accountId != null
      ? (() => {
          const scoped = getSyncInfo(scopedKey(KEY_CATEGORY_IDS, accountId));
          if (scoped !== null && scoped !== '') return scoped;
          return getSyncInfo(KEY_CATEGORY_IDS);
        })()
      : getSyncInfo(KEY_CATEGORY_IDS);

  return normalizeReplySuggestionSettings({
    autoEnabled: readFlag(KEY_ENABLED, defaults.autoEnabled),
    triggerOnInbound: readFlag(KEY_TRIGGER_INBOUND, defaults.triggerOnInbound),
    triggerOnOpen: readFlag(KEY_TRIGGER_OPEN, defaults.triggerOnOpen),
    categoryMode: categoryModeRaw === 'only_listed' ? 'only_listed' : 'any',
    categoryIds: parseCategoryIds(categoryIdsRaw),
  });
}

export function setReplySuggestionSettings(
  partial: Partial<ReplySuggestionSettings>,
  accountId?: number,
): ReplySuggestionSettings {
  const next = normalizeReplySuggestionSettings({
    ...getReplySuggestionSettings(accountId),
    ...partial,
  });
  const write = (base: string, value: string) => setSyncInfo(scopedKey(base, accountId), value);
  write(KEY_ENABLED, next.autoEnabled ? '1' : '0');
  write(KEY_TRIGGER_INBOUND, next.triggerOnInbound ? '1' : '0');
  write(KEY_TRIGGER_OPEN, next.triggerOnOpen ? '1' : '0');
  write(KEY_CATEGORY_MODE, next.categoryMode);
  write(KEY_CATEGORY_IDS, JSON.stringify(next.categoryIds));
  return next;
}

/** Remove per-account overrides so global defaults apply again. */
export function clearReplySuggestionAccountOverrides(accountId: number): void {
  for (const base of SETTINGS_KEYS) {
    setSyncInfo(scopedKey(base, accountId), '');
  }
}

export function messageMatchesReplySuggestionCategories(
  messageId: number,
  settings: ReplySuggestionSettings,
): boolean {
  if (settings.categoryMode !== 'only_listed') return true;
  if (settings.categoryIds.length === 0) return false;
  const categoryId = getMessageCategoryId(messageId);
  if (categoryId == null) return false;
  return settings.categoryIds.includes(categoryId);
}

/** Whether a background ensure should run for this trigger (not manual / force). */
export function shouldAutoEnsureReplySuggestion(
  messageId: number,
  trigger: ReplySuggestionAutoTrigger,
  preloadedRow?: EmailMessageRow,
): boolean {
  const row = preloadedRow ?? getEmailMessageById(messageId);
  const settings = getReplySuggestionSettings(row?.account_id);
  if (!shouldRunReplySuggestionForTrigger(settings, trigger)) return false;
  return messageMatchesReplySuggestionCategories(messageId, settings);
}
