import { parseMailSearchQuery } from '../packages/core/src/email/search-query';

/**
 * Treffer-Markierung in Suchergebnissen: Backend/Engine markiert Fundstellen
 * mit Sentinel-Zeichen (Private-Use-Codepoints, KEIN HTML); das Frontend
 * splittet am Sentinel und rendert <mark>-Elemente — injection-sicher, weil
 * nie HTML geparst wird.
 */
export const SEARCH_MARK_START = '\uE000';
export const SEARCH_MARK_END = '\uE001';

/** Suchbegriffe (Phrasen + Terme) einer Query — für clientseitiges Markieren. */
export function searchNeedlesFromQuery(raw: string): string[] {
  const parsed = parseMailSearchQuery(raw);
  return [...parsed.phrases, ...parsed.terms].filter((n) => n.length > 0);
}

/** Sentinels aus Fremdinhalten entfernen, bevor eigene Markierungen gesetzt werden. */
function stripMarks(text: string): string {
  return text.replace(/[\uE000\uE001]/g, '');
}

/**
 * ±window Zeichen um den ersten Treffer, Treffer mit Sentinels markiert.
 * Null, wenn keiner der Begriffe vorkommt.
 */
export function buildLikeSearchSnippet(
  text: string | null | undefined,
  needles: string[],
  window = 60,
): string | null {
  if (!text) return null;
  const clean = stripMarks(text).replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const lower = clean.toLowerCase();
  let best: { idx: number; len: number } | null = null;
  for (const needle of needles) {
    const n = needle.toLowerCase();
    if (!n) continue;
    const idx = lower.indexOf(n);
    if (idx >= 0 && (best === null || idx < best.idx)) {
      best = { idx, len: needle.length };
    }
  }
  if (!best) return null;
  const start = Math.max(0, best.idx - window);
  const end = Math.min(clean.length, best.idx + best.len + window);
  const prefix = start > 0 ? '… ' : '';
  const suffix = end < clean.length ? ' …' : '';
  return (
    prefix +
    clean.slice(start, best.idx) +
    SEARCH_MARK_START +
    clean.slice(best.idx, best.idx + best.len) +
    SEARCH_MARK_END +
    clean.slice(best.idx + best.len, end) +
    suffix
  );
}

/** Alle Vorkommen der Begriffe im Text markieren (z. B. Betreffzeile). */
export function highlightNeedlesInText(text: string, needles: string[]): string {
  const clean = stripMarks(text);
  const valid = needles.filter((n) => n.length > 0);
  if (valid.length === 0) return clean;
  const lower = clean.toLowerCase();
  type Span = { start: number; end: number };
  const spans: Span[] = [];
  for (const needle of valid) {
    const n = needle.toLowerCase();
    let from = 0;
    for (;;) {
      const idx = lower.indexOf(n, from);
      if (idx < 0) break;
      spans.push({ start: idx, end: idx + n.length });
      from = idx + Math.max(1, n.length);
    }
  }
  if (spans.length === 0) return clean;
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: Span[] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) {
      last.end = Math.max(last.end, s.end);
    } else {
      merged.push({ ...s });
    }
  }
  let out = '';
  let pos = 0;
  for (const s of merged) {
    out += clean.slice(pos, s.start) + SEARCH_MARK_START + clean.slice(s.start, s.end) + SEARCH_MARK_END;
    pos = s.end;
  }
  return out + clean.slice(pos);
}

export type HighlightedPart = { text: string; marked: boolean };

/** Sentinel-String in Render-Teile zerlegen (reine Textverarbeitung). */
export function splitHighlighted(snippet: string): HighlightedPart[] {
  const parts: HighlightedPart[] = [];
  let marked = false;
  let current = '';
  for (const ch of snippet) {
    if (ch === SEARCH_MARK_START || ch === SEARCH_MARK_END) {
      if (current) parts.push({ text: current, marked });
      current = '';
      marked = ch === SEARCH_MARK_START;
      continue;
    }
    current += ch;
  }
  if (current) parts.push({ text: current, marked });
  return parts;
}
