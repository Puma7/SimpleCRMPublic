/**
 * Attachment text extraction for the server edition (Suche Phase 3):
 * txt/md/csv/log, html, pdf (pdf-parse), docx (mammoth). Dispatch and caps
 * come from @simplecrm/core (shared with the desktop extractor); this module
 * is the thin fs/DB wrapper. Results land in
 * email_message_attachments.content_text (search_vector regenerates itself);
 * every failure is non-fatal — the row is marked as tried
 * (text_extracted_at) and skipped from future backfills.
 *
 * RLS: email_message_attachments is FORCE ROW LEVEL SECURITY. Candidate
 * enumeration across workspaces therefore runs inside a
 * withWorkspaceTransaction with role 'system' + crossWorkspaceAccess (the
 * same pattern the job-queue/auth ports use for cross-workspace scans);
 * per-row updates run in the row's own workspace session.
 */
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';

import {
  ATTACHMENT_TEXT_MAX_BYTES,
  attachmentTextKind,
  capAttachmentText,
  plainTextFromHtml,
  type AttachmentTextKind,
} from '@simplecrm/core';
import type { Kysely } from 'kysely';
import yauzl from 'yauzl';

import {
  resolveAttachmentStoragePath,
  withWorkspaceTransaction,
  type ServerDatabase,
  type WorkspaceSessionApplier,
} from './db';

const BACKFILL_BATCH_SIZE = 25;
const BACKFILL_POLL_INTERVAL_MS = 30_000;
const BACKFILL_BUSY_PAUSE_MS = 2_000;
/** Hard cap per parse — a hung pdf/docx parse must not stall the pipeline. */
const EXTRACT_TIMEOUT_MS = 30_000;
const MAX_DOCX_ARCHIVE_ENTRIES = 2_048;
const MAX_DOCX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;

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

const EXTRACTABLE_COLUMNS = [
  'id',
  'workspace_id',
  'filename_display',
  'content_type',
  'size_bytes',
  'storage_path',
] as const;

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
      await validateDocxArchive(buf);
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer: buf });
      return capAttachmentText(result.value ?? '');
    }
  }
}

async function validateDocxArchive(buf: Buffer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true }, (openError, zip) => {
      if (openError || !zip) {
        reject(openError ?? new Error('DOCX archive could not be opened'));
        return;
      }
      let entries = 0;
      let uncompressedBytes = 0;
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        zip.close();
        callback();
      };
      const rejectUnsafe = () => finish(() => reject(new Error('DOCX archive exceeds safe expansion limit')));
      zip.on('error', (error) => finish(() => reject(error)));
      zip.on('end', () => finish(resolve));
      zip.on('entry', (entry: yauzl.Entry) => {
        entries += 1;
        uncompressedBytes += entry.uncompressedSize;
        if (
          entries > MAX_DOCX_ARCHIVE_ENTRIES
          || uncompressedBytes > MAX_DOCX_UNCOMPRESSED_BYTES
          || (entry.generalPurposeBitFlag & 0x1) !== 0
        ) {
          rejectUnsafe();
          return;
        }
        zip.readEntry();
      });
      zip.readEntry();
    });
  });
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
    const text = await withTimeout(extractAttachmentTextFromBuffer(buf, kind), EXTRACT_TIMEOUT_MS);
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
    rows = (await withWorkspaceTransaction(
      options.db,
      { workspaceId: input.workspaceId, role: 'system' },
      async (trx) =>
        trx
          .selectFrom('email_message_attachments')
          .select(EXTRACTABLE_COLUMNS)
          .where('workspace_id', '=', input.workspaceId)
          .where('message_id', '=', input.messageId)
          .where('text_extracted_at', 'is', null)
          .execute(),
      { applySession: options.applyWorkspaceSession },
    )) as unknown as ExtractableAttachmentRow[];
  } catch {
    return;
  }
  for (const row of rows) {
    await extractTextForAttachmentRow(options, row);
  }
}

let syncExtractionQueue: Promise<void> = Promise.resolve();

/**
 * Sync-time hook: serialized queue (concurrency 1) so bulk syncs cannot pile
 * up parallel extraction chains and their file buffers.
 */
export function queueMessageAttachmentExtraction(
  options: AttachmentTextExtractionOptions,
  input: { workspaceId: string; messageId: number },
): void {
  syncExtractionQueue = syncExtractionQueue
    .then(() => extractTextForMessageAttachments(options, input))
    .catch(() => undefined);
}

/** One backfill batch across workspaces; returns processed row count. */
export async function runAttachmentTextBackfillBatch(
  options: AttachmentTextExtractionOptions,
  limit = BACKFILL_BATCH_SIZE,
): Promise<number> {
  // Cross-workspace candidate scan needs an explicit system session with
  // cross-workspace access — without it FORCE RLS returns zero rows.
  const rows = (await withWorkspaceTransaction(
    options.db,
    { workspaceId: randomUUID(), role: 'system', crossWorkspaceAccess: true },
    async (trx) =>
      trx
        .selectFrom('email_message_attachments')
        .select(EXTRACTABLE_COLUMNS)
        .where('text_extracted_at', 'is', null)
        .orderBy('id', 'asc')
        .limit(limit)
        .execute(),
    { applySession: options.applyWorkspaceSession },
  )) as unknown as ExtractableAttachmentRow[];
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
