import { joinKnowledgeWithinBudget } from '../../packages/core/src/workflow/knowledge-budget';

const separator = '\n---\n';

describe('joinKnowledgeWithinBudget', () => {
  test('passt alles, ist das Ergebnis identisch mit join()', () => {
    const items = [
      { group: 1, text: 'Firma' },
      { group: 2, text: 'Eingang' },
      { group: 3, text: 'Learnings' },
    ];
    expect(joinKnowledgeWithinBudget(items, { maxChars: 12_000, separator })).toBe(items.map((i) => i.text).join(separator));
  });

  test('große Firmen- und Eingangs-Wissensbasis schneiden die Learnings nicht mehr ab', () => {
    const learnings = `LEARNING-MARKER ${'L'.repeat(800)}`;
    const result = joinKnowledgeWithinBudget([
      { group: 1, text: 'G'.repeat(10_000) },
      { group: 2, text: 'I'.repeat(5_000) },
      { group: 3, text: learnings },
    ], { maxChars: 12_000, separator });
    expect(result.length).toBeLessThanOrEqual(12_000);
    expect(result).toContain(learnings);
    expect(result).toContain('I'.repeat(5_000));
    expect(result).not.toContain('G'.repeat(10_000));
  });

  test('gleich große Gruppen bekommen gleich viel', () => {
    const result = joinKnowledgeWithinBudget([
      { group: 'a', text: 'A'.repeat(10_000) },
      { group: 'b', text: 'B'.repeat(10_000) },
      { group: 'c', text: 'C'.repeat(10_000) },
    ], { maxChars: 12_000, separator });
    const counts = ['A', 'B', 'C'].map((ch) => result.split('').filter((c) => c === ch).length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(2);
    expect(result.length).toBeLessThanOrEqual(12_000);
  });

  test('mehrere Treffer je Gruppe: Anteil in Reihenfolge, leere Treffer fallen samt Trenner weg', () => {
    const result = joinKnowledgeWithinBudget([
      { group: 1, text: 'X'.repeat(6_000) },
      { group: 1, text: 'Y'.repeat(6_000) },
      { group: 2, text: 'Z'.repeat(6_000) },
    ], { maxChars: 12_000, separator });
    expect(result).toContain('X'.repeat(5_000));
    expect(result).not.toContain('Y');
    expect(result).toContain('Z'.repeat(5_000));
    expect(result.split(separator)).toHaveLength(2);
  });

  test('Randfälle', () => {
    expect(joinKnowledgeWithinBudget([], { maxChars: 100, separator })).toBe('');
    expect(joinKnowledgeWithinBudget([{ group: 1, text: 'x' }], { maxChars: 0, separator })).toBe('');
  });
});
