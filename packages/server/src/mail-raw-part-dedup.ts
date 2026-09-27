/**
 * Takes attachment parts out of stored originals (codec 'br' -> 'br-parts',
 * see mail-raw-parts.ts): the original keeps a reference instead of a second,
 * base64-encoded copy of a file that exists under the attachments root.
 *
 * Per message:
 *  1. read the original and its attachment rows (short transaction);
 *  2. for every base64 run whose decoded sha256 is one of the message's
 *     attachments: make sure the part object exists as a hard link of the
 *     verified attachment file (no link possible -> keep the run);
 *  3. store only if reading the new value back through the part objects
 *     yields exactly the original (encodeRawWithPartsForStorage);
 *  4. update guarded by the original's sha256 and codec, so a re-sync that
 *     wrote a new original in between wins.
 * Messages with nothing to take out are marked (empty part list) and not
 * scanned again until a new original is written.
 *
 * Nothing is deleted here: part objects stay even when attachment files go
 * (mail-raw-part-gc.ts removes parts no original names any more).
 */
import { randomUUID } from 'node:crypto';

import type { Kysely } from 'kysely';

import {
  withWorkspaceTransaction,
  type ServerDatabase,
  type WorkspaceSessionApplier,
} from './db';
import { pgTextArray } from './db/pg-array';
import { resolveAttachmentStoragePath } from './db/postgres-mail-read-ports';
import {
  decodeRunExactly,
  ensurePartObject,
  findBase64Runs,
  rawPartsDir,
  sha256Hex,
  stripRuns,
  type Base64Run,
} from './mail-raw-parts';
import {
  STORED_RAW_CODEC_BROTLI,
  encodeRawWithPartsForStorage,
  loadStoredRaw,
  rawPartReaderFor,
} from './mail-raw-storage';

const BATCH_SIZE = 20;
const TICK_INTERVAL_MS = 10 * 60_000;
const TICK_BUDGET_MS = 60_000;

export type RawPartDedupOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  attachmentsRoot: string;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}>;

export type RawPartDedupBatchResult = {
  seen: number;
  lastId: number;
  stripped: number;
  unchanged: number;
  bytesBefore: number;
  bytesAfter: number;
  /** Rows that could not be processed (damaged original, unreadable file); skipped. */
  failures: Array<{ messageId: number; error: string }>;
};

type Candidate = Readonly<{ id: number | string; workspace_id: string }>;

const MAX_REMEMBERED_FAILURES = 10_000;

export async function runRawPartDedupBatch(
  options: RawPartDedupOptions,
  afterId: number,
  limit = BATCH_SIZE,
  skipIds?: ReadonlySet<number>,
): Promise<RawPartDedupBatchResult> {
  const candidates = (await withWorkspaceTransaction(
    options.db,
    { workspaceId: randomUUID(), role: 'system', crossWorkspaceAccess: true },
    async (trx) => trx
      .selectFrom('email_messages')
      .select(['id', 'workspace_id'])
      .where('id', '>', afterId)
      .where('raw_rfc822_codec', '=', STORED_RAW_CODEC_BROTLI)
      .where('raw_rfc822_part_sha256s', 'is', null)
      .where('has_attachments', '=', true)
      .orderBy('id', 'asc')
      .limit(limit)
      .execute(),
    { applySession: options.applyWorkspaceSession },
  )) as unknown as Candidate[];
  const result: RawPartDedupBatchResult = {
    seen: candidates.length,
    lastId: afterId,
    stripped: 0,
    unchanged: 0,
    bytesBefore: 0,
    bytesAfter: 0,
    failures: [],
  };
  for (const candidate of candidates) {
    const id = Number(candidate.id);
    result.lastId = id;
    if (skipIds?.has(id)) continue;
    let outcome: Awaited<ReturnType<typeof dedupOneMessage>>;
    try {
      outcome = await dedupOneMessage(options, candidate.workspace_id, id);
    } catch (error) {
      // Ein beschädigtes Original darf die übrigen Mails nicht aufhalten.
      result.failures.push({ messageId: id, error: error instanceof Error ? error.message : String(error) });
      continue;
    }
    if (outcome) {
      result.stripped += 1;
      result.bytesBefore += outcome.bytesBefore;
      result.bytesAfter += outcome.bytesAfter;
    } else {
      result.unchanged += 1;
    }
  }
  return result;
}

