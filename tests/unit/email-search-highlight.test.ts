import {
  buildLikeSearchSnippet,
  highlightNeedlesInText,
  SEARCH_MARK_END,
  SEARCH_MARK_START,
  searchNeedlesFromQuery,
  splitHighlighted,
} from '../../shared/email-search-highlight';

describe('searchNeedlesFromQuery', () => {
  test('returns phrases and terms, not operators', () => {
    expect(searchNeedlesFromQuery('rechnung "Auftrag 4711" von:max@test.de')).toEqual([
      'Auftrag 4711',
      'rechnung',
    ]);
    expect(searchNeedlesFromQuery('has:attachment')).toEqual([]);
  });
});

describe('buildLikeSearchSnippet', () => {
  test('marks the first hit with a window around it', () => {
    const text = `${'a'.repeat(100)} Zahlung ${'b'.repeat(100)}`;
    const snip = buildLikeSearchSnippet(text, ['zahlung']);
    expect(snip).toContain(`${SEARCH_MARK_START}Zahlung${SEARCH_MARK_END}`);
    expect(snip!.startsWith('… ')).toBe(true);
    expect(snip!.endsWith(' …')).toBe(true);
    expect(snip!.length).toBeLessThan(140);
  });

  test('returns null without a hit and strips foreign sentinels', () => {
    expect(buildLikeSearchSnippet('nichts hier', ['zahlung'])).toBeNull();
    expect(buildLikeSearchSnippet(null, ['x'])).toBeNull();
    const sneaky = `${SEARCH_MARK_START}fake${SEARCH_MARK_END} Zahlung`;
    const snip = buildLikeSearchSnippet(sneaky, ['zahlung']);
    expect(snip).toBe(`fake ${SEARCH_MARK_START}Zahlung${SEARCH_MARK_END}`);
  });
});

describe('highlightNeedlesInText', () => {
  test('marks all occurrences case-insensitively and merges overlaps', () => {
    const out = highlightNeedlesInText('Rechnung zur Rechnungsnummer', ['rechnung', 'rechnungsnummer']);
    expect(out).toBe(
      `${SEARCH_MARK_START}Rechnung${SEARCH_MARK_END} zur ${SEARCH_MARK_START}Rechnungsnummer${SEARCH_MARK_END}`,
    );
  });

  test('returns the plain text when nothing matches', () => {
    expect(highlightNeedlesInText('Hallo Welt', ['xyz'])).toBe('Hallo Welt');
    expect(highlightNeedlesInText('Hallo', [])).toBe('Hallo');
  });
});

describe('splitHighlighted', () => {
  test('splits sentinel strings into marked/unmarked parts', () => {
    const parts = splitHighlighted(`vor ${SEARCH_MARK_START}Treffer${SEARCH_MARK_END} nach`);
    expect(parts).toEqual([
      { text: 'vor ', marked: false },
      { text: 'Treffer', marked: true },
      { text: ' nach', marked: false },
    ]);
  });

  test('plain text stays a single unmarked part', () => {
    expect(splitHighlighted('nur text')).toEqual([{ text: 'nur text', marked: false }]);
  });
});
