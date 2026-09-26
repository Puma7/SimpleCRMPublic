/**
 * Identical attachments occupy disk space only once.
 *
 * The same file arrives many times (newsletter logos, signatures, a contract
 * sent back and forth, the same mail in two folders). Every row keeps its own
 * storage_path (access checks, draft references and deletions work per path
 * as before); only the files behind those paths become hard links of one
 * inode. Deleting one path leaves the others intact.
 *
 * Safety:
 *  - only within one workspace and one content_sha256;
 *  - the kept file must hash to that sha256, every file that is replaced must
 *    have the same size and hash (checked right before the swap);
 *  - the swap is link(kept, tmp) + rename(tmp, path): atomic, a reader sees
 *    the old or the new file, both with the same content;
 *  - attachment files are write-once (flag 'wx'), so a shared inode is never
 *    written through one path.
 * The part object of the stored original (raw-parts) joins the same inode, so
 * the replaced file's space is actually freed. Nothing is ever deleted
 * without a remaining link to the same content.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import { link, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

import { sql, type Kysely } from 'kysely';

import {
  withWorkspaceTransaction,
  type ServerDatabase,
  type WorkspaceSessionApplier,
} from './db';
import { resolveAttachmentStoragePath } from './db/postgres-mail-read-ports';
import { fileSha256, rawPartPath, rawPartsDir } from './mail-raw-parts';

const GROUP_BATCH = 200;
const TICK_INTERVAL_MS = 6 * 60 * 60_000;
const TICK_BUDGET_MS = 5 * 60_000;

export type AttachmentDedupOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  attachmentsRoot: string;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}>;

export type AttachmentDedupResult = {
  groups: number;
  linked: number;
  bytesFreed: number;
  skipped: number;
};

type Group = Readonly<{ workspace_id: string; content_sha256: string }>;

/** Duplicate groups (workspace, sha256) after the given one, in a stable order. */
async function listGroups(
  options: AttachmentDedupOptions,
  after: Group | null,
  limit: number,
): Promise<Group[]> {
  return withWorkspaceTransaction(
    options.db,
    { workspaceId: randomUUID(), role: 'system', crossWorkspaceAccess: true },
    async (trx) => {
      let query = trx
        .selectFrom('email_message_attachments')
        .select(['workspace_id', 'content_sha256'])
        .where('content_sha256', 'is not', null)
        .groupBy(['workspace_id', 'content_sha256'])
        .having(sql<boolean>`count(*) > 1`)
        .orderBy('workspace_id', 'asc')
        .orderBy('content_sha256', 'asc')
        .limit(limit);
      if (after) {
        query = query.where(sql<boolean>`(workspace_id, content_sha256) > (${after.workspace_id}::uuid, ${after.content_sha256})`);
      }
      return (await query.execute()) as unknown as Group[];
    },
    { applySession: options.applyWorkspaceSession },
  );
}

async function pathsOfGroup(options: AttachmentDedupOptions, group: Group): Promise<string[]> {
  const rows = await withWorkspaceTransaction(
    options.db,
    { workspaceId: group.workspace_id, role: 'system' },
    async (trx) => trx
      .selectFrom('email_message_attachments')
      .select(['storage_path'])
      .where('workspace_id', '=', group.workspace_id)
      .where('content_sha256', '=', group.content_sha256)
      .orderBy('id', 'asc')
      .execute(),
    { applySession: options.applyWorkspaceSession },
  );
  const files = new Set<string>();
  for (const row of rows) {
    const resolved = resolveAttachmentStoragePath(options.attachmentsRoot, row.storage_path);
    if (resolved) files.add(resolved);
  }
  return [...files];
}

