/**
 * Verteilt das Zeichenbudget des Wissens-Blocks fair auf die Wissensbasen
 * (Gruppen): jede Gruppe bekommt höchstens ihren Anteil, ungenutzter Anteil
 * kleiner Gruppen geht an die übrigen. So schneidet eine große Firmen- oder
 * Eingangs-Wissensbasis die Learnings (immer zuletzt) nicht mehr ab. Passt
 * alles, ist das Ergebnis identisch mit `join(separator)`.
 */
export type KnowledgeBudgetItem = { group: string | number; text: string };

export function joinKnowledgeWithinBudget(
  items: readonly KnowledgeBudgetItem[],
  options: { maxChars: number; separator: string },
): string {
  const { maxChars, separator } = options;
  if (maxChars <= 0 || items.length === 0) return '';
  const plain = items.map((item) => item.text).join(separator);
  if (plain.length <= maxChars) return plain;

  let remaining = Math.max(0, maxChars - separator.length * (items.length - 1));
  const demand = new Map<string | number, number>();
  for (const item of items) demand.set(item.group, (demand.get(item.group) ?? 0) + item.text.length);
  // Auffüllen: kleine Gruppen zuerst, ihr Rest geht an die größeren.
  const grants = new Map<string | number, number>();
  const byDemand = [...demand.entries()].sort((a, b) => a[1] - b[1]);
  byDemand.forEach(([group, wanted], index) => {
    const grant = Math.min(wanted, Math.floor(remaining / (byDemand.length - index)));
    grants.set(group, grant);
    remaining -= grant;
  });

  const kept: string[] = [];
  for (const item of items) {
    const left = grants.get(item.group) ?? 0;
    const take = Math.min(left, item.text.length);
    grants.set(item.group, left - take);
    if (take > 0) kept.push(item.text.slice(0, take));
  }
  return kept.join(separator).slice(0, maxChars);
}
