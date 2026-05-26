jest.mock('../../electron/email/mail-rfc822-build', () => ({
  buildRfc822FromStored: jest.fn(() => null),
}));

import { buildRfc822FromStored } from '../../electron/email/mail-rfc822-build';
import { checkMessageWithRspamd } from '../../electron/email/rspamd-client';

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
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        score: 5.5,
        action: 'add header',
        required_score: 10,
        symbols: { BAYES_SPAM: { score: 2.1 } },
      }),
    }) as typeof fetch;

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
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'service unavailable',
    }) as typeof fetch;
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
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        score: 1,
        action: 'no action',
        symbols: { LOW: { score: 0.001 }, HIGH: { score: 3.5 } },
      }),
    }) as typeof fetch;
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
});
