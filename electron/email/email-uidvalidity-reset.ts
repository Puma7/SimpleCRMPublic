import { getDb, deleteSyncInfo, getSyncInfo, setSyncInfo } from '../sqlite-service';
import {
  EMAIL_MESSAGE_CATEGORIES_TABLE,
  EMAIL_MESSAGE_TAGS_TABLE,
  EMAIL_MESSAGE_WORKFLOW_APPLIED_TABLE,
  EMAIL_MESSAGES_TABLE,
} from '../database-schema';

export type UidValidityBackupEntry = {
  message_id: string | null;
  uid: number;
  customer_id: number | null;
  assigned_to: string | null;
  is_spam: number;
  spam_status?: string | null;
  spam_score?: number | null;
  spam_score_label?: string | null;
  spam_decision_source?: string | null;
  spam_score_breakdown_json?: string | null;
  spam_decided_at?: string | null;
  tags: string[];
  category_ids: number[];
  workflow_ids: number[];
};

export type UidValidityResetNotice = {
  id: string;
  accountId: number;
  folderPath: string;
  oldValidity: string | null;
  newValidity: string | null;
  messageCount: number;
  backedUpCount: number;
  at: string;
};

const NOTICE_KEY_PREFIX = 'uidvalidity_notice:';

function noticeKey(accountId: number): string {
  return `${NOTICE_KEY_PREFIX}${accountId}`;
}

function backupKey(folderId: number): string {
  return `uidvalidity_backup:${folderId}`;
}

export function backupFolderLocalMetaBeforeUidValidityReset(folderId: number): UidValidityBackupEntry[] {
  const rows = getDb()
    .prepare(
      `SELECT m.id, m.uid, m.message_id, m.customer_id, m.assigned_to, m.is_spam,
              m.spam_status, m.spam_score, m.spam_score_label, m.spam_decision_source,
              m.spam_score_breakdown_json, m.spam_decided_at
       FROM ${EMAIL_MESSAGES_TABLE} m
       WHERE m.folder_id = ? AND (m.uid >= 0 OR m.pop3_uidl IS NOT NULL)`,
    )
    .all(folderId) as {
    id: number;
    uid: number;
    message_id: string | null;
    customer_id: number | null;
    assigned_to: string | null;
    is_spam: number;
    spam_status: string | null;
    spam_score: number | null;
    spam_score_label: string | null;
    spam_decision_source: string | null;
    spam_score_breakdown_json: string | null;
    spam_decided_at: string | null;
  }[];

  const entries: UidValidityBackupEntry[] = [];
  const tagStmt = getDb().prepare(
    `SELECT tag FROM ${EMAIL_MESSAGE_TAGS_TABLE} WHERE message_id = ?`,
  );
  const catStmt = getDb().prepare(
    `SELECT category_id FROM ${EMAIL_MESSAGE_CATEGORIES_TABLE} WHERE message_id = ?`,
  );
  const wfStmt = getDb().prepare(
    `SELECT workflow_id FROM ${EMAIL_MESSAGE_WORKFLOW_APPLIED_TABLE} WHERE message_id = ?`,
  );

  for (const row of rows) {
    const tags = (tagStmt.all(row.id) as { tag: string }[]).map((t) => t.tag);
    const category_ids = (catStmt.all(row.id) as { category_id: number }[]).map((c) => c.category_id);
    const workflow_ids = (wfStmt.all(row.id) as { workflow_id: number }[]).map((w) => w.workflow_id);
    entries.push({
      message_id: row.message_id,
      uid: row.uid,
      customer_id: row.customer_id,
      assigned_to: row.assigned_to,
      is_spam: row.is_spam,
      spam_status: row.spam_status,
      spam_score: row.spam_score,
      spam_score_label: row.spam_score_label,
      spam_decision_source: row.spam_decision_source,
      spam_score_breakdown_json: row.spam_score_breakdown_json,
      spam_decided_at: row.spam_decided_at,
      tags,
      category_ids,
      workflow_ids,
    });
  }

  setSyncInfo(backupKey(folderId), JSON.stringify(entries));
  return entries;
}

