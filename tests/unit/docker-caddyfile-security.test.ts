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
