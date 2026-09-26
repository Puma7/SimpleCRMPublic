/**
 * Part objects (mail-raw-parts.ts) that no stored original names any more.
 *
 * A part stays needed as long as one original in its workspace lists its
 * sha256 in raw_rfc822_part_sha256s (GIN index). When the last such message
 * is deleted, or re-synced with a new original, the part would stay on disk
 * and in every attachment backup for good. It is removed in two steps:
 *
 *  1. set aside: moved to raw-parts/.unreferenced/<aa>/<sha256>.<ms>. Readers
 *     still find it there (readVerifiedPart), so a message that names it again
 *     right after the check stays readable;
 *  2. removed: only UNREFERENCED_GRACE_MS (7 days) later and after a fresh
 *     check that still no original names it. Named again: moved back.
 *
 * Only workspaces that exist in the database are touched: an empty or wrong
 * database never leads to a removal. The part object is a hard link; removing
 * it frees space only when no attachment file shares the content any more
 * (the deleted message's attachment files are already gone).
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

import { sql, type Kysely } from 'kysely';

import {
  withWorkspaceTransaction,
  type ServerDatabase,
  type WorkspaceSessionApplier,
} from './db';
import {
  parseSetAsidePartName,
  rawPartPath,
  rawPartsDir,
  setAsidePartPath,
  setAsidePartsDir,
} from './mail-raw-parts';

export const UNREFERENCED_GRACE_MS = 7 * 24 * 60 * 60_000;
const SHA_BATCH = 500;
const TICK_INTERVAL_MS = 24 * 60 * 60_000;
const SHA256_NAME = /^[0-9a-f]{64}$/;
const UUID_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RawPartGcOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  attachmentsRoot: string;
  applyWorkspaceSession?: WorkspaceSessionApplier;
  /** Count only, move and remove nothing. */
  checkOnly?: boolean;
  now?: number;
  graceMs?: number;
}>;

export type RawPartGcResult = {
  /** Parts no original names; set aside now (checkOnly: would be). */
  setAside: number;
  /** Set-aside parts an original names again; moved back. */
  restored: number;
  /** Set-aside parts removed after the grace period. */
  removed: number;
  /** Disk space freed by the removals (parts no attachment file shared). */
  bytesFreed: number;
  /** Set-aside parts still within the grace period. */
  waiting: number;
  /** Folders of workspaces that do not exist in the database (left alone). */
  unknownWorkspaces: number;
};

async function existingWorkspaces(options: RawPartGcOptions): Promise<Set<string>> {
  const rows = await withWorkspaceTransaction(
    options.db,
    { workspaceId: randomUUID(), role: 'system', crossWorkspaceAccess: true },
    (trx) => trx.selectFrom('workspaces').select('id').execute(),
    { applySession: options.applyWorkspaceSession },
  );
  return new Set(rows.map((row) => String(row.id).toLowerCase()));
}

/** The shas of the list that at least one stored original in the workspace names. */
async function referencedShas(
  options: RawPartGcOptions,
  workspaceId: string,
  shas: readonly string[],
): Promise<Set<string>> {
  if (shas.length === 0) return new Set();
  const result = await withWorkspaceTransaction(
    options.db,
    { workspaceId, role: 'system' },
    (trx) => sql<{ part: string }>`
      SELECT DISTINCT part
      FROM email_messages, unnest(raw_rfc822_part_sha256s) AS part
      WHERE workspace_id = ${workspaceId}
        AND raw_rfc822_part_sha256s IS NOT NULL
        AND raw_rfc822_part_sha256s && ${[...shas]}::text[]
        AND part = ANY(${[...shas]}::text[])
    `.execute(trx),
    { applySession: options.applyWorkspaceSession },
  );
  return new Set(result.rows.map((row) => row.part));
}

async function* batches<T>(items: AsyncIterable<T>, size: number): AsyncGenerator<T[]> {
  let batch: T[] = [];
  for await (const item of items) {
    batch.push(item);
    if (batch.length >= size) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length > 0) yield batch;
}

async function* filesIn(dir: string): AsyncGenerator<{ bucket: string; name: string }> {
  const buckets = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const bucket of buckets) {
    if (!bucket.isDirectory() || !/^[0-9a-f]{2}$/.test(bucket.name)) continue;
    const names = await readdir(path.join(dir, bucket.name), { withFileTypes: true }).catch(() => []);
    for (const entry of names) {
      if (entry.isFile()) yield { bucket: bucket.name, name: entry.name };
    }
  }
}

