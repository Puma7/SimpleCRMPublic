jest.mock('../../electron/email/mail-rfc822-build', () => ({
  buildRfc822FromStored: jest.fn(() => null),
}));

import { buildRfc822FromStored } from '../../electron/email/mail-rfc822-build';
import { checkMessageWithRspamd } from '../../electron/email/rspamd-client';

const KIB = 1024;
const CHUNK = 64 * KIB;

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status });
}

/** Streams `body` in 64 KiB pulls and records how much the client read. */
function trackedResponse(body: string, status: number) {
  const bytes = new TextEncoder().encode(body);
  const stats = { pulled: 0, cancelled: false };
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (offset >= bytes.length) {
          controller.close();
          return;
        }
        const chunk = bytes.subarray(offset, offset + CHUNK);
        offset += chunk.length;
        stats.pulled += chunk.length;
        controller.enqueue(chunk);
      },
      cancel() {
        stats.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { response: new Response(stream, { status }), stats };
}

const checkInput = {
  rawHeaders: 'From: a@b.de',
  bodyText: 'hi',
  bodyHtml: null,
  baseUrl: 'http://127.0.0.1:11333',
  timeoutMs: 5000,
};

describe('rspamd-client', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns error when no message body', async () => {
    (buildRfc822FromStored as jest.Mock).mockReturnValue(null);
    const r = await checkMessageWithRspamd({
      rawHeaders: null,
      bodyText: null,
      bodyHtml: null,
      baseUrl: 'http://127.0.0.1:11333',
      timeoutMs: 1000,
    });
    expect(r.error).toContain('Keine Nachricht');
  });

  test('parses successful rspamd json', async () => {
    (buildRfc822FromStored as jest.Mock).mockReturnValue(Buffer.from('raw'));
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        score: 5.5,
        action: 'add header',
        required_score: 10,
        symbols: { BAYES_SPAM: { score: 2.1 } },
      }),
    ) as typeof fetch;

    const r = await checkMessageWithRspamd({
      rawHeaders: 'From: a@b.de',
      bodyText: 'hi',
      bodyHtml: null,
      baseUrl: 'http://127.0.0.1:11333',
      timeoutMs: 5000,
    });
    expect(r.score).toBe(5.5);
    expect(r.symbols.length).toBeGreaterThan(0);
  });

  test('invalid base url rejected', async () => {
    (buildRfc822FromStored as jest.Mock).mockReturnValue(Buffer.from('x'));
    const r = await checkMessageWithRspamd({
      rawHeaders: '',
      bodyText: 'x',
      bodyHtml: null,
      baseUrl: 'ftp://bad',
      timeoutMs: 1000,
    });
    expect(r.error).toBeTruthy();
  });

  test('handles non-ok HTTP response', async () => {
    (buildRfc822FromStored as jest.Mock).mockReturnValue(Buffer.from('raw'));
    global.fetch = jest.fn().mockResolvedValue(
      new Response('service unavailable', { status: 503 }),
    ) as typeof fetch;
    const r = await checkMessageWithRspamd({
      rawHeaders: 'From: a@b.de',
      bodyText: 'hi',
      bodyHtml: null,
      baseUrl: 'http://127.0.0.1:11333',
      timeoutMs: 1000,
    });
    expect(r.error).toContain('503');
  });

  test('handles timeout abort', async () => {
    (buildRfc822FromStored as jest.Mock).mockReturnValue(Buffer.from('raw'));
    global.fetch = jest.fn((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
        setTimeout(() => undefined, 50);
      }),
    ) as typeof fetch;
    const r = await checkMessageWithRspamd({
      rawHeaders: 'From: a@b.de',
      bodyText: 'hi',
      bodyHtml: null,
      baseUrl: 'http://127.0.0.1:11333',
      timeoutMs: 5,
    });
    expect(r.error).toBe('Rspamd Timeout');
  });

  test('filters low-score symbols', async () => {
    (buildRfc822FromStored as jest.Mock).mockReturnValue(Buffer.from('raw'));
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        score: 1,
        action: 'no action',
        symbols: { LOW: { score: 0.001 }, HIGH: { score: 3.5 } },
      }),
    ) as typeof fetch;
    const r = await checkMessageWithRspamd({
      rawHeaders: 'From: a@b.de',
      bodyText: 'hi',
      bodyHtml: null,
      baseUrl: 'http://127.0.0.1:11333',
      timeoutMs: 1000,
    });
    expect(r.symbols.some((s) => s.startsWith('HIGH'))).toBe(true);
    expect(r.symbols.some((s) => s.startsWith('LOW'))).toBe(false);
  });

  test('handles fetch network error', async () => {
    (buildRfc822FromStored as jest.Mock).mockReturnValue(Buffer.from('raw'));
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as typeof fetch;
    const r = await checkMessageWithRspamd({
      rawHeaders: 'From: a@b.de',
      bodyText: 'hi',
      bodyHtml: null,
      baseUrl: 'http://127.0.0.1:11333',
      timeoutMs: 1000,
    });
    expect(r.error).toBe('network down');
  });

  test('parses json without symbols and non-numeric score', async () => {
    (buildRfc822FromStored as jest.Mock).mockReturnValue(Buffer.from('raw'));
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ action: 'no action' })) as typeof fetch;
    const r = await checkMessageWithRspamd({
      rawHeaders: 'From: a@b.de',
      bodyText: 'hi',
      bodyHtml: null,
      baseUrl: 'http://127.0.0.1:11333',
      timeoutMs: 1000,
    });
    expect(r.score).toBeNull();
    expect(r.symbols).toEqual([]);
  });

  test('HTTP error without response text', async () => {
    (buildRfc822FromStored as jest.Mock).mockReturnValue(Buffer.from('raw'));
    const failingBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('no body'));
      },
    });
    global.fetch = jest.fn().mockResolvedValue(
      new Response(failingBody, { status: 500 }),
    ) as typeof fetch;
    const r = await checkMessageWithRspamd({
      rawHeaders: 'From: a@b.de',
      bodyText: 'hi',
      bodyHtml: null,
      baseUrl: 'http://127.0.0.1:11333',
      timeoutMs: 1000,
    });
    expect(r.error).toBe('Rspamd HTTP 500');
  });

  // C-A23: the Rspamd answer and its error text were buffered without a byte limit.
  test('stops reading an oversized Rspamd answer at 1 MiB', async () => {
    (buildRfc822FromStored as jest.Mock).mockReturnValue(Buffer.from('raw'));
    const { response, stats } = trackedResponse(
      `{"score":1,"action":"no action","pad":"${'x'.repeat(2 * KIB * KIB)}"}`,
      200,
    );
    global.fetch = jest.fn().mockResolvedValue(response) as typeof fetch;

    const r = await checkMessageWithRspamd(checkInput);
    expect(r.score).toBeNull();
    expect(r.error).toMatch(/zu groß/);
    expect(stats.cancelled).toBe(true);
    expect(stats.pulled).toBeLessThanOrEqual(KIB * KIB + CHUNK);
  });

  test('reads at most 64 KiB of an Rspamd error body', async () => {
    (buildRfc822FromStored as jest.Mock).mockReturnValue(Buffer.from('raw'));
    const { response, stats } = trackedResponse('e'.repeat(KIB * KIB), 503);
    global.fetch = jest.fn().mockResolvedValue(response) as typeof fetch;

    const r = await checkMessageWithRspamd(checkInput);
    expect(r.error).toBe(`Rspamd HTTP 503: ${'e'.repeat(200)}`);
    expect(stats.cancelled).toBe(true);
    expect(stats.pulled).toBeLessThanOrEqual(64 * KIB + CHUNK);
  });
});
