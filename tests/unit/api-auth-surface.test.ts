import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createServerApi } from '../../packages/server/src/api/server-api';
import type { HttpMethod, ServerApiPorts } from '../../packages/server/src/api/types';

const API_DIR = join(__dirname, '..', '..', 'packages', 'server', 'src', 'api');

/**
 * Genau die Methoden, die der Fastify-Adapter durchlaesst. PUT gehoert nicht
 * dazu und wird dort mit 405 abgewiesen, bevor der Dispatcher ueberhaupt
 * gefragt wird — ihn hier zu proben wuerde Treffer melden, die ueber HTTP
 * niemand erreicht. Der Test unten haelt die Liste mit dem Adapter zusammen.
 */
const METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PATCH', 'DELETE'];

/**
 * Welche Endpunkte antworten OHNE Anmeldung?
 *
 * Es gibt keine zentrale Auth-Schranke: jedes Routenmodul ruft requirePrincipal
 * selbst auf. Das ist heute lueckenlos, aber eine neu hinzugefuegte Route kann
 * es still vergessen — und das faellt sonst niemandem auf, weil die Route ja
 * funktioniert. Genau diese Klasse Fehler faengt dieser Test.
 *
 * Gemessen wird nicht "gibt 401 zurueck", sondern die staerkere Aussage: die
 * MENGE der ohne Principal erreichbaren Endpunkte ist genau die unten
 * aufgezaehlte. Damit schlaegt der Test in beide Richtungen an — eine Route,
 * die versehentlich oeffentlich wird, und eine bewusst oeffentliche, die
 * jemand hinzufuegt, ohne sie hier einzutragen. Das Eintragen ist die
 * eigentliche Absicht: es macht die Entscheidung sichtbar.
 *
 * Nachgewiesen, dass er anschlaegt: nimmt man requirePrincipal aus
 * user-group-routes heraus, meldet er acht neu offene Endpunkte. Bei den
 * CRM-Pfaden greift zusaetzlich eine zentrale Schranke im Dispatcher
 * (isCrmApiPath in server-api.ts) — dort bliebe derselbe Eingriff folgenlos.
 * Der Wert dieses Tests liegt deshalb bei allem, was NICHT unter dieser
 * zweiten Schranke liegt: Mail, Workflows, Einstellungen, Auth-Verwaltung.
 */
const PUBLIC_SURFACE: readonly string[] = [
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
  // Einladungen: der Token IST der Nachweis, ein Principal existiert noch nicht.
  'GET /api/v1/auth/invitations/:token',
  'POST /api/v1/auth/invitations/:token/accept',
  // Oeffentliches Retouren-Portal. Eigene Ratenbegrenzung, CAPTCHA-Pflicht und
  // Token-Pruefung; siehe returns-routes.
  'POST /api/v1/portal/returns/:token',
  'GET /api/v1/portal/returns/:token/:returnNumber',
  // Zaehlpixel. Muss aus fremden Mail-Clients erreichbar sein und antwortet
  // immer gleich, damit sich daraus nichts ablesen laesst.
  //
  // Der Klick-Endpunkt /t/c/:token gehoert derselben oeffentlichen Klasse an,
  // erscheint hier aber nicht: mit einem ungueltigen Token antwortet er 404 und
  // ist damit von einer nicht existierenden Route nicht zu unterscheiden. Das
  // ist die Grenze dieser Probe — sie sieht, wer OHNE Anmeldung Daten liefert,
  // nicht jeden Pfad, den es gibt.
  'GET /t/o/:token.gif',
];

/**
 * Jede Port-Eigenschaft existiert (kein `if (!ports.x) return 503`-Kurzschluss
 * verdeckt den Auth-Pfad), und jeder tatsaechliche Datenzugriff wirft erkennbar.
 * Nur so trennt der Test "Handler hat 401 geliefert" von "Handler war ohne
 * Principal schon an den Daten".
 */
function throwingPorts(trail = ''): unknown {
  const target = function reached() { /* aufrufbar */ } as unknown as Record<string, unknown>;
  return new Proxy(target, {
    get(_t, prop) {
      if (typeof prop === 'symbol') return undefined;
      // `then` muss undefined bleiben, sonst haelt await den Proxy fuer ein Promise.
      if (prop === 'then') return undefined;
      return throwingPorts(trail ? `${trail}.${String(prop)}` : String(prop));
    },
    apply() {
      throw new Error(`PORT_REACHED:${trail}`);
    },
    has() { return true; },
  });
}

