/** Mail search query parsing: quoted phrases, tolerant terms and
 * operators (from:/von:, to:/an:, subject:/betreff:, has:attachment/hat:anhang). */

export type ParsedMailSearchQuery = {
  /** Bare "quoted text" — matched exactly (FTS phrase). */
  phrases: string[];
  /** Unquoted words — matched tolerantly (FTS prefix). */
  terms: string[];
  from: string[];
  to: string[];
  subject: string[];
  hasAttachment: boolean;
};

/** Max phrases+terms carried into one FTS MATCH / LIKE query. */
export const MAX_SEARCH_TEXT_TOKENS = 12;

const OPERATOR_ALIASES: Record<string, 'from' | 'to' | 'subject' | 'has'> = {
  from: 'from',
  von: 'from',
  to: 'to',
  an: 'to',
  subject: 'subject',
  betreff: 'subject',
  has: 'has',
  hat: 'has',
};

/** Split on whitespace; double-quoted spans (incl. operator values) stay together. */
function tokenizeQuery(raw: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const ch of raw) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }
    if (!inQuotes && /\s/.test(ch)) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

/** Strip one pair of surrounding double quotes (tolerates an unclosed quote). */
function unquote(value: string): string {
  let v = value;
  if (v.startsWith('"')) v = v.slice(1);
  if (v.endsWith('"')) v = v.slice(0, -1);
  return v;
}

export function parseMailSearchQuery(raw: string): ParsedMailSearchQuery {
  const parsed: ParsedMailSearchQuery = {
    phrases: [],
    terms: [],
    from: [],
    to: [],
    subject: [],
    hasAttachment: false,
  };
  for (const token of tokenizeQuery(raw.trim())) {
    if (token.startsWith('"')) {
      const phrase = unquote(token).trim();
      if (phrase) parsed.phrases.push(phrase);
      continue;
    }
    const colon = token.indexOf(':');
    if (colon > 0) {
      const op = OPERATOR_ALIASES[token.slice(0, colon).toLowerCase()];
      const value = unquote(token.slice(colon + 1)).trim();
      if (op === 'has') {
        const flag = value.toLowerCase();
        if (flag === 'attachment' || flag === 'anhang') {
          parsed.hasAttachment = true;
          continue;
        }
      } else if (op && value) {
        parsed[op].push(value);
        continue;
      }
    }
    parsed.terms.push(token);
  }
  return parsed;
}

/** True when the query carries at least one field operator. */
export function hasSearchOperators(parsed: ParsedMailSearchQuery): boolean {
  return (
    parsed.from.length > 0 ||
    parsed.to.length > 0 ||
    parsed.subject.length > 0 ||
    parsed.hasAttachment
  );
}

/**
 * FTS5 MATCH expression: phrases exact (`"..."`), terms as prefix queries
 * (`"..."*`), AND-joined, capped at MAX_SEARCH_TEXT_TOKENS. Null when the
 * query has no text tokens (operator-only query).
 */
export function buildFtsMatchExpression(parsed: ParsedMailSearchQuery): string | null {
  const parts: string[] = [];
  for (const phrase of parsed.phrases) {
    if (parts.length >= MAX_SEARCH_TEXT_TOKENS) break;
    parts.push(`"${phrase.replace(/"/g, '""')}"`);
  }
  for (const term of parsed.terms) {
    if (parts.length >= MAX_SEARCH_TEXT_TOKENS) break;
    parts.push(`"${term.replace(/"/g, '""')}"*`);
  }
  if (parts.length === 0) return null;
  return parts.join(' AND ');
}
