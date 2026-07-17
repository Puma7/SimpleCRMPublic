import { requireCapability } from '../../packages/server/src/api/http';
import {
  USER_GROUP_CAPABILITY_KEYS,
  isForbiddenUserMutation,
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

  test('delegated user managers may only create/edit ordinary users', () => {
    // Admins may create or edit any account.
    expect(isForbiddenUserMutation(true, 'owner')).toBe(false);
    expect(isForbiddenUserMutation(true, 'admin', 'owner')).toBe(false);
    // A delegated user manager may create and edit ordinary users…
    expect(isForbiddenUserMutation(false, 'user')).toBe(false);
    expect(isForbiddenUserMutation(false, 'user', 'user')).toBe(false);
    // …but never create/assign a privileged role…
    expect(isForbiddenUserMutation(false, 'owner')).toBe(true);
    expect(isForbiddenUserMutation(false, 'admin')).toBe(true);
    expect(isForbiddenUserMutation(false, 'owner', 'user')).toBe(true);
    // …and never touch an existing admin/owner account (even keeping its role),
    // which would otherwise allow resetting an admin's password or disabling an owner.
    expect(isForbiddenUserMutation(false, 'admin', 'admin')).toBe(true);
    expect(isForbiddenUserMutation(false, 'owner', 'owner')).toBe(true);
    expect(isForbiddenUserMutation(false, 'user', 'admin')).toBe(true);
  });

  test('delegated deletes may only target ordinary users', () => {
    // The DELETE route guards with isForbiddenUserMutation(actorIsAdmin, role, role)
    // where `role` is the target account's existing role.
    const forbiddenForNonAdmin = (targetRole: 'owner' | 'admin' | 'user') =>
      isForbiddenUserMutation(false, targetRole, targetRole);
    // Admins may delete anyone (subject to the separate last-owner check).
    expect(isForbiddenUserMutation(true, 'owner', 'owner')).toBe(false);
    expect(isForbiddenUserMutation(true, 'admin', 'admin')).toBe(false);
    // A delegated user manager may delete ordinary users…
    expect(forbiddenForNonAdmin('user')).toBe(false);
    // …but never delete an admin or owner (which would revoke their sessions).
    expect(forbiddenForNonAdmin('admin')).toBe(true);
    expect(forbiddenForNonAdmin('owner')).toBe(true);
  });
});
