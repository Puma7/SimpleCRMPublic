/**
 * Welche Renderer-Routen CRM-Daten zeigen — bewusst ohne Komponenten-Import,
 * damit die Regel ohne den gesamten Router testbar bleibt.
 *
 * Serverseitig verlangen alle CRM-Pfade seit dieser Aenderung `crm.read`
 * (packages/server/src/api/crm-route-inventory.ts). Ohne dieses Gate wuerde die
 * Navigation einem Nutzer ohne CRM-Recht weiterhin Kunden/Deals/Aufgaben
 * anbieten und jede Seite liefe in ein 403 — inklusive des Dashboards unter "/",
 * das Kunden und Aufgaben aggregiert.
 *
 * `/email` und `/settings` sind KEINE CRM-Routen: sie haengen an der Mail-ACL
 * bzw. an settings.view.
 */
export const CRM_ROUTE_PREFIXES = [
  '/customers',
  '/deals',
  '/tasks',
  '/products',
  '/calendar',
  '/followup',
  '/returns',
] as const

/** Das Dashboard unter "/" zeigt letzte Kunden und offene Aufgaben. */
export function isCrmRoutePath(pathname: string): boolean {
  const path = pathname.split('?')[0] ?? ''
  if (path === '/' || path === '') return true
  return CRM_ROUTE_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  )
}

export type CrmRouteAccessContext = {
  serverClientMode: boolean
  /** false, solange die Gruppenrechte noch geladen werden — dann nicht sperren. */
  capabilitiesReady: boolean
  canReadCrm: boolean
}

export function isCrmRouteBlocked(
  pathname: string,
  context: CrmRouteAccessContext,
): boolean {
  if (!context.serverClientMode) return false
  if (!context.capabilitiesReady) return false
  if (context.canReadCrm) return false
  return isCrmRoutePath(pathname)
}
