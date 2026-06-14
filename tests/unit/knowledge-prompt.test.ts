import { formatKnowledgeChunksForPrompt } from '../../shared/knowledge-prompt';

describe('formatKnowledgeChunksForPrompt', () => {
  it('returns empty string for no chunks', () => {
    expect(formatKnowledgeChunksForPrompt([])).toBe('');
  });

  it('formats titled and untitled chunks', () => {
    const out = formatKnowledgeChunksForPrompt([
      { title: 'Versand', content: 'Lieferzeit 2–3 Tage.' },
      { title: null, content: 'Allgemeine Info.' },
    ]);
    expect(out).toContain('Relevante Wissensbasis:');
    expect(out).toContain('### Versand');
    expect(out).toContain('Lieferzeit 2–3 Tage.');
    expect(out).toContain('Allgemeine Info.');
  });
});
