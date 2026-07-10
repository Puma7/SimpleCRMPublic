/**
 * Pure builders for the Postgres mail search (Suche Phase 3). Mirrors the
 * SQLite engine's semantics: shared query parser from @simplecrm/core,
 * phrases exact / terms as prefix, from:/an:/betreff:/hat:anhang operators
 * with the desktop's 3-case address matching, deterministic fts→ILIKE mode.
 * Kept DB-free so unit tests can cover escaping and pattern building.
 */
import {
  MAX_SEARCH_TEXT_TOKENS,
  parseMailSearchQuery,
  type ParsedMailSearchQuery,
} from '@simplecrm/core';

export type { ParsedMailSearchQuery };

export function parseServerMailSearchQuery(raw: string): ParsedMailSearchQuery {
  return parseMailSearchQuery(raw);
}

/** Single tsquery lexeme: quotes/backslashes stripped, single-quoted. */
function tsqueryLexeme(token: string): string | null {
  const cleaned = token.replace(/['\\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  return `'${cleaned}'`;
}

/**
 * to_tsquery('simple', …) input: phrases as `'a' <-> 'b'`, terms as prefix
 * lexemes `'t':*`, AND-joined, capped like the SQLite engine. Null when the
 * query carries no text tokens (operator-only query).
 */
export function buildTsQueryText(parsed: ParsedMailSearchQuery): string | null {
  const parts: string[] = [];
  for (const phrase of parsed.phrases) {
    if (parts.length >= MAX_SEARCH_TEXT_TOKENS) break;
    const words = phrase
      .split(/\s+/)
      .map((w) => tsqueryLexeme(w))
      .filter((w): w is string => w !== null);
    if (words.length === 1) parts.push(words[0]!);
    else if (words.length > 1) parts.push(`(${words.join(' <-> ')})`);
  }
  for (const term of parsed.terms) {
    if (parts.length >= MAX_SEARCH_TEXT_TOKENS) break;
    const lex = tsqueryLexeme(term);
    if (lex) parts.push(`${lex}:*`);
  }
  if (parts.length === 0) return null;
  return parts.join(' & ');
}

export function escapeIlikePattern(value: string): string {
  return value.replace(/[%_\\]/g, (ch) => `\\${ch}`);
}

/**
 * ILIKE pattern for from:/to: operator values against the address JSON text —
 * identical 3-case semantics to the desktop engine: `@bar.de` domain suffix,
 * `foo@bar.de` exact address, `foo@bar` address prefix, plain value substring.
 * NB: Postgres re-serializes jsonb with a space after the colon
 * (`"address": "max@test.de"`), so the anchor differs from the desktop's raw
 * TEXT JSON — verified against a real Postgres.
 */
export function addressIlikePattern(value: string): string {
  const escaped = escapeIlikePattern(value);
  if (value.startsWith('@')) {
    return `%"address": "%${escaped}"%`;
  }
  if (/^\S+@\S+\.\S{2,}$/.test(value)) {
    return `%"address": "${escaped}"%`;
  }
  if (value.includes('@')) {
    return `%"address": "${escaped}%`;
  }
  return `%${escaped}%`;
}

/** Needles for the ILIKE text blocks (phrases + terms, capped). */
export function ilikeTextNeedles(parsed: ParsedMailSearchQuery): string[] {
  return [...parsed.phrases, ...parsed.terms]
    .slice(0, MAX_SEARCH_TEXT_TOKENS)
    .map((needle) => `%${escapeIlikePattern(needle)}%`);
}

export function hasSearchOperators(parsed: ParsedMailSearchQuery): boolean {
  return (
    parsed.from.length > 0 ||
    parsed.to.length > 0 ||
    parsed.subject.length > 0 ||
    parsed.hasAttachment
  );
}
