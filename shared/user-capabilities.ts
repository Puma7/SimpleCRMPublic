/**
 * Grant-only capabilities that can be granted to user groups. Owners and admins
 * hold every capability implicitly; the `user` role gains only what its groups grant.
 *
 * The server keeps an inlined mirror of these keys in
 * packages/server/src/api/capabilities.ts (no /shared copy in the Docker build);
 * a unit test asserts the two lists stay in sync.
 */
export const USER_GROUP_CAPABILITIES = [
  { key: 'email_settings.manage', label: 'E-Mail-Einstellungen verwalten' },
  { key: 'workflows.manage', label: 'Workflows verwalten' },
  { key: 'crm.write', label: 'CRM-Daten bearbeiten' },
  { key: 'tracking.view', label: 'Tracking einsehen' },
  { key: 'users.manage', label: 'Benutzer verwalten' },
] as const

export type UserGroupCapability = (typeof USER_GROUP_CAPABILITIES)[number]['key']

export const USER_GROUP_CAPABILITY_KEYS: readonly UserGroupCapability[] =
  USER_GROUP_CAPABILITIES.map((c) => c.key)
