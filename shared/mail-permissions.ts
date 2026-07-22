/**
 * Client-accessible mirror of packages/core/src/email/mail-permissions.ts.
 *
 * The web-only Vite build (SIMPLECRM_WEB_ONLY=1) does not alias `@simplecrm/core`,
 * so renderer components (e.g. mail-delegation-panel) must not import it directly.
 * These are pure constants/types with no server dependencies; a unit test asserts
 * this mirror stays in sync with the core source of truth.
 */
export const MAIL_PERMISSIONS = Object.freeze([
  'mail.metadata.read',
  'mail.content.read',
  'mail.attachment.read',
  'mail.attachment.suspicious_download',
  'mail.triage',
  'mail.comment',
  'mail.draft.create',
  'mail.draft.edit',
  'mail.send',
  'mail.send_as',
  'mail.delete',
  'mail.export',
  'mail.account.manage',
  'mail.delegation.manage',
] as const)

export type MailPermission = (typeof MAIL_PERMISSIONS)[number]

const VIEWER_PERMISSIONS = Object.freeze([
  'mail.metadata.read',
  'mail.content.read',
  'mail.attachment.read',
] as const satisfies readonly MailPermission[])

const TRIAGE_PERMISSIONS = Object.freeze([
  ...VIEWER_PERMISSIONS,
  'mail.triage',
  'mail.comment',
] as const satisfies readonly MailPermission[])

const EDITOR_PERMISSIONS = Object.freeze([
  ...TRIAGE_PERMISSIONS,
  'mail.draft.create',
  'mail.draft.edit',
] as const satisfies readonly MailPermission[])

const SENDER_PERMISSIONS = Object.freeze([
  ...EDITOR_PERMISSIONS,
  'mail.send',
] as const satisfies readonly MailPermission[])

export const MAIL_PERMISSION_PROFILES = Object.freeze({
  viewer: VIEWER_PERMISSIONS,
  triage: TRIAGE_PERMISSIONS,
  editor: EDITOR_PERMISSIONS,
  sender: SENDER_PERMISSIONS,
  manager: MAIL_PERMISSIONS,
})

export type MailPermissionProfile = keyof typeof MAIL_PERMISSION_PROFILES
