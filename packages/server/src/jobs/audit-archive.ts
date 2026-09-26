import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

import type { AuditRetentionArchivePort } from './maintenance-handlers';

export type JsonlAuditRetentionArchiveOptions = Readonly<{
  rootDir: string;
  mkdir?: (path: string, options: { recursive: true }) => Promise<unknown>;
  writeFile?: (path: string, data: string, options: { encoding: 'utf8' }) => Promise<unknown>;
}>;

export function createJsonlAuditRetentionArchivePort(
  options: JsonlAuditRetentionArchiveOptions,
): AuditRetentionArchivePort {
  const rootDir = resolve(options.rootDir);
  const ensureDir = options.mkdir ?? mkdir;
  const write = options.writeFile ?? writeFileDurably;

  return {
    async archive(input) {
      if (input.rows.length === 0) return;
      const workspaceDir = resolveArchivePath(rootDir, safePathToken(input.workspaceId));
      const filePath = resolveArchivePath(
        workspaceDir,
        archiveFileName({
          olderThan: input.olderThan,
          firstId: input.rows[0]!.id,
          lastId: input.rows[input.rows.length - 1]!.id,
          count: input.rows.length,
        }),
      );
      const jsonl = input.rows
        .map((row) => JSON.stringify({
          id: row.id,
          workspaceId: row.workspace_id,
          actorUserId: row.actor_user_id,
          action: row.action,
          entityType: row.entity_type,
          entityId: row.entity_id,
          metadata: row.metadata,
          previousHash: row.previous_hash,
          eventHash: row.event_hash,
          createdAt: timestampToIso(row.created_at),
        }))
        .join('\n')
        + '\n';

      await ensureDir(workspaceDir, { recursive: true });
      await write(filePath, jsonl, { encoding: 'utf8' });
    },
  };
}

/**
 * The caller deletes the archived audit rows right after this returns, and that
 * DELETE is durable at COMMIT. A plain writeFile could still sit in the page
 * cache, so a host crash would lose the only copy. Write to a temporary name,
 * fsync, rename into place and fsync the directory entry.
 */
async function writeFileDurably(path: string, data: string, options: { encoding: 'utf8' }): Promise<void> {
  const tmpPath = `${path}.${randomUUID()}.tmp`;
  const handle = await open(tmpPath, 'wx');
  try {
    try {
      await handle.writeFile(data, options);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmpPath, path);
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => undefined);
    throw error;
  }
  await syncDirectory(dirname(path));
}

async function syncDirectory(dir: string): Promise<void> {
  // Windows cannot open a directory for fsync; NTFS journals the rename itself.
  if (process.platform === 'win32') return;
  const handle = await open(dir, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export function archiveFileName(input: {
  olderThan: Date;
  firstId: number;
  lastId: number;
  count: number;
}): string {
  return [
    'audit-retention',
    safePathToken(input.olderThan.toISOString()),
    `ids-${input.firstId}-${input.lastId}`,
    `count-${input.count}`,
  ].join('_') + '.jsonl';
}

function resolveArchivePath(rootDir: string, child: string): string {
  const resolved = resolve(rootDir, child);
  if (!isWithin(rootDir, resolved)) {
    throw new Error('audit archive path escaped archive root');
  }
  return resolved;
}

function isWithin(rootDir: string, candidate: string): boolean {
  const root = resolve(rootDir);
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function safePathToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
}

function timestampToIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
