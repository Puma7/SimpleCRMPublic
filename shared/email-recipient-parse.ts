import { emailAddressForDelivery, normalizeEmailAddress } from './email-address-normalize';

/**
 * Parse To/Cc fields: supports "a@b.de", "Name <a@b.de>", comma/semicolon lists.
 * Returns normalized address strings for comparison; empty entries dropped.
 */
const ADDR_CORE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/i

export function extractEmailAddressesFromRecipientField(
  raw: string,
  opts?: { preservePlusAddressing?: boolean },
): string[] {
  const out: string[] = []
  const chunks = raw.split(/[,;]+/)
  for (const chunk of chunks) {
    const t = chunk.trim()
    if (!t) continue
    const m = t.match(/^(.*)<([^>]+)>$/)
    const candidate = (m ? m[2] : t).trim()
    if (ADDR_CORE.test(candidate)) {
      out.push(opts?.preservePlusAddressing ? candidate.trim().toLowerCase() : normalizeEmailAddress(candidate))
    }
  }
  return out
}

/**
 * Split a recipient field into address candidates and invalid entries.
 * Unquoted display names may contain commas ("Mueller, Hans <h@x.de>"), so a
 * chunk without "@" only counts as a name fragment when a "Name <addr>" chunk follows.
 */
function parseRecipientField(raw: string): { candidates: string[]; invalid: string[] } {
  const candidates: string[] = []
  const invalid: string[] = []
  let nameFragments: string[] = []
  for (const chunk of raw.split(/[,;]+/)) {
    const t = chunk.trim()
    if (!t) continue
    const m = t.match(/^(.*)<([^>]+)>$/)
    if (!m && !t.includes('@') && !t.includes('<')) {
      nameFragments.push(t)
      continue
    }
    if (!m) invalid.push(...nameFragments)
    nameFragments = []
    const candidate = (m ? m[2] : t).trim()
    if (ADDR_CORE.test(candidate)) candidates.push(candidate)
    else invalid.push(t)
  }
  invalid.push(...nameFragments)
  return { candidates, invalid }
}

/**
 * Addresses for SMTP and stored recipients: local part (case, plus tag) is
 * delivery data and stays intact; duplicates collapse case-insensitively.
 */
export function extractDeliveryAddressesFromRecipientField(raw: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const candidate of parseRecipientField(raw).candidates) {
    const address = emailAddressForDelivery(candidate)
    const identity = address.toLowerCase()
    if (seen.has(identity)) continue
    seen.add(identity)
    out.push(address)
  }
  return out
}

export function validateRecipientField(raw: string, label: string): { ok: true } | { ok: false; error: string } {
  const parsed = parseRecipientField(raw)
  if (parsed.invalid.length > 0) {
    return { ok: false, error: `Ungültige E-Mail-Adresse in „${label}“: ${parsed.invalid[0]}` }
  }
  if (parsed.candidates.length === 0) {
    return { ok: false, error: `Mindestens eine gültige E-Mail-Adresse in „${label}“ (z. B. a@b.de oder Name <a@b.de>).` }
  }
  return { ok: true }
}

/** Display string for compose fields from stored `to_json` / `cc_json`. */
export function recipientFieldFromJson(json: string | null | undefined): string {
  if (!json?.trim()) return ''
  try {
    const parsed = JSON.parse(json) as {
      value?: { address?: string; name?: string }[]
    }
    const parts = (parsed.value ?? [])
      .map((v) => {
        const addr = v.address?.trim()
        if (!addr) return ''
        const name = v.name?.trim()
        return name ? `${name} <${addr}>` : addr
      })
      .filter(Boolean)
    return parts.join(', ')
  } catch {
    return ''
  }
}

/** Canonical `{ value: [{ address, name? }] }` JSON for SQLite recipient columns. */
export function recipientJsonFromField(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const addrs = extractDeliveryAddressesFromRecipientField(trimmed)
  if (addrs.length === 0) return null
  return JSON.stringify({
    value: addrs.map((address) => ({ address })),
  })
}

/** Single mailbox JSON for outbound From (compose / sent). */
export function senderJsonFromMailbox(
  email: string | null | undefined,
  displayName?: string | null,
): string {
  const address = (email ?? '').trim()
  if (!address) return JSON.stringify({ value: [] })
  const name = (displayName ?? '').trim()
  return JSON.stringify({
    value: [{ address, ...(name ? { name } : {}) }],
  })
}
