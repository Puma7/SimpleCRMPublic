import {
  MAINTENANCE_HARD_RESET_PHRASE,
  maintenanceHardResetPhraseMatches,
} from '@simplecrm/core';

describe('maintenanceHardResetPhraseMatches', () => {
  test('accepts exact phrase', () => {
    expect(maintenanceHardResetPhraseMatches(MAINTENANCE_HARD_RESET_PHRASE)).toBe(true);
  });

  test('rejects variants', () => {
    expect(maintenanceHardResetPhraseMatches('system löschen')).toBe(false);
    expect(maintenanceHardResetPhraseMatches('WIEDERHERSTELLEN')).toBe(false);
    expect(maintenanceHardResetPhraseMatches('')).toBe(false);
  });
});
