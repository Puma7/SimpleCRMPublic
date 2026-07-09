import {
  MAINTENANCE_HARD_RESET_PHRASE,
  maintenanceHardResetPhraseMatches,
} from '../../shared/maintenance';
import { MAINTENANCE_HARD_RESET_PHRASE as corePhrase } from '@simplecrm/core';

describe('maintenanceHardResetPhraseMatches', () => {
  test('shared and core export the same phrase', () => {
    expect(MAINTENANCE_HARD_RESET_PHRASE).toBe(corePhrase);
  });

  test('accepts exact phrase', () => {
    expect(maintenanceHardResetPhraseMatches(MAINTENANCE_HARD_RESET_PHRASE)).toBe(true);
  });

  test('rejects variants', () => {
    expect(maintenanceHardResetPhraseMatches('system löschen')).toBe(false);
    expect(maintenanceHardResetPhraseMatches('WIEDERHERSTELLEN')).toBe(false);
    expect(maintenanceHardResetPhraseMatches('')).toBe(false);
  });
});
