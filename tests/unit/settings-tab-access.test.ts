import { isSettingsTabAvailable } from '@/components/email/settings-tab-access';

/**
 * Regression: OAuth-Apps, SMTP-Relay und Audit-Log sind serverseitig schon
 * beim LESEN admin-only (mail-routes / relay-routes / auth-routes). Einem
 * delegierten settings.view-Nutzer angeboten, enden sie garantiert im 403.
 */
describe('settings tab access', () => {
  const server = { serverClientMode: true, personalOnly: false, isAdmin: false };

  test('hides admin-only tabs from a delegated settings reader', () => {
    expect(isSettingsTabAvailable({ adminOnly: true }, server)).toBe(false);
    expect(isSettingsTabAvailable({ adminOnly: true }, { ...server, isAdmin: true })).toBe(true);
  });

  test('keeps ordinary tabs available for the same user', () => {
    expect(isSettingsTabAvailable({}, server)).toBe(true);
    expect(isSettingsTabAvailable({ serverOnly: true }, server)).toBe(true);
  });

  test('personalOnly leaves only the personal account tab', () => {
    const personal = { ...server, personalOnly: true };
    expect(isSettingsTabAvailable({ personalAccount: true }, personal)).toBe(true);
    expect(isSettingsTabAvailable({}, personal)).toBe(false);
    // Auch ein Admin sieht im personalOnly-Zustand nichts anderes.
    expect(isSettingsTabAvailable({ adminOnly: true }, { ...personal, isAdmin: true })).toBe(false);
  });

  test('server-only tabs stay hidden in standalone electron', () => {
    const desktop = { serverClientMode: false, personalOnly: false, isAdmin: true };
    expect(isSettingsTabAvailable({ serverOnly: true }, desktop)).toBe(false);
    expect(isSettingsTabAvailable({}, desktop)).toBe(true);
  });
});
