/** Shared helpers for IMAP/POP3 mail parsing (DRY). */

export type CanonicalAddressJson = {
  value: { address: string; name?: string }[];
};

/** Normalize mailparser / stored JSON to `{ value: [{ address, name? }] }`. */
export function normalizeAddressJson(value: unknown): CanonicalAddressJson | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') {
    try {
      return normalizeAddressJson(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    const valueArr = value
      .map((entry) => {
        if (typeof entry === 'string' && entry.includes('@')) {
          return { address: entry.trim().toLowerCase() };
        }
        if (entry && typeof entry === 'object' && 'address' in entry) {
          const addr = String((entry as { address?: string }).address ?? '').trim();
          if (!addr.includes('@')) return null;
          const name = (entry as { name?: string }).name;
          return name ? { address: addr, name: String(name) } : { address: addr };
        }
        return null;
      })
      .filter((x): x is { address: string; name?: string } => x != null);
    return valueArr.length > 0 ? { value: valueArr } : null;
  }
  if (typeof value === 'object' && value !== null && 'value' in value) {
    const inner = (value as { value?: unknown }).value;
    if (Array.isArray(inner)) {
      return normalizeAddressJson(inner);
    }
  }
  return null;
}

export function addressJson(value: unknown): string | null {
  const canonical = normalizeAddressJson(value);
  if (!canonical) return null;
  try {
    return JSON.stringify(canonical);
  } catch {
    return null;
  }
}

/** Comma-separated addresses for workflow context / SMTP display. */
export function addressesFromRecipientJson(json: string | null): string {
  if (!json) return '';
  try {
    const canonical = normalizeAddressJson(JSON.parse(json) as unknown);
    return canonical?.value.map((v) => v.address).filter(Boolean).join(', ') ?? '';
  } catch {
    return '';
  }
}

export function formatDate(d: Date | undefined): string | null {
  if (!d || Number.isNaN(d.getTime())) {
    return null;
  }
  return d.toISOString();
}

/**
 * Common named HTML entities (pragmatic table, not the full HTML5 list):
 * markup basics, German umlauts/ß, frequent accents, typography and symbols.
 * `amp` is intentionally absent — `&amp;` is decoded LAST in
 * {@link decodeHtmlEntities} so `&amp;uuml;` stays the literal `&uuml;`
 * instead of double-decoding to `ü`.
 */
const NAMED_HTML_ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
  szlig: 'ß',
  aacute: 'á',
  agrave: 'à',
  acirc: 'â',
  eacute: 'é',
  egrave: 'è',
  ecirc: 'ê',
  iacute: 'í',
  igrave: 'ì',
  icirc: 'î',
  oacute: 'ó',
  ograve: 'ò',
  ocirc: 'ô',
  uacute: 'ú',
  ugrave: 'ù',
  ucirc: 'û',
  ccedil: 'ç',
  ntilde: 'ñ',
  euro: '€',
  pound: '£',
  cent: '¢',
  copy: '©',
  reg: '®',
  trade: '™',
  sect: '§',
  para: '¶',
  deg: '°',
  middot: '·',
  bull: '•',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  times: '×',
  divide: '÷',
  plusmn: '±',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
};

/** Decodable target for numeric entities: no surrogates, no C0 controls (except whitespace). */
function isDecodableCodePoint(code: number): boolean {
  if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) return false;
  if (code >= 0xd800 && code <= 0xdfff) return false;
  if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return false;
  return true;
}

/**
 * Decode numeric (`&#228;`, `&#xE4;`) and common named HTML entities so
 * `M&uuml;ller` is indexed/searchable as `Müller`. `&amp;` is decoded in a
 * final pass so already-escaped sequences like `&amp;uuml;` yield the literal
 * `&uuml;` (no double-decode). Unknown entities are left untouched.
 */
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d{1,7});/g, (match, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return isDecodableCodePoint(code) ? String.fromCodePoint(code) : match;
    })
    .replace(/&#[xX]([0-9a-fA-F]{1,6});/g, (match, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return isDecodableCodePoint(code) ? String.fromCodePoint(code) : match;
    })
    .replace(/&([a-zA-Z][a-zA-Z0-9]{1,30});/g, (match, name: string) => {
      if (name === 'amp') return match;
      return NAMED_HTML_ENTITIES[name] ?? match;
    })
    .replace(/&amp;/g, '&');
}

/**
 * Strip HTML down to searchable plain text (style/script content removed).
 * Used as body_text fallback for HTML-only mail so search/FTS can see it.
 * HTML entities are decoded after the tag strip (before whitespace collapse)
 * so text like `M&uuml;ller` or `Rechnung&nbsp;2026` becomes searchable.
 */