/** Ein Regex-Routenmuster in einen konkreten Beispielpfad verwandeln. */
function sampleFromPattern(raw: string): string | null {
  if (!raw.startsWith('^')) return null;
  let s = raw.replace(/^\^/, '').replace(/\$$/, '');
  s = s.replace(/\(\?:[^()]*\)\?/g, '');
  s = s.replace(/\(\\d\+\)/g, '1').replace(/\\d\+/g, '1');
  s = s.replace(/\(\[\^\/\]\+\)/g, 'x').replace(/\[\^\/\]\+/g, 'x');
  s = s.replace(/\[[^\]]+\]\+/g, 'x');
  s = s.replace(/\(([a-z0-9|_-]+)\)/gi, (_m, alts: string) => alts.split('|')[0] ?? 'x');
  s = s.replace(/\\\//g, '/').replace(/\\-/g, '-').replace(/\\\./g, '.');
  if (/[\\()[\]+*?{}|^$]/.test(s)) return null;
  return s.startsWith('/') ? s : null;
}

/**
 * Die Routen kommen aus den Quellen, nicht aus einer gepflegten Liste — eine
 * Liste waere schon beim naechsten neuen Endpunkt unvollstaendig, und
 * ausgerechnet der neue Endpunkt ist der, um den es hier geht.
 */
function collectRoutePaths(): string[] {
  const paths = new Set<string>();
  for (const file of readdirSync(API_DIR).filter((name) => name.endsWith('.ts'))) {
    const source = readFileSync(join(API_DIR, file), 'utf8');
    for (const match of source.matchAll(/'(\/(?:api\/v1|health|openapi|t)\/?[^'`\s]*)'/g)) {
      const path = match[1];
      if (!path || path.includes('${') || path.includes('*')) continue;
      paths.add(path);
    }
    for (const match of source.matchAll(/\/\^([^\n]*?)\$\//g)) {
      const raw = `^${match[1]}$`;
      if (!raw.includes('api')) continue;
      const sample = sampleFromPattern(raw);
      if (sample) paths.add(sample);
    }
  }
  return [...paths].sort();
}

/** Beispielpfad zurueck auf die sprechende Form bringen, die oben steht. */
function canonicalize(path: string): string {
  return path
    .replace(/^\/api\/v1\/auth\/invitations\/x\/accept$/, '/api/v1/auth/invitations/:token/accept')
    .replace(/^\/api\/v1\/auth\/invitations\/x$/, '/api/v1/auth/invitations/:token')
    .replace(/^\/api\/v1\/portal\/returns\/x\/x$/, '/api/v1/portal/returns/:token/:returnNumber')
    .replace(/^\/api\/v1\/portal\/returns\/x$/, '/api/v1/portal/returns/:token')
    .replace(/^\/t\/o\/x\.gif$/, '/t/o/:token.gif')
    .replace(/^\/t\/c\/x$/, '/t/c/:token');
}

describe('unauthentifiziert erreichbare API-Oberflaeche', () => {
  test('die geprobten Methoden sind die, die der Adapter durchlaesst', () => {
    const adapter = readFileSync(join(API_DIR, 'fastify-adapter.ts'), 'utf8');
    const declared = /const SUPPORTED_METHODS: readonly HttpMethod\[\] = \[([^\]]*)\]/
      .exec(adapter)?.[1];
    expect(declared).toBeDefined();
    const adapterMethods = [...(declared ?? '').matchAll(/'([A-Z]+)'/g)].map((m) => m[1]).sort();
    // Kommt eine Methode hinzu, muss die Probe sie mitnehmen — sonst entstuende
    // genau dort ein blinder Fleck, wo neue Routen liegen.
    expect(adapterMethods).toEqual([...METHODS].sort());
  });

  test('nur die bewusst oeffentlichen Endpunkte antworten ohne Principal', async () => {
    const routePaths = collectRoutePaths();
    // Schutz gegen eine stillschweigend leere Probe: findet die Extraktion
    // nichts mehr (umbenanntes Verzeichnis, geaenderte Schreibweise), waere der
    // Test gruen, ohne irgendetwas geprueft zu haben.
    expect(routePaths.length).toBeGreaterThan(200);

    const api = createServerApi(throwingPorts() as ServerApiPorts);
    const reachable = new Set<string>();

    for (const path of routePaths) {
      for (const method of METHODS) {
        let openToAnyone: boolean;
        try {
          const res = await api.handle({
            method,
            path,
            query: {},
            body: {},
            headers: {},
            ip: '203.0.113.9',
          });
          // 401 = verlangt Anmeldung. 404/405 = diese Route/Methode gibt es
          // nicht; beides ist kein Zugriff.
          openToAnyone = res.status !== 401 && res.status !== 404 && res.status !== 405;
        } catch (err) {
          // Ein Datenzugriff ohne Principal zaehlt als offen — auch dann, wenn
          // der Handler danach einen Fehler geliefert haette.
          openToAnyone = err instanceof Error && err.message.startsWith('PORT_REACHED');
        }
        if (openToAnyone) reachable.add(`${method} ${canonicalize(path)}`);
      }
    }

    expect([...reachable].sort()).toEqual([...PUBLIC_SURFACE].sort());
  }, 120_000);
});
