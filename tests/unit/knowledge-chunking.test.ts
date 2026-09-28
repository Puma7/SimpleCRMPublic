/**
 * Plan 048: Wissensbasis-Abschnitte als Suchindex (abgeleitet vom Dokument)
 * und bereinigte Suchbegriffe für die Volltextsuche.
 */
import {
  buildKnowledgeQueryTerms,
  deriveKnowledgeSections,
  formatKnowledgeSourcesLabel,
  GERMAN_KNOWLEDGE_STOPWORDS,
} from '../../packages/core/src/learnings/knowledge-chunking';

describe('deriveKnowledgeSections', () => {
  test('Einleitung ohne # Titel, dann ## Abschnitte in Reihenfolge', () => {
    const doc = '# Firma\n\nWir sind ein Versandhandel.\n\n## Rückgabe\n\n30 Tage.\n\n## Versand\n\nDHL, 2 Tage.\n';
    expect(deriveKnowledgeSections(doc, 'Firma')).toEqual([
      { position: 0, title: 'Firma', content: 'Wir sind ein Versandhandel.' },
      { position: 1, title: 'Rückgabe', content: '30 Tage.' },
      { position: 2, title: 'Versand', content: 'DHL, 2 Tage.' },
    ]);
  });

  test('nur Titel als Einleitung entfällt; leere Abschnitte entfallen', () => {
    expect(deriveKnowledgeSections('# Firma\n\n## Leer\n\n## Rückgabe\n\n30 Tage.', 'Firma')).toEqual([
      { position: 0, title: 'Rückgabe', content: '30 Tage.' },
    ]);
  });

  test('Trennlinien der Chunk-Zusammenführung gehören zu keinem Abschnitt', () => {
    const merged = 'Einleitung.\n\n---\n\n## Rückgabe 1\n\nHinweis 1.\n\n---\n\n## Rückgabe 2\n\nHinweis 2.';
    expect(deriveKnowledgeSections(merged, 'KB')).toEqual([
      { position: 0, title: 'KB', content: 'Einleitung.' },
      { position: 1, title: 'Rückgabe 1', content: 'Hinweis 1.' },
      { position: 2, title: 'Rückgabe 2', content: 'Hinweis 2.' },
    ]);
    // Eine Trennlinie mitten im Text bleibt.
    expect(deriveKnowledgeSections('## A\n\neins\n\n---\n\nzwei', 'KB')[0]!.content).toBe('eins\n\n---\n\nzwei');
  });

  test('nur Einleitung', () => {
    expect(deriveKnowledgeSections('Nur Text ohne Abschnitte.', 'Notizen')).toEqual([
      { position: 0, title: 'Notizen', content: 'Nur Text ohne Abschnitte.' },
    ]);
  });

  test('## in einem Codeblock trennt nicht; offener Codeblock verschluckt keine Abschnitte (Plan 028)', () => {
    const fenced = '## Vorlage\n\n```\n## kein Abschnitt\n```\n\n## Danach\n\nText.';
    expect(deriveKnowledgeSections(fenced, 'KB').map((s) => s.title)).toEqual(['Vorlage', 'Danach']);
    const unclosed = '## Vorlage\n\n```\nkaputt\n\n## Danach\n\nText.';
    expect(deriveKnowledgeSections(unclosed, 'KB').map((s) => s.title)).toEqual(['Vorlage', 'Danach']);
  });

  test('lange Abschnitte an Absätzen geteilt: „Titel (Teil n)“', () => {
    const paragraph = (n: number) => `Absatz ${n} ${'x'.repeat(90)}`;
    const body = Array.from({ length: 10 }, (_, i) => paragraph(i + 1)).join('\n\n');
    const parts = deriveKnowledgeSections(`## Lang\n\n${body}`, 'KB', { maxSectionChars: 300 });
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.map((part) => part.title)).toEqual(parts.map((_, i) => `Lang (Teil ${i + 1})`));
    expect(parts.every((part) => part.content.length <= 300)).toBe(true);
    expect(parts.map((part) => part.content).join('\n\n')).toBe(body);
    expect(parts.map((part) => part.position)).toEqual(parts.map((_, i) => i));
  });

  test('ein einzelner übergroßer Absatz wird hart geteilt', () => {
    const parts = deriveKnowledgeSections(`## Block\n\n${'y'.repeat(750)}`, 'KB', { maxSectionChars: 300 });
    expect(parts.map((part) => part.content.length)).toEqual([300, 300, 150]);
  });

  test('leer → keine Abschnitte', () => {
    expect(deriveKnowledgeSections('', 'KB')).toEqual([]);
    expect(deriveKnowledgeSections('   \n\n', 'KB')).toEqual([]);
  });
});

describe('buildKnowledgeQueryTerms', () => {
  test('klein, nur Buchstaben/Ziffern, ≥ 3 Zeichen, ohne Stoppwörter, ohne Dubletten', () => {
    expect(buildKnowledgeQueryTerms('Die Rücksendung und das Etikett – bitte! Etikett? ID 42, Paket-Nr. 4711'))
      .toEqual(['rücksendung', 'etikett', 'paket', '4711']);
  });

  test('höchstens max Begriffe; nur Stoppwörter → leer; sichere Zeichen', () => {
    expect(buildKnowledgeQueryTerms('eins zwei drei vier', 2)).toEqual(['eins', 'zwei']);
    expect(buildKnowledgeQueryTerms('und die der das mit für')).toEqual([]);
    expect(buildKnowledgeQueryTerms("x' OR 1=1; DROP TABLE -- «Straße» :*|&!()")).toEqual(['drop', 'table', 'straße']);
    for (const term of buildKnowledgeQueryTerms('Ärger über Übergrößen & Maße: ÄÖÜ 123')) {
      expect(term).toMatch(/^[\p{L}\p{N}]+$/u);
    }
  });

  test('Stoppwortliste enthält typische Füllwörter', () => {
    for (const word of ['und', 'die', 'der', 'das', 'nicht', 'bitte', 'freundlichen']) {
      expect(GERMAN_KNOWLEDGE_STOPWORDS.has(word)).toBe(true);
    }
  });
});

describe('formatKnowledgeSourcesLabel', () => {
  test('KB-Name › Abschnitt, ohne Dubletten, Einleitung nur mit Namen', () => {
    expect(formatKnowledgeSourcesLabel([
      { knowledgeBaseName: 'Handbuch', title: 'Rücksendungen' },
      { knowledgeBaseName: 'Handbuch', title: 'Rücksendungen' },
      { knowledgeBaseName: 'Learnings', title: 'Learnings' },
      { knowledgeBaseName: null, title: 'Versand' },
      { knowledgeBaseName: '  ', title: '' },
    ])).toBe('Handbuch › Rücksendungen; Learnings; Versand');
  });

  test('ohne Titel wie bisher „Chunk #id“', () => {
    expect(formatKnowledgeSourcesLabel([
      { id: 5, knowledgeBaseName: null, title: null },
      { id: 6, knowledgeBaseName: 'Handbuch', title: '' },
    ])).toBe('Chunk #5; Handbuch › Chunk #6');
  });

  test('höchstens 500 Zeichen', () => {
    const label = formatKnowledgeSourcesLabel(Array.from({ length: 60 }, (_, n) => ({ knowledgeBaseName: 'Handbuch', title: `Abschnitt ${n}` })));
    expect(label).toHaveLength(500);
    expect(label.endsWith('…')).toBe(true);
  });
});