export function plainTextFromHtml(html: string, cap = 500_000): string {
  const stripped = html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  const text = decodeHtmlEntities(stripped)
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > cap ? text.slice(0, cap) : text;
}

export function snippetFromParsed(textBody: string | null, htmlBody: string | null): string | null {
  if (textBody?.trim()) {
    const t = textBody.trim();
    return t.length > 220 ? `${t.slice(0, 217)}...` : t;
  }
  if (htmlBody) {
    const capped = htmlBody.length > 8000 ? htmlBody.slice(0, 8000) : htmlBody;
    const plain = plainTextFromHtml(capped);
    if (!plain) return null;
    return plain.length > 220 ? `${plain.slice(0, 217)}...` : plain;
  }
  return null;
}

/** True when stored headers were broken by object stringification (legacy sync bug). */
export function isCorruptRawHeaders(raw: string | null | undefined): boolean {
  if (!raw?.trim()) return false;
  return /\[object Object\]/i.test(raw);
}

/** Format a single mailparser header value as RFC822 header field text. */
export function formatMailparserHeaderValue(val: unknown): string {
  if (val == null) return '';
  if (typeof val === 'string') return val;
  if (val instanceof Date) return val.toUTCString();
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (Array.isArray(val)) {
    return val
      .map((v) => formatMailparserHeaderValue(v))
      .filter((s) => s.length > 0)
      .join(', ');
  }
  if (typeof val === 'object') {
    const o = val as Record<string, unknown>;
    if (typeof o.text === 'string' && o.text.trim()) return o.text.trim();
    if (typeof o.html === 'string' && o.html.trim()) {
      return o.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    if (Array.isArray(o.value)) {
      const parts = o.value
        .map((entry) => {
          if (entry && typeof entry === 'object' && 'address' in entry) {
            const addr = String((entry as { address?: string }).address ?? '').trim();
            if (!addr) return '';
            const name = (entry as { name?: string }).name?.trim();
            if (name) {
              const escaped = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
              return `"${escaped}" <${addr}>`;
            }
            return addr;
          }
          return formatMailparserHeaderValue(entry);
        })
        .filter((s) => s.length > 0);
      return parts.join(', ');
    }
    if (typeof o.value === 'string') {
      const base = o.value.trim();
      const params = o.params;
      if (params && typeof params === 'object' && !Array.isArray(params)) {
        const paramBits = Object.entries(params as Record<string, unknown>)
          .map(([k, v]) => {
            const pv = formatMailparserHeaderValue(v);
            if (!pv) return '';
            return /^[\w.-]+$/.test(pv) ? `${k}=${pv}` : `${k}="${pv.replace(/"/g, '\\"')}"`;
          })
          .filter(Boolean);
        return paramBits.length ? `${base}; ${paramBits.join('; ')}` : base;
      }
      return base;
    }
  }
  try {
    return JSON.stringify(val);
  } catch {
    return '';
  }
}

/** Serialize RFC822 headers from mailparser for support/debug display. */
export function rawHeadersFromParsed(parsed: {
  headerLines?: string[];
  headers?: { get?: (key: string) => unknown; [Symbol.iterator]?: () => IterableIterator<[string, unknown]> };
}): string | null {
  if (parsed.headerLines?.length) {
    return parsed.headerLines.join('\n');
  }
  const headers = parsed.headers;
  if (!headers) return null;
  const lines: string[] = [];
  if (typeof headers.get === 'function') {
    const keys = new Set<string>();
    if (Symbol.iterator in Object(headers)) {
      for (const [key] of headers as Iterable<[string, unknown]>) {
        keys.add(key);
      }
    }
    for (const key of keys) {
      const val = headers.get!(key);
      if (Array.isArray(val)) {
        for (const v of val) {
          const text = formatMailparserHeaderValue(v);
          if (text) lines.push(`${key}: ${text}`);
        }
      } else {
        const text = formatMailparserHeaderValue(val);
        if (text) lines.push(`${key}: ${text}`);
      }
    }
  }
  return lines.length > 0 ? lines.join('\n') : null;
}

export function parseAttachmentsMeta(parsed: {
  attachments?: { filename?: string; contentType?: string; size?: number }[];
}): { hasAttachments: boolean; json: string | null } {
  const att = parsed.attachments;
  if (!att || att.length === 0) return { hasAttachments: false, json: null };
  const meta = att.map((a) => ({
    filename: a.filename ?? null,
    contentType: a.contentType ?? null,
    size: a.size ?? null,
  }));
  return { hasAttachments: true, json: JSON.stringify(meta) };
}
