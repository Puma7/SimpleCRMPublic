import type { Kysely } from 'kysely';

import { createPostgresEmailMessageReadPort } from '../../packages/server/src/db/postgres-mail-read-ports';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000e1';
const ACCOUNT_ID = 501;
const FOLDER_ID = 511;

/**
 * Teilautomatisierung P2: Angehaltene Entwürfe müssen in der Server-Oberfläche
 * als angehalten erscheinen (Grund inklusive) und dürfen nicht unsichtbar
 * „geplant“ hängen bleiben.
 */
describe('Server: angehaltene Entwürfe im Posteingang', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('outbound-hold-visibility');
    const { admin } = postgres;
    await admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Outbound Hold Test')`, [WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_accounts (id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username)
      VALUES ($1, $2, $1, 'Support', 'support@example.test', 'imap.example.test', 'support')
    `, [ACCOUNT_ID, WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_folders (id, workspace_id, source_sqlite_id, account_source_sqlite_id, account_id, path)
      VALUES ($1, $2, $1, $3, $3, 'INBOX')
    `, [FOLDER_ID, WORKSPACE_ID, ACCOUNT_ID]);
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  async function seedDraft(draftId: number, fields: { hold: boolean; reason: string | null }): Promise<void> {
    await postgres.admin.query(`
      INSERT INTO email_messages (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
        account_id, folder_id, uid, folder_kind, subject, to_json, body_text, outbound_hold, outbound_block_reason
      ) VALUES ($1, $2, $1, $3, $4, $3, $4, $5, 'draft', 'Re: Frage', $6::jsonb, 'Antwort', $7, $8)
    `, [
      draftId,
      WORKSPACE_ID,
      ACCOUNT_ID,
      FOLDER_ID,
      -draftId,
      JSON.stringify({ value: [{ address: `kunde${draftId}@example.com` }] }),
      fields.hold,
      fields.reason,
    ]);
  }

  test('Posteingang und Einzelabruf liefern outboundHold und den Grund', async () => {
    await seedDraft(5101, { hold: true, reason: 'Preisangabe fehlt' });
    const port = createPostgresEmailMessageReadPort({ db });

    const inbox = await port.list({ workspaceId: WORKSPACE_ID, view: 'inbox', limit: 50 });
    const row = inbox.items.find((item) => item.id === 5101);
    expect(row).toEqual(expect.objectContaining({ outboundHold: true, outboundBlockReason: 'Preisangabe fehlt' }));

    const single = await port.get({ workspaceId: WORKSPACE_ID, id: 5101, includeBody: true });
    expect(single).toEqual(expect.objectContaining({ outboundHold: true, outboundBlockReason: 'Preisangabe fehlt' }));
  });
});