async function dedupOneMessage(
  options: RawPartDedupOptions,
  workspaceId: string,
  id: number,
): Promise<{ bytesBefore: number; bytesAfter: number } | null> {
  const partsDir = rawPartsDir(options.attachmentsRoot, workspaceId);
  const readPart = rawPartReaderFor(options.attachmentsRoot, workspaceId);
  if (!partsDir || !readPart) return null;

  const loaded = await withWorkspaceTransaction(
    options.db,
    { workspaceId, role: 'system' },
    async (trx) => {
      const row = await trx
        .selectFrom('email_messages')
        .select(['raw_rfc822_z', 'raw_rfc822_codec', 'raw_rfc822_sha256', 'raw_rfc822_size'])
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', id)
        .where('raw_rfc822_codec', '=', STORED_RAW_CODEC_BROTLI)
        .where('raw_rfc822_part_sha256s', 'is', null)
        .executeTakeFirst();
      if (!row) return null;
      const attachments = await trx
        .selectFrom('email_message_attachments')
        .select(['content_sha256', 'size_bytes', 'storage_path'])
        .where('workspace_id', '=', workspaceId)
        .where('message_id', '=', id)
        .execute();
      return { row, attachments };
    },
    { applySession: options.applyWorkspaceSession },
  );
  if (!loaded) return null;
  const { row, attachments } = loaded;
  const sha256 = row.raw_rfc822_sha256!;

  const original = await loadStoredRaw(row);
  if (!original) return null;

  const filesBySha = new Map<string, string[]>();
  for (const attachment of attachments) {
    const sha = attachment.content_sha256?.toLowerCase();
    if (!sha) continue;
    const file = resolveAttachmentStoragePath(options.attachmentsRoot, attachment.storage_path);
    if (!file) continue;
    filesBySha.set(sha, [...(filesBySha.get(sha) ?? []), file]);
  }

  const takeOut: Array<{ run: Base64Run; sha256: string; size: number }> = [];
  if (filesBySha.size > 0) {
    for (const run of findBase64Runs(original)) {
      const data = decodeRunExactly(original, run);
      if (!data) continue;
      const partSha = sha256Hex(data);
      const files = filesBySha.get(partSha);
      if (!files) continue;
      let ensured = false;
      for (const file of files) {
        if (await ensurePartObject(partsDir, partSha, data.length, file)) {
          ensured = true;
          break;
        }
      }
      if (ensured) takeOut.push({ run, sha256: partSha, size: data.length });
    }
  }

  // Nothing to take out: mark as scanned (empty list) so it is not read again
  // until a new original is written.
  const patch = takeOut.length === 0
    ? { raw_rfc822_part_sha256s: [] as string[] }
    : await encodeRawWithPartsForStorage(original, stripRuns(original, takeOut), readPart);
  const updated = await withWorkspaceTransaction(
    options.db,
    { workspaceId, role: 'system' },
    async (trx) => trx
      .updateTable('email_messages')
      // text[]: as a Postgres array literal, never a JS array (see db/pg-array.ts).
      .set({ ...patch, raw_rfc822_part_sha256s: pgTextArray(patch.raw_rfc822_part_sha256s) })
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', id)
      .where('raw_rfc822_codec', '=', STORED_RAW_CODEC_BROTLI)
      .where('raw_rfc822_sha256', '=', sha256)
      .where('raw_rfc822_part_sha256s', 'is', null)
      .executeTakeFirst(),
    { applySession: options.applyWorkspaceSession },
  );
  if (!('raw_rfc822_z' in patch)) return null;
  if (Number(updated.numUpdatedRows ?? 0) !== 1) return null;
  return { bytesBefore: row.raw_rfc822_z?.length ?? 0, bytesAfter: patch.raw_rfc822_z.length };
}

/**
 * Periodic run (new mail keeps arriving): each tick works through candidates
 * for at most TICK_BUDGET_MS, then waits TICK_INTERVAL_MS. A message that
 * cannot be processed (damaged original, unreadable file) is logged once and
 * skipped for the rest of this process; after a restart it is tried again.
 * Other errors (e.g. the database) end the tick and are retried on the next one.
 */
export function startRawPartDedupTicker(
  options: RawPartDedupOptions & { intervalMs?: number; firstDelayMs?: number },
): { stop(): void } {
  const intervalMs = options.intervalMs ?? TICK_INTERVAL_MS;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Nicht bearbeitbare Mails (je Prozess, gedeckelt): nicht bei jedem Takt neu lesen.
  const failedIds = new Set<number>();

  const tick = async () => {
    if (stopped) return;
    const deadline = Date.now() + TICK_BUDGET_MS;
    let lastId = 0;
    try {
      while (!stopped && Date.now() < deadline) {
        const batch = await runRawPartDedupBatch(options, lastId, undefined, failedIds);
        if (batch.seen === 0) break;
        lastId = batch.lastId;
        for (const failure of batch.failures) {
          if (failedIds.has(failure.messageId)) continue;
          if (failedIds.size < MAX_REMEMBERED_FAILURES) failedIds.add(failure.messageId);
          console.warn(`[mail] attachment part dedup skipped message ${failure.messageId} (stored original unreadable, see simplecrm maintenance): ${failure.error}`);
        }
        if (batch.stripped > 0) {
          const kb = (bytes: number) => Math.round(bytes / 1024);
          console.warn(`[mail] attachment parts taken out of ${batch.stripped} originals: ${kb(batch.bytesBefore)} KB -> ${kb(batch.bytesAfter)} KB`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[mail] attachment part dedup stopped (retry next tick): ${message}`);
    }
    if (!stopped) timer = setTimeout(() => { void tick(); }, intervalMs);
  };

  timer = setTimeout(() => { void tick(); }, options.firstDelayMs ?? 60_000);
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
