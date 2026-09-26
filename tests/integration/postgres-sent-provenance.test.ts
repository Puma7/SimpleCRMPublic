import type { Kysely } from 'kysely';

import { createPostgresEmailMessageReadPort } from '../../packages/server/src/db/postgres-mail-read-ports';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { withWorkspaceTransaction } from '../../packages/server/src/db/workspace-context';
import { createPostgresEmailComposeSenderPort } from '../../packages/server/src/mail-compose-send';
import { markDraftOrigin } from '../../packages/server/src/mail-sent-provenance';
import { createPostgresRelaySubmissionStore } from '../../packages/server/src/relay-submission';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000e4';
const USER_ID = '20000000-0000-4000-8000-0000000000e4';
const ACCOUNT_ID = 801;
const FOLDER_ID = 811;
const WORKFLOW_ID = 831;
const RELAY_ID = '30000000-0000-4000-8000-0000000000e4';

/**
 * Teilautomatisierung P3 (Server): Migration 0055 und die Bestimmung von
 * „gesendet von“ beim Übergang zu folder_kind 'sent' — Mensch, unveränderter
 * KI-Entwurf, bearbeiteter KI-Entwurf, Workflow ohne Menschen, Relay,
 * übersprungene Ausgangsprüfung. RLS über die Anwendungsrolle.
 */
