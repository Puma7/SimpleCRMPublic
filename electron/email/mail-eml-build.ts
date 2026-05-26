import fs from 'fs';
import { randomBytes } from 'crypto';
import {
  addressesFromRecipientJson,
  isCorruptRawHeaders,
  normalizeAddressJson,
} from './email-parse-utils';
import type { EmailAttachmentRow } from './email-message-attachments-store';
import type { EmailMessageRow } from './email-store';

export function rfc822SourceToStorageB64(source: Buffer | string): string {
  const buf = Buffer.isBuffer(source) ? source : Buffer.from(source);
  return buf.toString('base64');
}

/** Lossless decode for .eml display / export (byte-preserving). */
export function emlFromStorageB64(b64: string): string {
  return Buffer.from(b64, 'base64').toString('latin1');
}

function crlf(s: string): string {
  return s.replace(/\r?\n/g, '\r\n');
}

function formatMailboxList(json: string | null): string | null {
  if (!json) return null;
  try {
    const canonical = normalizeAddressJson(JSON.parse(json) as unknown);
    if (!canonical?.value.length) return null;
    return canonical.value
      .map((v) => {
        const addr = v.address.trim();
        if (!addr) return null;
        if (v.name?.trim()) {
          const name = v.name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          return `"${name}" <${addr}>`;
        }
        return addr;
      })
      .filter((x): x is string => Boolean(x))
      .join(', ');
  } catch {
    return addressesFromRecipientJson(json) || null;
  }
}

function stripContentTypeFromHeaders(headers: string): string {
  return headers
    .split(/\r?\n/)
    .filter((line) => !/^content-type:/i.test(line) && !/^content-transfer-encoding:/i.test(line) && !/^mime-version:/i.test(line))
    .join('\r\n');
}

