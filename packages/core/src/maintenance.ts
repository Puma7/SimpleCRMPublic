/** Typed confirmation for factory reset / hard reinstall (server + desktop). */
export const MAINTENANCE_HARD_RESET_PHRASE = 'SYSTEM LÖSCHEN';

export function maintenanceHardResetPhraseMatches(value: string): boolean {
  return value.trim() === MAINTENANCE_HARD_RESET_PHRASE;
}
