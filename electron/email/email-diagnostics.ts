import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import {
  EMAIL_FOLDERS_TABLE,
  EMAIL_MESSAGES_TABLE,
  EMAIL_WORKFLOW_RUNS_TABLE,
  SYNC_INFO_TABLE,
} from '../database-schema';
import { getDb } from '../sqlite-service';
import { MAIL_SCHEMA_GENERATION, MAIL_SCHEMA_GENERATION_LABEL } from '../db/mail-schema-version';
import { listEmailAccounts } from './email-store';
import { listImapAuthNotices } from './email-imap-auth-notice';
import { listUidValidityResetNotices } from './email-uidvalidity-reset';
import { getEmailBackgroundSyncSnapshot } from './email-imap-services';

function fileSizeBytes(p: string): number | null {
  try {
    return fs.statSync(p).size;
  } catch {
    return null;
  }
}

function dirSizeBytes(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  const walk = (d: string) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else {
        try {
          total += fs.statSync(p).size;
        } catch {
          /* skip */
        }
      }
    }
  };
  walk(dir);
  return total;
}

function syncInfoBreakdown(): { totalKeys: number; prefixes: Record<string, number> } {
  const db = getDb();
  const keys = db.prepare(`SELECT key FROM ${SYNC_INFO_TABLE}`).all() as { key: string }[];
  const prefixes: Record<string, number> = {};
  for (const { key } of keys) {
    const prefix = key.includes(':') ? `${key.split(':')[0]}:` : key;
    prefixes[prefix] = (prefixes[prefix] ?? 0) + 1;
  }
  return { totalKeys: keys.length, prefixes };
}

export type MailDiagnosticsReport = {
  collectedAt: string;
  schemaGeneration: number;
  schemaGenerationLabel: string;
  paths: {
    userData: string;
    databaseSqlite: string;
    emailAttachments: string;
  };
  sizes: {
    databaseBytes: number | null;
    attachmentsBytes: number;
  };
  accounts: {
    id: number;
    email: string;
    protocol: string;
    inboxLastSyncedAt: string | null;
  }[];
  messages: {
    total: number;
    byFolderKind: Record<string, number>;
    pendingPostProcess: number;
    outboundHold: number;
  };
  workflows: {
    runsLast24h: number;
    runsBlockedLast24h: number;
    runsErrorLast24h: number;
  };
  notices: {
    imapAuth: number;
    uidValidity: number;
  };
  syncInfo: { totalKeys: number; prefixes: Record<string, number> };
  background: ReturnType<typeof getEmailBackgroundSyncSnapshot>;
};

export function collectMailDiagnostics(): MailDiagnosticsReport {
  const db = getDb();
  const userData = app.getPath('userData');
  const dbPath = path.join(userData, 'database.sqlite');
  const attPath = path.join(userData, 'email-attachments');

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c FROM ${EMAIL_MESSAGES_TABLE}`)
    .get() as { c: number };
  const byKind = db
    .prepare(
      `SELECT COALESCE(folder_kind, 'inbox') AS k, COUNT(*) AS c FROM ${EMAIL_MESSAGES_TABLE} GROUP BY k`,
    )
    .all() as { k: string; c: number }[];
  const pending = db
    .prepare(
      `SELECT COUNT(*) AS c FROM ${EMAIL_MESSAGES_TABLE} WHERE COALESCE(post_process_done, 0) = 0`,
    )
    .get() as { c: number };
  const held = db
    .prepare(`SELECT COUNT(*) AS c FROM ${EMAIL_MESSAGES_TABLE} WHERE outbound_hold = 1`)
    .get() as { c: number };

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const runs24 = db
    .prepare(
      `SELECT COUNT(*) AS c FROM ${EMAIL_WORKFLOW_RUNS_TABLE} WHERE started_at >= ?`,
    )
    .get(since) as { c: number };
  const blocked24 = db
    .prepare(
      `SELECT COUNT(*) AS c FROM ${EMAIL_WORKFLOW_RUNS_TABLE} WHERE started_at >= ? AND status = 'blocked'`,
    )
    .get(since) as { c: number };
  const error24 = db
    .prepare(
      `SELECT COUNT(*) AS c FROM ${EMAIL_WORKFLOW_RUNS_TABLE} WHERE started_at >= ? AND status = 'error'`,
    )
    .get(since) as { c: number };

  const accounts = listEmailAccounts().map((a) => {
    const folder = db
      .prepare(
        `SELECT last_synced_at FROM ${EMAIL_FOLDERS_TABLE} WHERE account_id = ? AND path = 'INBOX' LIMIT 1`,
      )
      .get(a.id) as { last_synced_at: string | null } | undefined;
    return {
      id: a.id,
      email: a.email_address,
      protocol: a.protocol || 'imap',
      inboxLastSyncedAt: folder?.last_synced_at ?? null,
    };
  });

  return {
    collectedAt: new Date().toISOString(),
    schemaGeneration: MAIL_SCHEMA_GENERATION,
    schemaGenerationLabel: MAIL_SCHEMA_GENERATION_LABEL,
    paths: {
      userData,
      databaseSqlite: dbPath,
      emailAttachments: attPath,
    },
    sizes: {
      databaseBytes: fileSizeBytes(dbPath),
      attachmentsBytes: dirSizeBytes(attPath),
    },
    accounts,
    messages: {
      total: totalRow.c,
      byFolderKind: Object.fromEntries(byKind.map((r) => [r.k, r.c])),
      pendingPostProcess: pending.c,
      outboundHold: held.c,
    },
    workflows: {
      runsLast24h: runs24.c,
      runsBlockedLast24h: blocked24.c,
      runsErrorLast24h: error24.c,
    },
    notices: {
      imapAuth: listImapAuthNotices().length,
      uidValidity: listUidValidityResetNotices().length,
    },
    syncInfo: syncInfoBreakdown(),
    background: getEmailBackgroundSyncSnapshot(),
  };
}
