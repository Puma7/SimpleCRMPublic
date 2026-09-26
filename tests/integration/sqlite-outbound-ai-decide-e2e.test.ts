/**
 * @jest-environment node
 */
/**
 * Teilautomatisierung P1 + P2, Desktop Ende-zu-Ende mit echter In-Memory-SQLite
 * (vollständiges Schema): ai.decide im Ausgangs-Workflow. Ersetzt sind nur die
 * Modulgrenzen KI-Aufruf, SMTP und IMAP-Kopie.
 * a) Ein Mensch sendet, die KI sagt „nein“: Entwurf im Posteingang mit
 *    Standardtext; „Ohne Ausgangsprüfung senden“ verschickt ihn (Mensch,
 *    übersprungen, Protokoll).
 * b) Eine automatische KI-Antwort (send_draft mit Ausgangsprüfung, geplant):
 *    „nein“ ⇒ Posteingang, Planung gelöscht; „ja“ ⇒ versendet als ai_auto.
 */
jest.mock('electron', () => ({
  app: { getPath: () => `${process.cwd()}/.tmp-tests/simplecrm-outbound-ai-decide` },
  dialog: {},
}));

const mockDecide = jest.fn();
jest.mock('../../electron/email/email-openai', () => ({
  runAiDecideCall: (...args: unknown[]) => mockDecide(...args),
  runChatCompletion: jest.fn(async () => {
    throw new Error('Kein Chat-Aufruf in diesem Test');
  }),
}));

const mockSendSmtp = jest.fn();
jest.mock('../../electron/email/email-smtp', () => ({
  sendSmtpForAccount: (...args: unknown[]) => mockSendSmtp(...args),
}));
jest.mock('../../electron/email/email-imap-append', () => ({
  appendSentToImap: jest.fn(async () => undefined),
}));

import Database from 'better-sqlite3';
import { bootstrapFreshDatabaseSchema, closeDatabase, setSyncInfo } from '../../electron/sqlite-service';
import { sendComposeDraft } from '../../electron/email/email-compose-send';
import { sendDraftSkippingOutboundReview } from '../../electron/email/email-outbound-review-skip';
import { processDueScheduledSends } from '../../electron/email/email-scheduled-send';
import { markDraftOrigin } from '../../electron/email/email-sent-provenance';
import { getWorkflowById } from '../../electron/email/email-workflow-store';
import { getEmailMessageById, listMessagesForAccountView } from '../../electron/email/email-store';
import { executeWorkflowForTrigger } from '../../electron/workflow/workflow-executor';
import { OUTBOUND_WARNING_MARKER } from '../../packages/core/src/email';

const ACCOUNT_ID = 1;
const FOLDER_ID = 10;
const INBOUND_WORKFLOW_ID = 1;
const OUTBOUND_WORKFLOW_ID = 2;
const OWNER = { userId: 'u-owner', role: 'owner' as const };
const DECIDE_BLOCK_TEXT = 'Vom Entscheidungsmodell als nicht versandfähig blockiert – bitte E-Mail prüfen.';
const logger = { warn: jest.fn(), debug: jest.fn() };

function decisions(probability: number) {
  return { source: 'decisions', probability, modelAnswer: null, reason: '', model: 'typesafe/jev-1.13' };
}

