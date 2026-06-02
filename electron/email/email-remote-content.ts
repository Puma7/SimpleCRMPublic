import type Database from 'better-sqlite3';
import type { RemoteContentPolicy } from '../../shared/email-html-remote-images';
import {
  EMAIL_ACCOUNTS_TABLE,
  EMAIL_MESSAGES_TABLE,
  EMAIL_REMOTE_CONTENT_ALLOWLIST_TABLE,
} from '../database-schema';
function extractFromEmail(fromJson: string | null): string {
  if (!fromJson) return '';
  try {
    const p = JSON.parse(fromJson) as { value?: { address?: string }[] };
    const addr = p.value?.[0]?.address;
    return typeof addr === 'string' ? addr : '';
  } catch {
    return '';
  }
}

export type EffectiveRemotePolicy = {
  policy: RemoteContentPolicy;
  allowRemote: boolean;
};

function normalizeEmail(addr: string): string {
  const m = addr.match(/<([^>]+)>/);
  const raw = (m ? m[1] : addr).trim().toLowerCase();
  return raw;
}

function domainOf(email: string): string {
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1) : email;
}

function isAllowlisted(
  db: Database.Database,
  scope: 'sender' | 'domain',
  value: string,
): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM ${EMAIL_REMOTE_CONTENT_ALLOWLIST_TABLE} WHERE scope = ? AND value = ? COLLATE NOCASE`,
    )
    .get(scope, value);
  return !!row;
}

export function resolveRemoteContentPolicy(
  db: Database.Database,
  messageId: number,
): EffectiveRemotePolicy {
  const row = db
    .prepare(
      `SELECT m.remote_content_policy, m.from_json, a.default_remote_content_policy
       FROM ${EMAIL_MESSAGES_TABLE} m
       JOIN ${EMAIL_ACCOUNTS_TABLE} a ON a.id = m.account_id
       WHERE m.id = ?`,
    )
    .get(messageId) as
    | {
        remote_content_policy: string;
        from_json: string | null;
        default_remote_content_policy: string;
      }
    | undefined;
  if (!row) {
    return { policy: 'blocked', allowRemote: false };
  }

  let policy = (row.remote_content_policy || row.default_remote_content_policy || 'blocked') as RemoteContentPolicy;
  const from = extractFromEmail(row.from_json);
  const sender = from ? normalizeEmail(from) : '';
  const domain = sender ? domainOf(sender) : '';

  if (policy === 'allowed_sender' && sender && isAllowlisted(db, 'sender', sender)) {
    return { policy, allowRemote: true };
  }
  if (policy === 'allowed_domain' && domain && isAllowlisted(db, 'domain', domain)) {
    return { policy, allowRemote: true };
  }
  if (policy === 'allowed_once') {
    return { policy: 'blocked', allowRemote: false };
  }
  if (policy === 'allowed_sender' || policy === 'allowed_domain') {
    return { policy: 'blocked', allowRemote: false };
  }

  return { policy: policy === 'blocked' ? 'blocked' : policy, allowRemote: false };
}

export function setRemoteContentPolicy(
  db: Database.Database,
  messageId: number,
  policy: RemoteContentPolicy,
  remember?: { scope: 'sender' | 'domain'; value: string },
): void {
  db.prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET remote_content_policy = ? WHERE id = ?`).run(
    policy,
    messageId,
  );
  if (remember) {
    db.prepare(
      `INSERT OR IGNORE INTO ${EMAIL_REMOTE_CONTENT_ALLOWLIST_TABLE} (scope, value) VALUES (?, ?)`,
    ).run(remember.scope, remember.value.toLowerCase());
  }
}
