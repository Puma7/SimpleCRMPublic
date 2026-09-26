import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Kysely } from 'kysely';

import type { PostgresSecretPort } from '../../packages/server/src/db/postgres-secret-port';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { runAttachmentDedup } from '../../packages/server/src/mail-attachment-dedup';
import { rawPartPath, rawPartsDir, sha256Hex } from '../../packages/server/src/mail-raw-parts';
import { runRawPartDedupBatch } from '../../packages/server/src/mail-raw-part-dedup';
import { createPostgresMailSyncJobPort } from '../../packages/server/src/mail-sync';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000fa';
const ACCOUNT_ID = 981;

const secrets = {
  async readSecret() { return Buffer.from('mailbox-password'); },
  async writeSecret() { throw new Error('not used'); },
} as unknown as PostgresSecretPort;

const pdf = Buffer.concat(Array.from({ length: 1000 }, (_, i) => createHash('sha256').update(`vertrag-${i}`).digest()));

function sourceFor(uid: number): Buffer {
  return Buffer.from([
    'From: Kunde <kunde@example.com>',
    'To: support@example.test',
    `Subject: Vertrag ${uid}`,
    `Message-ID: <dedup-${uid}@example.com>`,
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="grenze"',
    '',
    '--grenze',
    'Content-Type: text/plain; charset=utf-8',
    '',
    `Version ${uid} des Vertrags.`,
    '--grenze',
    'Content-Type: application/pdf; name="vertrag.pdf"',
    'Content-Disposition: attachment; filename="vertrag.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    pdf.toString('base64').replace(/.{76}/g, '$&\r\n'),
    '--grenze--',
    '',
  ].join('\r\n'), 'latin1');
}

function fakeImapClient(uids: number[]) {
  return {
    async connect() { return undefined; },
    async list() { return []; },
    async status() { return { uidValidity: 9, uidNext: Math.max(0, ...uids) + 1, messages: uids.length }; },
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

// Gleiche Anhänge belegen nur einmal Platz: die Dateien werden Hardlinks eines
// Inodes, jede Zeile behält ihren Pfad. Eine Datei, deren Inhalt nicht zur
// gespeicherten Prüfsumme passt, wird nie verknüpft.
describe('server links identical attachments to one file', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;
  let attachmentsRoot: string;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('mail-attachment-dedup');
    await postgres.admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Dedup Test')`, [WORKSPACE_ID]);
    await postgres.admin.query(`
      INSERT INTO email_accounts (id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username)
      VALUES ($1, $2, $1, 'Support', 'support@example.test', 'imap.example.test', 'support')
    `, [ACCOUNT_ID, WORKSPACE_ID]);
    db = postgres.createApplicationDb();
    attachmentsRoot = mkdtempSync(join(tmpdir(), 'simplecrm-attachment-dedup-'));
    await createPostgresMailSyncJobPort({
      db,
      secrets,
      attachmentsRoot,
      imapClientFactory: () => fakeImapClient([1, 2, 3]) as never,
    }).sync({ workspaceId: WORKSPACE_ID, accountId: ACCOUNT_ID, protocol: 'imap' });
    // Erst die Originale verschlanken: der Teil-Speicher hängt dann an Datei 1.
    for (let afterId = 0; ;) {
      const batch = await runRawPartDedupBatch({ db, attachmentsRoot }, afterId);
      if (batch.seen === 0) break;
      afterId = batch.lastId;
    }
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
    if (attachmentsRoot) rmSync(attachmentsRoot, { recursive: true, force: true });
  });

  async function files(): Promise<string[]> {
    const { rows } = await postgres.admin.query(`
      SELECT a.storage_path FROM email_message_attachments a JOIN email_messages m ON m.id = a.message_id
      WHERE a.workspace_id = $1 ORDER BY m.uid
    `, [WORKSPACE_ID]);
    return rows.map((row: { storage_path: string }) => join(attachmentsRoot, row.storage_path));
  }

  test('identical files share one inode afterwards; a damaged copy is left alone', async () => {
    const [first, second, third] = await files();
    expect(new Set([first, second, third].map((file) => statSync(file!).ino)).size).toBe(3);
    // Datei 3 wird auf der Platte beschädigt: gleiche Größe, anderer Inhalt.
    const damaged = Buffer.from(pdf);
    damaged[100] = damaged[100]! ^ 0xff;
    writeFileSync(third!, damaged);

    const result = await runAttachmentDedup({ db, attachmentsRoot });
    expect(result.linked).toBeGreaterThanOrEqual(1);
    expect(result.skipped).toBe(1);

    const part = rawPartPath(rawPartsDir(attachmentsRoot, WORKSPACE_ID)!, sha256Hex(pdf));
    const inodes = [first!, second!, part].map((file) => statSync(file).ino);
    expect(new Set(inodes).size).toBe(1);
    expect(statSync(first!).nlink).toBeGreaterThanOrEqual(3);
    expect(readFileSync(second!).equals(pdf)).toBe(true);
    expect(statSync(third!).ino).not.toBe(inodes[0]);
    expect(readFileSync(third!).equals(damaged)).toBe(true);

    // Nochmals: nichts mehr zu tun.
    const again = await runAttachmentDedup({ db, attachmentsRoot });
    expect(again.linked).toBe(0);
  });
});
