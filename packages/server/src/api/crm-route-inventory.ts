/**
 * Welche HTTP-Pfade CRM-Daten liefern.
 *
 * Die Schreibpfade pruefen seit jeher `crm.write` (rejectUnlessCrmWrite), die
 * LESEpfade pruefen bislang nur die Anmeldung. Damit war die im Gruppenpanel
 * angebotene CRM-Stufe „Keins" wirkungslos: jeder angemeldete Server-Nutzer
 * konnte saemtliche Kunden, Deals, Aufgaben usw. lesen.
 *
 * Die Durchsetzung sitzt bewusst zentral im Dispatcher (server-api.ts) und
 * nicht in den einzelnen Handlern: eine neue Route unter einem der hier
 * gelisteten Wurzelsegmente ist damit automatisch abgedeckt und kann die
 * Pruefung nicht vergessen.
 *
 * `crm.write` schliesst `crm.read` ein (expandUserGroupCapabilities), Owner und
 * Admins halten ohnehin jede Capability — die Schreibpfade brauchen deshalb
 * keine zusaetzliche Ausnahme.
 *
 * NICHT enthalten ist `portal` (`/api/v1/portal/returns/...`): das oeffentliche
 * Retouren-Portal hat absichtlich keinen Principal.
 */
export const CRM_API_ROOT_SEGMENTS = [
  'activity-log',
  'calendar-entries',
  'calendar-events',
  'customer-custom-field-values',
  'customer-custom-fields',
  'customers',
  'dashboard',
  'deal-products',
  'deals',
  'follow-up',
  'jtl',
  'products',
  'return-reasons',
  'returns',
  'saved-views',
  'tasks',
] as const;

const CRM_ROOT_SEGMENT_SET: ReadonlySet<string> = new Set(CRM_API_ROOT_SEGMENTS);

/** True fuer jeden Pfad unterhalb eines CRM-Wurzelsegments (alle Methoden). */
export function isCrmApiPath(path: string): boolean {
  const withoutQuery = path.split('?')[0] ?? '';
  const match = /^\/api\/v1\/([^/]+)/.exec(withoutQuery);
  if (!match) return false;
  return CRM_ROOT_SEGMENT_SET.has(match[1]!);
}
