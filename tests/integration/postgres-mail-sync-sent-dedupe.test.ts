import type { Kysely } from 'kysely';

import type { PostgresSecretPort } from '../../packages/server/src/db/postgres-secret-port';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { createPostgresMailSyncJobPort } from '../../packages/server/src/mail-sync';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000e3';
const ACCOUNT_ID = 701;
const DRAFT_FOLDER_ID = 711;
const LOCAL_SENT_ID = 7001;
const MESSAGE_ID = '<local-sent-7001@example.test>';

const secrets = {
  async readSecret() {
    return Buffer.from('mailbox-password');
  },
  async writeSecret() {
    throw new Error('not used');
  },
} as unknown as PostgresSecretPort;

/** IMAP-Postfach mit leerem Posteingang und der Server-Kopie im Gesendet-Ordner. */
function fakeImapClient(mailboxes: Record<string, number[]>) {
  let current = 'INBOX';
  return {
    async connect() { return undefined; },
    async list() {
      return [
        { path: 'INBOX', name: 'INBOX', delimiter: '/', flags: new Set<string>() },
        { path: 'Sent', name: 'Sent', delimiter: '/', flags: new Set<string>(['\\Sent']), specialUse: '\\Sent' },
      ];
    },
    async status(path: string) {
      const uids = mailboxes[path] ?? [];
      return { uidValidity: 33, uidNext: Math.max(0, ...uids) + 1, messages: uids.length };
    },
    async getMailboxLock(path: string) {
      current = path;
      return { release: () => undefined };
    },
    async search(query: { all?: boolean; uid?: string }) {
      const uids = mailboxes[current] ?? [];
      if (query.all) return uids;
      const from = Number(String(query.uid ?? '').split(':')[0]);
      return uids.filter((uid) => uid >= from);
    },
    async fetchOne(uid: string) {
      return {
        source: Buffer.from(
          'From: Support <support@example.test>\r\nTo: kunde@example.com\r\nSubject: Re: Frage\r\n'
          + `Message-ID: ${MESSAGE_ID}\r\nDate: Sat, 26 Sep 2026 08:00:00 +0000\r\n\r\nIhre Bestellung kommt morgen. (${uid})\r\n`,
        ),
        flags: new Set<string>(['\\Seen']),
        threadId: null,
      };
    },
    async logout() { return undefined; },
  };
}

/**
 * Teilautomatisierung P3: Mit aktivem Sync des Gesendet-Ordners legte der
 * Server für dieselbe Mail eine zweite Zeile an (kein Message-ID-Abgleich).
 * Wie auf dem Desktop (tryPromoteLocalSentImapRow) übernimmt der Sync jetzt
 * die lokale Gesendet-Zeile; die Kennzeichnung „gesendet von“ bleibt erhalten.
 */
describe('Server: Sync des Gesendet-Ordners ohne Doppelzeilen', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('mail-sync-sent-dedupe');
    const { admin } = postgres;
    await admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Sent Dedupe Test')`, [WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_accounts (
        id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username,
        imap_sync_sent, sent_folder_path
      ) VALUES ($1, $2, $1, 'Support', 'support@example.test', 'imap.example.test', 'support', true, 'Sent')
    `, [ACCOUNT_ID, WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_folders (id, workspace_id, source_sqlite_id, account_source_sqlite_id, account_id, path)
      VALUES ($1, $2, $1, $3, $3, 'Drafts')
    `, [DRAFT_FOLDER_ID, WORKSPACE_ID, ACCOUNT_ID]);
    // Von SimpleCRM gesendete Mail (lokale Zeile, uid < 0) mit Kennzeichnung.
    await admin.query(`
      INSERT INTO email_messages (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
        account_id, folder_id, uid, folder_kind, message_id, subject, body_text,
        sent_by_kind, sent_by_label, sent_outbound_review_skipped, draft_origin_kind
      ) VALUES ($1, $2, $1, $3, $4, $3, $4, $6, 'sent', $5, 'Re: Frage', 'Ihre Bestellung kommt morgen.',
        'ai_auto', 'Workflow „KI-Antwort“', true, 'ai')
    `, [LOCAL_SENT_ID, WORKSPACE_ID, ACCOUNT_ID, DRAFT_FOLDER_ID, MESSAGE_ID, -LOCAL_SENT_ID]);
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  async function rowsForMessageId() {
    const rows = await postgres.admin.query<{
      id: string;
      uid: string;
      folder_kind: string;
      folder_path: string;
      sent_by_kind: string | null;
      sent_by_label: string | null;
      sent_outbound_review_skipped: boolean;
      seen_local: boolean;
    }>(`
      SELECT m.id, m.uid, m.folder_kind, f.path AS folder_path, m.sent_by_kind, m.sent_by_label,
        m.sent_outbound_review_skipped, m.seen_local
      FROM email_messages m JOIN email_folders f ON f.id = m.folder_id
      WHERE m.workspace_id = $1 AND m.message_id = $2
      ORDER BY m.id
    `, [WORKSPACE_ID, MESSAGE_ID]);
    return rows.rows;
  }

  test('übernimmt die lokale Gesendet-Zeile statt eine zweite anzulegen; Kennzeichnung bleibt', async () => {
    const port = createPostgresMailSyncJobPort({
      db,
      secrets,
      imapClientFactory: () => fakeImapClient({ INBOX: [], Sent: [5] }) as never,
    });
    const plan = { workspaceId: WORKSPACE_ID, accountId: ACCOUNT_ID, protocol: 'imap' as const };

    await port.sync(plan);

    const rows = await rowsForMessageId();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({
      id: String(LOCAL_SENT_ID),
      uid: '5',
      folder_kind: 'sent',
      folder_path: 'Sent',
      sent_by_kind: 'ai_auto',
      sent_by_label: 'Workflow „KI-Antwort“',
      sent_outbound_review_skipped: true,
      seen_local: true,
    }));

    // Erneuter Sync derselben Server-Kopie: weiterhin genau eine Zeile.
    await port.sync(plan);
    expect(await rowsForMessageId()).toHaveLength(1);
  });
});
