/**
 * Parse To/Cc fields: supports "a@b.de", "Name <a@b.de>", comma/semicolon lists.
 * Returns lowercased address strings for comparison; empty entries dropped.
 */
const ADDR_CORE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i

export function extractEmailAddressesFromRecipientField(raw: string): string[] {
  const out: string[] = []
  const chunks = raw.split(/[,;]+/)
  for (const chunk of chunks) {
    const t = chunk.trim()
    if (!t) continue
    const m = t.match(/^(.+)<([^>]+)>$/)
    const candidate = (m ? m[2] : t).trim()
    if (ADDR_CORE.test(candidate)) {
      out.push(candidate.toLowerCase())
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
