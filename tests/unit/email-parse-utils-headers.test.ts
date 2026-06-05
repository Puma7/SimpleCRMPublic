import {
  formatMailparserHeaderValue,
  isCorruptRawHeaders,
  rawHeadersFromParsed,
} from '../../packages/core/src/email';

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

describe('isCorruptRawHeaders', () => {
  it('detects legacy corrupt header blobs', () => {
    expect(isCorruptRawHeaders('[object Object]\n[object Object]')).toBe(true);
    expect(isCorruptRawHeaders('From: a@b.com')).toBe(false);
  });
});
