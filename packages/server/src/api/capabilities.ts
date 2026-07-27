/**
 * Inlined mirror of shared/user-capabilities.ts (no /shared copy in the
 * packages/server Docker build). A unit test asserts the grantable key lists match.
 */

export const USER_GROUP_CAPABILITY_KEYS = [
  'crm.read',
  'crm.write',
  'workflows.view',
  'workflows.run',
  'workflows.edit',
  'workflows.manage',
  'settings.view',
  'settings.manage',
  'tracking.view',
  'users.manage',
] as const;

/** Includes legacy aliases accepted in storage / tokens. */
export const USER_GROUP_CAPABILITY_STORAGE_KEYS = [
  ...USER_GROUP_CAPABILITY_KEYS,
  'email_settings.manage',
] as const;

export type UserGroupCapability = (typeof USER_GROUP_CAPABILITY_STORAGE_KEYS)[number];

const CAPABILITY_KEY_SET: ReadonlySet<string> = new Set(USER_GROUP_CAPABILITY_STORAGE_KEYS);
const GRANTABLE_KEY_SET: ReadonlySet<string> = new Set(USER_GROUP_CAPABILITY_KEYS);

export function isUserGroupCapability(value: unknown): value is UserGroupCapability {
  return typeof value === 'string' && CAPABILITY_KEY_SET.has(value);
}

const MODULE_LEVELS = {
  crm: ['crm.read', 'crm.write'],
  workflows: ['workflows.view', 'workflows.run', 'workflows.edit', 'workflows.manage'],
  settings: ['settings.view', 'settings.manage'],
  tracking: ['tracking.view'],
  users: ['users.manage'],
} as const;

export function normalizeLegacyCapability(value: string): string | null {
  if (value === 'email_settings.manage') return 'settings.manage';
  if (GRANTABLE_KEY_SET.has(value)) return value;
  return null;
}

export function expandUserGroupCapabilities(
  granted: readonly string[] | null | undefined,
): string[] {
  if (!granted || granted.length === 0) return [];
  const out = new Set<string>();
  for (const raw of granted) {
    const key = normalizeLegacyCapability(raw);
    if (!key) continue;
    out.add(key);
    for (const levels of Object.values(MODULE_LEVELS)) {
      const idx = (levels as readonly string[]).indexOf(key);
      if (idx < 0) continue;
      for (let i = 0; i <= idx; i += 1) out.add(levels[i]!);
    }
  }
  return [...out].sort();
}

/** Normalize + compact grants for persistence (highest key per module). */
export function normalizeStoredUserGroupPermissions(
  granted: readonly string[] | null | undefined,
): string[] {
  if (!granted || granted.length === 0) return [];
  const normalized = new Set<string>();
  for (const raw of granted) {
    const key = normalizeLegacyCapability(raw);
    if (key) normalized.add(key);
  }
  const result: string[] = [];
  for (const levels of Object.values(MODULE_LEVELS)) {
    let highest = -1;
    for (let i = 0; i < levels.length; i += 1) {
      if (normalized.has(levels[i]!)) highest = i;
    }
    if (highest >= 0) result.push(levels[highest]!);
  }
  return result.sort();
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
