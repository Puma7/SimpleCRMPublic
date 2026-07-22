import {
  MAIL_PERMISSIONS as CORE_PERMISSIONS,
  MAIL_PERMISSION_PROFILES as CORE_PROFILES,
} from '@simplecrm/core';
import {
  MAIL_PERMISSIONS as SHARED_PERMISSIONS,
  MAIL_PERMISSION_PROFILES as SHARED_PROFILES,
} from '../../shared/mail-permissions';

// The renderer can't import @simplecrm/core (the web-only Vite build doesn't
// alias it), so shared/mail-permissions.ts mirrors the core source of truth.
// Keep the two in lockstep.
describe('shared mail-permissions mirror', () => {
  test('permission list matches core exactly (order included)', () => {
    expect([...SHARED_PERMISSIONS]).toEqual([...CORE_PERMISSIONS]);
  });

  test('permission profiles match core exactly', () => {
    const coreKeys = Object.keys(CORE_PROFILES).sort();
    expect(Object.keys(SHARED_PROFILES).sort()).toEqual(coreKeys);
    for (const key of coreKeys) {
      const coreProfile = (CORE_PROFILES as Record<string, readonly string[]>)[key]!;
      const sharedProfile = (SHARED_PROFILES as Record<string, readonly string[]>)[key]!;
      expect([...sharedProfile]).toEqual([...coreProfile]);
    }
  });
});
