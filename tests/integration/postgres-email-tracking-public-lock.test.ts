import type { Kysely } from 'kysely';
import { Client } from 'pg';

import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { createPostgresEmailTrackingService } from '../../packages/server/src/email-tracking';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000e1';
const ACCOUNT_ID = 7161;
const FOLDER_ID = 7162;
const MESSAGE_ID = 7163;
const MASTER_KEY = Buffer.alloc(32, 9);
const POLICY_LOCK_KEY = `email_tracking_policy:${WORKSPACE_ID}`;

// F-A3a-05: Jeder oeffentliche Tracking-Abruf nahm den Workspace-Policy-Lock
// exklusiv und ohne lock_timeout. Abrufe serialisierten sich gegenseitig, und
// jeder wartende hielt eine der zehn Pool-Verbindungen, solange der Lock belegt war.
describe('public tracking interactions take the workspace policy lock shared and bounded', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;
  let openToken: string;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('tracking-public-lock');
    await postgres.admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Tracking Lock Test')`, [WORKSPACE_ID]);
    await postgres.admin.query(`
      INSERT INTO email_accounts (
        id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username,
        smtp_host, smtp_port, smtp_tls, smtp_username, smtp_use_imap_auth
      ) VALUES ($1, $2, $1, 'Vertrieb', 'vertrieb@example.test', 'imap.example.test', 'vertrieb',
        'smtp.example.test', 587, true, 'vertrieb', false)
    `, [ACCOUNT_ID, WORKSPACE_ID]);
    await postgres.admin.query(`
      INSERT INTO email_folders (id, workspace_id, source_sqlite_id, account_source_sqlite_id, account_id, path)
      VALUES ($1, $2, $1, $3, $3, 'Sent')
    `, [FOLDER_ID, WORKSPACE_ID, ACCOUNT_ID]);
    await postgres.admin.query(`
      INSERT INTO email_messages (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
        account_id, folder_id, uid, subject, body_text, folder_kind
      ) VALUES ($1, $2, $1, $3, $4, $3, $4, 1, 'Angebot', 'Hallo', 'sent')
    `, [MESSAGE_ID, WORKSPACE_ID, ACCOUNT_ID, FOLDER_ID]);
    await postgres.admin.query(`
      INSERT INTO email_tracking_policies (
        workspace_id, enabled, track_opens, track_links, legal_basis, privacy_notice_url, compliance_acknowledged_at
      ) VALUES ($1, true, true, true, 'legitimate_interest', 'https://crm.example/datenschutz', now())
    `, [WORKSPACE_ID]);
    db = postgres.createApplicationDb();

    const prepared = await service().prepareOutbound({
      workspaceId: WORKSPACE_ID,
      messageId: MESSAGE_ID,
      accountId: ACCOUNT_ID,
      messageIdHeader: '<angebot-7163@example.test>',
      recipientCount: 1,
      html: '<p>Hallo</p><a href="https://kunde.example/angebot">Angebot</a>',
      pgpProtected: false,
    });
    const match = /\/t\/o\/([A-Za-z0-9_-]{43})\.gif/.exec(prepared.html ?? '');
    expect(match).not.toBeNull();
    openToken = match![1]!;
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  function service() {
    return createPostgresEmailTrackingService({ db, publicBaseUrl: 'https://crm.example', masterKey: MASTER_KEY });
  }

  async function lockHolder(mode: 'shared' | 'exclusive'): Promise<Client> {
    const client = new Client({
      host: '127.0.0.1',
      port: postgres.port,
      user: 'postgres',
      password: 'regression-test-superuser-password',
      database: 'postgres',
    });
    await client.connect();
    await client.query('BEGIN');
    const fn = mode === 'shared' ? 'pg_advisory_xact_lock_shared' : 'pg_advisory_xact_lock';
    await client.query(`SELECT ${fn}(hashtextextended($1, 0))`, [POLICY_LOCK_KEY]);
    return client;
  }

  async function eventCount(): Promise<number> {
    const result = await postgres.admin.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM email_tracking_events WHERE workspace_id = $1 AND event_type LIKE 'open%'`,
      [WORKSPACE_ID],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async function settleWithin<T>(promise: Promise<T>, ms: number): Promise<'settled' | 'pending'> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise.then(() => 'settled' as const, () => 'settled' as const),
        new Promise<'pending'>((resolve) => { timer = setTimeout(() => resolve('pending'), ms); }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  test('an in-flight interaction holding the policy lock does not block the next one', async () => {
    const holder = await lockHolder('shared');
    try {
      const before = await eventCount();
      const open = service().recordPublicOpen({
        token: openToken,
        ip: '198.51.100.7',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0) Thunderbird/128.0',
        headers: {},
      });
      expect(await settleWithin(open, 5_000)).toBe('settled');
      await open;
      expect(await eventCount()).toBe(before + 1);
    } finally {
      await holder.query('ROLLBACK');
      await holder.end();
    }
  });

  test('a policy change holding the lock makes the interaction give up instead of waiting', async () => {
    const holder = await lockHolder('exclusive');
    try {
      const before = await eventCount();
      const started = Date.now();
      const open = service().recordPublicOpen({
        token: openToken,
        ip: '198.51.100.8',
        userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15',
        headers: {},
      });
      expect(await settleWithin(open, 5_000)).toBe('settled');
      const outcome = await open.then(() => null, (error: unknown) => error);
      expect(Date.now() - started).toBeLessThan(5_000);
      expect((outcome as { code?: string } | null)?.code).toBe('55P03');
      expect(await eventCount()).toBe(before);
      const waiting = await postgres.admin.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`,
      );
      expect(waiting.rows[0]?.count).toBe('0');
    } finally {
      await holder.query('ROLLBACK');
      await holder.end();
    }
  });
});
