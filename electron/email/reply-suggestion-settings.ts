import {
  DEFAULT_REPLY_SUGGESTION_SETTINGS,
  normalizeReplySuggestionSettings,
  shouldRunReplySuggestionForTrigger,
  type ReplySuggestionAutoTrigger,
  type ReplySuggestionSettings,
} from '../../shared/reply-suggestion-settings';
import { getSyncInfo, setSyncInfo } from '../sqlite-service';
import { getMessageCategoryId } from './email-crm-store';
import type { EmailMessageRow } from './email-store';

const KEY_ENABLED = 'reply_suggestion_auto_enabled';
const KEY_TRIGGER_INBOUND = 'reply_suggestion_trigger_inbound';
const KEY_TRIGGER_OPEN = 'reply_suggestion_trigger_on_open';
const KEY_CATEGORY_MODE = 'reply_suggestion_category_mode';
const KEY_CATEGORY_IDS = 'reply_suggestion_category_ids';

function flagFromSync(key: string, defaultValue: boolean): boolean {
  const raw = getSyncInfo(key);
  if (raw === null || raw === undefined || raw === '') return defaultValue;
  return raw === '1' || raw.toLowerCase() === 'true';
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

export function getReplySuggestionSettings(): ReplySuggestionSettings {
  const defaults = DEFAULT_REPLY_SUGGESTION_SETTINGS;
  const categoryModeRaw = getSyncInfo(KEY_CATEGORY_MODE);
  return normalizeReplySuggestionSettings({
    autoEnabled: flagFromSync(KEY_ENABLED, defaults.autoEnabled),
    triggerOnInbound: flagFromSync(KEY_TRIGGER_INBOUND, defaults.triggerOnInbound),
    triggerOnOpen: flagFromSync(KEY_TRIGGER_OPEN, defaults.triggerOnOpen),
    categoryMode: categoryModeRaw === 'only_listed' ? 'only_listed' : 'any',
    categoryIds: parseCategoryIds(getSyncInfo(KEY_CATEGORY_IDS)),
  });
}

export function setReplySuggestionSettings(
  partial: Partial<ReplySuggestionSettings>,
): ReplySuggestionSettings {
  const next = normalizeReplySuggestionSettings({
    ...getReplySuggestionSettings(),
    ...partial,
  });
  setSyncInfo(KEY_ENABLED, next.autoEnabled ? '1' : '0');
  setSyncInfo(KEY_TRIGGER_INBOUND, next.triggerOnInbound ? '1' : '0');
  setSyncInfo(KEY_TRIGGER_OPEN, next.triggerOnOpen ? '1' : '0');
  setSyncInfo(KEY_CATEGORY_MODE, next.categoryMode);
  setSyncInfo(KEY_CATEGORY_IDS, JSON.stringify(next.categoryIds));
  return next;
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
): boolean {
  const settings = getReplySuggestionSettings();
  if (!shouldRunReplySuggestionForTrigger(settings, trigger)) return false;
  return messageMatchesReplySuggestionCategories(messageId, settings);
}
