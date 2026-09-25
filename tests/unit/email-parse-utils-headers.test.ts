import { simpleParser } from 'mailparser';
import {
  formatMailparserHeaderValue,
  isAutomatedInboundMessage,
  isCorruptRawHeaders,
  isUnsafeAutoReplyTarget,
  rawHeadersFromParsed,
} from '../../packages/core/src/email';

if (typeof setImmediate === 'undefined') {
  (globalThis as any).setImmediate = setTimeout;
}

describe('formatMailparserHeaderValue', () => {
  it('formats address objects with text', () => {
    expect(
      formatMailparserHeaderValue({
        text: 'Shop <shop@example.com>',
        value: [{ address: 'shop@example.com', name: 'Shop' }],
      }),
    ).toBe('Shop <shop@example.com>');
  });

  it('formats structured content-type', () => {
    expect(
      formatMailparserHeaderValue({
        value: 'multipart/alternative',
        params: { boundary: 'abc123' },
      }),
    ).toBe('multipart/alternative; boundary=abc123');
  });
});

describe('rawHeadersFromParsed', () => {
  it('does not emit [object Object] for object header values', () => {
    const headers = new Map<string, unknown>([
      [
        'from',
        { text: 'Alice <alice@test.com>', value: [{ address: 'alice@test.com', name: 'Alice' }] },
      ],
      ['subject', 'Hello'],
    ]);
    const out = rawHeadersFromParsed({
      headers: {
        get: (k: string) => headers.get(k),
        [Symbol.iterator]: () => headers.entries(),
      },
    });
    expect(out).toContain('from: Alice <alice@test.com>');
    expect(out).toContain('subject: Hello');
    expect(out).not.toContain('[object Object]');
  });
});

describe('rawHeadersFromParsed with real mailparser output', () => {
  // F-N-sm-01: mailparser liefert headerLines als { key, line }-Objekte; join() ergab "[object Object]", Auto-Submitted/List-* griffen nie.
  it('keeps the original header lines so automation checks see them', async () => {
    const source = [
      'From: "Shop" <noreply-shop@example.com>',
      'To: kunde@example.com',
      'Subject: Ihre Bestellung',
      'Auto-Submitted: auto-generated',
      'List-Id: <news.example.com>',
      'Content-Type: text/plain;',
      ' charset=utf-8',
      '',
      'Hallo',
    ].join('\r\n');
    const parsed = await simpleParser(Buffer.from(source, 'utf8'));
    const raw = rawHeadersFromParsed(parsed as never);
    expect(raw).not.toContain('[object Object]');
    expect(isCorruptRawHeaders(raw)).toBe(false);
    expect(raw).toContain('From: "Shop" <noreply-shop@example.com>');
    expect(raw).toContain('Auto-Submitted: auto-generated');
    expect(raw).toContain('Content-Type: text/plain;\r\n charset=utf-8');
    expect(isAutomatedInboundMessage(raw)).toBe(true);
    expect(isUnsafeAutoReplyTarget(raw)).toBe(true);
  });
});

describe('isCorruptRawHeaders', () => {
  it('detects legacy corrupt header blobs', () => {
    expect(isCorruptRawHeaders('[object Object]\n[object Object]')).toBe(true);
    expect(isCorruptRawHeaders('From: a@b.com')).toBe(false);
  });
});
