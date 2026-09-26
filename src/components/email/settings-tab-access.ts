/**
 * Sichtbarkeitsregeln der Einstellungs-Tabs — bewusst ohne Komponenten-Import,
 * damit sie ohne den gesamten Panel-Baum testbar bleiben.
 *
 * Drei unabhaengige Gruende, einen Tab NICHT anzubieten:
 * - `serverOnly`: die IPC-Kanaele existieren im Standalone-Electron nicht.
 * - `personalAccount`: ohne `settings.view` bleibt nur der eigene Konto-Tab.
 * - `adminOnly`: schon der initiale GET ist serverseitig admin-only
 *   (OAuth-Apps, SMTP-Relay, Audit-Log) — fuer einen delegierten
 *   settings.view-Nutzer waere der Tab ein garantierter 403.
 * - `desktopAdminOnly`: nur im Desktop verlangen die IPC-Kanaele Owner/Admin
 *   (DSGVO-Export); der Server regelt denselben Tab ueber die Mail-ACL.
 */
export type SettingsTabAccess = {
  serverOnly?: boolean
  personalAccount?: boolean
  adminOnly?: boolean
  desktopAdminOnly?: boolean
}

export type SettingsTabAccessContext = {
  serverClientMode: boolean
  personalOnly: boolean
  isAdmin: boolean
}

export function isSettingsTabAvailable(
  tab: SettingsTabAccess,
  context: SettingsTabAccessContext,
): boolean {
  if (tab.serverOnly && !context.serverClientMode) return false
  if (context.personalOnly && !tab.personalAccount) return false
  if (tab.adminOnly && !context.isAdmin) return false
  if (tab.desktopAdminOnly && !context.serverClientMode && !context.isAdmin) return false
  return true
}
