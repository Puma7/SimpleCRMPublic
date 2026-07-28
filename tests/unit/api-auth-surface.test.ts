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

/**
 * Optionale Gruppen in beide Faelle aufloesen: `(?:\/([^/]+))?` steht fuer
 * ZWEI Routen, die Liste und den einzelnen Datensatz, und die haben
 * verschiedene Handler.
 *
 * Der frueher benutzte Einzeiler (`\(\?:[^()]*\)\?` einfach loeschen) scheiterte
 * an der Verschachtelung — und schwieg dazu. Acht Routenfamilien, darunter
 * user-groups/:id/members, ai/profiles und calendar-entries, wurden dadurch
 * ueberhaupt nicht geprobt.
 */
function expandOptionalGroups(pattern: string): string[] {
  const start = pattern.indexOf('(?:');
  if (start === -1) return [pattern];
  let level = 0;
  let end = -1;
  for (let i = start; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '\\') { i += 1; continue; }
    if (ch === '(') level += 1;
    else if (ch === ')') {
      level -= 1;
      if (level === 0) { end = i; break; }
    }
  }
  // Nicht balanciert oder nicht optional: das Muster bleibt unveraendert und
  // faellt unten durch die Metazeichen-Pruefung — es wird gemeldet, nicht
  // uebergangen.
  if (end === -1 || pattern[end + 1] !== '?') return [pattern];
  const head = pattern.slice(0, start);
  const inner = pattern.slice(start + 3, end);
  const rest = pattern.slice(end + 2);
  return [`${head}${inner}${rest}`, `${head}${rest}`].flatMap(expandOptionalGroups);
}

/**
 * Ein Regex-Routenmuster in konkrete Beispielpfade verwandeln. Leeres Ergebnis
 * heisst "nicht abbildbar" — und wird oben zum Testfehler, statt die Route
 * still aus der Probe zu nehmen.
 */
