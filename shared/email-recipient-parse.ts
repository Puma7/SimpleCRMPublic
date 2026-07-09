import { normalizeEmailAddress } from './email-address-normalize';

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
    const m = t.match(/^(.+)<([^>]+)>$/)
    const candidate = (m ? m[2] : t).trim()
    if (ADDR_CORE.test(candidate)) {
      out.push(opts?.preservePlusAddressing ? candidate.trim().toLowerCase() : normalizeEmailAddress(candidate))
    }
  }
  return out
}

export function validateRecipientField(raw: string, label: string): { ok: true } | { ok: false; error: string } {
  const addrs = extractEmailAddressesFromRecipientField(raw)
  if (addrs.length === 0) {
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
  const addrs = extractEmailAddressesFromRecipientField(trimmed)
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
