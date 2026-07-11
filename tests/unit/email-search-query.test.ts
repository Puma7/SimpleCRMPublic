import {
  buildFtsMatchExpression,
  hasSearchOperators,
  parseMailSearchQuery,
} from '../../packages/core/src/email/search-query';

describe('parseMailSearchQuery', () => {
  test('plain terms', () => {
    const p = parseMailSearchQuery('rechnung offen');
    expect(p.terms).toEqual(['rechnung', 'offen']);
    expect(p.phrases).toEqual([]);
    expect(hasSearchOperators(p)).toBe(false);
  });

  test('quoted phrase is exact', () => {
    const p = parseMailSearchQuery('"Rechnung 2024"');
    expect(p.phrases).toEqual(['Rechnung 2024']);
    expect(p.terms).toEqual([]);
  });

  test('mixed phrase and terms', () => {
    const p = parseMailSearchQuery('storno "Auftrag 4711" dringend');
    expect(p.terms).toEqual(['storno', 'dringend']);
    expect(p.phrases).toEqual(['Auftrag 4711']);
  });

  test('english operators', () => {
    const p = parseMailSearchQuery('from:max@test.de to:sales@firma.de subject:Angebot');
    expect(p.from).toEqual(['max@test.de']);
    expect(p.to).toEqual(['sales@firma.de']);
    expect(p.subject).toEqual(['Angebot']);
    expect(hasSearchOperators(p)).toBe(true);
  });

  test('german operator aliases (case-insensitive)', () => {
    const p = parseMailSearchQuery('VON:max@test.de An:info@firma.de Betreff:Mahnung');
    expect(p.from).toEqual(['max@test.de']);
    expect(p.to).toEqual(['info@firma.de']);
    expect(p.subject).toEqual(['Mahnung']);
  });

  test('quoted operator value keeps spaces', () => {
    const p = parseMailSearchQuery('von:"Max Mustermann" hallo');
    expect(p.from).toEqual(['Max Mustermann']);
    expect(p.terms).toEqual(['hallo']);
  });

  test('has:attachment and hat:anhang set the flag', () => {
    expect(parseMailSearchQuery('has:attachment').hasAttachment).toBe(true);
    expect(parseMailSearchQuery('HAT:Anhang').hasAttachment).toBe(true);
    const other = parseMailSearchQuery('has:xyz');
    expect(other.hasAttachment).toBe(false);
    expect(other.terms).toEqual(['has:xyz']);
  });

  test('operator-only query has no text tokens', () => {
    const p = parseMailSearchQuery('von:max@test.de has:attachment');
    expect(p.terms).toEqual([]);
    expect(p.phrases).toEqual([]);
    expect(hasSearchOperators(p)).toBe(true);
    expect(buildFtsMatchExpression(p)).toBeNull();
  });

  test('empty and whitespace-only input', () => {
    const empty = parseMailSearchQuery('');
    expect(empty).toEqual({
      phrases: [],
      terms: [],
      from: [],
      to: [],
      subject: [],
      hasAttachment: false,
    });
    expect(parseMailSearchQuery('   ').terms).toEqual([]);
    expect(buildFtsMatchExpression(empty)).toBeNull();
  });

  test('operator without value stays a term', () => {
    const p = parseMailSearchQuery('from: offen');
    expect(p.from).toEqual([]);
    expect(p.terms).toEqual(['from:', 'offen']);
  });

  test('unknown operator stays a term', () => {
    const p = parseMailSearchQuery('foo:bar');
    expect(p.terms).toEqual(['foo:bar']);
  });
});

describe('buildFtsMatchExpression', () => {
  test('terms become prefix queries, phrases stay exact', () => {
    const expr = buildFtsMatchExpression(parseMailSearchQuery('rechnung "Auftrag 4711"'));
    expect(expr).toBe('"Auftrag 4711" AND "rechnung"*');
  });

  test('escapes embedded double quotes', () => {
    const p = parseMailSearchQuery('foo"bar');
    expect(p.terms).toEqual(['foo"bar']);
    expect(buildFtsMatchExpression(p)).toBe('"foo""bar"*');
  });

  test('caps tokens at 12', () => {
    const many = Array.from({ length: 20 }, (_, i) => `wort${i}`).join(' ');
    const expr = buildFtsMatchExpression(parseMailSearchQuery(many));
    expect(expr?.split(' AND ')).toHaveLength(12);
  });

  test('operators do not leak into the match expression', () => {
    const expr = buildFtsMatchExpression(parseMailSearchQuery('von:max@test.de rechnung'));
    expect(expr).toBe('"rechnung"*');
  });
});
