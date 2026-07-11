/**
 * Sentinel-based search hit marking (no HTML): engines mark hits with
 * private-use codepoints, frontends split on them and render <mark>
 * elements — injection-safe pure text processing. Lives in core so the
 * desktop engine, the server port and the frontend share one implementation.
 */
export const SEARCH_MARK_START = '\uE000';
export const SEARCH_MARK_END = '\uE001';

/** Strip foreign sentinels before adding our own marks. */
function stripMarks(text: string): string {
  return text.replace(/[\uE000\uE001]/g, '');
}

/**
 * ±window chars around the first hit, hit marked with the sentinels.
 * Null when none of the needles occur.
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

/** Mark all occurrences of the needles (e.g. subject lines). */
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

/** Split a sentinel string into render parts (pure text processing). */
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
