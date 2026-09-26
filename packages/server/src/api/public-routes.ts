/**
 * Welche Endpunkte antworten OHNE Anmeldung?
 *
 * Es gibt keine zentrale Auth-Schranke im Dispatcher: jedes Routenmodul ruft
 * requirePrincipal selbst auf. Diese Liste ist die bewusste Ausnahme davon und
 * wird an zwei Stellen gebraucht:
 *
 *  - Der Fastify-Adapter verlangt fuer jede andere /api/v1-Route die Anmeldung,
 *    BEVOR er den Body liest (F-A13A14-02). Fehlt hier ein oeffentlicher
 *    Endpunkt, bekommt er dort 401 — er faellt also sofort auf.
 *  - tests/unit/api-auth-surface.test.ts haelt die Liste gegen den Dispatcher:
 *    genau diese Endpunkte liefern ohne Principal etwas anderes als das 401
 *    von requirePrincipal. Eine Route, die versehentlich oeffentlich wird, und
 *    eine bewusst oeffentliche, die hier fehlt, schlagen dort an.
 *
 * Form: `METHODE /pfad`, Parameter als `:name`.
 */
export const PUBLIC_API_ROUTES: readonly string[] = Object.freeze([
  // Betriebsproben. Liefern Status und einen Datenbank-Ping, sonst nichts.
  'GET /health',
  'GET /health/ready',
  'GET /api/v1/health',
  'GET /api/v1/health/ready',
  // Anmeldung selbst. Ohne diese Endpunkte kaeme niemand je an ein Token.
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/logout',
  'GET /api/v1/auth/login-config',
  'GET /api/v1/auth/setup-state',
  'POST /api/v1/auth/initial-setup',
  'POST /api/v1/auth/captcha-verify',
  'POST /api/v1/auth/mfa/verify',
  // Sitzungserneuerung: der Nachweis ist das Refresh-Cookie, nicht ein
  // Access-Token. Ohne Cookie antworten beide mit einem eigenen 401.
  'GET /api/v1/auth/csrf',
  'POST /api/v1/auth/refresh',
  // Einladungen: der Token IST der Nachweis, ein Principal existiert noch nicht.
  'GET /api/v1/auth/invitations/:token',
  'POST /api/v1/auth/invitations/:token/accept',
  // Oeffentliches Retouren-Portal. Eigene Ratenbegrenzung, CAPTCHA-Pflicht und
  // Token-Pruefung; siehe returns-routes.
  'POST /api/v1/portal/returns/:token',
  'GET /api/v1/portal/returns/:token/:returnNumber',
  // Liefert nur { captchaRequired, siteKey } fuer den Workspace des Tokens
  // (F-A3a-03); gleiche Ratenbegrenzung und Token-Pruefung wie die Abfrage.
  'GET /api/v1/portal/returns/:token/config',
  // Zaehlpixel. Muss aus fremden Mail-Clients erreichbar sein und antwortet
  // immer gleich, damit sich daraus nichts ablesen laesst.
  //
  // Der Klick-Endpunkt /t/c/:token gehoert derselben oeffentlichen Klasse an,
  // erscheint hier aber nicht: mit einem ungueltigen Token antwortet er 404 und
  // ist damit von einer nicht existierenden Route nicht zu unterscheiden. Die
  // Probe im Test sieht, wer OHNE Anmeldung Daten liefert, nicht jeden Pfad.
  // Fuer den Adapter spielt das keine Rolle: /t/ liegt ausserhalb von /api/v1.
  'GET /t/o/:token.gif',
]);

const PUBLIC_API_ROUTE_MATCHERS: ReadonlyArray<{ method: string; pattern: RegExp }> = PUBLIC_API_ROUTES.map(
  (route) => {
    const [method, template] = route.split(' ') as [string, string];
    const source = template
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/:[A-Za-z]+/g, '[^/]+');
    return { method, pattern: new RegExp(`^${source}$`) };
  },
);

/** Ob `METHOD path` ohne Anmeldung beantwortet wird (siehe PUBLIC_API_ROUTES). */
export function isPublicApiRoute(method: string, path: string): boolean {
  return PUBLIC_API_ROUTE_MATCHERS.some((route) => route.method === method && route.pattern.test(path));
}
