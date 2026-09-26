import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Kysely } from 'kysely';
import { authenticate } from 'mailauth';

import { createPostgresEmailMessageReadPort } from '../../packages/server/src/db/postgres-mail-read-ports';
import type { PostgresSecretPort } from '../../packages/server/src/db/postgres-secret-port';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { rawPartPath, rawPartsDir, sha256Hex } from '../../packages/server/src/mail-raw-parts';
import { runRawPartDedupBatch } from '../../packages/server/src/mail-raw-part-dedup';
import { runRawPartGc, UNREFERENCED_GRACE_MS } from '../../packages/server/src/mail-raw-part-gc';
import { loadStoredRaw, rawPartReaderFor, storedRawColumns } from '../../packages/server/src/mail-raw-storage';
import { createPostgresMailSyncJobPort } from '../../packages/server/src/mail-sync';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));
jest.mock('mailauth', () => ({
  authenticate: jest.fn(async () => {
    throw new Error('DNS nicht erreichbar');
  }),
}));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000fc';
const UNKNOWN_WORKSPACE_ID = '10000000-0000-4000-8000-0000000000fd';
const USER_ID = '20000000-0000-4000-8000-0000000000fc';
const ACCOUNT_ID = 983;
const DAY = 24 * 60 * 60_000;

const secrets = {
  async readSecret() { return Buffer.from('mailbox-password'); },
  async writeSecret() { throw new Error('not used'); },
} as unknown as PostgresSecretPort;

const pdf = Buffer.concat(Array.from({ length: 1000 }, (_, i) => createHash('sha256').update(`gc-${i}`).digest()));
const PDF_SHA = sha256Hex(pdf);