describe('Desktop: KI-Entscheidung im Ausgang Ende-zu-Ende', () => {
  let db: Database.Database;

  beforeEach(() => {
    mockDecide.mockReset();
    mockSendSmtp.mockReset();
    mockSendSmtp.mockResolvedValue(undefined);
    db = new Database(':memory:');
    bootstrapFreshDatabaseSchema(db, { keepDbAssigned: true });
    db.prepare(
      `INSERT INTO users (id, username, display_name, role, password_hash, password_updated_at)
       VALUES (?, 'anna', 'Anna Beispiel', 'owner', 'x', '2026-01-01T00:00:00Z')`,
    ).run(OWNER.userId);
    db.prepare(
      `INSERT INTO email_accounts (id, display_name, email_address, imap_host, imap_username, keytar_account_key, smtp_host)
       VALUES (?, 'Support', 'support@example.test', 'imap.example.test', 'support', 'kt-1', 'smtp.example.test')`,
    ).run(ACCOUNT_ID);
    db.prepare(`INSERT INTO email_folders (id, account_id, path) VALUES (?, ?, 'INBOX')`).run(FOLDER_ID, ACCOUNT_ID);
    const inboundGraph = {
      version: 1,
      nodes: [
        { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } },
        {
          id: 'send',
          type: 'registry',
          data: {
            nodeType: 'email.send_draft',
            config: { draftIdVariable: 'draft.id', runOutboundReview: true, runOnEveryInbound: true },
          },
        },
      ],
      edges: [{ id: 'edge-1', source: 'trigger-1', target: 'send' }],
    };
    const outboundGraph = {
      version: 1,
      nodes: [
        { id: 'trigger-1', type: 'trigger', data: { kind: 'outbound' } },
        { id: 'decide', type: 'registry', data: { nodeType: 'ai.decide', config: { question: 'Ist die Mail versandfähig?', threshold: 80 } } },
      ],
      edges: [{ id: 'edge-1', source: 'trigger-1', target: 'decide' }],
    };
    const insertWorkflow = db.prepare(
      `INSERT INTO email_workflows (id, name, trigger, enabled, priority, definition_json, graph_json)
       VALUES (?, ?, ?, 1, 50, '{"version":1,"rules":[]}', ?)`,
    );
    insertWorkflow.run(INBOUND_WORKFLOW_ID, 'KI-Antwort', 'inbound', JSON.stringify(inboundGraph));
    insertWorkflow.run(OUTBOUND_WORKFLOW_ID, 'Versandfreigabe', 'outbound', JSON.stringify(outboundGraph));
  });

  afterEach(() => {
    closeDatabase();
  });

  function insertDraft(id: number, customer: string): void {
    db.prepare(
      `INSERT INTO email_messages
         (id, account_id, folder_id, uid, subject, folder_kind, to_json, body_text, body_html, date_received)
       VALUES (?, ?, ?, ?, 'Re: Frage', 'draft', ?, 'Ihre Bestellung kommt morgen.',
               '<p>Ihre Bestellung kommt morgen.</p>', '2026-09-26T07:00:00Z')`,
    ).run(id, ACCOUNT_ID, FOLDER_ID, -id, JSON.stringify({ value: [{ address: customer }] }));
  }

  function row(id: number) {
    return db.prepare(
      `SELECT folder_kind, outbound_hold, outbound_block_reason, body_text, scheduled_send_at,
              auto_submitted, sent_by_kind, sent_by_user_id, sent_outbound_review_skipped
       FROM email_messages WHERE id = ?`,
    ).get(id) as {
      folder_kind: string;
      outbound_hold: number;
      outbound_block_reason: string | null;
      body_text: string;
      scheduled_send_at: string | null;
      auto_submitted: number;
      sent_by_kind: string | null;
      sent_by_user_id: string | null;
      sent_outbound_review_skipped: number;
    };
  }

  function inboxIds(): number[] {
    return listMessagesForAccountView(ACCOUNT_ID, 'inbox').map((message) => message.id);
  }

  /** Eingang + KI-Entwurf (Herkunft 'ai' wie von ai.draft_reply), dann der Eingangs-Workflow. */
  async function planAutoReply(messageId: number, draftId: number): Promise<void> {
    const customer = `kunde${messageId}@example.com`;
    db.prepare(
      `INSERT INTO email_messages
         (id, account_id, folder_id, uid, subject, folder_kind, from_json, body_text, date_received)
       VALUES (?, ?, ?, ?, 'Frage', 'inbox', ?, 'Wann kommt meine Bestellung?', '2026-09-26T06:00:00Z')`,
    ).run(messageId, ACCOUNT_ID, FOLDER_ID, messageId, JSON.stringify({ value: [{ address: customer }] }));
    insertDraft(draftId, customer);
    markDraftOrigin(draftId, 'ai', INBOUND_WORKFLOW_ID);
    setSyncInfo('auto_reply_enabled', 'true');
    const result = await executeWorkflowForTrigger({
      workflow: getWorkflowById(INBOUND_WORKFLOW_ID)!,
      trigger: 'inbound',
      direction: 'inbound',
      message: getEmailMessageById(messageId),
      eventVariables: { 'draft.id': draftId },
    });
    expect(result.status).toBe('ok');
    expect(row(draftId).scheduled_send_at).not.toBeNull();
    // Geplant liegt die Antwort nicht im Posteingang.
    expect(inboxIds()).not.toContain(draftId);
  }

  test('a) Mensch sendet, KI sagt „nein“ ⇒ Posteingang; „Ohne Ausgangsprüfung senden“ ⇒ versendet und protokolliert', async () => {
    insertDraft(101, 'kunde101@example.com');
    mockDecide.mockResolvedValue(decisions(12));

    const result = await sendComposeDraft({
      accountId: ACCOUNT_ID,
      draftMessageId: 101,
      subject: 'Re: Frage',
      bodyText: 'Ihre Bestellung kommt morgen.',
      bodyHtml: '<p>Ihre Bestellung kommt morgen.</p>',
      to: 'kunde101@example.com',
      actor: OWNER,
    });

    const reason = `${DECIDE_BLOCK_TEXT} (Ja-Wahrscheinlichkeit 12 %)`;
    expect(result).toEqual(expect.objectContaining({ ok: false, error: reason, outboundHeld: true }));
    expect(mockSendSmtp).not.toHaveBeenCalled();
    const held = row(101);
    expect(held).toEqual(expect.objectContaining({ folder_kind: 'draft', outbound_hold: 1, outbound_block_reason: reason }));
    expect(held.body_text).toContain(OUTBOUND_WARNING_MARKER);
    expect(inboxIds()).toContain(101);

    expect(await sendDraftSkippingOutboundReview(101, OWNER)).toEqual(expect.objectContaining({ success: true }));

    // Die Ausgangs-Workflows sind übersprungen: keine zweite KI-Anfrage.
    expect(mockDecide).toHaveBeenCalledTimes(1);
    expect(mockSendSmtp).toHaveBeenCalledTimes(1);
    expect(String((mockSendSmtp.mock.calls[0]![1] as { text: string }).text)).not.toContain('AUSGANGSPR');
    expect(row(101)).toEqual(expect.objectContaining({
      folder_kind: 'sent',
      outbound_hold: 0,
      sent_by_kind: 'human',
      sent_by_user_id: OWNER.userId,
      sent_outbound_review_skipped: 1,
    }));
    expect(db.prepare(`SELECT user_id, action, resource_id FROM auth_audit_log WHERE action = 'email.outbound_review_skipped'`).all())
      .toEqual([{ user_id: OWNER.userId, action: 'email.outbound_review_skipped', resource_id: '101' }]);
  });

  test('b) automatische KI-Antwort, KI sagt „nein“ ⇒ Posteingang mit Grund, Planung gelöscht, kein Versand', async () => {
    await planAutoReply(201, 202);
    mockDecide.mockResolvedValue(decisions(20));

    await processDueScheduledSends(logger);
    await processDueScheduledSends(logger);

    expect(mockSendSmtp).not.toHaveBeenCalled();
    const held = row(202);
    expect(held).toEqual(expect.objectContaining({
      folder_kind: 'draft',
      outbound_hold: 1,
      outbound_block_reason: `${DECIDE_BLOCK_TEXT} (Ja-Wahrscheinlichkeit 20 %)`,
      scheduled_send_at: null,
      // RFC 3834 bleibt für einen späteren Versand erhalten.
      auto_submitted: 1,
    }));
    expect(held.body_text).toContain(OUTBOUND_WARNING_MARKER);
    expect(inboxIds()).toContain(202);
  });

  test('b) KI sagt „ja“ ⇒ Versand als automatische KI-Antwort (ai_auto)', async () => {
    await planAutoReply(301, 302);
    mockDecide.mockResolvedValue(decisions(97));

    await processDueScheduledSends(logger);

    expect(mockSendSmtp).toHaveBeenCalledTimes(1);
    expect(mockSendSmtp.mock.calls[0]![1]).toEqual(expect.objectContaining({ to: expect.stringContaining('kunde301@example.com') }));
    expect(row(302)).toEqual(expect.objectContaining({
      folder_kind: 'sent',
      scheduled_send_at: null,
      sent_by_kind: 'ai_auto',
      sent_by_user_id: null,
      sent_outbound_review_skipped: 0,
    }));
  });
});
