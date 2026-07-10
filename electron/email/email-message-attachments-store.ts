import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { app } from 'electron';
import { getDb } from '../sqlite-service';
import { EMAIL_MESSAGE_ATTACHMENTS_TABLE, EMAIL_MESSAGES_TABLE } from '../database-schema';

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

function sha256Hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

type PreparedPart = {
  hash: string;
  buf: Buffer;
  displayName: string;
  contentType: string | null;
};

export type PersistLocalComposeAttachmentsResult = {
  expectedCount: number;
  storedCount: number;
  failures: { name: string; reason: string }[];
};

function insertPreparedAttachments(
  messageId: number,
  prepared: PreparedPart[],
  omitted: { name: string; size: number; reason: string }[],
): { storedCount: number; writeFailures: { name: string; reason: string }[] } {
  const db = getDb();
  const metaJson =
    omitted.length > 0
      ? JSON.stringify({
          stored: prepared.map((p) => ({ name: p.displayName, size: p.buf.length })),
          omitted,
        })
      : null;

  if (prepared.length === 0) {
    const row = db.prepare(`SELECT has_attachments FROM ${EMAIL_MESSAGES_TABLE} WHERE id = ?`).get(messageId) as
      | { has_attachments: number }
      | undefined;
    if (omitted.length > 0) {
      db.prepare(
        `UPDATE ${EMAIL_MESSAGES_TABLE} SET has_attachments = 1, attachments_json = ? WHERE id = ?`,
      ).run(metaJson, messageId);
    } else if (row?.has_attachments === 1) {
      db.prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET has_attachments = 0 WHERE id = ?`).run(messageId);
    }
    return { storedCount: 0, writeFailures: [] };
  }

  const dir = path.join(attachmentsRoot(), String(messageId));
  fs.mkdirSync(dir, { recursive: true });

  const written: { filePath: string; displayName: string; hash: string; contentType: string | null; size: number }[] = [];
  const writeFailures: { name: string; reason: string }[] = [];
  let fileIdx = 0;
  for (const p of prepared) {
    let filePath = path.join(dir, p.displayName);
    try {
      if (fs.existsSync(filePath)) {
        filePath = path.join(dir, `${fileIdx}-${p.displayName}`);
      }
      fs.writeFileSync(filePath, p.buf);
      written.push({
        filePath,
        displayName: path.basename(filePath),
        hash: p.hash,
        contentType: p.contentType,
        size: p.buf.length,
      });
    } catch (e) {
      writeFailures.push({
        name: p.displayName,
        reason: e instanceof Error ? e.message : 'write_failed',
      });
    }
    fileIdx += 1;
  }

  const ins = db.prepare(
    `INSERT OR IGNORE INTO ${EMAIL_MESSAGE_ATTACHMENTS_TABLE}
     (message_id, filename_display, content_type, size_bytes, storage_path, content_sha256)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  let storedCount = 0;
  const transaction = db.transaction(() => {
    let storedAny = false;
    for (const w of written) {
      const r = ins.run(messageId, w.displayName, w.contentType, w.size, w.filePath, w.hash);
      if (r.changes > 0) {
        storedAny = true;
        storedCount += 1;
      } else {
        void fs.promises.unlink(w.filePath).catch(() => undefined);
        writeFailures.push({ name: w.displayName, reason: 'db_insert_skipped' });
      }
    }

    if (storedAny || omitted.length > 0) {
      db.prepare(
        `UPDATE ${EMAIL_MESSAGES_TABLE} SET has_attachments = 1, attachments_json = COALESCE(?, attachments_json) WHERE id = ?`,
      ).run(metaJson, messageId);
    } else {
      const row = db.prepare(`SELECT has_attachments FROM ${EMAIL_MESSAGES_TABLE} WHERE id = ?`).get(messageId) as
        | { has_attachments: number }
        | undefined;
      if (row?.has_attachments === 1) {
        db.prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET has_attachments = 0 WHERE id = ?`).run(messageId);
      }
    }
  });

  transaction();
  if (storedCount > 0) {
    // Best-effort text extraction (pdf/docx/txt/html) for the search index;
    // serialized queue (concurrency 1) so bulk syncs cannot pile up parallel
    // extraction chains; lazy import keeps the parser deps off the hot path.
    void import('./attachment-text-extract')
      .then((m) => m.queueMessageAttachmentExtraction(messageId))
      .catch(() => undefined);
  }
  return { storedCount, writeFailures };
}

export function persistLocalComposeAttachments(
  messageId: number,
  attachments: { filename?: string; path: string; contentType?: string }[] | undefined,
): PersistLocalComposeAttachmentsResult {
  if (!attachments?.length) {
    getDb().prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET has_attachments = 0 WHERE id = ?`).run(messageId);
    return { expectedCount: 0, storedCount: 0, failures: [] };
  }

  const readFailures: { name: string; reason: string }[] = [];
  const prepared: PreparedPart[] = [];
  const seenSha = new Set<string>();
  const expectedCount = attachments.length;

  for (const [idx, attachment] of attachments.entries()) {
    const displayName = safeFilename(
      attachment.filename || path.basename(attachment.path) || `file-${idx}`,
    );
    try {
      const st = fs.statSync(attachment.path);
      if (!st.isFile()) {
        readFailures.push({ name: displayName, reason: 'not_a_file' });
        continue;
      }
      const buf = fs.readFileSync(attachment.path);
      if (buf.length === 0) {
        readFailures.push({ name: displayName, reason: 'empty_file' });
        continue;
      }
      const hash = sha256Hex(buf);
      if (seenSha.has(hash)) {
        readFailures.push({ name: displayName, reason: 'duplicate_content' });
        continue;
      }
      seenSha.add(hash);
      prepared.push({
        hash,
        buf,
        displayName,
        contentType: attachment.contentType ?? null,
      });
    } catch (e) {
      readFailures.push({
        name: displayName,
        reason: e instanceof Error ? e.message : 'read_failed',
      });
    }
  }

  const { storedCount, writeFailures } = insertPreparedAttachments(messageId, prepared, []);
  const failures = [...readFailures, ...writeFailures];

  if (expectedCount > 0 && storedCount < expectedCount) {
    const detail = failures.map((f) => `${f.name}: ${f.reason}`).join('; ');
    throw new Error(
      `Nur ${storedCount} von ${expectedCount} Anhängen lokal gespeichert${detail ? ` (${detail})` : ''}.`,
    );
  }

  return { expectedCount, storedCount, failures };
}

/**
 * Persist parsed mail attachments: async disk writes, then a single DB transaction.
 * Deduplicates by SHA-256 per message. Clears has_attachments if MIME claimed parts exist but none stored.
 */
export async function persistParsedAttachments(
  messageId: number,
  attachments: { filename?: string; contentType?: string; size?: number; content?: Buffer }[] | undefined,
): Promise<void> {
  if (!attachments?.length) return;

  const db = getDb();
  const existingRows = db
    .prepare(
      `SELECT id, storage_path FROM ${EMAIL_MESSAGE_ATTACHMENTS_TABLE} WHERE message_id = ?`,
    )
    .all(messageId) as { id: number; storage_path: string }[];
  const missingOnDisk = existingRows.some((r) => !fs.existsSync(r.storage_path));
  if (existingRows.length > 0 && !missingOnDisk) return;

  const prepared: PreparedPart[] = [];
  const omitted: { name: string; size: number; reason: string }[] = [];
  const seenSha = new Set<string>();
  let idx = 0;
  for (const a of attachments) {
    const buf = a.content;
    if (!buf || !Buffer.isBuffer(buf) || buf.length === 0) continue;
    if (buf.length > MAX_ATTACHMENT_BYTES) {
      omitted.push({
        name: safeFilename(a.filename || `file-${idx}`),
        size: buf.length,
        reason: 'too_large',
      });
      idx += 1;
      continue;
    }
    const hash = sha256Hex(buf);
    if (seenSha.has(hash)) continue;
    seenSha.add(hash);
    prepared.push({
      hash,
      buf,
      displayName: safeFilename(a.filename || `file-${idx}`),
      contentType: a.contentType ?? null,
    });
    idx += 1;
  }

  insertPreparedAttachments(messageId, prepared, omitted);
}

/** Remove on-disk attachment files for all messages of an account (before account DELETE CASCADE). */
export async function purgeAttachmentFilesForAccount(accountId: number): Promise<void> {
  const rows = getDb()
    .prepare(
      `SELECT a.storage_path FROM ${EMAIL_MESSAGE_ATTACHMENTS_TABLE} a
       INNER JOIN ${EMAIL_MESSAGES_TABLE} m ON m.id = a.message_id
       WHERE m.account_id = ?`,
    )
    .all(accountId) as { storage_path: string }[];
  const dirs = new Set<string>();
  for (const r of rows) {
    if (r.storage_path) {
      dirs.add(path.dirname(r.storage_path));
      await fs.promises.unlink(r.storage_path).catch(() => undefined);
    }
  }
  const accountDir = path.join(attachmentsRoot(), String(accountId));
  await fs.promises.rm(accountDir, { recursive: true, force: true }).catch(() => undefined);
  for (const d of dirs) {
    if (d.startsWith(attachmentsRoot())) {
      await fs.promises.rm(d, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/** Root used for GDPR ZIP (directory must exist before archiver.directory). */
export function getAttachmentsRootForExport(): string {
  return path.join(app.getPath('userData'), 'email-attachments');
}
