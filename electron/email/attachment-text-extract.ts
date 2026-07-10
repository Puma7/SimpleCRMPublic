/**
 * Attachment text extraction (Suche Phase 2): txt/md/csv/log, html, pdf
 * (pdf-parse), docx (mammoth). Results land in
 * email_message_attachments.text_content and are indexed by the
 * email_attachments_fts triggers. Every failure is non-fatal: the row is
 * marked as tried (text_extracted_at) and skipped from future backfills.
 *
 * storage_path values from the DB are confined to the attachments root
 * (resolve + prefix check, like the server's resolveAttachmentStoragePath) —
 * a manipulated row must not pull arbitrary files into the search index.
 */
import fs from 'fs';
import path from 'path';
import { getDb } from '../sqlite-service';
import { EMAIL_MESSAGE_ATTACHMENTS_TABLE } from '../database-schema';
import { getAttachmentsRootForExport } from './email-message-attachments-store';
import {
  ATTACHMENT_TEXT_MAX_BYTES,
  attachmentTextKind,
  capAttachmentText,
  plainTextFromHtml,
  type AttachmentTextKind,
} from './email-parse-utils';

const BACKFILL_BATCH_SIZE = 25;
const BACKFILL_BATCH_PAUSE_MS = 2_000;
/** Hard cap per parse — a hung pdf/docx parse must not stall the pipeline. */
const EXTRACT_TIMEOUT_MS = 30_000;

type ExtractableRow = {
  id: number;
  filename_display: string;
  content_type: string | null;
  size_bytes: number;
  storage_path: string;
};

export type ExtractOpts = {
  /** Override fuer Tests; Default: userData/email-attachments. */
  attachmentsRoot?: string;
};

/** storage_path -> absoluter Pfad, nur wenn er im Attachments-Root liegt. */
function resolveConfinedStoragePath(storagePath: string, attachmentsRoot?: string): string | null {
  const root = path.resolve(attachmentsRoot ?? getAttachmentsRootForExport());
  const resolved = path.resolve(storagePath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

/**
 * Reject after ms. NB: the underlying parse promise cannot be cancelled and
 * may keep running detached — acceptable, the row is marked as tried and the
 * pipeline moves on.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error(`extraction timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolvePromise(value);
      },
      (error) => {
        clearTimeout(timer);
        rejectPromise(error);
      },
    );
  });
}

/** Buffer -> plain text for a supported kind (caller checked size limits). */
export async function extractAttachmentTextFromBuffer(
  buf: Buffer,
  kind: AttachmentTextKind,
): Promise<string> {
  switch (kind) {
    case 'text':
      return capAttachmentText(buf.toString('utf8'));
    case 'html':
      return capAttachmentText(plainTextFromHtml(buf.toString('utf8')));
    case 'pdf': {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: new Uint8Array(buf) });
      try {
        const result = await parser.getText();
        return capAttachmentText(result.text ?? '');
      } finally {
        await parser.destroy().catch(() => undefined);
      }
    }
    case 'docx': {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer: buf });
      return capAttachmentText(result.value ?? '');
    }
  }
}

function markExtracted(id: number, text: string | null): void {
  getDb()
    .prepare(
      `UPDATE ${EMAIL_MESSAGE_ATTACHMENTS_TABLE}
       SET text_content = ?, text_extracted_at = datetime('now') WHERE id = ?`,
    )
    .run(text, id);
}

/**
 * Extract one attachment row; always marks the row as tried. Returns true
 * when non-empty text was stored.
 */
