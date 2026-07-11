/**
 * Standalone (DB-free) MIME parsing for the server edition. Extracted out of
 * mail-sync.ts so unit tests can import parseMailSource without dragging the
 * Kysely/Postgres stack (kysely is ESM-only and trips the mail Jest preset).
 *
 * mail-sync.ts re-imports the values it needs from here, so the public API
 * (parseMailSource etc. via the packages/server/src barrel) is unchanged.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  addressJson,
  formatDate,
  parseAttachmentsMeta,
  plainTextFromHtml,
  rawHeadersFromParsed,
  snippetFromParsed,
} from '@simplecrm/core';

export const MAX_SYNC_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_SYNC_ATTACHMENT_TOTAL_BYTES = 50 * 1024 * 1024;

export type ServerMailSyncParsedAttachment = Readonly<{
  filename: string;
  contentType: string | null;
  sizeBytes: number;
  contentSha256: string;
  content: Buffer;
}>;

export type ServerMailSyncParsedMessage = Readonly<{
  messageId: string | null;
  inReplyTo: string | null;
  referencesHeader: string | null;
  subject: string | null;
  fromJson: unknown | null;
  toJson: unknown | null;
  ccJson: unknown | null;
  bccJson: unknown | null;
  dateReceived: string | null;
  snippet: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  hasAttachments: boolean;
  attachmentsJson: unknown | null;
  rawHeaders: string | null;
  rawRfc822B64: string;
  attachments?: readonly ServerMailSyncParsedAttachment[];
}>;

export function sourceToBuffer(source: Buffer | Uint8Array | string): Buffer {
  if (Buffer.isBuffer(source)) return source;
  if (typeof source === 'string') return Buffer.from(source);
  return Buffer.from(source.buffer, source.byteOffset, source.byteLength);
}

export function sanitizeAttachmentFilename(input: string): string {
  const basename = path.basename(input).trim();
  if (!basename || basename === '.' || basename === '..') return 'attachment';
  const sanitized = basename
    .replace(/[\r\n\0]+/g, '_')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+/, '')
    .slice(0, 180);
  return sanitized || 'attachment';
}

/** Validates JSON text and returns it as a string suitable for jsonb columns.
 *  Returning the parsed value would be serialized by node-postgres as a Postgres
 *  array literal ('{...}') and rejected by jsonb. */
export function parseJsonValue(value: string | null): string | null {
  if (!value) return null;
  try {
    JSON.parse(value);
    return value;
  } catch {
    return null;
  }
}

export function parsedAttachmentsForStorage(
  attachments:
    | readonly {
      filename?: string;
      contentType?: string;
      size?: number;
      content?: Buffer | Uint8Array | string;
    }[]
    | undefined,
): ServerMailSyncParsedAttachment[] {
  if (!attachments?.length) return [];
  const stored: ServerMailSyncParsedAttachment[] = [];
  let totalBytes = 0;
  for (const attachment of attachments) {
    if (attachment.content == null) continue;
    const content = sourceToBuffer(attachment.content);
    if (content.length <= 0 || content.length > MAX_SYNC_ATTACHMENT_BYTES) continue;
    if (totalBytes + content.length > MAX_SYNC_ATTACHMENT_TOTAL_BYTES) break;
    totalBytes += content.length;
    stored.push({
      filename: sanitizeAttachmentFilename(attachment.filename ?? 'attachment'),
      contentType: attachment.contentType?.trim() || null,
      sizeBytes: typeof attachment.size === 'number' && Number.isFinite(attachment.size)
        ? Math.max(0, Math.trunc(attachment.size))
        : content.length,
      contentSha256: createHash('sha256').update(content).digest('hex'),
      content,
    });
  }
  return stored;
}

export async function parseMailSource(source: Buffer): Promise<ServerMailSyncParsedMessage> {
  const { simpleParser } = require('mailparser') as {
    simpleParser(input: Buffer): Promise<{
      messageId?: string;
      inReplyTo?: string;
      references?: string | string[];
      subject?: string;
      from?: unknown;
      to?: unknown;
      cc?: unknown;
      bcc?: unknown;
      date?: Date;
      text?: string;
      html?: string | false;
      attachments?: { filename?: string; contentType?: string; size?: number; content?: Buffer | Uint8Array | string }[];
      headerLines?: string[];
      headers?: { get?: (key: string) => unknown; [Symbol.iterator]?: () => IterableIterator<[string, unknown]> };
    }>;
  };
  const parsed = await simpleParser(source);
  const referencesHeader = parsed.references
    ? Array.isArray(parsed.references)
      ? parsed.references.join(' ')
      : String(parsed.references)
    : null;
  const htmlBody = typeof parsed.html === 'string' ? parsed.html : null;
  // HTML-only mail: derive body_text from the HTML so search (search_vector)
  // can see it — parity with the desktop ingest.
  const textBody =
    parsed.text?.trim() || (htmlBody ? plainTextFromHtml(htmlBody) || null : null);
  const { hasAttachments, json: attachmentsJson } = parseAttachmentsMeta(parsed);
  return {
    messageId: parsed.messageId ?? null,
    inReplyTo: parsed.inReplyTo ?? null,
    referencesHeader,
    subject: parsed.subject ?? null,
    fromJson: parseJsonValue(addressJson(parsed.from)),
    toJson: parseJsonValue(addressJson(parsed.to)),
    ccJson: parseJsonValue(addressJson(parsed.cc)),
    bccJson: parseJsonValue(addressJson(parsed.bcc)),
    dateReceived: formatDate(parsed.date),
    snippet: snippetFromParsed(textBody, htmlBody),
    bodyText: textBody,
    bodyHtml: htmlBody,
    hasAttachments,
    attachmentsJson: parseJsonValue(attachmentsJson),
    rawHeaders: rawHeadersFromParsed(parsed),
    rawRfc822B64: source.toString('base64'),
    attachments: parsedAttachmentsForStorage(parsed.attachments),
  };
}
