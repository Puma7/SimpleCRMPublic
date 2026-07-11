import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';

export type GuardedHttpInit = Readonly<{
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  redirect: 'manual';
  /** Pre-validated public IP(s). The socket connects to pinnedAddresses[0]; DNS is never re-resolved. */
  pinnedAddresses: readonly string[];
}>;

export type GuardedHttpResponse = Readonly<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export type GuardedFetch = (url: string, init: GuardedHttpInit) => Promise<GuardedHttpResponse>;

const MAX_RESPONSE_BYTES = 256 * 1024;

export function createPinnedFetch(): GuardedFetch {
  return (url, init) =>
    new Promise<GuardedHttpResponse>((resolve, reject) => {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        reject(new Error('pinned fetch received an invalid URL'));
        return;
      }
      const pinned = init.pinnedAddresses[0];
      if (!pinned) {
        reject(new Error('pinned fetch requires at least one pinned address'));
        return;
      }
      const transport = parsed.protocol === 'https:' ? https : http;
      const family = isIP(pinned) === 6 ? 6 : 4;
      // Custom lookup: ignore the hostname, always return the pre-validated IP,
      // so the connection cannot be redirected to another (private) address.
      // Node's default autoSelectFamily connect path calls lookup with
      // `{ all: true }` and expects an array of { address, family }; the legacy
      // path expects `(err, address, family)`. Honor both so pinning holds.
      const lookup = ((
        _hostname: string,
        options: { all?: boolean } | undefined,
        cb: (err: Error | null, address: string | { address: string; family: number }[], family?: number) => void,
      ) => {
        if (options?.all) {
          cb(null, [{ address: pinned, family }]);
        } else {
          cb(null, pinned, family);
        }
      }) as unknown as http.RequestOptions['lookup'];

      const req = transport.request(
        url,
        { method: init.method, headers: init.headers, ...(init.signal ? { signal: init.signal } : {}), lookup },
        (res) => {
          const chunks: Buffer[] = [];
          let total = 0;
          let settled = false;
          const resolveWith = (text: string): void => {
            if (settled) return;
            settled = true;
            const status = res.statusCode ?? 0;
            resolve({
              ok: status >= 200 && status < 300,
              status,
              headers: {
                get: (name) => {
                  const v = res.headers[name.toLowerCase()];
                  if (v === undefined) return null;
                  return Array.isArray(v) ? v.join(', ') : v;
                },
              },
              text: async () => text,
            });
          };
          res.on('data', (c: Buffer) => {
            if (settled) return;
            total += c.length;
            if (total <= MAX_RESPONSE_BYTES) {
              chunks.push(c);
              return;
            }
            // Over the cap: keep only the first MAX_RESPONSE_BYTES bytes, then
            // tear down the socket so we stop reading instead of draining the
            // rest of a (possibly huge) response body into the void.
            chunks.push(c);
            const text = Buffer.concat(chunks).subarray(0, MAX_RESPONSE_BYTES).toString('utf8');
            res.destroy();
            resolveWith(text);
          });
          res.on('end', () => {
            resolveWith(Buffer.concat(chunks).toString('utf8'));
          });
          res.on('error', (err) => {
            if (settled) return;
            settled = true;
            reject(err);
          });
        },
      );
      req.on('error', reject);
      if (init.body !== undefined) req.write(init.body);
      req.end();
    });
}