/** Replaces `target` by a hard link of `keep` (same directory temp name, then rename). */
async function relink(keep: string, target: string): Promise<void> {
  const tmp = path.join(path.dirname(target), `.dedup-${randomBytes(6).toString('hex')}`);
  await link(keep, tmp);
  try {
    await rename(tmp, target);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
}

/** Links the files of one group; returns what was done. */
export async function dedupAttachmentGroup(
  options: AttachmentDedupOptions,
  group: Group,
): Promise<{ linked: number; bytesFreed: number; skipped: number }> {
  const sha = group.content_sha256.toLowerCase();
  const outcome = { linked: 0, bytesFreed: 0, skipped: 0 };
  const files = await pathsOfGroup(options, group);
  const partsDir = rawPartsDir(options.attachmentsRoot, group.workspace_id);
  const partObject = partsDir ? rawPartPath(partsDir, sha) : null;
  const candidates = partObject ? [...files, partObject] : files;

  // The kept inode: the one most paths already share, verified by hash.
  const stats = new Map<string, Stats>();
  for (const file of candidates) {
    const info = await stat(file).catch(() => null);
    if (info?.isFile()) stats.set(file, info);
  }
  const byInode = new Map<string, string[]>();
  for (const [file, info] of stats) {
    const key = `${info.dev}:${info.ino}`;
    byInode.set(key, [...(byInode.get(key) ?? []), file]);
  }
  if (byInode.size < 2) return outcome;
  const families = [...byInode.values()].sort((a, b) => b.length - a.length);
  let keep: string | null = null;
  for (const family of families) {
    if (await fileSha256(family[0]!) === sha) {
      keep = family[0]!;
      break;
    }
  }
  if (!keep) {
    outcome.skipped += stats.size;
    return outcome;
  }
  const keepInfo = stats.get(keep)!;
  for (const family of families) {
    const first = family[0]!;
    const info = stats.get(first)!;
    if (info.dev === keepInfo.dev && info.ino === keepInfo.ino) continue;
    if (info.dev !== keepInfo.dev || info.size !== keepInfo.size || await fileSha256(first) !== sha) {
      outcome.skipped += family.length;
      continue;
    }
    for (const file of family) {
      try {
        await relink(keep, file);
        outcome.linked += 1;
      } catch {
        outcome.skipped += 1;
      }
    }
    outcome.bytesFreed += Number(info.size);
  }
  return outcome;
}

export async function runAttachmentDedup(
  options: AttachmentDedupOptions,
  budgetMs = TICK_BUDGET_MS,
): Promise<AttachmentDedupResult> {
  const deadline = Date.now() + budgetMs;
  const total: AttachmentDedupResult = { groups: 0, linked: 0, bytesFreed: 0, skipped: 0 };
  let after: Group | null = null;
  while (Date.now() < deadline) {
    const groups = await listGroups(options, after, GROUP_BATCH);
    if (groups.length === 0) break;
    for (const group of groups) {
      if (Date.now() >= deadline) break;
      const outcome = await dedupAttachmentGroup(options, group);
      total.groups += 1;
      total.linked += outcome.linked;
      total.bytesFreed += outcome.bytesFreed;
      total.skipped += outcome.skipped;
      after = group;
    }
    if (groups.length < GROUP_BATCH) break;
  }
  return total;
}

export function startAttachmentDedupTicker(
  options: AttachmentDedupOptions & { intervalMs?: number; firstDelayMs?: number },
): { stop(): void } {
  const intervalMs = options.intervalMs ?? TICK_INTERVAL_MS;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async () => {
    if (stopped) return;
    try {
      const result = await runAttachmentDedup(options);
      if (result.linked > 0) {
        console.warn(`[mail] identical attachments linked: ${result.linked} files, ${(result.bytesFreed / 1048576).toFixed(1)} MB freed`);
      }
      if (result.skipped > 0) {
        console.warn(`[mail] attachment dedup skipped ${result.skipped} files whose content does not match their recorded sha256 (see simplecrm maintenance)`);
      }
    } catch (error) {
      console.warn(`[mail] attachment dedup stopped (retry next tick): ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!stopped) timer = setTimeout(() => { void tick(); }, intervalMs);
  };

  timer = setTimeout(() => { void tick(); }, options.firstDelayMs ?? 5 * 60_000);
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
