/**
 * Attachment text extraction for the server edition (Suche Phase 3):
 * txt/md/csv/log, html, pdf (pdf-parse), docx (mammoth). Dispatch and caps
 * come from @simplecrm/core (shared with the desktop extractor); this module
 * is the thin fs/DB wrapper. Results land in
 * email_message_attachments.content_text (search_vector regenerates itself);
 * every failure is non-fatal — the row is marked as tried
 * (text_extracted_at) and skipped from future backfills.
 */
import { readFile, stat } from 'node:fs/promises';

import {
  ATTACHMENT_TEXT_MAX_BYTES,
  attachmentTextKind,
  capAttachmentText,
  plainTextFromHtml,
  type AttachmentTextKind,
} from '@simplecrm/core';
import type { Kysely } from 'kysely';

import {
  resolveAttachmentStoragePath,
  withWorkspaceTransaction,
  type ServerDatabase,
  type WorkspaceSessionApplier,
} from './db';

const BACKFILL_BATCH_SIZE = 25;
const BACKFILL_POLL_INTERVAL_MS = 30_000;
const BACKFILL_BUSY_PAUSE_MS = 2_000;

export type AttachmentTextExtractionOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  attachmentsRoot: string;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}>;

type ExtractableAttachmentRow = Readonly<{
  id: number;
  workspace_id: string;
  filename_display: string;
  content_type: string | null;
  size_bytes: number | string;
  storage_path: string;
}>;

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

async function markExtracted(
  options: AttachmentTextExtractionOptions,
  row: ExtractableAttachmentRow,
  text: string | null,
): Promise<void> {
  await withWorkspaceTransaction(
    options.db,
    { workspaceId: row.workspace_id, role: 'system' },
    async (trx) => {
      await trx
        .updateTable('email_message_attachments')
        .set({ content_text: text, text_extracted_at: new Date(), updated_at: new Date() })
        .where('workspace_id', '=', row.workspace_id)
        .where('id', '=', Number(row.id))
        .execute();
    },
    { applySession: options.applyWorkspaceSession },
  );
}

/** Extract one row; always marks it as tried. True when text was stored. */
export async function extractTextForAttachmentRow(
  options: AttachmentTextExtractionOptions,
  row: ExtractableAttachmentRow,
): Promise<boolean> {
  try {
    const kind = attachmentTextKind(row.filename_display, row.content_type);
    const sizeBytes = Number(row.size_bytes);
    if (!kind || sizeBytes > ATTACHMENT_TEXT_MAX_BYTES) {
      await markExtracted(options, row, null);
      return false;
    }
    const resolvedPath = resolveAttachmentStoragePath(options.attachmentsRoot, row.storage_path);
    if (!resolvedPath) {
      await markExtracted(options, row, null);
      return false;
    }
    const fileStat = await stat(resolvedPath);
    if (fileStat.size > ATTACHMENT_TEXT_MAX_BYTES) {
      await markExtracted(options, row, null);
      return false;
    }
    const buf = await readFile(resolvedPath);
    const text = await extractAttachmentTextFromBuffer(buf, kind);
    await markExtracted(options, row, text.length > 0 ? text : null);
    return text.length > 0;
  } catch {
    try {
      await markExtracted(options, row, null);
    } catch {
      /* DB nicht erreichbar — Zeile bleibt Kandidat fuer den naechsten Lauf. */
    }
    return false;
  }
}

/** Best-effort extraction for all not-yet-tried attachments of one message. */
export async function extractTextForMessageAttachments(
  options: AttachmentTextExtractionOptions,
  input: { workspaceId: string; messageId: number },
): Promise<void> {
  let rows: ExtractableAttachmentRow[];
  try {
    rows = (await options.db
      .selectFrom('email_message_attachments')
      .select(['id', 'workspace_id', 'filename_display', 'content_type', 'size_bytes', 'storage_path'])
      .where('workspace_id', '=', input.workspaceId)
      .where('message_id', '=', input.messageId)
      .where('text_extracted_at', 'is', null)
      .execute()) as unknown as ExtractableAttachmentRow[];
  } catch {
    return;
  }
  for (const row of rows) {
    await extractTextForAttachmentRow(options, row);
  }
}

/** One backfill batch across workspaces; returns processed row count. */
export async function runAttachmentTextBackfillBatch(
  options: AttachmentTextExtractionOptions,
  limit = BACKFILL_BATCH_SIZE,
): Promise<number> {
  const rows = (await options.db
    .selectFrom('email_message_attachments')
    .select(['id', 'workspace_id', 'filename_display', 'content_type', 'size_bytes', 'storage_path'])
    .where('text_extracted_at', 'is', null)
    .orderBy('id', 'asc')
    .limit(limit)
    .execute()) as unknown as ExtractableAttachmentRow[];
  for (const row of rows) {
    await extractTextForAttachmentRow(options, row);
  }
  return rows.length;
}

/**
 * Background backfill after server start (pattern: startScheduledSendTicker):
 * small batches with pauses, keeps polling for newly synced attachments,
 * never blocks startup.
 */
export function startAttachmentTextBackfillTicker(
  options: AttachmentTextExtractionOptions & { pollIntervalMs?: number },
): { stop(): void } {
  const pollIntervalMs = options.pollIntervalMs ?? BACKFILL_POLL_INTERVAL_MS;
  let stopped = false;
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = (delay: number) => {
    if (stopped) return;
    timer = setTimeout(() => {
      void tick();
    }, delay);
  };

  const tick = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const processed = await runAttachmentTextBackfillBatch(options);
      schedule(processed >= BACKFILL_BATCH_SIZE ? BACKFILL_BUSY_PAUSE_MS : pollIntervalMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[mail] attachment text backfill: ${message}`);
      schedule(pollIntervalMs);
    } finally {
      inFlight = false;
    }
  };

  schedule(BACKFILL_BUSY_PAUSE_MS);

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
