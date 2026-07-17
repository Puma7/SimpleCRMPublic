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
