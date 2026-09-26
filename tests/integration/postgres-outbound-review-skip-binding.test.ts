import type { Kysely } from 'kysely';

import { createServerApi } from '../../packages/server/src/api/server-api';
import type { AuthenticatedPrincipal, ServerApiPorts } from '../../packages/server/src/api/types';
import { createPostgresAuditPort } from '../../packages/server/src/db/postgres-audit-port';
import { createPostgresEmailMessageReadPort } from '../../packages/server/src/db/postgres-mail-read-ports';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { createPostgresEmailComposeSenderPort } from '../../packages/server/src/mail-compose-send';
import { createPostgresOutboundReviewSkipPort } from '../../packages/server/src/mail-outbound-review-skip';
import { createPostgresWorkflowExecutionJobPort } from '../../packages/server/src/workflow-execution';
import { OUTBOUND_WARNING_MARKER } from '../../packages/core/src/email';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000f5';
const USER_ID = '20000000-0000-4000-8000-0000000000f5';
const ACCOUNT_ID = 961;
const FOLDER_ID = 962;
const OUTBOUND_WORKFLOW_ID = 963;
const CHANGED_MESSAGE =
  'Der Entwurf wurde nach dem Anhalten geändert. Bitte normal senden – die Ausgangsprüfung prüft dann den neuen Inhalt.';

/**
 * Sicherheits-Review B3/B4: „Ohne Ausgangsprüfung senden“ gilt nur für den
 * unveränderten, angehaltenen Inhalt. Beim endgültigen Anhalten wird dessen
 * Fingerprint gespeichert; der Skip vergleicht unter Sperre. Bearbeitet
 * (auch nur im HTML, z. B. ein Link-Ziel) oder Altbestand ohne Fingerprint ⇒
 * 409, kein Versand; unverändert — auch nach dem Speichern durch das
 * Entwurfsfenster, das das HTML umformatiert — ⇒ versendet.
 */
