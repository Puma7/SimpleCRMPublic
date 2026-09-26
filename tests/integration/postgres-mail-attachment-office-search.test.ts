import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Kysely } from 'kysely';

import { createPostgresEmailMessageReadPort } from '../../packages/server/src/db/postgres-mail-read-ports';
import type { PostgresSecretPort } from '../../packages/server/src/db/postgres-secret-port';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { runAttachmentTextBackfillBatch } from '../../packages/server/src/mail-attachment-text';
import { createPostgresMailSyncJobPort } from '../../packages/server/src/mail-sync';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

// Die Office-Leser laufen im Worker über tsx (wie im Server-Test).
process.env.TSX_TSCONFIG_PATH ??= join(__dirname, '../setup/tsconfig.node-runtime.json');

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000fb';
const ACCOUNT_ID = 982;
const EAN_XLSX = '4006381333931';
const EAN_CSV = '5901234123457';

const secrets = {
  async readSecret() { return Buffer.from('mailbox-password'); },
  async writeSecret() { throw new Error('not used'); },
} as unknown as PostgresSecretPort;

const fixture = (name: string) => readFileSync(join(__dirname, '../fixtures/attachments', name));

const ATTACHMENTS: Record<number, { filename: string; contentType: string; data: Buffer }> = {
  1: {
    filename: 'preisliste.xlsx',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    data: fixture('lieferant-ean.xlsx'),
  },
  2: {
    filename: 'preisliste-alt.xls',
    contentType: 'application/vnd.ms-excel',
    data: fixture('lieferant-ean.xls'),
  },
  // Excel speichert CSV unter Windows in Windows-1252.
  3: {
    filename: 'artikel.csv',
    contentType: 'application/octet-stream',
    data: Buffer.from(`EAN;Artikel\r\n${EAN_CSV};Unterlegscheibe Übergröße\r\n`, 'latin1'),
  },
  4: {
    filename: 'logo.png',
    contentType: 'image/png',
    data: Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'),
  },
};

