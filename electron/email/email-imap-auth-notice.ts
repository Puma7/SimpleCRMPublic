import { deleteSyncInfo, getDb, getSyncInfo, setSyncInfo } from '../sqlite-service';

export type ImapAuthNotice = {
  accountId: number;
  message: string;
  at: string;
};

const KEY_PREFIX = 'imap_auth_notice:';

function noticeKey(accountId: number): string {
  return `${KEY_PREFIX}${accountId}`;
}

export function recordImapAuthNotice(accountId: number, message: string): void {
  const payload: ImapAuthNotice = {
    accountId,
    message: message.slice(0, 500),
    at: new Date().toISOString(),
  };
  setSyncInfo(noticeKey(accountId), JSON.stringify(payload));
}

export function clearImapAuthNotice(accountId: number): void {
  deleteSyncInfo(noticeKey(accountId));
}

export function listImapAuthNotices(): ImapAuthNotice[] {
  const rows = getDb()
    .prepare(`SELECT key, value FROM sync_info WHERE key LIKE ?`)
    .all(`${KEY_PREFIX}%`) as { key: string; value: string }[];
  const out: ImapAuthNotice[] = [];
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.value) as ImapAuthNotice;
      if (parsed?.accountId != null && parsed.message) out.push(parsed);
    } catch {
      const id = Number(row.key.slice(KEY_PREFIX.length));
      if (Number.isInteger(id) && id > 0) {
        out.push({ accountId: id, message: row.value, at: '' });
      }
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

export function dismissImapAuthNotice(accountId: number): void {
  clearImapAuthNotice(accountId);
}

/** Record sync_info notice when IMAP/POP3/OAuth auth fails (R-2). */
export function maybeRecordImapAuthNotice(accountId: number, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  if (!message.trim()) return;
  recordImapAuthNotice(accountId, message);
}