function buildBodyParts(input: {
  bodyText: string | null;
  bodyHtml: string | null;
  attachments: EmailAttachmentRow[];
}): { headers: string[]; body: string } {
  const text = (input.bodyText ?? '').trim();
  const html = (input.bodyHtml ?? '').trim();
  const fileParts: string[] = [];

  for (const att of input.attachments) {
    try {
      if (!fs.existsSync(att.storage_path)) continue;
      const buf = fs.readFileSync(att.storage_path);
      if (!buf.length) continue;
      const b64 = buf.toString('base64');
      const lines = b64.match(/.{1,76}/g) ?? [];
      const folded = lines.join('\r\n');
      const filename = att.filename_display.replace(/"/g, '\\"');
      const ct = att.content_type?.trim() || 'application/octet-stream';
      fileParts.push(
        [
          `Content-Type: ${ct}; name="${filename}"`,
          `Content-Disposition: attachment; filename="${filename}"`,
          'Content-Transfer-Encoding: base64',
          '',
          folded,
        ].join('\r\n'),
      );
    } catch {
      /* skip unreadable attachment */
    }
  }

  const hasFiles = fileParts.length > 0;
  const hasAlt = Boolean(text && html);
  const singlePlain = text || html || '';

  if (!hasFiles && !hasAlt) {
    const ct = html && !text ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8';
    return {
      headers: [`Content-Type: ${ct}`, 'MIME-Version: 1.0'],
      body: singlePlain,
    };
  }

  const outerBoundary = `----=_SimpleCRM_${randomBytes(8).toString('hex')}`;
  const outerHeaders = [`MIME-Version: 1.0`, `Content-Type: multipart/mixed; boundary="${outerBoundary}"`];

  const innerParts: string[] = [];

  if (hasAlt) {
    const altBoundary = `----=_SimpleCRM_alt_${randomBytes(8).toString('hex')}`;
    innerParts.push(
      `--${outerBoundary}`,
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      '',
      `--${altBoundary}`,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      text,
      `--${altBoundary}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      html,
      `--${altBoundary}--`,
    );
  } else {
    const ct = html && !text ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8';
    innerParts.push(
      `--${outerBoundary}`,
      `Content-Type: ${ct}`,
      'Content-Transfer-Encoding: 8bit',
      '',
      singlePlain,
    );
  }

  for (const fp of fileParts) {
    innerParts.push(`--${outerBoundary}`, fp);
  }
  innerParts.push(`--${outerBoundary}--`, '');

  return { headers: outerHeaders, body: innerParts.join('\r\n') };
}

function synthesizeHeaders(row: EmailMessageRow): string {
  const lines: string[] = [];
  const from = formatMailboxList(row.from_json);
  if (from) lines.push(`From: ${from}`);
  const to = formatMailboxList(row.to_json);
  if (to) lines.push(`To: ${to}`);
  const cc = formatMailboxList(row.cc_json);
  if (cc) lines.push(`Cc: ${cc}`);
  if (row.subject) lines.push(`Subject: ${row.subject}`);
  if (row.date_received) lines.push(`Date: ${row.date_received}`);
  if (row.message_id) lines.push(`Message-ID: ${row.message_id}`);
  if (row.in_reply_to) lines.push(`In-Reply-To: ${row.in_reply_to}`);
  if (row.references_header) lines.push(`References: ${row.references_header}`);
  lines.push('X-SimpleCRM-Reconstructed: 1');
  return lines.join('\r\n');
}

function buildReconstructedEml(row: EmailMessageRow, attachments: EmailAttachmentRow[]): string {
  const { headers: bodyHdrs, body } = buildBodyParts({
    bodyText: row.body_text,
    bodyHtml: row.body_html,
    attachments,
  });

  const storedHeaders =
    row.raw_headers?.trim() && !isCorruptRawHeaders(row.raw_headers) ? row.raw_headers : null;
  let headerBlock = storedHeaders
    ? stripContentTypeFromHeaders(storedHeaders)
    : synthesizeHeaders(row);
  headerBlock = crlf(headerBlock).replace(/\r\n+$/, '');
  const extra = bodyHdrs.map((h) => crlf(h)).join('\r\n');
  const allHeaders = extra ? `${headerBlock}\r\n${extra}` : headerBlock;
  return `${allHeaders}\r\n\r\n${crlf(body).replace(/\r\n+$/, '')}\r\n`;
}

export type EmlBuildMeta = {
  source: 'original' | 'reconstructed';
  attachmentCount: number;
  note?: string;
};

export function buildEmlForMessage(
  row: EmailMessageRow,
  attachments: EmailAttachmentRow[],
): { eml: string; meta: EmlBuildMeta } {
  if (row.raw_rfc822_b64?.trim()) {
    return {
      eml: emlFromStorageB64(row.raw_rfc822_b64),
      meta: { source: 'original', attachmentCount: attachments.length },
    };
  }

  const missingOnDisk = attachments.filter((a) => !fs.existsSync(a.storage_path)).length;
  let note: string | undefined;
  if (attachments.length > 0 && missingOnDisk > 0) {
    note = `${missingOnDisk} Anhang/Anhänge nicht auf Platte — in der Rekonstruktion fehlend.`;
  } else if (!row.raw_headers?.trim() || isCorruptRawHeaders(row.raw_headers)) {
    note = isCorruptRawHeaders(row.raw_headers)
      ? 'Gespeicherte Header waren ungültig — rekonstruiert aus Absender, Betreff und Body.'
      : 'Keine Original-Rohmail gespeichert (ältere Syncs). Header/Body aus Datenbank rekonstruiert.';
  } else {
    note =
      'Keine vollständige Original-Rohmail — rekonstruiert aus gespeicherten Headern, Body und Anhängen.';
  }

  return {
    eml: buildReconstructedEml(row, attachments),
    meta: {
      source: 'reconstructed',
      attachmentCount: attachments.length,
      note,
    },
  };
}

export function formatEmlDisplayAppendix(row: EmailMessageRow, meta: EmlBuildMeta): string {
  const lines: string[] = [
    '',
    '--- SimpleCRM (Zusatz, nicht Teil der Original-RFC822-Nachricht) ---',
    `Quelle: ${meta.source === 'original' ? 'Original-Rohmail vom Sync' : 'Rekonstruktion aus DB'}`,
    `Lokale Nachrichten-ID: ${row.id}`,
    `Account-ID: ${row.account_id}`,
    `Ordner-ID: ${row.folder_id}`,
    `IMAP/POP3 UID: ${row.uid}`,
  ];
  if (row.pop3_uidl) lines.push(`POP3 UIDL: ${row.pop3_uidl}`);
  if (meta.attachmentCount > 0) {
    lines.push(`Anhänge in SimpleCRM: ${meta.attachmentCount}`);
  }
  if (meta.note) lines.push(`Hinweis: ${meta.note}`);
  if (row.auth_spf || row.auth_dkim || row.auth_dmarc) {
    lines.push(
      `Auth: SPF=${row.auth_spf ?? '—'} DKIM=${row.auth_dkim ?? '—'} DMARC=${row.auth_dmarc ?? '—'}`,
    );
  }
  return lines.join('\r\n');
}
