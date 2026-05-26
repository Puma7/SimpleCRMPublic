/** Allowed protocols when opening links from mail HTML in the system browser. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

const BLOCKED_PROTOCOL_PREFIXES = ['javascript:', 'data:', 'vbscript:', 'file:']

export type ExternalMailLink =
  | { ok: true; url: string; display: string }
  | { ok: false; reason: string }

/**
 * Validates a mail body hyperlink before opening externally.
 * Relative URLs and unknown schemes are rejected.
 */
export function parseExternalMailLink(href: string): ExternalMailLink {
  const raw = href.trim()
  if (!raw) return { ok: false, reason: 'empty' }

  const lower = raw.toLowerCase()
  for (const blocked of BLOCKED_PROTOCOL_PREFIXES) {
    if (lower.startsWith(blocked)) {
      return { ok: false, reason: 'blocked_protocol' }
    }
  }

  let url: URL
  try {
    if (raw.startsWith('//')) {
      url = new URL(`https:${raw}`)
    } else {
      url = new URL(raw)
    }
  } catch {
    return { ok: false, reason: 'invalid' }
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return { ok: false, reason: 'unsupported_protocol' }
  }

  return { ok: true, url: url.href, display: url.href }
}
