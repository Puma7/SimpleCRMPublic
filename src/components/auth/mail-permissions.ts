/**
 * Die eigenen Mail-Berechtigungen im Renderer.
 *
 * Die Capability-Stufen (crm/workflows/settings/…) und die Mail-ACL sind zwei
 * unabhaengige Systeme. Der Renderer kannte bisher nur die erste — deshalb bot
 * er Bedienelemente an, deren Aufruf garantiert im 403 endet: Konto anlegen und
 * loeschen, SMTP, OAuth-Verknuepfung und Signaturen haengen alle an
 * `mail.account.manage`, nicht an `settings.manage`.
 *
 * Bewusst ohne React-Import, damit die Regeln ohne Komponentenbaum testbar sind.
 */
export type MailPermissionReport = {
  /** Owner/Admin halten jede Berechtigung auf jeder Ressource. */
  unrestricted: boolean
  /** Irgendwo gehalten — reicht, um ein Bedienelement ueberhaupt anzubieten. */
  permissions: readonly string[]
  /** Konto-Id → dort gehaltene Berechtigungen. Bei `unrestricted` leer. */
  accountPermissions: Readonly<Record<string, readonly string[]>>
}

export const EMPTY_MAIL_PERMISSION_REPORT: MailPermissionReport = {
  unrestricted: false,
  permissions: [],
  accountPermissions: {},
}

/**
 * Im Desktop gibt es keine Mail-ACL — dort gilt alles als erlaubt. Solange der
 * Bericht in der Server-Edition noch laedt, ebenfalls: ein Gate, das im ersten
 * Render zuschlaegt, laesst die Oberflaeche aufblitzen.
 */
export type MailPermissionContext = {
  serverClientMode: boolean
  ready: boolean
  report: MailPermissionReport
}

export function hasMailPermission(
  context: MailPermissionContext,
  permission: string,
): boolean {
  if (!context.serverClientMode) return true
  if (!context.ready) return true
  if (context.report.unrestricted) return true
  return context.report.permissions.includes(permission)
}

/**
 * Dieselbe Frage fuer ein KONKRETES Konto.
 *
 * Bewusst FAIL CLOSED, solange der Bericht laedt — anders als
 * `hasMailPermission`. Der Unterschied ist der Zweck: die Anywhere-Frage
 * entscheidet, ob ein Bereich ueberhaupt angeboten wird (dort waere ein
 * Aufblitzen das groessere Uebel), die Konto-Frage gatet MUTIERENDE Aktionen —
 * Konto loeschen, IMAP/SMTP/OAuth bearbeiten. Waeren die waehrend des Ladens
 * bedienbar, koennte ein eingeschraenkter Nutzer sie ausloesen und liefe sicher
 * ins 403. Ein kurz verzoegertes Bedienelement ist der bessere Fehler; dieselbe
 * Regel gilt fuer `mailAccessUnrestricted` beim Anlegen.
 */
export function hasMailPermissionForAccount(
  context: MailPermissionContext,
  permission: string,
  accountId: number | string | null | undefined,
): boolean {
  if (!context.serverClientMode) return true
  if (!context.ready) return false
  if (context.report.unrestricted) return true
  if (accountId == null) return false
  const held = context.report.accountPermissions[String(accountId)]
  return Array.isArray(held) && held.includes(permission)
}

export function parseMailPermissionReport(value: unknown): MailPermissionReport {
  if (!value || typeof value !== "object") return EMPTY_MAIL_PERMISSION_REPORT
  const raw = value as Record<string, unknown>
  const permissions = Array.isArray(raw.permissions)
    ? raw.permissions.filter((entry): entry is string => typeof entry === "string")
    : []
  const accountPermissions: Record<string, readonly string[]> = {}
  if (raw.accountPermissions && typeof raw.accountPermissions === "object") {
    for (const [accountId, held] of Object.entries(raw.accountPermissions as Record<string, unknown>)) {
      if (!Array.isArray(held)) continue
      accountPermissions[accountId] = held.filter((entry): entry is string => typeof entry === "string")
    }
  }
  return {
    unrestricted: raw.unrestricted === true,
    permissions,
    accountPermissions,
  }
}
