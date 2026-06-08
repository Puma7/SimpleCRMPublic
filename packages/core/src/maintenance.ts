/** Keep in sync with `shared/maintenance.ts` (renderer cannot import @simplecrm/core). */
export const MAINTENANCE_HARD_RESET_PHRASE = 'SYSTEM LÖSCHEN';

export function maintenanceHardResetPhraseMatches(value: string): boolean {
  return value.trim() === MAINTENANCE_HARD_RESET_PHRASE;
}
