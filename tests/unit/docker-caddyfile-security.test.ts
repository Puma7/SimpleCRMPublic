import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Docker Caddy security headers', () => {
  test('allows only same-host WebSocket origins for live server events', () => {
    const caddyfile = readFileSync(resolve(process.cwd(), 'docker/Caddyfile'), 'utf8');

    expect(caddyfile).toContain('ws://{http.request.host}');
    expect(caddyfile).toContain('wss://{http.request.host}');
  });
});
