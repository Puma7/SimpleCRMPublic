import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Kysely } from 'kysely';

import { createPostgresEmailMessageReadPort } from '../../packages/server/src/db/postgres-mail-read-ports';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000e7';
const SERVICE_ACCOUNT_ID = 621;
const SALES_ACCOUNT_ID = 622;

// F-A11a-04: Ein Kontowechsel im Verfasser legte einen neuen, leeren Entwurf im
// Zielkonto an; der alte Entwurf mit Empfaengern, Text und Anhaengen blieb im
// alten Konto zurueck. PATCH compose-draft haengt den Entwurf jetzt um.
describe('server compose draft: move to another account', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;
  let attachmentsRoot: string;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('compose-draft-account-move');
    await postgres.admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Compose Draft Account Move')`, [WORKSPACE_ID]);
    for (const [id, name, address] of [
      [SERVICE_ACCOUNT_ID, 'Service', 'service@example.test'],
      [SALES_ACCOUNT_ID, 'Vertrieb', 'vertrieb@example.test'],
    ] as const) {
      await postgres.admin.query(`
        INSERT INTO email_accounts (
          id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username,
          smtp_host, smtp_port, smtp_tls, smtp_username, smtp_use_imap_auth
        ) VALUES ($1, $2, $1, $3, $4, 'imap.example.test', $4, 'smtp.example.test', 587, true, $4, false)
      `, [id, WORKSPACE_ID, name, address]);
    }
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  beforeEach(() => {
    attachmentsRoot = mkdtempSync(join(tmpdir(), 'compose-draft-account-move-'));
  });

  afterEach(() => {
    rmSync(attachmentsRoot, { recursive: true, force: true });
  });

  async function createFilledDraft(messages: ReturnType<typeof createPostgresEmailMessageReadPort>) {
    const created = await messages.createComposeDraft({
      workspaceId: WORKSPACE_ID,
      accountId: SERVICE_ACCOUNT_ID,
      values: { accountId: SERVICE_ACCOUNT_ID },
    });
    if (!created.ok) throw new Error(created.reason);
    const draftId = created.message.id;
    const attachmentPath = `${WORKSPACE_ID}/compose-drafts/${draftId}/ab12-angebot.pdf`;
    mkdirSync(join(attachmentsRoot, WORKSPACE_ID, 'compose-drafts', String(draftId)), { recursive: true });
    writeFileSync(join(attachmentsRoot, attachmentPath), 'pdf');
    const filled = await messages.updateComposeDraft({
      workspaceId: WORKSPACE_ID,
      messageId: draftId,
      values: {
        subject: 'Angebot Mai',
        bodyText: 'Hallo Frau Muster',
        toJson: { value: [{ address: 'kunde@example.test' }] },
        draftAttachmentPaths: [attachmentPath],
      },
    });
    if (!filled.ok) throw new Error(filled.reason);
    return { draftId, attachmentPath };
  }

  test('moves the draft with its content and attachments to the target account', async () => {
    const messages = createPostgresEmailMessageReadPort({ db, attachmentsRoot });
    const { draftId, attachmentPath } = await createFilledDraft(messages);
    const before = await postgres.admin.query<{ draft_attachment_paths_json: unknown }>(
      `SELECT draft_attachment_paths_json FROM email_messages WHERE id = $1`,
      [draftId],
    );
    expect(String(before.rows[0]!.draft_attachment_paths_json)).toContain(attachmentPath);

    const moved = await messages.updateComposeDraft({
      workspaceId: WORKSPACE_ID,
      messageId: draftId,
      values: { accountId: SALES_ACCOUNT_ID },
    });

    expect(moved).toMatchObject({ ok: true, message: { id: draftId, accountId: SALES_ACCOUNT_ID, subject: 'Angebot Mai' } });
    const row = await postgres.admin.query<{
      account_id: string;
      account_source_sqlite_id: string;
      uid: string;
      folder_kind: string;
      from_address: string;
      to_address: string;
      body_text: string;
      draft_attachment_paths_json: unknown;
      folder_account_id: string;
    }>(`
      SELECT m.account_id, m.account_source_sqlite_id, m.uid, m.folder_kind,
        m.from_json->'value'->0->>'address' AS from_address,
        m.to_json->'value'->0->>'address' AS to_address,
        m.body_text, m.draft_attachment_paths_json, f.account_id AS folder_account_id
      FROM email_messages m JOIN email_folders f ON f.id = m.folder_id
      WHERE m.id = $1
    `, [draftId]);
    expect(row.rows[0]).toMatchObject({
      account_id: String(SALES_ACCOUNT_ID),
      account_source_sqlite_id: String(SALES_ACCOUNT_ID),
      folder_kind: 'draft',
      from_address: 'vertrieb@example.test',
      to_address: 'kunde@example.test',
      body_text: 'Hallo Frau Muster',
      draft_attachment_paths_json: before.rows[0]!.draft_attachment_paths_json,
      folder_account_id: String(SALES_ACCOUNT_ID),
    });
    expect(Number(row.rows[0]!.uid)).toBeLessThan(0);
    expect(existsSync(join(attachmentsRoot, attachmentPath))).toBe(true);
    const leftovers = await postgres.admin.query(
      `SELECT id FROM email_messages WHERE workspace_id = $1 AND account_id = $2 AND folder_kind = 'draft'`,
      [WORKSPACE_ID, SERVICE_ACCOUNT_ID],
    );
    expect(leftovers.rows).toEqual([]);
  });

  test('rejects an unknown target account and leaves the draft untouched', async () => {
    const messages = createPostgresEmailMessageReadPort({ db, attachmentsRoot });
    const { draftId } = await createFilledDraft(messages);

    const result = await messages.updateComposeDraft({
      workspaceId: WORKSPACE_ID,
      messageId: draftId,
      values: { accountId: 9999 },
    });

    expect(result).toEqual({ ok: false, reason: 'account_not_found' });
    const row = await postgres.admin.query<{ account_id: string; subject: string }>(
      `SELECT account_id, subject FROM email_messages WHERE id = $1`,
      [draftId],
    );
    expect(row.rows[0]).toEqual({ account_id: String(SERVICE_ACCOUNT_ID), subject: 'Angebot Mai' });
  });
});