function readNotices(accountId: number): UidValidityResetNotice[] {
  const raw = getSyncInfo(noticeKey(accountId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as UidValidityResetNotice[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function recordUidValidityResetNotice(input: {
  accountId: number;
  folderPath: string;
  oldValidity: string | null;
  newValidity: string | null;
  messageCount: number;
  backedUpCount: number;
}): void {
  const list = readNotices(input.accountId);
  const notice: UidValidityResetNotice = {
    id: `${input.accountId}:${Date.now()}`,
    accountId: input.accountId,
    folderPath: input.folderPath,
    oldValidity: input.oldValidity,
    newValidity: input.newValidity,
    messageCount: input.messageCount,
    backedUpCount: input.backedUpCount,
    at: new Date().toISOString(),
  };
  list.unshift(notice);
  setSyncInfo(noticeKey(input.accountId), JSON.stringify(list.slice(0, 10)));
}

export function listUidValidityResetNotices(): UidValidityResetNotice[] {
  const db = getDb();
  const keys = db
    .prepare(`SELECT key FROM sync_info WHERE key LIKE ?`)
    .all(`${NOTICE_KEY_PREFIX}%`) as { key: string }[];
  const all: UidValidityResetNotice[] = [];
  for (const { key } of keys) {
    const accountId = parseInt(key.slice(NOTICE_KEY_PREFIX.length), 10);
    if (!Number.isNaN(accountId)) {
      all.push(...readNotices(accountId));
    }
  }
  return all.sort((a, b) => b.at.localeCompare(a.at));
}

export function dismissUidValidityResetNotice(noticeId: string): void {
  const db = getDb();
  const keys = db
    .prepare(`SELECT key FROM sync_info WHERE key LIKE ?`)
    .all(`${NOTICE_KEY_PREFIX}%`) as { key: string }[];
  for (const { key } of keys) {
    const accountId = parseInt(key.slice(NOTICE_KEY_PREFIX.length), 10);
    if (Number.isNaN(accountId)) continue;
    const list = readNotices(accountId).filter((n) => n.id !== noticeId);
    if (list.length === 0) {
      deleteSyncInfo(key);
    } else {
      setSyncInfo(key, JSON.stringify(list));
    }
  }
}

/** Re-apply tags/categories/workflow markers when the same Message-ID is fetched again. */
export function tryRestoreLocalMetaFromUidValidityBackup(
  folderId: number,
  localMsgId: number,
  messageIdHeader: string | null,
): boolean {
  if (!messageIdHeader?.trim()) return false;
  const raw = getSyncInfo(backupKey(folderId));
  if (!raw) return false;
  let entries: UidValidityBackupEntry[];
  try {
    entries = JSON.parse(raw) as UidValidityBackupEntry[];
  } catch {
    return false;
  }
  const entry = entries.find((e) => e.message_id === messageIdHeader);
  if (!entry) return false;

  const db = getDb();
  if (entry.customer_id != null) {
    db.prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET customer_id = ? WHERE id = ?`).run(
      entry.customer_id,
      localMsgId,
    );
  }
  if (entry.assigned_to != null) {
    db.prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET assigned_to = ? WHERE id = ?`).run(
      entry.assigned_to,
      localMsgId,
    );
  }
  if (entry.spam_status !== undefined || entry.is_spam === 1) {
    const spamStatus = entry.spam_status ?? (entry.is_spam === 1 ? 'spam' : 'clean');
    db.prepare(
      `UPDATE ${EMAIL_MESSAGES_TABLE}
       SET is_spam = ?,
           spam_status = ?,
           spam_score = ?,
           spam_score_label = ?,
           spam_decision_source = ?,
           spam_score_breakdown_json = ?,
           spam_decided_at = ?
       WHERE id = ?`,
    ).run(
      spamStatus === 'spam' ? 1 : 0,
      spamStatus,
      entry.spam_score ?? null,
      entry.spam_score_label ?? null,
      entry.spam_decision_source ?? null,
      entry.spam_score_breakdown_json ?? null,
      entry.spam_decided_at ?? null,
      localMsgId,
    );
  }
  for (const tag of entry.tags) {
    db.prepare(
      `INSERT OR IGNORE INTO ${EMAIL_MESSAGE_TAGS_TABLE} (message_id, tag) VALUES (?, ?)`,
    ).run(localMsgId, tag);
  }
  for (const categoryId of entry.category_ids) {
    db.prepare(
      `INSERT OR IGNORE INTO ${EMAIL_MESSAGE_CATEGORIES_TABLE} (message_id, category_id) VALUES (?, ?)`,
    ).run(localMsgId, categoryId);
  }
  for (const workflowId of entry.workflow_ids) {
    db.prepare(
      `INSERT OR IGNORE INTO ${EMAIL_MESSAGE_WORKFLOW_APPLIED_TABLE} (message_id, workflow_id) VALUES (?, ?)`,
    ).run(localMsgId, workflowId);
  }
  return true;
}