function samplesFromPattern(raw: string): string[] {
  if (!raw.startsWith('^')) return [];
  const body = raw.replace(/^\^/, '').replace(/\$$/, '');
  // Mehr als vier optionale Gruppen waeren 16 Varianten — dann stimmt etwas
  // anderes nicht, und Raten hilft hier niemandem.
  if ((body.match(/\(\?:/g) ?? []).length > 4) return [];
  const samples: string[] = [];
  for (const variant of expandOptionalGroups(body)) {
    let s = variant;
    s = s.replace(/\(\\d\+\)/g, '1').replace(/\\d\+/g, '1');
    s = s.replace(/\(\[\^\/\]\+\)/g, 'x').replace(/\[\^\/\]\+/g, 'x');
    s = s.replace(/\[[^\]]+\]\+/g, 'x');
    s = s.replace(/\(([a-z0-9|_-]+)\)/gi, (_m, alts: string) => alts.split('|')[0] ?? 'x');
    s = s.replace(/\\\//g, '/').replace(/\\-/g, '-').replace(/\\\./g, '.');
    // Bleibt in EINER Variante ein Metazeichen stehen, ist das ganze Muster
    // nicht verstanden. Dann lieber nichts liefern als eine halbe Familie.
    if (/[\\()[\]+*?{}|^$]/.test(s) || !s.startsWith('/')) return [];
    samples.push(s);
  }
  return samples;
}

/**
 * Zusammengesetzte Pfadliterale, die KEINE Route sind.
 *
 * Ein interpoliertes Literal kann die Probe nicht schiessen — es gibt keinen
 * festen Pfad. Statt das stillschweigend zu ueberspringen (dann waere ein so
 * geschriebener neuer Endpunkt unsichtbar und der Test trotzdem gruen), sind
 * die vorhandenen hier aufgezaehlt und jedes neue faellt auf. Alle drei sind
 * Rueckgabewerte in Antwortkoerpern, keine Vergleiche gegen req.path.
 */
const NON_ROUTE_INTERPOLATED_PATHS: readonly string[] = [
  '/api/v1/deals/${id}',
  '/api/v1/tasks/${id}',
  '/api/v1/email/messages/${messageId}/tags',
];

/** Pfadliterale in jeder Schreibweise: '…', "…" und `…`. */
const PATH_LITERAL = /(['"`])(\/(?:api\/v1|health|openapi|t)\/?[^'"`\s]*)\1/g;

/**
 * Die Routen kommen aus den Quellen, nicht aus einer gepflegten Liste — eine
 * Liste waere schon beim naechsten neuen Endpunkt unvollstaendig, und
 * ausgerechnet der neue Endpunkt ist der, um den es hier geht.
 *
 * Erfasst werden alle drei Anfuehrungsarten. Anfangs waren es nur einfache
 * Anfuehrungszeichen — dieselbe Luecke eine Ebene tiefer: ein Pfad in
 * doppelten Anfuehrungszeichen oder in einem Backtick-Literal waere durch die
 * Probe gefallen und sie waere gruen geblieben. Was sich nicht statisch
 * aufloesen laesst (Interpolation, geteilte Konstanten), faengt die Pruefung
 * darunter ab.
 */
function collectRoutePaths(): { paths: string[]; interpolated: string[]; unmappable: string[] } {
  const paths = new Set<string>();
  const interpolated = new Set<string>();
  const unmappable = new Set<string>();
  for (const file of readdirSync(API_DIR).filter((name) => name.endsWith('.ts'))) {
    // Reine Kommentarzeilen fliegen raus: dort steht Prosa ueber Routen, keine
    // Route. `/api/v1/portal/returns/...` aus einem Kopfkommentar wuerde sonst
    // als eigener Pfad geprobt und als offener Endpunkt gemeldet. Eine echte
    // Route steht nie ausschliesslich in einem Kommentar, es geht also nichts
    // verloren.
    const source = readFileSync(join(API_DIR, file), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\/?\*)/.test(line))
      .join('\n');
    for (const match of source.matchAll(PATH_LITERAL)) {
      const path = match[2];
      if (!path || path.includes('*')) continue;
      if (path.includes('${')) {
        interpolated.add(path);
        continue;
      }
      paths.add(path);
    }
    for (const match of source.matchAll(/\/\^([^\n]*?)\$\//g)) {
      const raw = `^${match[1]}$`;
      if (!raw.includes('api')) continue;
      const samples = samplesFromPattern(raw);
      if (samples.length === 0) unmappable.add(raw);
      for (const sample of samples) paths.add(sample);
    }
  }
  return {
    paths: [...paths].sort(),
    interpolated: [...interpolated].sort(),
    unmappable: [...unmappable].sort(),
  };
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

  test('kein Pfad entzieht sich der Probe durch Interpolation', () => {
    // Was zusammengesetzt wird, kann die Probe nicht schiessen. Diese Liste
    // macht aus dem stillen Ueberspringen eine sichtbare Entscheidung: kommt
    // ein interpolierter Pfad hinzu, faellt der Test, und wer ihn hinzufuegt
    // muss sagen, ob es eine Route ist. Waere er eine, muesste er anders
    // geschrieben werden — sonst pruefte ihn niemand.
    expect(collectRoutePaths().interpolated).toEqual([...NON_ROUTE_INTERPOLATED_PATHS].sort());
  });

  test('jedes Routen-Regex laesst sich in Beispielpfade aufloesen', () => {
    // Ein Muster, das die Vereinfachung nicht versteht, wurde frueher still
    // uebersprungen — und damit die ganze Routenfamilie ungeprobt gelassen.
    // Genau dort waere ein fehlendes requirePrincipal folgenlos geblieben.
    // Kommt eine Schreibweise hinzu, die hier niemand vorhergesehen hat, faellt
    // dieser Test und nicht die Absicherung.
    expect(collectRoutePaths().unmappable).toEqual([]);
  });

  test('nur die bewusst oeffentlichen Endpunkte antworten ohne Principal', async () => {
    const { paths: routePaths } = collectRoutePaths();
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
