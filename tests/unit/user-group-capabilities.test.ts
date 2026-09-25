import { requireCapability } from '../../packages/server/src/api/http';
import {
  USER_GROUP_CAPABILITY_KEYS,
  expandUserGroupCapabilities,
  isForbiddenUserMutation,
  isTargetMorePrivileged,
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
    expect(isForbiddenUserMutation('user', 'user')).toBeNull();
    expect(isForbiddenUserMutation('user', 'user', 'user')).toBeNull();
    expect(isForbiddenUserMutation('user', 'owner')).toBe('role_change_forbidden');
    expect(isForbiddenUserMutation('user', 'admin')).toBe('role_change_forbidden');
    expect(isForbiddenUserMutation('user', 'owner', 'user')).toBe('role_change_forbidden');
    expect(isForbiddenUserMutation('user', 'admin', 'admin')).toBe('role_change_forbidden');
    expect(isForbiddenUserMutation('user', 'owner', 'owner')).toBe('role_change_forbidden');
    expect(isForbiddenUserMutation('user', 'user', 'admin')).toBe('role_change_forbidden');
  });

  // C-A72 (G3): Ein Admin durfte die Owner-Rolle vergeben und Owner-Konten aendern. Frueher hielt
  // dieser Test `isForbiddenUserMutation(true, 'owner') === false` als gewollt fest (F-A2b-05 BY-DESIGN);
  // mit G3 vergeben und entziehen nur Owner die Owner-Rolle und aendern Owner-Konten.
  test('only owners assign or revoke the owner role and change owner accounts', () => {
    expect(isForbiddenUserMutation('admin', 'owner')).toBe('owner_management_requires_owner');
    expect(isForbiddenUserMutation('admin', 'owner', 'admin')).toBe('owner_management_requires_owner');
    expect(isForbiddenUserMutation('admin', 'owner', 'user')).toBe('owner_management_requires_owner');
    expect(isForbiddenUserMutation('admin', 'admin', 'owner')).toBe('owner_management_requires_owner');
    expect(isForbiddenUserMutation('admin', 'owner', 'owner')).toBe('owner_management_requires_owner');

    expect(isForbiddenUserMutation('owner', 'owner')).toBeNull();
    expect(isForbiddenUserMutation('owner', 'owner', 'user')).toBeNull();
    expect(isForbiddenUserMutation('owner', 'admin', 'owner')).toBeNull();
    expect(isForbiddenUserMutation('owner', 'owner', 'owner')).toBeNull();
  });

  test('admins keep managing every account that is not an owner', () => {
    expect(isForbiddenUserMutation('admin', 'admin')).toBeNull();
    expect(isForbiddenUserMutation('admin', 'user')).toBeNull();
    expect(isForbiddenUserMutation('admin', 'admin', 'admin')).toBeNull();
    expect(isForbiddenUserMutation('admin', 'user', 'admin')).toBeNull();
    expect(isForbiddenUserMutation('admin', 'admin', 'user')).toBeNull();
  });

  test('delegated deletes may only target ordinary users', () => {
    const deleteDenial = (actorRole: 'owner' | 'admin' | 'user', targetRole: 'owner' | 'admin' | 'user') =>
      isForbiddenUserMutation(actorRole, targetRole, targetRole);
    expect(deleteDenial('owner', 'owner')).toBeNull();
    expect(deleteDenial('owner', 'admin')).toBeNull();
    expect(deleteDenial('admin', 'admin')).toBeNull();
    expect(deleteDenial('admin', 'user')).toBeNull();
    expect(deleteDenial('admin', 'owner')).toBe('owner_management_requires_owner');
    expect(deleteDenial('user', 'user')).toBeNull();
    expect(deleteDenial('user', 'admin')).toBe('role_change_forbidden');
    expect(deleteDenial('user', 'owner')).toBe('role_change_forbidden');
  });

  // F-A2b-06: users.manage delegates could reset 'user' accounts that hold more
  // group capabilities or mailbox delegations than they do.
  test('a delegate may only manage targets whose rights are a subset of their own', () => {
    const helpdesk = ['users.manage', 'crm.write'];
    const target = (grantedCapabilities: string[], hasMailAclBindings = false) => ({
      grantedCapabilities,
      hasMailAclBindings,
    });
    expect(isTargetMorePrivileged(helpdesk, target([]))).toBe(false);
    expect(isTargetMorePrivileged(helpdesk, target(['crm.read']))).toBe(false);
    expect(isTargetMorePrivileged(helpdesk, target(['crm.write', 'users.manage']))).toBe(false);
    expect(isTargetMorePrivileged(helpdesk, target(['settings.view']))).toBe(true);
    expect(isTargetMorePrivileged(['settings.view', 'users.manage'], target(['email_settings.manage']))).toBe(true);
    expect(isTargetMorePrivileged(['settings.manage', 'users.manage'], target(['email_settings.manage']))).toBe(false);
    expect(isTargetMorePrivileged(['workflows.edit'], target(['workflows.run']))).toBe(false);
    expect(isTargetMorePrivileged(['workflows.run'], target(['workflows.edit']))).toBe(true);
    expect(isTargetMorePrivileged(undefined, target(['crm.read']))).toBe(true);
    expect(isTargetMorePrivileged(helpdesk, target(['unknown.key']))).toBe(false);
    expect(isTargetMorePrivileged(helpdesk, target([], true))).toBe(true);
  });
});
