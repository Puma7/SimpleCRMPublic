/**
 * Converts legacy originals (raw_rfc822_b64 text) to the compressed storage of
 * mail-raw-storage.ts. Application-level batch job like the body_text
 * backfill: email_messages is FORCE ROW LEVEL SECURITY, so a migration UPDATE
 * would be a silent no-op.
 *
 * Safety: each row is converted on its own. encodeRawForStorage proves the
 * round trip before anything is written, and the UPDATE only applies when the
 * stored base64 is still the one that was read (md5 guard): a concurrent
 * re-sync that wrote a new original wins, nothing is lost. updated_at stays:
 * the content did not change, only how it is stored.
 *
 * Candidates are enumerated cross-workspace (system session); each row is
 * loaded and updated in its own workspace session. Big originals are loaded
 * one at a time, so memory stays bounded by the largest single message.
 */
import { createHash, randomUUID } from 'node:crypto';

import { sql, type Kysely } from 'kysely';

import {
  withWorkspaceTransaction,
  type ServerDatabase,
  type WorkspaceSessionApplier,
} from './db';
import { encodeRawForStorage } from './mail-raw-storage';

const BACKFILL_BATCH_SIZE = 50;
const BACKFILL_BATCH_PAUSE_MS = 1000;

export type RawCompressionBackfillOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}>;

type Candidate = Readonly<{ id: number | string; workspace_id: string }>;

export type RawCompressionBatchResult = {
  seen: number;
  lastId: number;
  converted: number;
  skipped: number;
  bytesBefore: number;
  bytesAfter: number;
};

/** One keyset batch. seen = 0 means the scan is done. */
export async function runRawCompressionBackfillBatch(
  options: RawCompressionBackfillOptions,
  afterId: number,
  limit = BACKFILL_BATCH_SIZE,
): Promise<RawCompressionBatchResult> {
  const candidates = (await withWorkspaceTransaction(
    options.db,
    { workspaceId: randomUUID(), role: 'system', crossWorkspaceAccess: true },
    async (trx) => trx
      .selectFrom('email_messages')
      .select(['id', 'workspace_id'])
      .where('id', '>', afterId)
      .where('raw_rfc822_b64', 'is not', null)
      .where('raw_rfc822_z', 'is', null)
      .orderBy('id', 'asc')
      .limit(limit)
      .execute(),
    { applySession: options.applyWorkspaceSession },
  )) as unknown as Candidate[];
  const result: RawCompressionBatchResult = {
    seen: candidates.length,
    lastId: afterId,
    converted: 0,
    skipped: 0,
    bytesBefore: 0,
    bytesAfter: 0,
  };
  for (const candidate of candidates) {
    const id = Number(candidate.id);
    result.lastId = id;
    const outcome = await convertOneRow(options, candidate.workspace_id, id);
    if (outcome) {
      result.converted += 1;
      result.bytesBefore += outcome.bytesBefore;
      result.bytesAfter += outcome.bytesAfter;
    } else {
      result.skipped += 1;
    }
  }
  return result;
}

async function convertOneRow(
  options: RawCompressionBackfillOptions,
  workspaceId: string,
  id: number,
): Promise<{ bytesBefore: number; bytesAfter: number } | null> {
  return withWorkspaceTransaction(
    options.db,
    { workspaceId, role: 'system' },
    async (trx) => {
      const row = await trx
        .selectFrom('email_messages')
        .select(['raw_rfc822_b64'])
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', id)
        .where('raw_rfc822_z', 'is', null)
        .executeTakeFirst();
      const encoded = row?.raw_rfc822_b64?.trim();
      if (!encoded) return null;
      const original = Buffer.from(encoded, 'base64');
      if (original.length === 0) return null;
      const stored = await encodeRawForStorage(original);
      const md5 = createHash('md5').update(row!.raw_rfc822_b64!, 'utf8').digest('hex');
      const updated = await trx
        .updateTable('email_messages')
        .set(stored)
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', id)
        .where('raw_rfc822_z', 'is', null)
        .where(sql<boolean>`md5(raw_rfc822_b64) = ${md5}`)
        .executeTakeFirst();
      if (Number(updated.numUpdatedRows ?? 0) !== 1) return null;
      return { bytesBefore: Buffer.byteLength(row!.raw_rfc822_b64!, 'utf8'), bytesAfter: stored.raw_rfc822_z.length };
    },
    { applySession: options.applyWorkspaceSession },
  );
}

/**
 * Self-terminating run after server start: batches with pauses, ends when a
 * full keyset scan finds no candidates. A failing row aborts the run (it is
 * retried on the next start); the rows converted so far stay converted.
 */
export function startRawCompressionBackfillRun(
  options: RawCompressionBackfillOptions & { batchPauseMs?: number },
): { stop(): void } {
  const pauseMs = options.batchPauseMs ?? BACKFILL_BATCH_PAUSE_MS;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastId = 0;
  const total = { converted: 0, bytesBefore: 0, bytesAfter: 0 };

  const tick = async () => {
    if (stopped) return;
    try {
      const batch = await runRawCompressionBackfillBatch(options, lastId);
      if (stopped) return;
      if (batch.seen === 0) {
        if (total.converted > 0) {
          const mb = (bytes: number) => (bytes / 1048576).toFixed(1);
          console.warn(`[mail] raw original compression done: ${total.converted} messages, ${mb(total.bytesBefore)} MB -> ${mb(total.bytesAfter)} MB`);
        }
        return;
      }
      lastId = batch.lastId;
      total.converted += batch.converted;
      total.bytesBefore += batch.bytesBefore;
      total.bytesAfter += batch.bytesAfter;
      timer = setTimeout(() => { void tick(); }, pauseMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[mail] raw original compression aborted (retry next start): ${message}`);
    }
  };

  timer = setTimeout(() => { void tick(); }, pauseMs);
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