export async function extractTextForAttachmentRow(
  row: ExtractableRow,
  opts?: ExtractOpts,
): Promise<boolean> {
  try {
    const kind = attachmentTextKind(row.filename_display, row.content_type);
    if (!kind || row.size_bytes > ATTACHMENT_TEXT_MAX_BYTES) {
      markExtracted(row.id, null);
      return false;
    }
    const resolvedPath = resolveConfinedStoragePath(row.storage_path, opts?.attachmentsRoot);
    if (!resolvedPath) {
      markExtracted(row.id, null);
      return false;
    }
    const fileStat = await fs.promises.stat(resolvedPath);
    if (!fileStat.isFile() || fileStat.size > ATTACHMENT_TEXT_MAX_BYTES) {
      markExtracted(row.id, null);
      return false;
    }
    const buf = await fs.promises.readFile(resolvedPath);
    const text = await withTimeout(extractAttachmentTextFromBuffer(buf, kind), EXTRACT_TIMEOUT_MS);
    markExtracted(row.id, text.length > 0 ? text : null);
    return text.length > 0;
  } catch {
    try {
      markExtracted(row.id, null);
    } catch {
      /* db unavailable — retried on next backfill */
    }
    return false;
  }
}

/** Best-effort extraction for all not-yet-tried attachments of one message. */
export async function extractTextForMessageAttachments(
  messageId: number,
  opts?: ExtractOpts,
): Promise<void> {
  let rows: ExtractableRow[];
  try {
    rows = getDb()
      .prepare(
        `SELECT id, filename_display, content_type, size_bytes, storage_path
         FROM ${EMAIL_MESSAGE_ATTACHMENTS_TABLE}
         WHERE message_id = ? AND text_extracted_at IS NULL`,
      )
      .all(messageId) as ExtractableRow[];
  } catch {
    return;
  }
  for (const row of rows) {
    await extractTextForAttachmentRow(row, opts);
  }
}

let syncExtractionQueue: Promise<void> = Promise.resolve();

/**
 * Sync-time hook: serialized queue (concurrency 1) so bulk syncs cannot pile
 * up parallel extraction chains and their file buffers.
 */
export function queueMessageAttachmentExtraction(messageId: number, opts?: ExtractOpts): void {
  syncExtractionQueue = syncExtractionQueue
    .then(() => extractTextForMessageAttachments(messageId, opts))
    .catch(() => undefined);
}

/** One backfill batch over legacy attachments; returns processed row count. */
export async function runAttachmentTextBackfillBatch(
  limit = BACKFILL_BATCH_SIZE,
  opts?: ExtractOpts,
): Promise<number> {
  const rows = getDb()
    .prepare(
      `SELECT id, filename_display, content_type, size_bytes, storage_path
       FROM ${EMAIL_MESSAGE_ATTACHMENTS_TABLE}
       WHERE text_extracted_at IS NULL
       ORDER BY id ASC LIMIT ?`,
    )
    .all(limit) as ExtractableRow[];
  for (const row of rows) {
    await extractTextForAttachmentRow(row, opts);
  }
  return rows.length;
}

let backfillTimer: ReturnType<typeof setTimeout> | null = null;
let backfillRunning = false;

/**
 * Background backfill loop after app start: small batches with pauses so
 * startup and sync are never blocked; stops when no candidates remain.
 */
export function startAttachmentTextBackfill(
  logger: Pick<typeof console, 'warn' | 'debug'>,
): void {
  if (backfillRunning) return;
  backfillRunning = true;
  let total = 0;
  const tick = () => {
    backfillTimer = null;
    void runAttachmentTextBackfillBatch()
      .then((processed) => {
        total += processed;
        if (!backfillRunning) return;
        if (processed > 0) {
          backfillTimer = setTimeout(tick, BACKFILL_BATCH_PAUSE_MS);
        } else {
          backfillRunning = false;
          if (total > 0) logger.debug(`[email] attachment text backfill done (${total} rows)`);
        }
      })
      .catch((e) => {
        backfillRunning = false;
        logger.warn('[email] attachment text backfill', e);
      });
  };
  backfillTimer = setTimeout(tick, BACKFILL_BATCH_PAUSE_MS);
}

export function stopAttachmentTextBackfill(): void {
  backfillRunning = false;
  if (backfillTimer) {
    clearTimeout(backfillTimer);
    backfillTimer = null;
  }
}