function sourceFor(uid: number): Buffer {
  const attachment = ATTACHMENTS[uid]!;
  return Buffer.from([
    'From: Lieferant <verkauf@lieferant.example>',
    'To: einkauf@example.test',
    `Subject: Preisliste ${uid}`,
    `Message-ID: <office-${uid}@lieferant.example>`,
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="grenze"',
    '',
    '--grenze',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Anbei die aktuelle Liste.',
    '--grenze',
    `Content-Type: ${attachment.contentType}; name="${attachment.filename}"`,
    `Content-Disposition: attachment; filename="${attachment.filename}"`,
    'Content-Transfer-Encoding: base64',
    '',
    attachment.data.toString('base64').replace(/.{76}/g, '$&\r\n'),
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

// Lieferanten schicken Preislisten als Excel oder CSV; gesucht wird nach der
// EAN. Bis Version 1 wurden xls/xlsx gar nicht gelesen und CSV nur als UTF-8.
// Solche Anhänge waren als "versucht" markiert und kamen nie wieder dran.
describe('server finds supplier price lists by EAN', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;
  let attachmentsRoot: string;

  async function attachmentRows() {
    const { rows } = await postgres.admin.query(`
      SELECT a.filename_display, a.content_text, a.text_extracted_at, a.text_extractor_version
      FROM email_message_attachments a WHERE a.workspace_id = $1 ORDER BY a.id
    `, [WORKSPACE_ID]);
    return rows as Array<{ filename_display: string; content_text: string | null; text_extracted_at: Date | null; text_extractor_version: number }>;
  }

  async function subjectsFor(search: string): Promise<string[]> {
    const result = await createPostgresEmailMessageReadPort({ db }).list({ workspaceId: WORKSPACE_ID, search, limit: 10 });
    return result.items.map((item) => item.subject ?? '').sort();
  }

  async function backfillUntilDone(): Promise<number> {
    let total = 0;
    for (let round = 0; round < 10; round += 1) {
      const processed = await runAttachmentTextBackfillBatch({ db, attachmentsRoot });
      if (processed === 0) return total;
      total += processed;
    }
    throw new Error('backfill did not settle');
  }

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('mail-attachment-office-search');
    await postgres.admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Office Search')`, [WORKSPACE_ID]);
    await postgres.admin.query(`
      INSERT INTO email_accounts (id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username)
      VALUES ($1, $2, $1, 'Einkauf', 'einkauf@example.test', 'imap.example.test', 'einkauf')
    `, [ACCOUNT_ID, WORKSPACE_ID]);
    db = postgres.createApplicationDb();
    attachmentsRoot = mkdtempSync(join(tmpdir(), 'simplecrm-office-search-'));
    await createPostgresMailSyncJobPort({
      db,
      secrets,
      attachmentsRoot,
      imapClientFactory: () => fakeImapClient([1, 2, 3, 4]) as never,
    }).sync({ workspaceId: WORKSPACE_ID, accountId: ACCOUNT_ID, protocol: 'imap' });
    // Die Sync stößt die Extraktion im Hintergrund an; warten, bis alle vier
    // Anhänge fertig sind (Text gespeichert oder mit aktueller Version versucht).
    for (let wait = 0; wait < 200; wait += 1) {
      await backfillUntilDone();
      const rows = await attachmentRows();
      const settled = rows.length === 4 && rows.every((row) => row.text_extractor_version === 2
        && (row.content_text !== null || row.filename_display === 'logo.png'));
      if (settled) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
    if (attachmentsRoot) rmSync(attachmentsRoot, { recursive: true, force: true });
  });

  test('a new xlsx, xls or CSV attachment is found by its EAN', async () => {
    const rows = await attachmentRows();
    expect(rows.map((row) => [row.filename_display, row.text_extractor_version])).toEqual([
      ['preisliste.xlsx', 2],
      ['preisliste-alt.xls', 2],
      ['artikel.csv', 2],
      ['logo.png', 2],
    ]);
    expect(rows[2]!.content_text).toContain('Unterlegscheibe Übergröße');
    expect(rows[3]!.content_text).toBeNull();

    await expect(subjectsFor(EAN_XLSX)).resolves.toEqual(['Preisliste 1', 'Preisliste 2']);
    await expect(subjectsFor(EAN_CSV)).resolves.toEqual(['Preisliste 3']);
    await expect(subjectsFor('Übergröße')).resolves.toEqual(['Preisliste 3']);
  });

  test('attachments an older version tried without text are read once more', async () => {
    // Zustand nach Version 1: xls nicht lesbar, als versucht markiert.
    await postgres.admin.query(`
      UPDATE email_message_attachments SET content_text = NULL, text_extractor_version = 0
      WHERE workspace_id = $1 AND filename_display IN ('preisliste-alt.xls', 'logo.png')
    `, [WORKSPACE_ID]);
    // Mit Text gespeicherte Zeilen alter Versionen bleiben, wie sie sind.
    await postgres.admin.query(`
      UPDATE email_message_attachments SET text_extractor_version = 1
      WHERE workspace_id = $1 AND filename_display = 'preisliste.xlsx'
    `, [WORKSPACE_ID]);
    await expect(subjectsFor(EAN_XLSX)).resolves.toEqual(['Preisliste 1']);

    await expect(backfillUntilDone()).resolves.toBe(2);

    await expect(subjectsFor(EAN_XLSX)).resolves.toEqual(['Preisliste 1', 'Preisliste 2']);
    const rows = await attachmentRows();
    expect(rows.map((row) => [row.filename_display, row.text_extractor_version])).toEqual([
      ['preisliste.xlsx', 1],
      ['preisliste-alt.xls', 2],
      ['artikel.csv', 2],
      ['logo.png', 2],
    ]);
    // Kein Endlos-Nachlesen: das Bild bleibt ohne Text und ist jetzt erledigt.
    await expect(backfillUntilDone()).resolves.toBe(0);
  });
});
