import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Kysely } from 'kysely';

import { createPostgresEmailMessageReadPort } from '../../packages/server/src/db/postgres-mail-read-ports';
import type { PostgresSecretPort } from '../../packages/server/src/db/postgres-secret-port';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { runRawCompressionBackfillBatch } from '../../packages/server/src/mail-raw-compression-backfill';
import { createPostgresMailSyncJobPort } from '../../packages/server/src/mail-sync';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000f8';
const ACCOUNT_ID = 961;

const secrets = {
  async readSecret() { return Buffer.from('mailbox-password'); },
  async writeSecret() { throw new Error('not used'); },
} as unknown as PostgresSecretPort;

function sourceFor(uid: number): Buffer {
  return Buffer.from([
    'From: Kunde <kunde@example.com>',
    'To: support@example.test',
    `Subject: Rechnung ${uid} äöü`,
    `Message-ID: <raw-${uid}@example.com>`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    `Sehr geehrte Damen und Herren, Rechnung ${uid}. `.repeat(80),
    '',
  ].join('\r\n'), 'utf8');
}

function fakeImapClient(uids: number[]) {
  return {
    async connect() { return undefined; },
    async list() { return []; },
    async status() { return { uidValidity: 5, uidNext: Math.max(0, ...uids) + 1, messages: uids.length }; },
    async getMailboxLock() { return { release: () => undefined }; },
    async search(query: { all?: boolean; uid?: string }) {
      if (query.all) return uids;
      const from = Number(String(query.uid ?? '').split(':')[0]);
      return uids.filter((uid) => uid >= from);
    },
    async fetchOne(uid: string) {
      return { source: sourceFor(Number(uid)), flags: new Set<string>(), threadId: null };
    },
    async logout() { return undefined; },
  };
}

// Mail-Original: neue Mails landen komprimiert, Altbestand wird im Hintergrund
// umgestellt, die Quelltext-Ansicht liefert byte-genau das Original und ein
// beschädigtes Original wird erkannt statt weitergegeben.
describe('server stores the raw original compressed and verified', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;
  let attachmentsRoot: string;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('mail-raw-storage');
    await postgres.admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Raw Storage Test')`, [WORKSPACE_ID]);
    await postgres.admin.query(`
      INSERT INTO email_accounts (id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username)
      VALUES ($1, $2, $1, 'Support', 'support@example.test', 'imap.example.test', 'support')
    `, [ACCOUNT_ID, WORKSPACE_ID]);
    db = postgres.createApplicationDb();
    attachmentsRoot = mkdtempSync(join(tmpdir(), 'simplecrm-raw-storage-'));
    await createPostgresMailSyncJobPort({ db, secrets, imapClientFactory: () => fakeImapClient([1, 2, 3]) as never })
      .sync({ workspaceId: WORKSPACE_ID, accountId: ACCOUNT_ID, protocol: 'imap' });
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
    if (attachmentsRoot) rmSync(attachmentsRoot, { recursive: true, force: true });
  });

  async function rowOf(uid: number) {
    const { rows } = await postgres.admin.query(`
      SELECT id, raw_rfc822_b64, raw_rfc822_z, raw_rfc822_codec, raw_rfc822_sha256, raw_rfc822_size
      FROM email_messages WHERE workspace_id = $1 AND account_id = $2 AND uid = $3
    `, [WORKSPACE_ID, ACCOUNT_ID, uid]);
    return rows[0];
  }

  const rawSource = (id: number) => createPostgresEmailMessageReadPort({ db, attachmentsRoot })
    .getRawHeaders({ workspaceId: WORKSPACE_ID, id } as never);

  test('synced mail is stored compressed with hash and size of the original', async () => {
    const source = sourceFor(1);
    const row = await rowOf(1);
    expect(row.raw_rfc822_b64).toBeNull();
    expect(row.raw_rfc822_codec).toBe('br');
    expect(row.raw_rfc822_sha256).toBe(createHash('sha256').update(source).digest('hex'));
    expect(Number(row.raw_rfc822_size)).toBe(source.length);
    expect(row.raw_rfc822_z.length).toBeLessThan(source.length / 3);

    const view = await rawSource(Number(row.id));
    expect(view?.emlSource).toBe('original');
    expect(view?.rawEml.startsWith(source.toString('latin1'))).toBe(true);
  });

  test('legacy base64 originals are converted in the background, the view is unchanged', async () => {
    const source = sourceFor(2);
    const { id } = await rowOf(2);
    await postgres.admin.query(`
      UPDATE email_messages SET raw_rfc822_b64 = $2, raw_rfc822_z = NULL, raw_rfc822_codec = NULL,
        raw_rfc822_sha256 = NULL, raw_rfc822_size = NULL, updated_at = '2020-01-01T00:00:00Z'
      WHERE id = $1
    `, [id, source.toString('base64')]);
    const before = await rawSource(Number(id));

    let afterId = 0;
    let converted = 0;
    for (;;) {
      const batch = await runRawCompressionBackfillBatch({ db }, afterId);
      if (batch.seen === 0) break;
      afterId = batch.lastId;
      converted += batch.converted;
    }
    expect(converted).toBe(1);

    const row = await rowOf(2);
    expect(row.raw_rfc822_b64).toBeNull();
    expect(row.raw_rfc822_sha256).toBe(createHash('sha256').update(source).digest('hex'));
    const { rows } = await postgres.admin.query('SELECT updated_at FROM email_messages WHERE id = $1', [id]);
    expect(new Date(rows[0].updated_at).toISOString()).toBe('2020-01-01T00:00:00.000Z');
    expect(await rawSource(Number(id))).toEqual(before);
  });

  test('a damaged original is detected and not passed on as the original', async () => {
    const { id } = await rowOf(3);
    await postgres.admin.query(`UPDATE email_messages SET raw_rfc822_sha256 = repeat('0', 64) WHERE id = $1`, [id]);
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const view = await rawSource(Number(id));
      expect(view?.emlSource).toBe('reconstructed');
      expect(errors).toHaveBeenCalledWith(expect.stringContaining('does not match its sha256'));
    } finally {
      errors.mockRestore();
    }
  });
});
