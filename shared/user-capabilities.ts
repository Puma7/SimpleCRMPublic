/**
 * Grant-only capabilities for user groups (server edition).
 * Owners/admins hold every capability implicitly; the `user` role gains the
 * union of group grants, expanded to inclusive module levels.
 *
 * Server mirror: packages/server/src/api/capabilities.ts
 * (unit test asserts the grantable key lists stay in sync).
 */

export const USER_GROUP_CAPABILITIES = [
  { key: 'crm.read', label: 'CRM ansehen', module: 'crm', level: 1 },
  { key: 'crm.write', label: 'CRM bearbeiten', module: 'crm', level: 2 },
  { key: 'workflows.view', label: 'Workflows ansehen', module: 'workflows', level: 1 },
  { key: 'workflows.run', label: 'Workflows ausfuehren', module: 'workflows', level: 2 },
  { key: 'workflows.edit', label: 'Workflows bearbeiten', module: 'workflows', level: 3 },
  { key: 'workflows.manage', label: 'Workflows verwalten', module: 'workflows', level: 4 },
  { key: 'settings.view', label: 'Einstellungen ansehen', module: 'settings', level: 1 },
  { key: 'settings.manage', label: 'Einstellungen verwalten', module: 'settings', level: 2 },
  /** @deprecated Prefer settings.manage; still accepted and expanded. */
  { key: 'email_settings.manage', label: 'E-Mail-Einstellungen verwalten (Legacy)', module: 'settings', level: 2, legacy: true },
  { key: 'tracking.view', label: 'Tracking einsehen', module: 'tracking', level: 1 },
  { key: 'users.manage', label: 'Benutzer verwalten', module: 'users', level: 1 },
] as const

export type UserGroupCapability = (typeof USER_GROUP_CAPABILITIES)[number]['key']

/** Keys shown in the admin UI (excludes legacy aliases). */
export const USER_GROUP_CAPABILITY_KEYS: readonly UserGroupCapability[] =
  USER_GROUP_CAPABILITIES.filter((c) => !('legacy' in c && c.legacy)).map((c) => c.key)

/** All keys that may appear in storage or tokens (includes legacy). */
export const USER_GROUP_CAPABILITY_STORAGE_KEYS: readonly UserGroupCapability[] =
  USER_GROUP_CAPABILITIES.map((c) => c.key)

export type CapabilityModule = 'crm' | 'workflows' | 'settings' | 'tracking' | 'users'

export type GroupRightsTemplateId = 'support' | 'support_plus' | 'backoffice' | 'readonly'

export type GroupRightsTemplate = {
  id: GroupRightsTemplateId
  label: string
  description: string
  capabilities: readonly UserGroupCapability[]
}

/**
 * One-click presets for the Apple-simple admin flow.
 * Mailbox ACL / visibility filters are configured separately on the group.
 */
export const GROUP_RIGHTS_TEMPLATES: readonly GroupRightsTemplate[] = [
  {
    id: 'support',
    label: 'Support',
    description: 'CRM bearbeiten, keine Workflows/Einstellungen. Postfaecher separat zuweisen.',
    capabilities: ['crm.read', 'crm.write'],
  },
  {
    id: 'support_plus',
    label: 'Support+',
    description: 'Wie Support, zusaetzlich Workflows ansehen und ausfuehren.',
    capabilities: ['crm.read', 'crm.write', 'workflows.view', 'workflows.run'],
  },
  {
    id: 'backoffice',
    label: 'Backoffice / Automation',
    description: 'Workflows bearbeiten und Einstellungen verwalten.',
    capabilities: [
      'crm.read',
      'crm.write',
      'workflows.view',
      'workflows.run',
      'workflows.edit',
      'workflows.manage',
      'settings.view',
      'settings.manage',
    ],
  },
  {
    id: 'readonly',
    label: 'Nur Lesen',
    description: 'CRM und (optional) Einstellungen nur ansehen.',
    capabilities: ['crm.read', 'settings.view'],
  },
]

const MODULE_LEVELS: Record<CapabilityModule, readonly UserGroupCapability[]> = {
  crm: ['crm.read', 'crm.write'],
  workflows: ['workflows.view', 'workflows.run', 'workflows.edit', 'workflows.manage'],
  settings: ['settings.view', 'settings.manage'],
  tracking: ['tracking.view'],
  users: ['users.manage'],
}

/**
 * Expand stored grants to the effective capability set (inclusive levels + legacy aliases).
 */
export function expandUserGroupCapabilities(
  granted: readonly string[] | null | undefined,
): string[] {
  if (!granted || granted.length === 0) return []
  const out = new Set<string>()
  for (const raw of granted) {
    const key = normalizeLegacyCapability(raw)
    if (!key) continue
    out.add(key)
    const moduleLevels = moduleLevelsFor(key)
    if (!moduleLevels) continue
    const idx = moduleLevels.indexOf(key as UserGroupCapability)
    if (idx < 0) continue
    for (let i = 0; i <= idx; i += 1) out.add(moduleLevels[i]!)
  }
  return [...out].sort()
}

export function normalizeLegacyCapability(value: string): string | null {
  if (value === 'email_settings.manage') return 'settings.manage'
  if ((USER_GROUP_CAPABILITY_STORAGE_KEYS as readonly string[]).includes(value)) return value
  return null
}

function moduleLevelsFor(key: string): readonly UserGroupCapability[] | null {
  for (const levels of Object.values(MODULE_LEVELS)) {
    if ((levels as readonly string[]).includes(key)) return levels
  }
  return null
}

/** Highest stored key per module for UI segmented controls. */
export function capabilityLevelForModule(
  granted: readonly string[] | null | undefined,
  module: CapabilityModule,
): number {
  const expanded = new Set(expandUserGroupCapabilities(granted))
  const levels = MODULE_LEVELS[module]
  let highest = 0
  for (let i = 0; i < levels.length; i += 1) {
    if (expanded.has(levels[i]!)) highest = i + 1
  }
  return highest
}

export function capabilitiesForModuleLevel(
  module: CapabilityModule,
  level: number,
): UserGroupCapability[] {
  if (level <= 0) return []
  const levels = MODULE_LEVELS[module]
  return [...levels.slice(0, Math.min(level, levels.length))]
}

export function mergeModuleCapabilityLevels(
  current: readonly string[],
  module: CapabilityModule,
  level: number,
): UserGroupCapability[] {
  const otherModules = (Object.keys(MODULE_LEVELS) as CapabilityModule[]).filter((m) => m !== module)
  const kept: UserGroupCapability[] = []
  for (const m of otherModules) {
    const lvl = capabilityLevelForModule(current, m)
    kept.push(...capabilitiesForModuleLevel(m, lvl))
  }
  kept.push(...capabilitiesForModuleLevel(module, level))
  // Store only the highest key per module to keep rows small.
  return compactToHighestPerModule(kept)
}

function compactToHighestPerModule(keys: readonly UserGroupCapability[]): UserGroupCapability[] {
  const result: UserGroupCapability[] = []
  for (const module of Object.keys(MODULE_LEVELS) as CapabilityModule[]) {
    const levels = MODULE_LEVELS[module]
    let highest = -1
    for (let i = 0; i < levels.length; i += 1) {
      if (keys.includes(levels[i]!)) highest = i
    }
    if (highest >= 0) result.push(levels[highest]!)
  }
  return result
}

export function templateCapabilities(id: GroupRightsTemplateId): readonly UserGroupCapability[] {
  const template = GROUP_RIGHTS_TEMPLATES.find((t) => t.id === id)
  return template?.capabilities ?? []
}
