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

export function snippetFromParsed(textBody: string | null, htmlBody: string | null): string | null {
  if (textBody?.trim()) {
    const t = textBody.trim();
    return t.length > 220 ? `${t.slice(0, 217)}...` : t;
  }
  if (htmlBody) {
    const capped = htmlBody.length > 8000 ? htmlBody.slice(0, 8000) : htmlBody;
    const plain = capped.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!plain) return null;
    return plain.length > 220 ? `${plain.slice(0, 217)}...` : plain;
  }
  return null;
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
