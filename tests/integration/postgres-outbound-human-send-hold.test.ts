import type { Kysely } from 'kysely';

import { createPostgresEmailMessageReadPort } from '../../packages/server/src/db/postgres-mail-read-ports';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { createPostgresEmailComposeSenderPort } from '../../packages/server/src/mail-compose-send';
import { createPostgresWorkflowExecutionJobPort } from '../../packages/server/src/workflow-execution';
import { OUTBOUND_WARNING_MARKER } from '../../packages/core/src/email';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000f1';
const USER_ID = '20000000-0000-4000-8000-0000000000f1';
const ACCOUNT_ID = 901;
const FOLDER_ID = 911;
const OUTBOUND_WORKFLOW_ID = 931;

/**
 * Teilautomatisierung P2 (Härtung): Sendet ein Mensch auf dem Server und
 * blockt der synchrone Dry-Run der Ausgangs-Workflows, bleibt der Entwurf wie
 * auf dem Desktop endgültig angehalten (Hinweis mit Grund, Posteingang) — die
 * Antwort an die Oberfläche bleibt ein Fehler mit Grund.
 */
describe('Server: Mensch sendet, Ausgang blockt synchron', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('outbound-human-send-hold');
    const { admin } = postgres;
    await admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Human Send Hold Test')`, [WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO users (id, workspace_id, email, display_name, password_hash, role)
      VALUES ($1, $2, 'anna@example.test', 'Anna Beispiel', 'x', 'user')
    `, [USER_ID, WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_accounts (
        id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username,
        smtp_host, smtp_port, smtp_tls, smtp_username, smtp_use_imap_auth
      ) VALUES ($1, $2, $1, 'Support', 'support@example.test', 'imap.example.test', 'support',
        'smtp.example.test', 587, true, 'support', false)
    `, [ACCOUNT_ID, WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_folders (id, workspace_id, source_sqlite_id, account_source_sqlite_id, account_id, path)
      VALUES ($1, $2, $1, $3, $3, 'INBOX')
    `, [FOLDER_ID, WORKSPACE_ID, ACCOUNT_ID]);
    const graph = {
      version: 1,
      nodes: [
        { id: 'trigger-1', type: 'trigger', data: { kind: 'outbound' } },
        { id: 'hold', type: 'registry', data: { nodeType: 'email.hold_outbound', config: { reason: 'Preisangabe prüfen' } } },
      ],
      edges: [{ id: 'edge-1', source: 'trigger-1', target: 'hold' }],
    };
    await admin.query(`
      INSERT INTO email_workflows (
        id, workspace_id, source_sqlite_id, name, trigger_name, enabled, priority,
        definition_json, graph_json, execution_mode, engine_version
      ) VALUES ($1, $2, $1, 'Preisprüfung', 'outbound', true, 50, '{}'::jsonb, $3::jsonb, 'graph', 1)
    `, [OUTBOUND_WORKFLOW_ID, WORKSPACE_ID, JSON.stringify(graph)]);
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  test('Entwurf bleibt mit Grund im Posteingang, Antwort ist ein Fehler mit Grund', async () => {
    await postgres.admin.query(`
      INSERT INTO email_messages (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
        account_id, folder_id, uid, folder_kind, subject, to_json, body_text, body_html
      ) VALUES (9101, $1, 9101, $2, $3, $2, $3, -9101, 'draft', 'Angebot', $4::jsonb,
        'Das kostet 100 Euro.', '<p>Das kostet 100 Euro.</p>')
    `, [WORKSPACE_ID, ACCOUNT_ID, FOLDER_ID, JSON.stringify({ value: [{ address: 'kunde@example.com' }] })]);
    const smtpSend = jest.fn(async () => undefined);
    const execution = createPostgresWorkflowExecutionJobPort({ db });
    const sender = createPostgresEmailComposeSenderPort({
      db,
      secrets: { async readSecret() { return Buffer.from('smtp-secret'); } } as never,
      smtpSend,
      workflowDryRun: (plan) => execution.dryRun!(plan),
    });

    const result = await sender.send({
      workspaceId: WORKSPACE_ID,
      actorUserId: USER_ID,
      values: {
        accountId: ACCOUNT_ID,
        draftMessageId: 9101,
        subject: 'Angebot',
        bodyText: 'Das kostet 100 Euro.',
        bodyHtml: '<p>Das kostet 100 Euro.</p>',
        to: 'kunde@example.com',
      },
    });

    expect(result).toEqual(expect.objectContaining({ ok: false, error: 'Preisangabe prüfen' }));
    expect(smtpSend).not.toHaveBeenCalled();
    const row = await postgres.admin.query(`
      SELECT folder_kind, outbound_hold, outbound_block_reason, body_text, scheduled_send_at
      FROM email_messages WHERE workspace_id = $1 AND id = 9101
    `, [WORKSPACE_ID]);
    expect(row.rows[0]).toEqual(expect.objectContaining({
      folder_kind: 'draft',
      outbound_hold: true,
      outbound_block_reason: 'Preisangabe prüfen',
      scheduled_send_at: null,
    }));
    expect(String(row.rows[0].body_text)).toContain(OUTBOUND_WARNING_MARKER);
    expect(String(row.rows[0].body_text)).toContain('Das kostet 100 Euro.');

    const inbox = await createPostgresEmailMessageReadPort({ db }).list({
      workspaceId: WORKSPACE_ID,
      view: 'inbox',
      limit: 50,
    });
    expect(inbox.items.find((item) => item.id === 9101)).toEqual(expect.objectContaining({
      outboundHold: true,
      outboundBlockReason: 'Preisangabe prüfen',
    }));
    // Kein asynchroner Prüflauf: der Block ist endgültig.
    const jobs = await postgres.admin.query(
      `SELECT 1 FROM job_queue WHERE workspace_id = $1 AND type = 'workflow.execute'`,
      [WORKSPACE_ID],
    );
    expect(jobs.rows).toHaveLength(0);
  });
});
