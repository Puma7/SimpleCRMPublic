import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { getDb } from '../sqlite-service';
import { EMAIL_MESSAGE_ATTACHMENTS_TABLE } from '../database-schema';

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export type EmailAttachmentRow = {
  id: number;
  message_id: number;
  filename_display: string;
  content_type: string | null;
  size_bytes: number;
  storage_path: string;
  created_at: string;
};

function attachmentsRoot(): string {
  const root = path.join(app.getPath('userData'), 'email-attachments');
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._\-+ ]/g, '_').slice(0, 180) || 'attachment';
}

export function listAttachmentsForMessage(messageId: number): EmailAttachmentRow[] {
  return getDb()
    .prepare(
      `SELECT id, message_id, filename_display, content_type, size_bytes, storage_path, created_at
       FROM ${EMAIL_MESSAGE_ATTACHMENTS_TABLE} WHERE message_id = ? ORDER BY id ASC`,
    )
    .all(messageId) as EmailAttachmentRow[];
}

export function getAttachmentById(id: number): EmailAttachmentRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM ${EMAIL_MESSAGE_ATTACHMENTS_TABLE} WHERE id = ?`)
    .get(id) as EmailAttachmentRow | undefined;
}

/**
 * Persist parsed mail attachments to disk; skips if none or too large.
 */
export function persistParsedAttachments(
  messageId: number,
  attachments: { filename?: string; contentType?: string; size?: number; content?: Buffer }[] | undefined,
): void {
  if (!attachments?.length) return;
  const existing = getDb()
    .prepare(`SELECT COUNT(*) as c FROM ${EMAIL_MESSAGE_ATTACHMENTS_TABLE} WHERE message_id = ?`)
    .get(messageId) as { c: number };
  if (existing.c > 0) return;

  const dir = path.join(attachmentsRoot(), String(messageId));
  fs.mkdirSync(dir, { recursive: true });
  const ins = getDb().prepare(
    `INSERT INTO ${EMAIL_MESSAGE_ATTACHMENTS_TABLE}
     (message_id, filename_display, content_type, size_bytes, storage_path) VALUES (?, ?, ?, ?, ?)`,
  );

  let idx = 0;
  for (const a of attachments) {
    const buf = a.content;
    if (!buf || !Buffer.isBuffer(buf) || buf.length === 0) continue;
    if (buf.length > MAX_ATTACHMENT_BYTES) continue;
    const base = safeFilename(a.filename || `file-${idx}`);
    let filePath = path.join(dir, base);
    if (fs.existsSync(filePath)) {
      filePath = path.join(dir, `${idx}-${base}`);
    }
    fs.writeFileSync(filePath, buf);
    ins.run(messageId, base, a.contentType ?? null, buf.length, filePath);
    idx += 1;
  }
}

export function getAttachmentsRootForExport(): string {
  return attachmentsRoot();
}
