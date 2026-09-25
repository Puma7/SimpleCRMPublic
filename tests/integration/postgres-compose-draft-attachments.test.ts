import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Kysely } from 'kysely';

import { createPostgresEmailMessageReadPort } from '../../packages/server/src/db/postgres-mail-read-ports';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { createPostgresEmailComposeAttachmentUploadPort } from '../../packages/server/src/mail-compose-attachments';
import { createPostgresEmailComposeSenderPort } from '../../packages/server/src/mail-compose-send';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000e6';
const ACCOUNT_ID = 601;
const FOLDER_ID = 611;
const MB = 1024 * 1024;

// F-A13A14-06: Entwurfsanhaenge hatten weder eine Grenze pro Entwurf noch ein
// Aufraeumen; jeder Upload blieb dauerhaft auf der Platte (auch nach Senden,
// Loeschen oder Entfernen aus dem Entwurf).
describe('server compose draft attachments: per-draft quota and cleanup', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;
  let attachmentsRoot: string;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('compose-draft-attachments');
    await postgres.admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Compose Draft Attachments')`, [WORKSPACE_ID]);
    await postgres.admin.query(`
      INSERT INTO email_accounts (
        id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username,
        smtp_host, smtp_port, smtp_tls, smtp_username, smtp_use_imap_auth
      ) VALUES ($1, $2, $1, 'Support', 'support@example.test', 'imap.example.test', 'support',
        'smtp.example.test', 587, true, 'support', false)
    `, [ACCOUNT_ID, WORKSPACE_ID]);
    await postgres.admin.query(`
      INSERT INTO email_folders (id, workspace_id, source_sqlite_id, account_source_sqlite_id, account_id, path)
      VALUES ($1, $2, $1, $3, $3, 'Drafts')
    `, [FOLDER_ID, WORKSPACE_ID, ACCOUNT_ID]);
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  beforeEach(() => {
    attachmentsRoot = mkdtempSync(join(tmpdir(), 'compose-draft-attachments-'));
  });

  afterEach(() => {
    rmSync(attachmentsRoot, { recursive: true, force: true });
  });

  async function insertDraft(id: number): Promise<void> {
    await postgres.admin.query(`
      INSERT INTO email_messages (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
        account_id, folder_id, uid, subject, body_text, folder_kind
      ) VALUES ($1, $2, $1, $3, $4, $3, $4, $5, 'Entwurf', 'Hallo', 'draft')
    `, [id, WORKSPACE_ID, ACCOUNT_ID, FOLDER_ID, -id]);
  }

  function draftDir(id: number): string {
    return join(attachmentsRoot, WORKSPACE_ID, 'compose-drafts', String(id));
  }

  function directoryUsage(id: number): { files: number; bytes: number } {
    if (!existsSync(draftDir(id))) return { files: 0, bytes: 0 };
    const names = readdirSync(draftDir(id));
    return {
      files: names.length,
      bytes: names.reduce((sum, name) => sum + statSync(join(draftDir(id), name)).size, 0),
    };
  }

  function ageFile(storagePath: string): void {
    const past = new Date(Date.now() - 10 * 60_000);
    utimesSync(join(attachmentsRoot, storagePath), past, past);
  }

  async function upload(draftMessageId: number, bytes: number, filename = 'datei.bin') {
    const port = createPostgresEmailComposeAttachmentUploadPort({ db, attachmentsRoot });
    return port.upload({
      workspaceId: WORKSPACE_ID,
      draftMessageId,
      filename,
      contentBase64: Buffer.alloc(bytes, 7).toString('base64'),
    });
  }

  test('upload stops at the send limits: 50 MB in total and 50 files per draft', async () => {
    await insertDraft(7001);
    const first = await upload(7001, 20 * MB, 'a.bin');
    const second = await upload(7001, 20 * MB, 'b.bin');
    const third = await upload(7001, 20 * MB, 'c.bin');
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(third).toMatchObject({ ok: false, reason: 'quota_exceeded' });
    expect(third.ok ? '' : third.error).toMatch(/50 MB/);
    expect(directoryUsage(7001)).toEqual({ files: 2, bytes: 40 * MB });

    await insertDraft(7002);
    for (let index = 0; index < 50; index += 1) {
      expect((await upload(7002, 1, `f${index}.txt`)).ok).toBe(true);
    }
    const tooMany = await upload(7002, 1, 'f50.txt');
    expect(tooMany).toMatchObject({ ok: false, reason: 'quota_exceeded' });
    expect(tooMany.ok ? '' : tooMany.error).toMatch(/50 Anh/);
    expect(directoryUsage(7002).files).toBe(50);
  });

  test('stale unreferenced uploads do not count and are removed on the next upload', async () => {
    await insertDraft(7003);
    const orphan = await upload(7003, 25 * MB, 'orphan.bin');
    if (!orphan.ok) throw new Error(orphan.error);
    ageFile(orphan.path);

    const first = await upload(7003, 25 * MB, 'first.bin');
    const second = await upload(7003, 25 * MB, 'second.bin');

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(existsSync(join(attachmentsRoot, orphan.path))).toBe(false);
    expect(directoryUsage(7003)).toEqual({ files: 2, bytes: 50 * MB });
  });

  test('removing an attachment from the draft deletes only that draft-local file', async () => {
    await insertDraft(7004);
    const kept = await upload(7004, 10, 'kept.txt');
    const removed = await upload(7004, 10, 'removed.txt');
    if (!kept.ok || !removed.ok) throw new Error('upload failed');
    const foreignPath = `${WORKSPACE_ID}/mail-sync/99/fremd.pdf`;
    mkdirSync(join(attachmentsRoot, WORKSPACE_ID, 'mail-sync', '99'), { recursive: true });
    writeFileSync(join(attachmentsRoot, foreignPath), 'fremd');
    const messages = createPostgresEmailMessageReadPort({ db, attachmentsRoot });

    await messages.updateComposeDraft!({
      workspaceId: WORKSPACE_ID,
      messageId: 7004,
      values: { draftAttachmentPaths: [kept.path, removed.path, foreignPath] },
    });
    ageFile(kept.path);
    ageFile(removed.path);
    ageFile(foreignPath);
    const updated = await messages.updateComposeDraft!({
      workspaceId: WORKSPACE_ID,
      messageId: 7004,
      values: { draftAttachmentPaths: [kept.path] },
    });

    expect(updated).toMatchObject({ ok: true });
    expect(existsSync(join(attachmentsRoot, kept.path))).toBe(true);
    expect(existsSync(join(attachmentsRoot, removed.path))).toBe(false);
    expect(existsSync(join(attachmentsRoot, foreignPath))).toBe(true);
  });

  test('deleting drafts removes their upload directories', async () => {
    await insertDraft(7005);
    await insertDraft(7006);
    await insertDraft(7007);
    for (const id of [7005, 7006, 7007]) {
      expect((await upload(id, 10, 'anhang.txt')).ok).toBe(true);
    }
    const messages = createPostgresEmailMessageReadPort({ db, attachmentsRoot });

    await expect(messages.deleteLocalDraft!({ workspaceId: WORKSPACE_ID, messageId: 7005 }))
      .resolves.toEqual({ ok: true, count: 1 });
    await expect(messages.bulkDeleteLocalDrafts!({ workspaceId: WORKSPACE_ID, messageIds: [7006] }))
      .resolves.toEqual({ ok: true, count: 1 });

    expect(existsSync(draftDir(7005))).toBe(false);
    expect(existsSync(draftDir(7006))).toBe(false);
    expect(existsSync(draftDir(7007))).toBe(true);
  });

  // F-A6-05: Weiterleiten verlor in der Server-Edition alle Anhaenge, weil der Client keine
  // storage_path mehr bekommt; der Server kopiert den gespeicherten Anhang per ID in den Entwurf.
  test('forwarding copies a stored attachment into the draft uploads by attachment id', async () => {
    await insertDraft(7009);
    await postgres.admin.query(`
      INSERT INTO email_messages (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
        account_id, folder_id, uid, subject, body_text, folder_kind
      ) VALUES (7109, $1, 7109, $2, $3, $2, $3, 55, 'Rechnung', 'Anbei', 'inbox')
    `, [WORKSPACE_ID, ACCOUNT_ID, FOLDER_ID]);
    const sourcePath = `${WORKSPACE_ID}/mail-sync/7109/9f00-rechnung.pdf`;
    mkdirSync(join(attachmentsRoot, WORKSPACE_ID, 'mail-sync', '7109'), { recursive: true });
    writeFileSync(join(attachmentsRoot, sourcePath), 'pdf bytes');
    await postgres.admin.query(`
      INSERT INTO email_message_attachments (
        id, workspace_id, source_sqlite_id, message_source_sqlite_id, message_id,
        filename_display, content_type, size_bytes, storage_path
      ) VALUES (7201, $1, 7201, 7109, 7109, 'Rechnung März.pdf', 'application/pdf', 9, $2)
    `, [WORKSPACE_ID, sourcePath]);
    const port = createPostgresEmailComposeAttachmentUploadPort({ db, attachmentsRoot });

    const copied = await port.copyStoredAttachment!({
      workspaceId: WORKSPACE_ID,
      draftMessageId: 7009,
      sourceAttachmentId: 7201,
    });
    const missing = await port.copyStoredAttachment!({
      workspaceId: WORKSPACE_ID,
      draftMessageId: 7009,
      sourceAttachmentId: 999_999,
    });

    // F-A5-13: Umlaute bleiben im Anhangsnamen erhalten.
    expect(copied).toMatchObject({ ok: true, filename: 'Rechnung März.pdf', sizeBytes: 9 });
    if (!copied.ok) throw new Error(copied.error);
    expect(copied.path.startsWith(`${WORKSPACE_ID}/compose-drafts/7009/`)).toBe(true);
    expect(readFileSync(join(attachmentsRoot, copied.path), 'utf8')).toBe('pdf bytes');
    expect(existsSync(join(attachmentsRoot, sourcePath))).toBe(true);
    expect(missing).toMatchObject({ ok: false, reason: 'source_not_found' });
  });

  test('sending a draft removes its upload directory after the draft is marked sent', async () => {
    await insertDraft(7008);
    const attachment = await upload(7008, 10, 'rechnung.pdf');
    if (!attachment.ok) throw new Error(attachment.error);
    const smtpMessages: string[] = [];
    const sender = createPostgresEmailComposeSenderPort({
      db,
      attachmentsRoot,
      secrets: {
        async readSecret() {
          return Buffer.from('smtp-secret');
        },
      } as never,
      smtpSend: async (input) => {
        smtpMessages.push(String(input.rfc822));
      },
      outboundReview: {
        async review() {
          return { allowed: true };
        },
      },
    });

    const result = await sender.send({
      workspaceId: WORKSPACE_ID,
      actorUserId: '20000000-0000-4000-8000-0000000000e6',
      values: {
        accountId: ACCOUNT_ID,
        draftMessageId: 7008,
        to: 'kunde@example.test',
        subject: 'Rechnung',
        bodyText: 'Anbei die Rechnung.',
        attachmentPaths: [attachment.path],
      },
    });

    expect(result).toMatchObject({ ok: true, messageId: 7008 });
    expect(smtpMessages).toHaveLength(1);
    expect(smtpMessages[0]).toContain('rechnung.pdf');
    const row = await postgres.admin.query<{ folder_kind: string }>(
      'SELECT folder_kind FROM email_messages WHERE workspace_id = $1 AND id = 7008',
      [WORKSPACE_ID],
    );
    expect(row.rows[0]?.folder_kind).toBe('sent');
    expect(existsSync(draftDir(7008))).toBe(false);
  });
});
