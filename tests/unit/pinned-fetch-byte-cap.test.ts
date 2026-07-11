import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { createPinnedFetch } from '../../packages/server/src/jobs/pinned-fetch';

const MAX_RESPONSE_BYTES = 256 * 1024;

// The SSRF redirect fakes (webhook-ssrf-redirect.test.ts) inject a fake fetchImpl
// and never exercise createPinnedFetch's socket reading. This test drives the
// real pinned fetch against a loopback server that streams FAR past the cap and
// NEVER ends the response. Before the fix, the client kept draining forever and
// the promise never resolved (the test would hit the jest timeout); with the fix
// it keeps only MAX_RESPONSE_BYTES, destroys the socket, and resolves.
describe('pinned fetch response byte cap', () => {
  test('truncates at the cap and destroys the socket instead of draining an endless body', async () => {
    let clientWentAway = false;
    const chunk = Buffer.alloc(64 * 1024, 0x61); // 64KB of 'a'

    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      let stopped = false;
      const pump = (): void => {
        if (stopped) return;
        const ok = res.write(chunk, (err) => {
          if (err) {
            stopped = true;
            clientWentAway = true;
          }
        });
        if (ok) setImmediate(pump);
        else res.once('drain', pump);
      };
      res.on('close', () => {
        stopped = true;
        if (!res.writableFinished) clientWentAway = true;
      });
      // Intentionally never call res.end(): the stream only stops when the client
      // tears the connection down.
      pump();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const fetchImpl = createPinnedFetch();
      const response = await fetchImpl(`http://127.0.0.1:${port}/big`, {
        method: 'GET',
        headers: {},
        redirect: 'manual',
        pinnedAddresses: ['127.0.0.1'],
      });
      const text = await response.text();

      // Body is truncated to the cap, not the endless stream.
      expect(response.status).toBe(200);
      expect(text.length).toBeLessThanOrEqual(MAX_RESPONSE_BYTES);
      expect(text.length).toBeGreaterThan(0);

      // The client tore the socket down (server observed the abort) rather than
      // draining the rest of the body.
      for (let i = 0; i < 40 && !clientWentAway; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(clientWentAway).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('sets Content-Length (byte length) for a string POST body the caller did not', async () => {
    let receivedContentLength: string | undefined;
    let receivedBody = '';
    const server = http.createServer((req, res) => {
      receivedContentLength = req.headers['content-length'];
      req.on('data', (c: Buffer) => {
        receivedBody += c.toString('utf8');
      });
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const body = 'héllo wörld'; // multi-byte: byteLength (13) != length (11)
      const fetchImpl = createPinnedFetch();
      const response = await fetchImpl(`http://127.0.0.1:${port}/hook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        redirect: 'manual',
        pinnedAddresses: ['127.0.0.1'],
      });

      expect(response.status).toBe(200);
      expect(receivedBody).toBe(body);
      expect(receivedContentLength).toBe(String(Buffer.byteLength(body)));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
