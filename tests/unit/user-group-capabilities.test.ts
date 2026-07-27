import { requireCapability } from '../../packages/server/src/api/http';
import {
  USER_GROUP_CAPABILITY_KEYS,
  expandUserGroupCapabilities,
  isForbiddenUserMutation,
  isUserGroupCapability,
  normalizeStoredUserGroupPermissions,
} from '../../packages/server/src/api/capabilities';
import {
  USER_GROUP_CAPABILITY_KEYS as SHARED_KEYS,
  capabilityLevelForModule,
  expandUserGroupCapabilities as sharedExpand,
  templateCapabilities,
} from '../../shared/user-capabilities';
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
    expect(isUserGroupCapability('settings.manage')).toBe(true);
    expect(isUserGroupCapability('workflows.run')).toBe(true);
    expect(isUserGroupCapability('made.up')).toBe(false);
    expect(isUserGroupCapability(42)).toBe(false);
  });

  test('expand is inclusive across module levels and remaps legacy settings', () => {
    expect(expandUserGroupCapabilities(['workflows.manage'])).toEqual([
      'workflows.edit',
      'workflows.manage',
      'workflows.run',
      'workflows.view',
    ]);
    expect(expandUserGroupCapabilities(['email_settings.manage'])).toEqual([
      'settings.manage',
      'settings.view',
    ]);
    expect(sharedExpand(['crm.write'])).toEqual(['crm.read', 'crm.write']);
  });

  test('normalizeStoredUserGroupPermissions keeps highest key per module', () => {
    expect(normalizeStoredUserGroupPermissions([
      'crm.read',
      'crm.write',
      'workflows.view',
      'workflows.run',
      'email_settings.manage',
    ])).toEqual(['crm.write', 'settings.manage', 'workflows.run']);
  });

  test('template and module helpers match the matrix', () => {
    expect([...templateCapabilities('support')].sort()).toEqual(['crm.read', 'crm.write']);
    expect([...templateCapabilities('support_plus')].sort()).toEqual([
      'crm.read',
      'crm.write',
      'workflows.run',
      'workflows.view',
    ]);
    expect(capabilityLevelForModule(['workflows.run'], 'workflows')).toBe(2);
    expect(capabilityLevelForModule(['workflows.manage'], 'workflows')).toBe(4);
  });

  test('owners and admins hold every capability implicitly', () => {
    for (const role of ['owner', 'admin'] as const) {
      expect(requireCapability(principal({ role }), 'users.manage')).toBe(true);
      expect(requireCapability(principal({ role }), 'workflows.manage')).toBe(true);
      expect(requireCapability(principal({ role }), 'settings.view')).toBe(true);
    }
  });

  test('the user role gains only granted capabilities', () => {
    const granted = principal({
      role: 'user',
      capabilities: expandUserGroupCapabilities(['tracking.view', 'workflows.run']),
    });
    expect(requireCapability(granted, 'tracking.view')).toBe(true);
    expect(requireCapability(granted, 'workflows.view')).toBe(true);
    expect(requireCapability(granted, 'workflows.run')).toBe(true);
    expect(requireCapability(granted, 'workflows.edit')).toBe(false);
    expect(requireCapability(granted, 'users.manage')).toBe(false);
    expect(requireCapability(principal({ role: 'user' }), 'tracking.view')).toBe(false);
  });

  test('delegated user managers may only create/edit ordinary users', () => {
    expect(isForbiddenUserMutation(true, 'owner')).toBe(false);
    expect(isForbiddenUserMutation(true, 'admin', 'owner')).toBe(false);
    expect(isForbiddenUserMutation(false, 'user')).toBe(false);
    expect(isForbiddenUserMutation(false, 'user', 'user')).toBe(false);
    expect(isForbiddenUserMutation(false, 'owner')).toBe(true);
    expect(isForbiddenUserMutation(false, 'admin')).toBe(true);
    expect(isForbiddenUserMutation(false, 'owner', 'user')).toBe(true);
    expect(isForbiddenUserMutation(false, 'admin', 'admin')).toBe(true);
    expect(isForbiddenUserMutation(false, 'owner', 'owner')).toBe(true);
    expect(isForbiddenUserMutation(false, 'user', 'admin')).toBe(true);
  });

  test('delegated deletes may only target ordinary users', () => {
    const forbiddenForNonAdmin = (targetRole: 'owner' | 'admin' | 'user') =>
      isForbiddenUserMutation(false, targetRole, targetRole);
    expect(isForbiddenUserMutation(true, 'owner', 'owner')).toBe(false);
    expect(isForbiddenUserMutation(true, 'admin', 'admin')).toBe(false);
    expect(forbiddenForNonAdmin('user')).toBe(false);
    expect(forbiddenForNonAdmin('admin')).toBe(true);
    expect(forbiddenForNonAdmin('owner')).toBe(true);
  });
});
