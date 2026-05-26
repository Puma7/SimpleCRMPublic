import {
  EMAIL_FOLDERS_TABLE,
  EMAIL_MESSAGES_TABLE,
  WORKFLOW_DELAYED_JOBS_TABLE,
} from './database-schema';
import { deleteSyncInfo, getDb, getSyncInfo } from './sqlite-service';

const WEBHOOK_DEDUP_MS = 5 * 60 * 1000;
const VACATION_FAIL_TTL_MS = 60 * 60 * 1000;
const DEAL_STAGE_PREFIX = 'workflow_trigger_fired:crm.deal_stage_changed:';

/** Remove stale ephemeral keys from sync_info (call on app boot). */
export function sweepStaleSyncInfoKeys(): { removed: number } {
  const db = getDb();
  let removed = 0;
  const keys = db.prepare(`SELECT key FROM sync_info`).all() as { key: string }[];

  for (const { key } of keys) {
    if (tryRemoveStaleKey(db, key)) removed += 1;
  }
  return { removed };
}

function tryRemoveStaleKey(db: ReturnType<typeof getDb>, key: string): boolean {
  if (key.startsWith('email_compose_smtp_ok:')) {
    const id = parseInt(key.slice('email_compose_smtp_ok:'.length), 10);
    if (Number.isNaN(id)) return deleteKey(key);
    const row = db.prepare(`SELECT id FROM ${EMAIL_MESSAGES_TABLE} WHERE id = ?`).get(id);
    if (!row) return deleteKey(key);
    const val = getSyncInfo(key);
    if (val === '' || val === '0') return deleteKey(key);
    return false;
  }

  if (key.startsWith('scheduled_send_failures:')) {
    const id = parseInt(key.slice('scheduled_send_failures:'.length), 10);
    if (Number.isNaN(id)) return deleteKey(key);
    const draft = db
      .prepare(
        `SELECT id FROM ${EMAIL_MESSAGES_TABLE} WHERE id = ? AND folder_kind = 'draft'`,
      )
      .get(id);
    if (!draft) return deleteKey(key);
    const val = getSyncInfo(key);
    if (val === '0') return deleteKey(key);
    return false;
  }

  if (key.startsWith('imap_uid_fail:')) {
    const parts = key.split(':');
    if (parts.length !== 3) return false;
    const folderId = parseInt(parts[1]!, 10);
    const uid = parseInt(parts[2]!, 10);
    if (Number.isNaN(folderId) || Number.isNaN(uid)) return deleteKey(key);
    const folder = db.prepare(`SELECT id FROM ${EMAIL_FOLDERS_TABLE} WHERE id = ?`).get(folderId);
    if (!folder) return deleteKey(key);
    const msg = db
      .prepare(`SELECT id FROM ${EMAIL_MESSAGES_TABLE} WHERE folder_id = ? AND uid = ?`)
      .get(folderId, uid);
    if (!msg) return deleteKey(key);
    return false;
  }

  if (key.startsWith('delayed_job_retry:')) {
    const id = parseInt(key.slice('delayed_job_retry:'.length), 10);
    if (Number.isNaN(id)) return deleteKey(key);
    const job = db
      .prepare(`SELECT status FROM ${WORKFLOW_DELAYED_JOBS_TABLE} WHERE id = ?`)
      .get(id) as { status: string } | undefined;
    if (!job || job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') {
      return deleteKey(key);
    }
    return false;
  }

  if (key.startsWith('webhook_dedup:')) {
    const raw = getSyncInfo(key);
    const t = Number(raw);
    if (!Number.isNaN(t) && Date.now() - t > WEBHOOK_DEDUP_MS) {
      return deleteKey(key);
    }
    return false;
  }

  if (key.startsWith('vacation_smtp_fail:')) {
    const raw = getSyncInfo(key);
    if (!raw) return deleteKey(key);
    const t = new Date(raw).getTime();
    if (Number.isNaN(t) || Date.now() - t > VACATION_FAIL_TTL_MS) {
      return deleteKey(key);
    }
    return false;
  }

  if (key.startsWith(DEAL_STAGE_PREFIX)) {
    const rest = key.slice(DEAL_STAGE_PREFIX.length);
    const segments = rest.split(':');
    if (segments.length === 2) {
      return deleteKey(key);
    }
    return false;
  }

  return false;
}

function deleteKey(key: string): boolean {
  deleteSyncInfo(key);
  return true;
}