function sourceFor(uid: number): Buffer {
  return Buffer.from([
    'From: Kunde <kunde@example.com>',
    'To: support@example.test',
    `Subject: Angebot ${uid}`,
    `Message-ID: <gc-${uid}@example.com>`,
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="grenze"',
    '',
    '--grenze',
    'Content-Type: text/plain; charset=utf-8',
    '',
    `Angebot ${uid}.`,
    '--grenze',
    'Content-Type: application/pdf; name="angebot.pdf"',
    'Content-Disposition: attachment; filename="angebot.pdf"',
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

describe('server raw part objects of deleted mails', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;
  let attachmentsRoot: string;
  let partsDir: string;
  let partFile: string;

  async function messageIds(): Promise<number[]> {
    const { rows } = await postgres.admin.query(
      'SELECT id FROM email_messages WHERE workspace_id = $1 ORDER BY uid',
      [WORKSPACE_ID],
    );
    return rows.map((row: { id: string | number }) => Number(row.id));
  }

  async function readOriginal(id: number): Promise<Buffer | null> {
    const { rows } = await postgres.admin.query(
      `SELECT ${storedRawColumns.join(', ')} FROM email_messages WHERE workspace_id = $1 AND id = $2`,
      [WORKSPACE_ID, id],
    );
    return loadStoredRaw(rows[0], { readPart: rawPartReaderFor(attachmentsRoot, WORKSPACE_ID) });
  }

  /** Like a hard delete in the app: the rows and their attachment files go. */
  async function deleteMessages(ids: number[]): Promise<void> {
    const { rows } = await postgres.admin.query(
      'SELECT storage_path FROM email_message_attachments WHERE workspace_id = $1 AND message_id = ANY($2::bigint[])',
      [WORKSPACE_ID, ids],
    );
    await postgres.admin.query('DELETE FROM email_messages WHERE workspace_id = $1 AND id = ANY($2::bigint[])', [WORKSPACE_ID, ids]);
    for (const row of rows as Array<{ storage_path: string }>) rmSync(join(attachmentsRoot, row.storage_path), { force: true });
  }

  function setAsideFiles(): string[] {
    const dir = join(partsDir, '.unreferenced', PDF_SHA.slice(0, 2));
    return existsSync(dir) ? readdirSync(dir).map((name) => join(dir, name)) : [];
  }

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('mail-raw-part-gc');
    await postgres.admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Part GC')`, [WORKSPACE_ID]);
    await postgres.admin.query(`
      INSERT INTO users (id, workspace_id, email, display_name, password_hash, role)
      VALUES ($1, $2, 'owner@example.test', 'Owner', 'x', 'owner')
    `, [USER_ID, WORKSPACE_ID]);
    await postgres.admin.query(`
      INSERT INTO email_accounts (id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username)
      VALUES ($1, $2, $1, 'Support', 'support@example.test', 'imap.example.test', 'support')
    `, [ACCOUNT_ID, WORKSPACE_ID]);
    db = postgres.createApplicationDb();
    attachmentsRoot = mkdtempSync(join(tmpdir(), 'simplecrm-raw-part-gc-'));
    await createPostgresMailSyncJobPort({
      db,
      secrets,
      attachmentsRoot,
      imapClientFactory: () => fakeImapClient([1, 2, 3]) as never,
    }).sync({ workspaceId: WORKSPACE_ID, accountId: ACCOUNT_ID, protocol: 'imap' });
    for (let afterId = 0; ;) {
      const batch = await runRawPartDedupBatch({ db, attachmentsRoot }, afterId);
      if (batch.seen === 0) break;
      afterId = batch.lastId;
    }
    partsDir = rawPartsDir(attachmentsRoot, WORKSPACE_ID)!;
    partFile = rawPartPath(partsDir, PDF_SHA);
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
    if (attachmentsRoot) rmSync(attachmentsRoot, { recursive: true, force: true });
  });

  // Ein nicht lesbares Original wurde für SPF/DKIM/DMARC und Rspamd durch eine
  // aus Kopf und Text nachgebaute Nachricht ersetzt; deren Ergebnis wurde als
  // Prüfergebnis gespeichert bzw. an Rspamd zum Lernen gegeben.
  test('a damaged original is never replaced by a rebuilt message for checks or learning', async () => {
    const [first] = await messageIds();
    expect(existsSync(partFile)).toBe(true);
    await postgres.admin.query(`
      INSERT INTO sync_info (workspace_id, key, value) VALUES
        ($1, 'mail_security_rspamd_enabled', 'true'),
        ($1, 'mail_security_spam_rspamd_learning_enabled', 'true'),
        ($1, 'mail_security_rspamd_url', 'http://rspamd.test:11334')
    `, [WORKSPACE_ID]);
    const rspamdCalls: string[] = [];
    const rspamdFetch = (async (url: string | URL) => {
      rspamdCalls.push(String(url));
      return new Response(JSON.stringify({ score: 1, required_score: 15, action: 'no action', symbols: {} }), { status: 200 });
    }) as unknown as typeof fetch;
    const port = createPostgresEmailMessageReadPort({ db, attachmentsRoot, rspamdFetch });
    const mailauth = authenticate as jest.MockedFunction<typeof authenticate>;
    const damaged = `${partFile}.weg`;
    renameSync(partFile, damaged);
    try {
      mailauth.mockClear();
      const check = await port.runSecurityCheck!({ workspaceId: WORKSPACE_ID, messageId: first!, values: { applyStatus: false } });
      expect(check).toMatchObject({ authChecked: false, rspamdChecked: false, rawDamaged: true });
      expect(mailauth).not.toHaveBeenCalled();
      expect(rspamdCalls).toEqual([]);
      const { rows } = await postgres.admin.query(
        'SELECT auth_spf, auth_dmarc, rspamd_score FROM email_messages WHERE workspace_id = $1 AND id = $2',
        [WORKSPACE_ID, first],
      );
      expect(rows[0]).toEqual({ auth_spf: null, auth_dmarc: null, rspamd_score: null });

      await port.setSpamStatus!({ workspaceId: WORKSPACE_ID, actorUserId: USER_ID, messageId: first!, values: { status: 'spam' } });
      expect(rspamdCalls).toEqual([]);
    } finally {
      renameSync(damaged, partFile);
    }

    // Gegenprobe mit lesbarem Original: beide Prüfungen laufen, Rspamd lernt.
    mailauth.mockClear();
    const check = await port.runSecurityCheck!({ workspaceId: WORKSPACE_ID, messageId: first!, values: { applyStatus: false } });
    expect(check).toMatchObject({ authChecked: true, rspamdChecked: true });
    expect(check).not.toHaveProperty('rawDamaged');
    expect(mailauth).toHaveBeenCalledTimes(1);
    await port.setSpamStatus!({ workspaceId: WORKSPACE_ID, actorUserId: USER_ID, messageId: first!, values: { status: 'clean' } });
    expect(rspamdCalls.some((url) => url.includes('learnham'))).toBe(true);
  });

  test('a part stays while any original names it; unknown workspace folders are left alone', async () => {
    const unknownParts = rawPartsDir(attachmentsRoot, UNKNOWN_WORKSPACE_ID)!;
    const stray = rawPartPath(unknownParts, PDF_SHA);
    mkdirSync(join(stray, '..'), { recursive: true });
    writeFileSync(stray, pdf);

    const [first, second] = await messageIds();
    await deleteMessages([first!, second!]);
    const result = await runRawPartGc({ db, attachmentsRoot });
    expect(result).toMatchObject({ setAside: 0, removed: 0, unknownWorkspaces: 1 });
    expect(existsSync(partFile)).toBe(true);
    expect(existsSync(stray)).toBe(true);
  });

  test('named again right after the check: still readable, moved back on the next run', async () => {
    const [third] = await messageIds();
    // Wie ein Lauf, der das Teil beiseitelegt, während die Mail es gerade (wieder) nennt.
    const now = Date.now();
    const aside = join(partsDir, '.unreferenced', PDF_SHA.slice(0, 2), `${PDF_SHA}.${now}`);
    mkdirSync(join(aside, '..'), { recursive: true });
    renameSync(partFile, aside);

    expect((await readOriginal(third!))?.equals(sourceFor(3))).toBe(true);

    const result = await runRawPartGc({ db, attachmentsRoot, now: now + 30 * DAY });
    expect(result).toMatchObject({ restored: 1, removed: 0, setAside: 0 });
    expect(existsSync(partFile)).toBe(true);
    expect(setAsideFiles()).toEqual([]);
  });

  test('after the last mail is deleted: set aside, kept for 7 days, then removed', async () => {
    const [third] = await messageIds();
    await deleteMessages([third!]);

    const checkOnly = await runRawPartGc({ db, attachmentsRoot, checkOnly: true });
    expect(checkOnly).toMatchObject({ setAside: 1, removed: 0 });
    expect(existsSync(partFile)).toBe(true);

    const start = Date.now();
    const first = await runRawPartGc({ db, attachmentsRoot, now: start });
    expect(first).toMatchObject({ setAside: 1, removed: 0 });
    expect(existsSync(partFile)).toBe(false);
    const [aside] = setAsideFiles();
    expect(aside).toBeDefined();
    expect(statSync(aside!).size).toBe(pdf.length);

    const early = await runRawPartGc({ db, attachmentsRoot, now: start + UNREFERENCED_GRACE_MS - DAY });
    expect(early).toMatchObject({ removed: 0, waiting: 1 });
    expect(existsSync(aside!)).toBe(true);

    const due = await runRawPartGc({ db, attachmentsRoot, now: start + UNREFERENCED_GRACE_MS + 1 });
    expect(due).toMatchObject({ removed: 1, bytesFreed: pdf.length, waiting: 0 });
    expect(setAsideFiles()).toEqual([]);
    expect(await runRawPartGc({ db, attachmentsRoot })).toMatchObject({ setAside: 0, removed: 0, restored: 0 });
  });
});
