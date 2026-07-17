import { requireCapability } from '../../packages/server/src/api/http';
import { USER_GROUP_CAPABILITY_KEYS, isUserGroupCapability } from '../../packages/server/src/api/capabilities';
import { USER_GROUP_CAPABILITY_KEYS as SHARED_KEYS } from '../../shared/user-capabilities';
import type { AuthenticatedPrincipal } from '../../packages/server/src/api/types';

function principal(overrides: Partial<AuthenticatedPrincipal>): AuthenticatedPrincipal {
  return {
    userId: 'u1',
    workspaceId: 'w1',
    role: 'user',
    ...overrides,
  };
}

describe('user group capabilities', () => {
  test('the server capability list mirrors the shared list exactly', () => {
    expect([...USER_GROUP_CAPABILITY_KEYS].sort()).toEqual([...SHARED_KEYS].sort());
  });

  test('isUserGroupCapability only accepts known keys', () => {
    expect(isUserGroupCapability('email_settings.manage')).toBe(true);
    expect(isUserGroupCapability('made.up')).toBe(false);
    expect(isUserGroupCapability(42)).toBe(false);
  });

  test('owners and admins hold every capability implicitly', () => {
    for (const role of ['owner', 'admin'] as const) {
      expect(requireCapability(principal({ role }), 'users.manage')).toBe(true);
      expect(requireCapability(principal({ role }), 'workflows.manage')).toBe(true);
    }
  });

  test('the user role gains only granted capabilities', () => {
    const granted = principal({ role: 'user', capabilities: ['tracking.view'] });
    expect(requireCapability(granted, 'tracking.view')).toBe(true);
    expect(requireCapability(granted, 'users.manage')).toBe(false);
    // No grants at all → nothing beyond the base role.
    expect(requireCapability(principal({ role: 'user' }), 'tracking.view')).toBe(false);
  });
});