async function sweepSetAside(
  options: RawPartGcOptions,
  workspaceId: string,
  partsDir: string,
  result: RawPartGcResult,
): Promise<void> {
  const now = options.now ?? Date.now();
  const grace = options.graceMs ?? UNREFERENCED_GRACE_MS;
  const trashDir = setAsidePartsDir(partsDir);
  const entries = (async function* () {
    for await (const file of filesIn(trashDir)) {
      const parsed = parseSetAsidePartName(file.name);
      if (parsed) yield { file: path.join(trashDir, file.bucket, file.name), ...parsed };
    }
  })();
  for await (const batch of batches(entries, SHA_BATCH)) {
    const referenced = await referencedShas(options, workspaceId, [...new Set(batch.map((entry) => entry.sha256))]);
    for (const entry of batch) {
      if (referenced.has(entry.sha256)) {
        result.restored += 1;
        if (options.checkOnly) continue;
        const target = rawPartPath(partsDir, entry.sha256);
        if (await stat(target).catch(() => null)) {
          await unlink(entry.file).catch(() => undefined);
        } else {
          await mkdir(path.dirname(target), { recursive: true });
          await rename(entry.file, target).catch(() => undefined);
        }
      } else if (now - entry.setAsideAt >= grace) {
        if (options.checkOnly) {
          result.removed += 1;
          continue;
        }
        const info = await stat(entry.file).catch(() => null);
        if (!info) continue;
        await unlink(entry.file);
        result.removed += 1;
        if (info.nlink <= 1) result.bytesFreed += info.size;
      } else {
        result.waiting += 1;
      }
    }
  }
}

async function setAsideUnreferenced(
  options: RawPartGcOptions,
  workspaceId: string,
  partsDir: string,
  result: RawPartGcResult,
): Promise<void> {
  const now = options.now ?? Date.now();
  const entries = (async function* () {
    for await (const file of filesIn(partsDir)) {
      // Temp names of the attachment dedup (.dedup-*) and anything else are not parts.
      if (SHA256_NAME.test(file.name) && file.name.startsWith(file.bucket)) yield file.name;
    }
  })();
  for await (const batch of batches(entries, SHA_BATCH)) {
    const referenced = await referencedShas(options, workspaceId, batch);
    for (const sha of batch) {
      if (referenced.has(sha)) continue;
      result.setAside += 1;
      if (options.checkOnly) continue;
      const target = setAsidePartPath(partsDir, sha, now);
      await mkdir(path.dirname(target), { recursive: true });
      await rename(rawPartPath(partsDir, sha), target).catch(() => undefined);
    }
  }
}

export async function runRawPartGc(options: RawPartGcOptions): Promise<RawPartGcResult> {
  const result: RawPartGcResult = { setAside: 0, restored: 0, removed: 0, bytesFreed: 0, waiting: 0, unknownWorkspaces: 0 };
  const root = path.resolve(options.attachmentsRoot);
  const folders = await readdir(root, { withFileTypes: true }).catch(() => []);
  const candidates = folders.filter((folder) => folder.isDirectory() && UUID_NAME.test(folder.name));
  if (candidates.length === 0) return result;
  const known = await existingWorkspaces(options);
  for (const folder of candidates) {
    const partsDir = rawPartsDir(root, folder.name);
    if (!partsDir || !(await stat(partsDir).catch(() => null))?.isDirectory()) continue;
    if (!known.has(folder.name.toLowerCase())) {
      result.unknownWorkspaces += 1;
      continue;
    }
    // Sweep first, then set aside: a part set aside now waits the full grace period.
    await sweepSetAside(options, folder.name, partsDir, result);
    await setAsideUnreferenced(options, folder.name, partsDir, result);
  }
  return result;
}

export function startRawPartGcTicker(
  options: RawPartGcOptions & { intervalMs?: number; firstDelayMs?: number },
): { stop(): void } {
  const intervalMs = options.intervalMs ?? TICK_INTERVAL_MS;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async () => {
    if (stopped) return;
    try {
      const result = await runRawPartGc(options);
      if (result.setAside + result.restored + result.removed > 0) {
        console.warn(`[mail] parts of deleted originals: ${result.setAside} set aside, ${result.restored} named again, ${result.removed} removed (${(result.bytesFreed / 1048576).toFixed(1)} MB)`);
      }
    } catch (error) {
      console.warn(`[mail] raw part cleanup stopped (retry next tick): ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!stopped) timer = setTimeout(() => { void tick(); }, intervalMs);
  };

  timer = setTimeout(() => { void tick(); }, options.firstDelayMs ?? 30 * 60_000);
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
