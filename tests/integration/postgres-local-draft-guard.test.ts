import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Kysely } from 'kysely';

import { createPostgresEmailMessageReadPort } from '../../packages/server/src/db/postgres-mail-read-ports';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000f2';
const ACCOUNT_ID = 641;
const FOLDER_ID = 651;
const POP3_UID_CEILING = -1_000_000;

const POP3_A = 7201;
const POP3_B = 7202;
const SENT_COPY = 7203;
const DRAFT = 7204;

// N-cx-02: Die Entwurfsfunktionen des Servers prueften nur uid < 0. Empfangene POP3-Mails
// (uid <= POP3_UID_CEILING, pop3_uidl gesetzt) und gesendete lokale Kopien liessen sich ueber
// PATCH compose-draft (mail.draft.edit) ueberschreiben und ueber local-draft (mail.delete) endgueltig loeschen.
describe('server local drafts: only real local drafts are edited or deleted', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;
  let attachmentsRoot: string;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('local-draft-guard');
    await postgres.admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Local Draft Guard')`, [WORKSPACE_ID]);
    await postgres.admin.query(`
      INSERT INTO email_accounts (
        id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username, protocol
      ) VALUES ($1, $2, $1, 'POP3', 'pop@example.test', 'pop.example.test', 'pop', 'pop3')
    `, [ACCOUNT_ID, WORKSPACE_ID]);
    await postgres.admin.query(`
      INSERT INTO email_folders (id, workspace_id, source_sqlite_id, account_source_sqlite_id, account_id, path)
      VALUES ($1, $2, $1, $3, $3, 'INBOX')
    `, [FOLDER_ID, WORKSPACE_ID, ACCOUNT_ID]);
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  beforeEach(async () => {
    attachmentsRoot = mkdtempSync(join(tmpdir(), 'local-draft-guard-'));
    await postgres.admin.query(`DELETE FROM email_messages WHERE workspace_id = $1`, [WORKSPACE_ID]);
    const rows: Array<[number, number, string, string | null, string]> = [
      [POP3_A, POP3_UID_CEILING, 'inbox', 'UIDL-A', 'Rechnung A'],
      [POP3_B, POP3_UID_CEILING - 1, 'inbox', 'UIDL-B', 'Rechnung B'],
      [SENT_COPY, -5, 'sent', null, 'Gesendet'],
      [DRAFT, -3, 'draft', null, 'Entwurf'],
    ];
    for (const [id, uid, folderKind, uidl, subject] of rows) {
      await postgres.admin.query(`
        INSERT INTO email_messages (
          id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
          account_id, folder_id, uid, subject, body_text, folder_kind, pop3_uidl
        ) VALUES ($1, $2, $1, $3, $4, $3, $4, $5, $6, 'Inhalt', $7, $8)
      `, [id, WORKSPACE_ID, ACCOUNT_ID, FOLDER_ID, uid, subject, folderKind, uidl]);
    }
  });

  afterEach(() => {
    rmSync(attachmentsRoot, { recursive: true, force: true });
  });

  async function subjectOf(id: number): Promise<string | null | undefined> {
    const r = await postgres.admin.query(`SELECT subject FROM email_messages WHERE id = $1`, [id]);
    return r.rows[0]?.subject;
  }

  test('empfangene POP3-Mails und gesendete Kopien bleiben unveraendert', async () => {
    const messages = createPostgresEmailMessageReadPort({ db, attachmentsRoot });

    for (const id of [POP3_A, SENT_COPY]) {
      await expect(messages.updateComposeDraft!({
        workspaceId: WORKSPACE_ID,
        messageId: id,
        values: { subject: 'ueberschrieben' },
      })).resolves.toMatchObject({ ok: false, reason: 'not_local_draft' });
      await expect(messages.deleteLocalDraft!({ workspaceId: WORKSPACE_ID, messageId: id }))
        .resolves.toMatchObject({ ok: false, reason: 'not_local_draft' });
    }
    await expect(messages.bulkDeleteLocalDrafts!({
      workspaceId: WORKSPACE_ID,
      messageIds: [POP3_A, POP3_B, SENT_COPY],
    })).resolves.toEqual({ ok: true, count: 0 });

    expect(await subjectOf(POP3_A)).toBe('Rechnung A');
    expect(await subjectOf(POP3_B)).toBe('Rechnung B');
    expect(await subjectOf(SENT_COPY)).toBe('Gesendet');
  });

  test('lokale Entwuerfe lassen sich weiter bearbeiten und loeschen', async () => {
    const messages = createPostgresEmailMessageReadPort({ db, attachmentsRoot });

    await expect(messages.updateComposeDraft!({
      workspaceId: WORKSPACE_ID,
      messageId: DRAFT,
      values: { subject: 'Neu' },
    })).resolves.toMatchObject({ ok: true });
    expect(await subjectOf(DRAFT)).toBe('Neu');

    await expect(messages.bulkDeleteLocalDrafts!({
      workspaceId: WORKSPACE_ID,
      messageIds: [DRAFT, POP3_A],
    })).resolves.toEqual({ ok: true, count: 1 });
    expect(await subjectOf(DRAFT)).toBeUndefined();
    expect(await subjectOf(POP3_A)).toBe('Rechnung A');
  });
});
