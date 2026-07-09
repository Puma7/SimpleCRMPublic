import {
  MAX_THREAD_REF_IDS,
  collectRelatedIds,
  normalizeMessageId,
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
    const header = '<a@h>\t<B@H>\n  <c@h>';
    expect(parseReferenceIds(header)).toEqual(['a@h', 'b@h', 'c@h']);
  });

  it('drops empties and preserves order', () => {
    expect(parseReferenceIds('   <x@h>   <y@h>   ')).toEqual(['x@h', 'y@h']);
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
    expect(collectRelatedIds(null, null, '<a@h> <b@h>')).toEqual(['a@h', 'b@h']);
  });

  it(`caps the collected ids at MAX_THREAD_REF_IDS (${MAX_THREAD_REF_IDS})`, () => {
    const refs = Array.from({ length: MAX_THREAD_REF_IDS + 20 }, (_, i) => `<r${i}@h>`).join(' ');
    const out = collectRelatedIds('<self@h>', null, refs);
    expect(out.length).toBe(MAX_THREAD_REF_IDS);
    expect(out[0]).toBe('self@h');
  });
});