describe('Server: Kennzeichnung „gesendet von“', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('sent-provenance');
    const { admin } = postgres;
    await admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Sent Provenance Test')`, [WORKSPACE_ID]);
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
    await admin.query(`
      INSERT INTO email_workflows (
        id, workspace_id, source_sqlite_id, name, trigger_name, enabled, priority,
        definition_json, graph_json, execution_mode, engine_version
      ) VALUES ($1, $2, $1, 'KI-Antwort', 'inbound', true, 50, '{}'::jsonb, NULL, 'graph', 1)
    `, [WORKFLOW_ID, WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO smtp_relays (id, workspace_id, label) VALUES ($1, $2, 'Shop-System')
    `, [RELAY_ID, WORKSPACE_ID]);
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  async function seedDraft(draftId: number): Promise<void> {
    await postgres.admin.query(`
      INSERT INTO email_messages (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
        account_id, folder_id, uid, folder_kind, subject, to_json, body_text
      ) VALUES ($1, $2, $1, $3, $4, $3, $4, $5, 'draft', 'Re: Frage', $6::jsonb, 'Antwort')
    `, [draftId, WORKSPACE_ID, ACCOUNT_ID, FOLDER_ID, -draftId, JSON.stringify({ value: [{ address: 'kunde@example.com' }] })]);
  }

  async function markOrigin(draftId: number, kind: 'ai' | 'workflow'): Promise<void> {
    await withWorkspaceTransaction(db, { workspaceId: WORKSPACE_ID, role: 'system' }, async (trx) => {
      await markDraftOrigin(trx, { workspaceId: WORKSPACE_ID, draftId, kind, workflowId: WORKFLOW_ID });
    });
  }

  async function send(draftId: number, actor: { actorUserId: string; trustedService?: boolean }) {
    const sender = createPostgresEmailComposeSenderPort({
      db,
      secrets: { async readSecret() { return Buffer.from('smtp-secret'); } } as never,
      smtpSend: jest.fn(async () => undefined),
    });
    const result = await sender.send({
      workspaceId: WORKSPACE_ID,
      actorUserId: actor.actorUserId,
      ...(actor.trustedService ? { trustedService: true } : {}),
      values: { accountId: ACCOUNT_ID, draftMessageId: draftId, subject: 'Re: Frage', bodyText: 'Antwort', to: 'kunde@example.com' },
    });
    expect(result.ok).toBe(true);
  }

  async function sentBy(id: number) {
    const rows = await postgres.admin.query(`
      SELECT folder_kind, sent_by_kind, sent_by_user_id, sent_by_workflow_id::int AS sent_by_workflow_id,
        sent_by_label, sent_outbound_review_skipped
      FROM email_messages WHERE workspace_id = $1 AND id = $2
    `, [WORKSPACE_ID, id]);
    return rows.rows[0];
  }

  test('Migration 0055: Spalten mit Standardwerten und geprüften Werten', async () => {
    await seedDraft(8100);
    const row = await postgres.admin.query(`
      SELECT draft_origin_kind, draft_origin_edited, sent_by_kind, sent_outbound_review_skipped
      FROM email_messages WHERE id = 8100
    `);
    expect(row.rows[0]).toEqual({
      draft_origin_kind: null,
      draft_origin_edited: false,
      sent_by_kind: null,
      sent_outbound_review_skipped: false,
    });
    await expect(postgres.admin.query(`UPDATE email_messages SET sent_by_kind = 'robot' WHERE id = 8100`))
      .rejects.toThrow(/email_messages_sent_by_kind_check/);
    await expect(postgres.admin.query(`UPDATE email_messages SET draft_origin_kind = 'human' WHERE id = 8100`))
      .rejects.toThrow(/email_messages_draft_origin_kind_check/);
  });

  test('Mensch sendet eigenen Entwurf ⇒ human mit Anzeigename', async () => {
    await seedDraft(8101);
    await send(8101, { actorUserId: USER_ID });
    expect(await sentBy(8101)).toEqual({
      folder_kind: 'sent',
      sent_by_kind: 'human',
      sent_by_user_id: USER_ID,
      sent_by_workflow_id: null,
      sent_by_label: 'Anna Beispiel',
      sent_outbound_review_skipped: false,
    });
  });

  test('Mensch sendet unveränderten KI-Entwurf ⇒ ai_approved; nach Bearbeitung ⇒ human', async () => {
    await seedDraft(8102);
    await markOrigin(8102, 'ai');
    await send(8102, { actorUserId: USER_ID });
    expect(await sentBy(8102)).toMatchObject({ sent_by_kind: 'ai_approved', sent_by_workflow_id: WORKFLOW_ID, sent_by_label: 'Anna Beispiel' });

    await seedDraft(8103);
    await markOrigin(8103, 'ai');
    const edited = await createPostgresEmailMessageReadPort({ db }).updateComposeDraft!({
      workspaceId: WORKSPACE_ID,
      messageId: 8103,
      values: { bodyText: 'Antwort, von Anna ergänzt' },
    });
    expect(edited.ok).toBe(true);
    await send(8103, { actorUserId: USER_ID });
    expect(await sentBy(8103)).toMatchObject({ sent_by_kind: 'human', sent_by_workflow_id: null });

    // Das Entwurfsfenster speichert vor dem Senden alle Felder — ohne echte
    // Änderung (nur HTML-Absätze, Empfängername) bleibt es „KI · freigegeben“.
    await seedDraft(8107);
    await markOrigin(8107, 'ai');
    const saved = await createPostgresEmailMessageReadPort({ db }).updateComposeDraft!({
      workspaceId: WORKSPACE_ID,
      messageId: 8107,
      values: {
        subject: 'Re: Frage',
        bodyText: 'Antwort',
        bodyHtml: '<p>Antwort</p>',
        toJson: { value: [{ address: 'kunde@example.com', name: 'Kunde' }] },
        ccJson: null,
        bccJson: null,
        draftAttachmentPaths: [],
      },
    });
    expect(saved.ok).toBe(true);
    const flag = await postgres.admin.query(`SELECT draft_origin_edited FROM email_messages WHERE id = 8107`);
    expect(flag.rows[0]).toEqual({ draft_origin_edited: false });
    await send(8107, { actorUserId: USER_ID });
    expect(await sentBy(8107)).toMatchObject({ sent_by_kind: 'ai_approved', sent_by_label: 'Anna Beispiel' });
  });

  test('Workflow ohne Menschen sendet KI-Entwurf ⇒ ai_auto; Workflow-Entwurf ⇒ workflow', async () => {
    await seedDraft(8104);
    await markOrigin(8104, 'ai');
    await send(8104, { actorUserId: 'system', trustedService: true });
    expect(await sentBy(8104)).toEqual({
      folder_kind: 'sent',
      sent_by_kind: 'ai_auto',
      sent_by_user_id: null,
      sent_by_workflow_id: WORKFLOW_ID,
      sent_by_label: 'Workflow „KI-Antwort“',
      sent_outbound_review_skipped: false,
    });

    await seedDraft(8105);
    await markOrigin(8105, 'workflow');
    await send(8105, { actorUserId: 'system', trustedService: true });
    expect(await sentBy(8105)).toMatchObject({ sent_by_kind: 'workflow', sent_by_label: 'Workflow „KI-Antwort“' });
  });

  test('übersprungene Ausgangsprüfung wird nur bei passendem Freigabe-Marker gekennzeichnet', async () => {
    await seedDraft(8106);
    await postgres.admin.query(`
      INSERT INTO sync_info (workspace_id, key, value, last_updated) VALUES
        ($1, 'outbound_review_skipped:8106', 'm1', now())
    `, [WORKSPACE_ID]);
    // Kein Freigabe-Marker mehr (z. B. nach einer Änderung verworfen): nicht übersprungen.
    await send(8106, { actorUserId: USER_ID });
    expect(await sentBy(8106)).toMatchObject({ sent_outbound_review_skipped: false });
    const leftover = await postgres.admin.query(
      `SELECT 1 FROM sync_info WHERE workspace_id = $1 AND key = 'outbound_review_skipped:8106'`,
      [WORKSPACE_ID],
    );
    expect(leftover.rows).toHaveLength(0);
  });

  test('SMTP-Relay-Zeilen tragen relay und den Namen des Relays', async () => {
    const store = createPostgresRelaySubmissionStore({ db });
    const result = await store.persistMessage({
      workspaceId: WORKSPACE_ID,
      relayId: RELAY_ID,
      credentialId: null,
      accountId: ACCOUNT_ID,
      accountSourceSqliteId: ACCOUNT_ID,
      messageIdHeader: '<relay-1@shop.example>',
      dedupKey: '<relay-1@shop.example>',
      subject: 'Ihre Rechnung',
      inReplyTo: null,
      referencesHeader: null,
      fromJson: { value: [{ address: 'support@example.test' }] },
      toJson: { value: [{ address: 'kunde@example.com' }] },
      ccJson: null,
      bccJson: null,
      bodyText: 'Rechnung anbei',
      bodyHtml: null,
      snippet: 'Rechnung anbei',
      hasAttachments: false,
      attachmentsJson: null,
      recipientCount: 1,
      firstRecipient: 'kunde@example.com',
      trackingApplied: false,
      trackingRuleReason: null,
    });
    expect(result).toMatchObject({ alreadyRelayed: false });
    if (!('messageId' in result) || result.messageId === null) throw new Error('keine Relay-Zeile');
    expect(await sentBy(result.messageId)).toMatchObject({
      folder_kind: 'sent',
      sent_by_kind: 'relay',
      sent_by_label: 'Shop-System',
    });
  });

  test('Ansicht „Gesendet (KI)“: nur KI/Automatik, auch in der Suche; Liste trägt die Kennzeichnung', async () => {
    // Läuft nach den Versand-Tests: 8101 human, 8102 ai_approved, 8103 human,
    // 8107 ai_approved, 8104 ai_auto, 8105 workflow, 8106 human, Relay-Zeile relay.
    const port = createPostgresEmailMessageReadPort({ db });
    const listed = await port.list({ workspaceId: WORKSPACE_ID, view: 'sent_ai', limit: 50 });
    expect(listed.items.map((item) => item.id).sort()).toEqual([8102, 8104, 8105, 8107]);
    expect(listed.items.find((item) => item.id === 8104)).toEqual(expect.objectContaining({
      sentByKind: 'ai_auto',
      sentByLabel: 'Workflow „KI-Antwort“',
      sentOutboundReviewSkipped: false,
    }));

    const all = await port.list({ workspaceId: WORKSPACE_ID, view: 'sent', limit: 50 });
    expect(all.items.length).toBeGreaterThan(listed.items.length);
    expect(all.items.find((item) => item.id === 8101)).toEqual(expect.objectContaining({ sentByKind: 'human' }));

    const searched = await port.list({ workspaceId: WORKSPACE_ID, view: 'sent_ai', search: 'Frage', limit: 50 });
    expect(searched.items.map((item) => item.id).sort()).toEqual([8102, 8104, 8105, 8107]);
  });
});
