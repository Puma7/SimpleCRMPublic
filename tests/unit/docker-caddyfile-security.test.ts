import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Docker Caddy security headers', () => {
  test('allows only same-host WebSocket origins for live server events', () => {
    const caddyfile = readFileSync(resolve(process.cwd(), 'docker/Caddyfile'), 'utf8');

    expect(caddyfile).toContain('ws://{http.request.host}');
    expect(caddyfile).toContain('wss://{http.request.host}');
  });

  // F-A13A14-02: Caddy reichte API-Bodies beliebiger Groesse an Fastify weiter.
  test('caps API request bodies at the largest upload Fastify accepts', () => {
    const caddyfile = readFileSync(resolve(process.cwd(), 'docker/Caddyfile'), 'utf8');

    expect(caddyfile).toMatch(/handle @backend \{\s*(?:#[^\n]*\s*)*request_body \{\s*max_size 40MiB\s*\}/);
  });
});

// Inhalt eines Caddyfile-Blocks ab der Zeile, auf die `opener` passt, per
// Klammerzaehlung bis zur schliessenden Klammer.
function caddyBlock(caddyfile: string, opener: RegExp): string {
  const match = opener.exec(caddyfile);
  if (!match) throw new Error(`block ${opener} not found in docker/Caddyfile`);
  let depth = 0;
  for (let index = match.index; index < caddyfile.length; index += 1) {
    const char = caddyfile[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return caddyfile.slice(match.index, index + 1);
    }
  }
  throw new Error(`block ${opener} is not closed in docker/Caddyfile`);
}

describe('Docker Caddy access log', () => {
  // F-A1-09: Das Access-Log schrieb Einladungs-Token (Pfad und ?invite=) und das Access-Token aus dem WebSocket-Subprotokoll im Klartext.
  test('redacts invitation tokens and the WebSocket access token before writing', () => {
    const caddyfile = readFileSync(resolve(process.cwd(), 'docker/Caddyfile'), 'utf8');
    const log = caddyBlock(caddyfile, /^\tlog \{$/m);

    expect(log).toContain('output file /var/log/access.log');
    expect(log).toMatch(/format filter \{[\s\S]*wrap json/);
    // Caddy schwaerzt von sich aus nur Cookie/Authorization. Der Server
    // bestaetigt das Subprotokoll in der Antwort, also beide Richtungen.
    expect(log).toMatch(/^\s*request>headers>Sec-Websocket-Protocol delete$/m);
    expect(log).toMatch(/^\s*resp_headers>Sec-Websocket-Protocol delete$/m);

    const uriFilter = /^\s*request>uri regexp "([^"]+)" "([^"]+)"$/m.exec(log);
    expect(uriFilter).not.toBeNull();
    // Go-RE2 und JavaScript werten dieses Muster und `$1` gleich aus.
    const redact = (uri: string) => uri.replace(new RegExp(uriFilter![1], 'g'), uriFilter![2]);
    const token = 'aW52aXRhdGlvbi10b2tlbi1zZW50aW5lbC0wMTIzNDU2';

    expect(redact(`/api/v1/auth/invitations/${token}`)).toBe('/api/v1/auth/invitations/[redacted]');
    expect(redact(`/api/v1/auth/invitations/${token}/accept`)).toBe('/api/v1/auth/invitations/[redacted]/accept');
    expect(redact(`/login?invite=${token}`)).toBe('/login?invite=[redacted]');
    expect(redact(`/login?lang=de&invite=${token}&next=1`)).toBe('/login?lang=de&invite=[redacted]&next=1');
    expect(redact('/api/v1/auth/invitations')).toBe('/api/v1/auth/invitations');
    expect(redact('/api/v1/events?since=42')).toBe('/api/v1/events?since=42');
  });
});

describe('Docker Caddy HSTS', () => {
  // F-A12-06: Caddy setzte kein Strict-Transport-Security, der erste http://-Aufruf blieb fuer SSL-Stripping offen.
  test('sends a conservative HSTS header for the public domain, not for localhost', () => {
    const caddyfile = readFileSync(resolve(process.cwd(), 'docker/Caddyfile'), 'utf8');

    const hsts = /^\theader (@\S+ )?Strict-Transport-Security "([^"]+)"$/m.exec(caddyfile);
    expect(hsts).not.toBeNull();
    const [, matcher, value] = hsts!;
    const maxAge = /^max-age=(\d+)$/.exec(value);
    expect(maxAge).not.toBeNull();
    expect(Number(maxAge![1])).toBeGreaterThanOrEqual(15552000);
    // includeSubDomains/preload wuerden fremde Subdomains des Betreibers bzw.
    // die Browser-Preload-Liste mitbinden, das bleibt dessen Entscheidung.
    expect(value).not.toMatch(/includeSubDomains|preload/i);
    // HSTS gilt im Browser fuer alle Ports des Hosts; ein lokaler Testlauf auf
    // localhost soll andere lokale http-Dienste nicht ein Jahr lang sperren.
    expect(matcher).toBeDefined();
    expect(caddyfile).toContain(`${matcher.trim()} not host localhost 127.0.0.1`);
  });
});
