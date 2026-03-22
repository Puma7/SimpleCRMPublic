/** Shared helpers for IMAP/POP3 mail parsing (DRY). */

export function addressJson(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return null;
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
