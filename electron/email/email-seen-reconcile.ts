import type { ImapFlow } from 'imapflow';
import { EMAIL_MESSAGES_TABLE } from '../database-schema';
import { getDb } from '../sqlite-service';
import { assertSyncNotAborted } from './email-sync-mutex';

const SEEN_RECONCILE_CHUNK = 200;

/**
 * Align seen_local with server \\Seen for messages already in the folder (NF11).
 * Server flags win unless a local seen change is still waiting for IMAP push.
 */
export async function reconcileSeenFlagsForFolder(
  client: ImapFlow,
  folderId: number,
  folderPath: string,
  signal?: AbortSignal,
): Promise<number> {
  const rows = getDb()
    .prepare(
      `SELECT uid FROM ${EMAIL_MESSAGES_TABLE}
       WHERE folder_id = ? AND uid >= 0 AND (pop3_uidl IS NULL OR pop3_uidl = '')`,
    )
    .all(folderId) as { uid: number }[];
  if (rows.length === 0) return 0;

  const updateStmt = getDb().prepare(
    `UPDATE ${EMAIL_MESSAGES_TABLE}
     SET seen_local = ?
     WHERE folder_id = ? AND uid = ? AND seen_local != ? AND COALESCE(seen_sync_pending, 0) = 0`,
  );

  let changed = 0;
  const lock = await client.getMailboxLock(folderPath);
  try {
    for (let i = 0; i < rows.length; i += SEEN_RECONCILE_CHUNK) {
      assertSyncNotAborted(signal);
      const chunk = rows.slice(i, i + SEEN_RECONCILE_CHUNK);
      const uidList = chunk.map((r) => r.uid).join(',');
      for await (const msg of client.fetch({ uid: uidList }, { uid: true, flags: true })) {
        assertSyncNotAborted(signal);
        if (msg.uid == null) continue;
        const seen = msg.flags?.has('\\Seen') ? 1 : 0;
        const r = updateStmt.run(seen, folderId, msg.uid, seen);
        changed += r.changes;
      }
    }
  } finally {
    lock.release();
  }
  return changed;
}
