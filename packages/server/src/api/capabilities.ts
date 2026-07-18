/**
 * Inlined mirror of shared/user-capabilities.ts (no /shared copy in the
 * packages/server Docker build). A unit test asserts the two lists match.
 */
export const USER_GROUP_CAPABILITY_KEYS = [
  'email_settings.manage',
  'workflows.manage',
  'crm.write',
  'tracking.view',
  'users.manage',
] as const;

export type UserGroupCapability = (typeof USER_GROUP_CAPABILITY_KEYS)[number];

const CAPABILITY_KEY_SET: ReadonlySet<string> = new Set(USER_GROUP_CAPABILITY_KEYS);

export function isUserGroupCapability(value: unknown): value is UserGroupCapability {
  return typeof value === 'string' && CAPABILITY_KEY_SET.has(value);
}

type UserRole = 'owner' | 'admin' | 'user';

/**
 * Privileged user management is admin-only. A delegated user manager
 * (users.manage but not admin) may only create and edit ordinary `user`
 * accounts: they must never assign a privileged role, and must never mutate an
 * existing admin/owner account (e.g. reset its password or disable an owner).
 * `existingRole` is undefined when creating a new user.
 */
export function isForbiddenUserMutation(
  actorIsAdmin: boolean,
  requestedRole: UserRole,
  existingRole?: UserRole,
): boolean {
  if (actorIsAdmin) return false;
  if (requestedRole !== 'user') return true;
  if (existingRole !== undefined && existingRole !== 'user') return true;
  return false;
}
