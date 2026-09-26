import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Kysely } from 'kysely';

import type { PostgresSecretPort } from '../../packages/server/src/db/postgres-secret-port';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import {
  formatStorageMaintenanceReport,
  runStorageMaintenance,
} from '../../packages/server/src/maintenance/storage-maintenance';
import { createPostgresMailSyncJobPort } from '../../packages/server/src/mail-sync';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000fb';
const ACCOUNT_ID = 991;

const secrets = {
  async readSecret() { return Buffer.from('mailbox-password'); },
  async writeSecret() { throw new Error('not used'); },
} as unknown as PostgresSecretPort;

const pdf = Buffer.concat(Array.from({ length: 500 }, (_, i) => createHash('sha256').update(`wartung-${i}`).digest()));

function sourceFor(uid: number): Buffer {
  return Buffer.from([
    'From: Kunde <kunde@example.com>',
    'To: support@example.test',
    `Subject: Wartung ${uid}`,
    `Message-ID: <maint-${uid}@example.com>`,
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="grenze"',
    '',
    '--grenze',
    'Content-Type: text/plain; charset=utf-8',
    '',
    `Mail ${uid}`,
    '--grenze',
    'Content-Type: application/pdf; name="plan.pdf"',
    'Content-Disposition: attachment; filename="plan.pdf"',
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
    async status() { return { uidValidity: 11, uidNext: Math.max(0, ...uids) + 1, messages: uids.length }; },
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

// `simplecrm maintenance`: räumt verifiziert auf (komprimieren, Anhänge aus Originalen,
// gleiche Anhänge verknüpfen) und meldet, was nicht stimmt: fehlende Datei, falscher
// Inhalt, Dateien ohne Eintrag, beschädigtes Original. Gelöscht wird nichts.
describe('storage maintenance checks and cleans up without deleting anything', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;
  let attachmentsRoot: string;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('storage-maintenance');
    await postgres.admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Maintenance Test')`, [WORKSPACE_ID]);
    await postgres.admin.query(`
      INSERT INTO email_accounts (id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username)
      VALUES ($1, $2, $1, 'Support', 'support@example.test', 'imap.example.test', 'support')
    `, [ACCOUNT_ID, WORKSPACE_ID]);
    db = postgres.createApplicationDb();
    attachmentsRoot = mkdtempSync(join(tmpdir(), 'simplecrm-maintenance-'));
    await createPostgresMailSyncJobPort({
      db, secrets, attachmentsRoot, imapClientFactory: () => fakeImapClient([1, 2, 3]) as never,
    }).sync({ workspaceId: WORKSPACE_ID, accountId: ACCOUNT_ID, protocol: 'imap' });
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
    if (attachmentsRoot) rmSync(attachmentsRoot, { recursive: true, force: true });
  });

  async function attachmentFile(uid: number): Promise<string> {
    const { rows } = await postgres.admin.query(`
      SELECT a.storage_path FROM email_message_attachments a JOIN email_messages m ON m.id = a.message_id
      WHERE m.workspace_id = $1 AND m.uid = $2
    `, [WORKSPACE_ID, uid]);
    return join(attachmentsRoot, rows[0].storage_path);
  }

  test('a healthy store: cleanup runs, all checks pass', async () => {
    const source = sourceFor(3);
    await postgres.admin.query(`
      UPDATE email_messages SET raw_rfc822_b64 = $2, raw_rfc822_z = NULL, raw_rfc822_codec = NULL,
        raw_rfc822_sha256 = NULL, raw_rfc822_size = NULL WHERE workspace_id = $1 AND uid = 3
    `, [WORKSPACE_ID, source.toString('base64')]);

    const report = await runStorageMaintenance({ db, attachmentsRoot });
    expect(report.cleanup).toMatchObject({ compressed: 1, partsTakenOut: 3 });
    expect(report.cleanup!.filesLinked).toBeGreaterThanOrEqual(2);
    expect(report.attachments).toMatchObject({ rows: 3, missing: 0, sizeMismatch: 0, orphanFiles: 0 });
    expect(report.originals).toMatchObject({ total: 3, legacyBase64: 0, withoutAttachmentCopies: 3, damaged: 0 });
    expect(report.ok).toBe(true);
    expect(formatStorageMaintenanceReport(report)).toContain('Ergebnis: in Ordnung.');
  });

  test('problems are reported with examples; nothing is deleted', async () => {
    // Datei 1 fehlt, Datei 2 hat gleiche Größe, aber anderen Inhalt, dazu eine verwaiste Datei.
    unlinkSync(await attachmentFile(1));
    const second = await attachmentFile(2);
    unlinkSync(second);
    const damaged = Buffer.from(pdf);
    damaged[7] = damaged[7]! ^ 1;
    writeFileSync(second, damaged);
    const orphanDir = join(attachmentsRoot, WORKSPACE_ID, 'mail-sync', '999');
    mkdirSync(orphanDir, { recursive: true });
    writeFileSync(join(orphanDir, 'rest.pdf'), 'x');
    await postgres.admin.query(`UPDATE email_messages SET raw_rfc822_sha256 = repeat('0', 64) WHERE workspace_id = $1 AND uid = 3`, [WORKSPACE_ID]);

    const report = await runStorageMaintenance({ db, attachmentsRoot, checkOnly: true, deep: true });
    expect(report.cleanup).toBeNull();
    expect(report.attachments).toMatchObject({ missing: 1, hashMismatch: 1, orphanFiles: 1 });
    expect(report.originals.damaged).toBe(1);
    expect(report.ok).toBe(false);
    const text = formatStorageMaintenanceReport(report);
    expect(text).toContain('file missing');
    expect(text).toContain('content does not match its sha256');
    expect(text).toContain('does not match its sha256');
    expect(text).toContain('Anhänge und Originale wurden nicht gelöscht');
    expect(report.unreferencedParts).toMatchObject({ setAside: 0, removed: 0 });
  });
});
