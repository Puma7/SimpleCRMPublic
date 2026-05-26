/**
 * Seeds demo inbox messages for local QA (no IMAP required).
 * Usage: npx ts-node --project scripts/tsconfig.json scripts/seed-email-demo-messages.ts
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

function dbPath(): string {
  const candidates = [
    path.join(process.env.HOME || '', '.config', 'simplecrm', 'database.sqlite'),
    path.join(process.env.HOME || '', '.config', 'Electron', 'database.sqlite'),
    path.join(process.cwd(), 'userData', 'database.sqlite'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`No database found. Tried:\n${candidates.join('\n')}`);
}

const fromJson = JSON.stringify({
  value: [{ address: 'kunde@beispiel.de', name: 'Max Mustermann' }],
});

const db = new Database(dbPath());
db.pragma('foreign_keys = ON');

const account = db
  .prepare('SELECT id FROM email_accounts ORDER BY id LIMIT 1')
  .get() as { id: number } | undefined;

if (!account) {
  console.error('No email_accounts row — open the app once and add a test account.');
  process.exit(1);
}

const accountId = account.id;

let folder = db
  .prepare('SELECT id FROM email_folders WHERE account_id = ? AND path = ?')
  .get(accountId, 'INBOX') as { id: number } | undefined;

if (!folder) {
  const r = db
    .prepare(
      `INSERT INTO email_folders (account_id, path, delimiter, last_uid, last_synced_at)
       VALUES (?, 'INBOX', '/', 0, datetime('now'))`,
    )
    .run(accountId);
  folder = { id: Number(r.lastInsertRowid) };
}

const folderId = folder.id;

db.prepare(
  `DELETE FROM email_messages WHERE account_id = ? AND uid BETWEEN 900001 AND 900010`,
).run(accountId);

const insert = db.prepare(
  `INSERT INTO email_messages (
    account_id, folder_id, uid, message_id, subject, from_json, to_json,
    date_received, snippet, body_text, seen_local, done_local, archived,
    soft_deleted, folder_kind, is_spam, has_attachments
  ) VALUES (
    @account_id, @folder_id, @uid, @message_id, @subject, @from_json, @to_json,
    @date_received, @snippet, @body_text, @seen_local, @done_local, 0,
    0, 'inbox', 0, 0
  )`,
);

const now = new Date().toISOString();
const rows = [
  {
    uid: 900001,
    subject: 'Anfrage Produktberatung',
    snippet: 'Guten Tag, ich interessiere mich für Ihr CRM-Paket…',
    body_text:
      'Guten Tag,\n\nich interessiere mich für Ihr CRM-Paket und hätte gerne ein Angebot.\n\nViele Grüße\nMax Mustermann',
    seen_local: 0,
    done_local: 0,
  },
  {
    uid: 900002,
    subject: 'Re: Termin nächste Woche',
    snippet: 'Passt Ihnen Dienstag 14 Uhr?',
    body_text: 'Hallo,\n\npasst Ihnen Dienstag um 14 Uhr für ein kurzes Gespräch?\n\nDanke',
    seen_local: 1,
    done_local: 0,
  },
  {
    uid: 900003,
    subject: 'Newsletter Mai 2026',
    snippet: 'Unsere neuesten Tipps…',
    body_text: 'Newsletter-Inhalt (Werbung zum Testen des Tags).',
    seen_local: 0,
    done_local: 1,
  },
];

for (const row of rows) {
  insert.run({
    account_id: accountId,
    folder_id: folderId,
    uid: row.uid,
    message_id: `<demo-${row.uid}@simplecrm.local>`,
    subject: row.subject,
    from_json: fromJson,
    to_json: JSON.stringify({ value: [{ address: 'shop@demo.local', name: 'Shop' }] }),
    date_received: now,
    snippet: row.snippet,
    body_text: row.body_text,
    seen_local: row.seen_local,
    done_local: row.done_local,
  });
}

db.exec(`INSERT INTO email_messages_fts(email_messages_fts) VALUES('rebuild')`);

console.log(`✅ Seeded ${rows.length} demo messages in ${dbPath()} (account ${accountId}, folder ${folderId})`);
