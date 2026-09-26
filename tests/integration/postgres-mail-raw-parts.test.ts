import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Kysely } from 'kysely';

import { createPostgresEmailMessageReadPort } from '../../packages/server/src/db/postgres-mail-read-ports';
import type { PostgresSecretPort } from '../../packages/server/src/db/postgres-secret-port';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { rawPartPath, rawPartsDir, sha256Hex } from '../../packages/server/src/mail-raw-parts';
import { runRawPartDedupBatch } from '../../packages/server/src/mail-raw-part-dedup';
import { createPostgresMailSyncJobPort } from '../../packages/server/src/mail-sync';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000f9';
const ACCOUNT_ID = 971;

const secrets = {
  async readSecret() { return Buffer.from('mailbox-password'); },
  async writeSecret() { throw new Error('not used'); },
} as unknown as PostgresSecretPort;

// Nicht komprimierbar wie ein echtes PDF: Pseudozufall aus einer Hash-Kette.
const pdf = Buffer.concat(Array.from({ length: 1875 }, (_, i) => createHash('sha256').update(`block-${i}`).digest()));

function sourceFor(uid: number): Buffer {
  const attachment = uid === 1
    ? [
      'Content-Type: application/pdf; name="angebot.pdf"',
      'Content-Disposition: attachment; filename="angebot.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      pdf.toString('base64').replace(/.{76}/g, '$&\r\n'),
    ]
    : [
      'Content-Type: text/plain; name="notiz.txt"',
      'Content-Disposition: attachment; filename="notiz.txt"',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'Nur eine kleine Notiz ohne Base64.',
    ];
  return Buffer.from([
    'From: Kunde <kunde@example.com>',
    'To: support@example.test',
    `Subject: Anhang ${uid}`,
    `Message-ID: <parts-${uid}@example.com>`,
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="grenze"',
    '',
    '--grenze',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Anbei die Unterlagen.',
    '--grenze',
    ...attachment,
    '--grenze--',
    '',
  ].join('\r\n'), 'latin1');
}

function fakeImapClient(uids: number[]) {
  return {
    async connect() { return undefined; },
    async list() { return []; },
    async status() { return { uidValidity: 7, uidNext: Math.max(0, ...uids) + 1, messages: uids.length }; },
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

// Anhänge nicht doppelt: nach dem Lauf trägt das gespeicherte Original den PDF-
// Anhang nicht mehr base64-kodiert mit, die Quelltext-Ansicht liefert trotzdem
// byte-genau das Original – auch wenn die Anhang-Datei selbst später fehlt.
describe('server takes attachment parts out of stored originals', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;
  let attachmentsRoot: string;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('mail-raw-parts');
    await postgres.admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Raw Parts Test')`, [WORKSPACE_ID]);
    await postgres.admin.query(`
      INSERT INTO email_accounts (id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username)
      VALUES ($1, $2, $1, 'Support', 'support@example.test', 'imap.example.test', 'support')
    `, [ACCOUNT_ID, WORKSPACE_ID]);
    db = postgres.createApplicationDb();
    attachmentsRoot = mkdtempSync(join(tmpdir(), 'simplecrm-raw-parts-'));
    await createPostgresMailSyncJobPort({
      db,
      secrets,
      attachmentsRoot,
      imapClientFactory: () => fakeImapClient([1, 2]) as never,
    }).sync({ workspaceId: WORKSPACE_ID, accountId: ACCOUNT_ID, protocol: 'imap' });
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
    if (attachmentsRoot) rmSync(attachmentsRoot, { recursive: true, force: true });
  });

  async function rowOf(uid: number) {
    const { rows } = await postgres.admin.query(`
      SELECT m.id, m.raw_rfc822_z, m.raw_rfc822_codec, m.raw_rfc822_part_sha256s,
             (SELECT a.storage_path FROM email_message_attachments a WHERE a.message_id = m.id LIMIT 1) AS storage_path
      FROM email_messages m WHERE m.workspace_id = $1 AND m.account_id = $2 AND m.uid = $3
    `, [WORKSPACE_ID, ACCOUNT_ID, uid]);
    return rows[0];
  }

  const rawSource = (id: number) => createPostgresEmailMessageReadPort({ db, attachmentsRoot })
    .getRawHeaders({ workspaceId: WORKSPACE_ID, id } as never);

  test('the attachment leaves the stored original; the original stays exact', async () => {
    const before = await rowOf(1);
    expect(before.raw_rfc822_codec).toBe('br');
    const sizeBefore = before.raw_rfc822_z.length;

    let afterId = 0;
    let stripped = 0;
    for (;;) {
      const batch = await runRawPartDedupBatch({ db, attachmentsRoot }, afterId);
      if (batch.seen === 0) break;
      afterId = batch.lastId;
      stripped += batch.stripped;
    }
    expect(stripped).toBe(1);

    const after = await rowOf(1);
    expect(after.raw_rfc822_codec).toBe('br-parts');
    expect(after.raw_rfc822_part_sha256s).toEqual([sha256Hex(pdf)]);
    expect(after.raw_rfc822_z.length).toBeLessThan(sizeBefore / 10);

    const partsDir = rawPartsDir(attachmentsRoot, WORKSPACE_ID)!;
    const attachmentFile = join(attachmentsRoot, after.storage_path);
    expect(statSync(rawPartPath(partsDir, sha256Hex(pdf))).ino).toBe(statSync(attachmentFile).ino);

    const view = await rawSource(Number(after.id));
    expect(view?.emlSource).toBe('original');
    expect(view?.rawEml.startsWith(sourceFor(1).toString('latin1'))).toBe(true);

    // Nichts zum Herausnehmen: markiert, bleibt 'br'.
    const plain = await rowOf(2);
    expect(plain.raw_rfc822_codec).toBe('br');
    expect(plain.raw_rfc822_part_sha256s).toEqual([]);
  });

  test('removing the attachment file keeps the original complete; a missing part is reported', async () => {
    const row = await rowOf(1);
    unlinkSync(join(attachmentsRoot, row.storage_path));
    const view = await rawSource(Number(row.id));
    expect(view?.emlSource).toBe('original');
    expect(view?.rawEml.startsWith(sourceFor(1).toString('latin1'))).toBe(true);

    const partsDir = rawPartsDir(attachmentsRoot, WORKSPACE_ID)!;
    const part = rawPartPath(partsDir, sha256Hex(pdf));
    unlinkSync(part);
    expect(existsSync(part)).toBe(false);
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const damaged = await rawSource(Number(row.id));
      expect(damaged?.emlSource).toBe('reconstructed');
      expect(errors).toHaveBeenCalledWith(expect.stringContaining('cannot be reassembled'));
    } finally {
      errors.mockRestore();
    }
    expect(readdirSync(partsDir)).toHaveLength(1);
  });
});