describe('Server: „Ohne Ausgangsprüfung senden“ nur für den angehaltenen Inhalt', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('outbound-review-skip-binding');
    const { admin } = postgres;
    await admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Skip Binding Test')`, [WORKSPACE_ID]);
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

  function composeSender(smtpSend: jest.Mock) {
    const execution = createPostgresWorkflowExecutionJobPort({ db });
    return createPostgresEmailComposeSenderPort({
      db,
      secrets: { async readSecret() { return Buffer.from('smtp-secret'); } } as never,
      smtpSend,
      workflowDryRun: (plan) => execution.dryRun!(plan),
    });
  }

  function api(smtpSend: jest.Mock) {
    return createServerApi({
      auth: {} as ServerApiPorts['auth'],
      locks: {} as ServerApiPorts['locks'],
      mailAccess: {
        async assertPermission() { return undefined; },
        async resolveScope() { return { kind: 'all' }; },
      },
      mailResourceLookup: {
        async resolve(input: { target: { kind: string; id?: number } }) {
          return input.target.kind === 'message'
            ? [{ type: 'message', accountId: String(ACCOUNT_ID), messageId: String(input.target.id) }]
            : [];
        },
      },
      emailOutboundReviewSkip: createPostgresOutboundReviewSkipPort({ db }),
      emailComposeSender: composeSender(smtpSend),
      audit: createPostgresAuditPort({ db }),
    } as unknown as ServerApiPorts);
  }

  const principal = { userId: USER_ID, workspaceId: WORKSPACE_ID, role: 'user', capabilities: ['crm.write'] } as AuthenticatedPrincipal;

  /** Ein Mensch sendet, der Ausgangs-Workflow hält den Entwurf endgültig an. */
  async function heldDraft(id: number): Promise<void> {
    await postgres.admin.query(`
      INSERT INTO email_messages (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
        account_id, folder_id, uid, folder_kind, subject, to_json, body_text, body_html
      ) VALUES ($1, $2, $1, $3, $4, $3, $4, $5, 'draft', 'Angebot', $6::jsonb,
        'Das kostet 100 € &amp; mehr. Angebot', '<p>Das kostet 100 € &amp; mehr. <a href="https://shop.example.test/a">Angebot</a></p>')
    `, [id, WORKSPACE_ID, ACCOUNT_ID, FOLDER_ID, -id, JSON.stringify({ value: [{ address: 'kunde@example.com' }] })]);
    const result = await composeSender(jest.fn()).send({
      workspaceId: WORKSPACE_ID,
      actorUserId: USER_ID,
      values: {
        accountId: ACCOUNT_ID,
        draftMessageId: id,
        subject: 'Angebot',
        // Textteil wie vom Entwurfsfenster aus dem HTML gewonnen (Entitäten bleiben).
        bodyText: 'Das kostet 100 € &amp; mehr. Angebot',
        bodyHtml: '<p>Das kostet 100 € &amp; mehr. <a href="https://shop.example.test/a">Angebot</a></p>',
        to: 'kunde@example.com',
      },
    });
    expect(result).toEqual(expect.objectContaining({ ok: false, error: 'Preisangabe prüfen' }));
  }

  async function row(id: number) {
    const rows = await postgres.admin.query<{
      folder_kind: string;
      outbound_hold: boolean;
      body_text: string;
      body_html: string;
      sent_outbound_review_skipped: boolean;
    }>(`SELECT folder_kind, outbound_hold, body_text, body_html, sent_outbound_review_skipped
        FROM email_messages WHERE workspace_id = $1 AND id = $2`, [WORKSPACE_ID, id]);
    return rows.rows[0]!;
  }

  async function skip(id: number, smtpSend: jest.Mock) {
    return api(smtpSend).handle({
      method: 'POST',
      path: `/api/v1/email/messages/${id}/send-skip-outbound-review`,
      principal,
    });
  }

  async function saveLikeComposeWindow(id: number, values: Record<string, unknown>) {
    // Das Fenster zeigt und speichert den gespeicherten Betreff (ggf. mit Ticket).
    const stored = await postgres.admin.query<{ subject: string }>(
      'SELECT subject FROM email_messages WHERE workspace_id = $1 AND id = $2',
      [WORKSPACE_ID, id],
    );
    const saved = await createPostgresEmailMessageReadPort({ db }).updateComposeDraft!({
      workspaceId: WORKSPACE_ID,
      messageId: id,
      values: {
        subject: stored.rows[0]!.subject,
        toJson: { value: [{ address: 'kunde@example.com', name: 'Kunde' }] },
        ccJson: null,
        bccJson: null,
        draftAttachmentPaths: [],
        ...values,
      },
    });
    expect(saved.ok).toBe(true);
  }

  // Wie das Entwurfsfenster nach dem Öffnen speichert: der Hinweis-Block wird
  // zum Absatz, Text ohne Zeilenumbrüche, Entitäten unverändert.
  const composeBanner = `<p><strong>${OUTBOUND_WARNING_MARKER}</strong><br>Preisangabe prüfen<br><em>Bitte E-Mail prüfen, korrigieren und erneut senden.</em></p>`;
  const composeText = (body: string) =>
    `${OUTBOUND_WARNING_MARKER} Preisangabe prüfen Bitte E-Mail prüfen, korrigieren und erneut senden. ${body}`;

  test('unverändert (auch nach dem Speichern im Entwurfsfenster) ⇒ versendet', async () => {
    await heldDraft(9601);
    const direct = jest.fn(async () => undefined);
    expect((await skip(9601, direct)).status).toBe(200);
    expect(direct).toHaveBeenCalledTimes(1);
    expect(await row(9601)).toEqual(expect.objectContaining({ folder_kind: 'sent', sent_outbound_review_skipped: true }));

    await heldDraft(9602);
    await saveLikeComposeWindow(9602, {
      bodyText: composeText('Das kostet 100 € &amp; mehr. Angebot'),
      bodyHtml: `${composeBanner}<p>Das kostet 100 € &amp; mehr. <a href="https://shop.example.test/a" target="_blank" rel="noopener">Angebot</a></p>`,
    });
    const smtpSend = jest.fn(async () => undefined);
    const response = await skip(9602, smtpSend);
    expect(response.status).toBe(200);
    expect(smtpSend).toHaveBeenCalledTimes(1);
    const sent = await row(9602);
    expect(sent.folder_kind).toBe('sent');
    // Der vom Fenster zum Absatz umgeformte Hinweis geht nicht mit hinaus.
    const rfc822 = String((smtpSend.mock.calls[0] as unknown as [{ rfc822: string }])[0].rfc822);
    expect(rfc822).not.toContain('AUSGANGSPR');
    expect(rfc822).not.toContain('erneut senden');
    expect(sent.body_text).not.toContain('AUSGANGSPR');
    expect(sent.body_text).toContain('Das kostet 100');
  });

  test('nach dem Anhalten bearbeitet ⇒ 409, kein Versand, Entwurf bleibt angehalten', async () => {
    await heldDraft(9603);
    await saveLikeComposeWindow(9603, {
      bodyText: composeText('Das kostet 90 € & mehr. Angebot'),
      bodyHtml: `${composeBanner}<p>Das kostet 90 € &amp; mehr. <a href="https://shop.example.test/a">Angebot</a></p>`,
    });
    const smtpSend = jest.fn(async () => undefined);
    const response = await skip(9603, smtpSend);
    expect(response.status).toBe(409);
    expect(response.body).toEqual(expect.objectContaining({
      error: expect.objectContaining({ code: 'email_draft_changed_since_hold', message: CHANGED_MESSAGE }),
    }));
    expect(smtpSend).not.toHaveBeenCalled();
    expect(await row(9603)).toEqual(expect.objectContaining({ folder_kind: 'draft', outbound_hold: true }));
    const audit = await postgres.admin.query(
      `SELECT 1 FROM audit_events WHERE workspace_id = $1 AND entity_id = '9603'`,
      [WORKSPACE_ID],
    );
    expect(audit.rows).toHaveLength(0);
  });

  test('nur das HTML geändert (Link-Ziel) oder nur der Text ⇒ 409', async () => {
    await heldDraft(9604);
    await saveLikeComposeWindow(9604, {
      bodyText: composeText('Das kostet 100 € &amp; mehr. Angebot'),
      bodyHtml: `${composeBanner}<p>Das kostet 100 € &amp; mehr. <a href="https://phish.example.test/a">Angebot</a></p>`,
    });
    const smtpSend = jest.fn(async () => undefined);
    expect((await skip(9604, smtpSend)).status).toBe(409);

    await heldDraft(9605);
    // API-Client ändert nur den Textteil, das HTML bleibt.
    await createPostgresEmailMessageReadPort({ db }).updateComposeDraft!({
      workspaceId: WORKSPACE_ID,
      messageId: 9605,
      values: { bodyText: 'Das kostet 1 € & mehr.' },
    });
    expect((await skip(9605, smtpSend)).status).toBe(409);
    expect(smtpSend).not.toHaveBeenCalled();
  });

  test('Altbestand: angehalten ohne gespeicherten Fingerprint ⇒ 409', async () => {
    await postgres.admin.query(`
      INSERT INTO email_messages (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
        account_id, folder_id, uid, folder_kind, subject, to_json, body_text, outbound_hold, outbound_block_reason
      ) VALUES (9606, $1, 9606, $2, $3, $2, $3, -9606, 'draft', 'Alt', $4::jsonb, 'Alter Text', true, 'Preisangabe prüfen')
    `, [WORKSPACE_ID, ACCOUNT_ID, FOLDER_ID, JSON.stringify({ value: [{ address: 'kunde@example.com' }] })]);
    const smtpSend = jest.fn(async () => undefined);
    const response = await skip(9606, smtpSend);
    expect(response.status).toBe(409);
    expect((response.body as { error: { message: string } }).error.message).toBe(CHANGED_MESSAGE);
    expect(smtpSend).not.toHaveBeenCalled();
  });

  test('Versand räumt den Fingerprint auf; ein erneutes Anhalten speichert den neuen Inhalt', async () => {
    await heldDraft(9607);
    const key = 'outbound_hold_fingerprint:9607';
    const stored = await postgres.admin.query(`SELECT value FROM sync_info WHERE workspace_id = $1 AND key = $2`, [WORKSPACE_ID, key]);
    expect(stored.rows).toHaveLength(1);
    expect(String(stored.rows[0].value)).toMatch(/^[a-f0-9]{32}$/);
    expect((await skip(9607, jest.fn(async () => undefined))).status).toBe(200);
    const after = await postgres.admin.query(`SELECT value FROM sync_info WHERE workspace_id = $1 AND key = $2`, [WORKSPACE_ID, key]);
    expect(after.rows).toHaveLength(0);
  });
});
