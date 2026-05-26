/** When automatic KI reply suggestions may run (cost / data control). */
export type ReplySuggestionAutoTrigger = 'inbound' | 'open';

export type ReplySuggestionCategoryMode = 'any' | 'only_listed';

export type ReplySuggestionSettings = {
  /** Master switch for background suggestion jobs (manual button still works). */
  autoEnabled: boolean;
  /** After sync / inbound workflows (E-Mail eingegangen). */
  triggerOnInbound: boolean;
  /** When a message is opened in the reader (no re-generation if already ready). */
  triggerOnOpen: boolean;
  /** Restrict auto generation to listed CRM categories (e.g. after workflow sorting). */
  categoryMode: ReplySuggestionCategoryMode;
  categoryIds: number[];
};

export const DEFAULT_REPLY_SUGGESTION_SETTINGS: ReplySuggestionSettings = {
  autoEnabled: true,
  triggerOnInbound: true,
  triggerOnOpen: true,
  categoryMode: 'any',
  categoryIds: [],
};

export function normalizeReplySuggestionSettings(
  partial: Partial<ReplySuggestionSettings> | null | undefined,
): ReplySuggestionSettings {
  const base = DEFAULT_REPLY_SUGGESTION_SETTINGS;
  if (!partial) return { ...base };
  const categoryIds = Array.isArray(partial.categoryIds)
    ? partial.categoryIds
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0)
    : base.categoryIds;
  const categoryMode =
    partial.categoryMode === 'only_listed' ? 'only_listed' : 'any';
  return {
    autoEnabled: partial.autoEnabled ?? base.autoEnabled,
    triggerOnInbound: partial.triggerOnInbound ?? base.triggerOnInbound,
    triggerOnOpen: partial.triggerOnOpen ?? base.triggerOnOpen,
    categoryMode,
    categoryIds,
  };
}

export function shouldRunReplySuggestionForTrigger(
  settings: ReplySuggestionSettings,
  trigger: ReplySuggestionAutoTrigger,
): boolean {
  if (!settings.autoEnabled) return false;
  if (trigger === 'inbound') return settings.triggerOnInbound;
  return settings.triggerOnOpen;
}
