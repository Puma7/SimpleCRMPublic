import {
  addressIlikePattern,
  buildTsQueryText,
  escapeIlikePattern,
  hasSearchOperators,
  ilikeTextNeedles,
  parseServerMailSearchQuery,
} from '../../packages/server/src/mail-search-sql';

describe('buildTsQueryText', () => {
  test('terms become prefix lexemes, phrases become <-> chains', () => {
    expect(buildTsQueryText(parseServerMailSearchQuery('rechnung offen'))).toBe(
      "'rechnung':* & 'offen':*",
    );
    expect(buildTsQueryText(parseServerMailSearchQuery('"Auftrag 4711" storno'))).toBe(
      "('Auftrag' <-> '4711') & 'storno':*",
    );
  });

  test('single-word phrases stay exact lexemes', () => {
    expect(buildTsQueryText(parseServerMailSearchQuery('"Rechnung"'))).toBe("'Rechnung'");
  });

  test('escapes quotes/backslashes out of lexemes', () => {
    expect(buildTsQueryText(parseServerMailSearchQuery("O'Brien"))).toBe("'O Brien':*");
    expect(buildTsQueryText(parseServerMailSearchQuery('foo\\bar'))).toBe("'foo bar':*");
  });

  test('operator-only query yields null', () => {
    expect(buildTsQueryText(parseServerMailSearchQuery('von:max@test.de'))).toBeNull();
    expect(buildTsQueryText(parseServerMailSearchQuery(''))).toBeNull();
  });

  test('caps at 12 tokens', () => {
    const many = Array.from({ length: 20 }, (_, i) => `wort${i}`).join(' ');
    const expr = buildTsQueryText(parseServerMailSearchQuery(many));
    expect(expr?.split(' & ')).toHaveLength(12);
  });
});

describe('addressIlikePattern (Desktop-Paritaet, Fix 2)', () => {
  test('domain suffix, exact address, prefix, plain substring', () => {
    // jsonb::text serialisiert mit Leerzeichen nach dem Doppelpunkt.
    expect(addressIlikePattern('@test.de')).toBe('%"address": "%@test.de"%');
    expect(addressIlikePattern('max@test.de')).toBe('%"address": "max@test.de"%');
    expect(addressIlikePattern('max@test')).toBe('%"address": "max@test%');
    expect(addressIlikePattern('Mustermann')).toBe('%Mustermann%');
  });

  test('escapes LIKE wildcards in values', () => {
    expect(addressIlikePattern('a_b%c')).toBe('%a\\_b\\%c%');
  });
});

describe('ilikeTextNeedles / operators', () => {
  test('needles wrap phrases and terms with escaping', () => {
    const parsed = parseServerMailSearchQuery('foo_bar "exakte Phrase"');
    expect(ilikeTextNeedles(parsed)).toEqual(['%exakte Phrase%', '%foo\\_bar%']);
  });

  test('escapeIlikePattern escapes %, _ and backslash', () => {
    expect(escapeIlikePattern('10%_x\\')).toBe('10\\%\\_x\\\\');
  });

  test('hasSearchOperators detects operators', () => {
    expect(hasSearchOperators(parseServerMailSearchQuery('hat:anhang'))).toBe(true);
    expect(hasSearchOperators(parseServerMailSearchQuery('nur text'))).toBe(false);
  });
});
