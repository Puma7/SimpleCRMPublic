import { requireCapability } from '../../packages/server/src/api/http';
import {
  USER_GROUP_CAPABILITY_KEYS,
  isRoleAssignmentForbidden,
  isUserGroupCapability,
} from '../../packages/server/src/api/capabilities';
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

  test('only admins may assign or change roles (users.manage cannot self-escalate)', () => {
    // Admins may assign any role, on create or update.
    expect(isRoleAssignmentForbidden(true, 'owner')).toBe(false);
    expect(isRoleAssignmentForbidden(true, 'admin', 'user')).toBe(false);
    // A delegated user manager may create ordinary users…
    expect(isRoleAssignmentForbidden(false, 'user')).toBe(false);
    // …but not privileged ones, and not change an existing role.
    expect(isRoleAssignmentForbidden(false, 'owner')).toBe(true);
    expect(isRoleAssignmentForbidden(false, 'admin')).toBe(true);
    expect(isRoleAssignmentForbidden(false, 'owner', 'user')).toBe(true);
    expect(isRoleAssignmentForbidden(false, 'admin', 'user')).toBe(true);
    // Editing a user without touching the role is allowed.
    expect(isRoleAssignmentForbidden(false, 'user', 'user')).toBe(false);
  });
});
