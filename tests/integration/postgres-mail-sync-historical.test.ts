import type { Kysely } from 'kysely';

import type { PostgresSecretPort } from '../../packages/server/src/db/postgres-secret-port';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { createPostgresMailSyncJobPort } from '../../packages/server/src/mail-sync';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000f7';
const HISTORY_ACCOUNT_ID = 951;
const EMPTY_ACCOUNT_ID = 952;

const secrets = {
  async readSecret() {
    return Buffer.from('mailbox-password');
  },
  async writeSecret() {
    throw new Error('not used');
  },
} as unknown as PostgresSecretPort;

function fakeImapClient(mailbox: { uids: number[] }) {
  return {
    async connect() { return undefined; },
    async list() { return []; },
    async status() { return { uidValidity: 22, uidNext: Math.max(0, ...mailbox.uids) + 1, messages: mailbox.uids.length }; },
    async getMailboxLock() { return { release: () => undefined }; },
    async search(query: { all?: boolean; uid?: string }) {
      if (query.all) return mailbox.uids;
      const from = Number(String(query.uid ?? '').split(':')[0]);
      return mailbox.uids.filter((uid) => uid >= from);
    },
    async fetchOne(uid: string) {
      return {
        source: Buffer.from(
          `From: kunde@example.com\r\nTo: support@example.test\r\nSubject: Mail ${uid}\r\n`
          + `Message-ID: <mail-${uid}@example.com>\r\n\r\nText ${uid}\r\n`,
        ),
        flags: new Set<string>(),
        threadId: null,
      };
    },
    async logout() { return undefined; },
  };
}

// F-A7b-04: Der Erst-Sync eines Kontos meldete bis zu 2000 Bestandsmails als neu;
// Inbound-Workflows, KI-Vorschlaege und Abwesenheitsantworten liefen fuer die
// ganze Historie. Kriterium ist last_synced_at des Ordners (nie synchronisiert).
describe('server mail sync separates historical mail of a never-synced folder', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('mail-sync-historical');
    const { admin } = postgres;
    await admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Historical Sync Test')`, [WORKSPACE_ID]);
    for (const accountId of [HISTORY_ACCOUNT_ID, EMPTY_ACCOUNT_ID]) {
      await admin.query(`
        INSERT INTO email_accounts (id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username)
        VALUES ($1, $2, $1, 'Support', $3, 'imap.example.test', 'support')
      `, [accountId, WORKSPACE_ID, `support-${accountId}@example.test`]);
    }
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  function port(mailbox: { uids: number[] }) {
    return createPostgresMailSyncJobPort({
      db,
      secrets,
      imapClientFactory: () => fakeImapClient(mailbox) as never,
    });
  }

  test('the first sync of a mailbox with history reports it as historical, later mail as inbound', async () => {
    const mailbox = { uids: [1, 2] };
    const plan = { workspaceId: WORKSPACE_ID, accountId: HISTORY_ACCOUNT_ID, protocol: 'imap' as const };

    const first = await port(mailbox).sync(plan);
    expect(first.inboundMessageIds).toEqual([]);
    expect(first.historicalMessageIds).toHaveLength(2);

    mailbox.uids = [1, 2, 3];
    const second = await port(mailbox).sync(plan);
    expect(second.inboundMessageIds).toHaveLength(1);
    expect(second.historicalMessageIds).toBeUndefined();
  });

  test('the first mail of a new, empty mailbox is inbound', async () => {
    const mailbox = { uids: [] as number[] };
    const plan = { workspaceId: WORKSPACE_ID, accountId: EMPTY_ACCOUNT_ID, protocol: 'imap' as const };

    await expect(port(mailbox).sync(plan)).resolves.toEqual({ inboundMessageIds: [] });

    mailbox.uids = [1];
    const second = await port(mailbox).sync(plan);
    expect(second.inboundMessageIds).toHaveLength(1);
    expect(second.historicalMessageIds).toBeUndefined();
  });
});
