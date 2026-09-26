import {
  MAX_THREAD_REF_IDS,
  collectRelatedIds,
  normalizeMessageId,
  normalizeThreadingMessageId,
  parseReferenceIds,
} from '../../packages/core/src/email/reference-threading';

describe('normalizeMessageId', () => {
  it('strips a single leading < / trailing >, trims and lowercases', () => {
    expect(normalizeMessageId('<ABC@Example.COM>')).toBe('abc@example.com');
    expect(normalizeMessageId('  <Id-1@Host>  ')).toBe('id-1@host');
  });

  it('returns null for empty / missing input', () => {
    expect(normalizeMessageId(null)).toBeNull();
    expect(normalizeMessageId(undefined)).toBeNull();
    expect(normalizeMessageId('')).toBeNull();
    expect(normalizeMessageId('   ')).toBeNull();
    expect(normalizeMessageId('<>')).toBeNull();
  });

  it('only strips the OUTER brackets (parity with electron normId)', () => {
    // A single ^< and >$ are removed; inner brackets are preserved.
    expect(normalizeMessageId('<a>b>')).toBe('a>b');
    expect(normalizeMessageId('<<x@y>>')).toBe('<x@y>');
  });

  it('is idempotent on an already-normalized id', () => {
    expect(normalizeMessageId('abc@host')).toBe('abc@host');
    expect(normalizeMessageId(normalizeMessageId('<ABC@Host>'))).toBe('abc@host');
  });
});

describe('parseReferenceIds', () => {
  it('splits on any whitespace run (spaces, tabs, folded newlines) and normalizes each', () => {
    const header = '<a@h.de>\t<B@H.DE>\n  <c@h.de>';
    expect(parseReferenceIds(header)).toEqual(['a@h.de', 'b@h.de', 'c@h.de']);
  });

  it('drops empties and preserves order', () => {
    expect(parseReferenceIds('   <x@h.de>   <y@h.de>   ')).toEqual(['x@h.de', 'y@h.de']);
  });

  it('returns [] for empty / missing', () => {
    expect(parseReferenceIds(null)).toEqual([]);
    expect(parseReferenceIds(undefined)).toEqual([]);
    expect(parseReferenceIds('')).toEqual([]);
  });
});

describe('collectRelatedIds', () => {
  it('unions Message-ID, In-Reply-To and References, Message-ID first, deduped', () => {
    expect(
      collectRelatedIds('<self@h>', '<parent@h>', '<root@h> <parent@h>'),
    ).toEqual(['self@h', 'parent@h', 'root@h']);
  });

  it('handles all-null inputs', () => {
    expect(collectRelatedIds(null, null, null)).toEqual([]);
  });

  it('works with only a References header (no Message-ID / In-Reply-To)', () => {
    expect(collectRelatedIds(null, null, '<a@h.de> <b@h.de>')).toEqual(['a@h.de', 'b@h.de']);
  });

  it(`caps the collected ids at MAX_THREAD_REF_IDS (${MAX_THREAD_REF_IDS})`, () => {
    const refs = Array.from({ length: MAX_THREAD_REF_IDS + 20 }, (_, i) => `<r${i}@h.de>`).join(' ');
    const out = collectRelatedIds('<self@h>', null, refs);
    expect(out.length).toBe(MAX_THREAD_REF_IDS);
    expect(out[0]).toBe('self@h');
  });
});

// C-A62: Referenzen ohne Form id@rechts (etwa der Token "com") wurden als Message-IDs
// uebernommen; der Desktop fuehrte darueber fremde Konversationen zusammen.
describe('plausible threading Message-IDs (shared with the desktop JWZ path)', () => {
  it('accepts only id-left@id-right of at least five characters without brackets or whitespace', () => {
    expect(normalizeThreadingMessageId('<ABC@Example.COM>')).toBe('abc@example.com');
    expect(normalizeThreadingMessageId('x@y.z')).toBe('x@y.z');
    for (const raw of ['com', '<com>', 'kunde-b.com', '@kunde.de', 'kunde@', 'a@b', '<<x@y.de>>', '<a>b@c.de>', null, '']) {
      expect(normalizeThreadingMessageId(raw)).toBeNull();
    }
  });

  it('drops implausible References tokens and splits adjacent bracketed ids', () => {
    expect(parseReferenceIds('com <y7@kunde-b.com> lieferant.com')).toEqual(['y7@kunde-b.com']);
    expect(parseReferenceIds('<a@h.de><B@H.DE>')).toEqual(['a@h.de', 'b@h.de']);
  });

  it('collects no related id from bare tokens', () => {
    expect(collectRelatedIds('com', 'de', 'com kunde')).toEqual([]);
    expect(collectRelatedIds('<self@h.de>', '<x>', 'com')).toEqual(['self@h.de']);
  });
});
