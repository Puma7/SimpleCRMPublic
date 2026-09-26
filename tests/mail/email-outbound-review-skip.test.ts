/**
 * „Ohne Ausgangsprüfung senden“ (Teilautomatisierung P2, Desktop): Freigabe
 * für genau den aktuellen Inhalt, Versand über den normalen Sendepfad, der den
 * Freigabe-Marker erkennt, Protokoll im Audit-Log. Echte In-Memory-DB; nur der
 * SMTP-Sendepfad und die Ticket-Vergabe sind ersetzt.
 */
import Database from 'better-sqlite3';

const db = new Database(':memory:');
db.pragma('foreign_keys = OFF');

const mockSendComposeDraft = jest.fn();

jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => db,
  getSyncInfo: (key: string) =>
    (db.prepare('SELECT value FROM sync_info WHERE key = ?').get(key) as { value: string } | undefined)
      ?.value ?? null,
  setSyncInfo: (key: string, value: string) => {
    db.prepare(
      `INSERT INTO sync_info (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(key, value);
  },
}));
jest.mock('../../electron/email/email-compose-send', () => ({
  sendComposeDraft: (...args: unknown[]) => mockSendComposeDraft(...args),
}));
jest.mock('../../electron/email/email-ticket', () => ({
  extractKnownTicketFromSubject: (subject: string | null) => /\[(T-\d+)\]/.exec(subject ?? '')?.[1] ?? null,
  createTicketCodeForAccount: () => 'T-9',
  ensureTicketInSubject: (subject: string, ticket: string) =>
    subject.includes(`[${ticket}]`) ? subject : `[${ticket}] ${subject}`,
}));

import {
  createAuthAuditLogTable,
  createEmailMessagesTable,
  createSyncInfoTable,
} from '../../electron/database-schema';
import { getEmailMessageById, updateComposeDraft } from '../../electron/email/email-store';
import { returnOutboundDraftToInbox } from '../../electron/email/email-outbound-review';
import { sendDraftSkippingOutboundReview } from '../../electron/email/email-outbound-review-skip';
import { tryOutboundApprovalBypass } from '../../electron/email/outbound-approval';
import {
  loadOutboundReviewSkipPolicy,
  saveOutboundReviewSkipPolicy,
} from '../../electron/email/outbound-review-skip-settings';
import { OUTBOUND_WARNING_MARKER } from '../../packages/core/src/email';
import { ensureSentProvenanceColumns } from '../../electron/email/email-sent-provenance-schema';
import { markDraftOrigin, recordSentProvenance } from '../../electron/email/email-sent-provenance';

beforeAll(() => {
  db.exec(createEmailMessagesTable);
  db.exec(createSyncInfoTable);
  db.exec(createAuthAuditLogTable);
  db.exec(`
    ALTER TABLE email_messages ADD COLUMN scheduled_send_at TEXT;
    ALTER TABLE email_messages ADD COLUMN approval_state TEXT;
    ALTER TABLE email_messages ADD COLUMN approval_reason TEXT;
    ALTER TABLE email_messages ADD COLUMN auto_submitted INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE email_messages ADD COLUMN draft_attachment_paths_json TEXT;
    ALTER TABLE email_messages ADD COLUMN reply_parent_message_id INTEGER;
  `);
  ensureSentProvenanceColumns(db);
});

beforeEach(() => {
  db.exec('DELETE FROM email_messages');
  db.exec('DELETE FROM sync_info');
  db.exec('DELETE FROM auth_audit_log');
  mockSendComposeDraft.mockReset();
  mockSendComposeDraft.mockResolvedValue({ ok: true });
});

const owner = { userId: 'owner-1', role: 'owner' as const };
const user = { userId: 'user-1', role: 'user' as const };

function insertHeldDraft(id: number, opts: { autoSubmitted?: number } = {}): void {
  db.prepare(
    `INSERT INTO email_messages
       (id, account_id, folder_id, uid, subject, folder_kind, body_text, body_html, to_json,
        auto_submitted, reply_parent_message_id, date_received)
     VALUES (?, 1, 10, ?, 'Re: Frage', 'draft', 'Antwort an den Kunden', '<p>Antwort an den Kunden</p>',
             ?, ?, 7, '2026-09-26T07:00:00Z')`,
  ).run(id, -id, JSON.stringify({ value: [{ address: 'kunde@example.com', name: 'Kunde' }] }), opts.autoSubmitted ?? 0);
  returnOutboundDraftToInbox(id, 'Preisangabe fehlt');
}

function setPolicy(value: 'all' | 'admins' | 'none'): void {
  saveOutboundReviewSkipPolicy(value);
  expect(loadOutboundReviewSkipPolicy()).toBe(value);
}

describe('Desktop: Ohne Ausgangsprüfung senden', () => {
  test('gibt den aktuellen Inhalt frei, sendet über den normalen Pfad und protokolliert', async () => {
    insertHeldDraft(61, { autoSubmitted: 1 });
    expect(getEmailMessageById(61)!.body_text).toContain(OUTBOUND_WARNING_MARKER);

    const result = await sendDraftSkippingOutboundReview(61, user);

    expect(result).toEqual({ success: true });
    const row = getEmailMessageById(61)!;
    expect(row.outbound_hold).toBe(0);
    expect(row.body_text).not.toContain(OUTBOUND_WARNING_MARKER);
    expect(row.subject).toBe('[T-9] Re: Frage');
    // Das Entfernen des Banners ist keine inhaltliche Änderung (RFC 3834 bleibt).
    expect(row.auto_submitted).toBe(1);

    expect(mockSendComposeDraft).toHaveBeenCalledTimes(1);
    const sendInput = mockSendComposeDraft.mock.calls[0]![0] as {
      subject: string;
      bodyText: string;
      bodyHtml: string | null;
      to: string;
      cc?: string;
      bcc?: string;
      inReplyToMessageId?: number;
      actor: unknown;
    };
    expect(sendInput).toMatchObject({
      accountId: 1,
      draftMessageId: 61,
      to: 'Kunde <kunde@example.com>',
      inReplyToMessageId: 7,
      actor: user,
    });
    expect(sendInput.bodyText).not.toContain(OUTBOUND_WARNING_MARKER);
    // Der normale Sendepfad (evaluateOutboundWorkflows) erkennt die Freigabe
    // für genau diese Werte — die Ausgangs-Workflows laufen nicht erneut.
    expect(tryOutboundApprovalBypass(61, {
      subject: sendInput.subject,
      bodyText: sendInput.bodyText,
      bodyHtml: sendInput.bodyHtml ?? null,
      to: sendInput.to,
      cc: sendInput.cc ?? null,
      bcc: sendInput.bcc ?? null,
      attachmentPaths: [],
    })).toBe(true);

    const skipMarker = db.prepare(`SELECT value FROM sync_info WHERE key = 'outbound_review_skipped:61'`).get() as { value: string };
    const approvalMarker = db.prepare(`SELECT value FROM sync_info WHERE key = 'outbound_review_approved:61'`).get() as { value: string };
    expect(skipMarker.value).toBe(approvalMarker.value);

    const audit = db.prepare(`SELECT user_id, action, resource_type, resource_id FROM auth_audit_log`).all();
    expect(audit).toEqual([{
      user_id: 'user-1',
      action: 'email.outbound_review_skipped',
      resource_type: 'email_message',
      resource_id: '61',
    }]);
  });

  test('Einstellung „niemand“ bzw. „nur Owner und Admin“ wird im Main-Prozess durchgesetzt', async () => {
    insertHeldDraft(62);
    setPolicy('admins');
    expect(await sendDraftSkippingOutboundReview(62, user)).toEqual({
      success: false,
      error: expect.stringContaining('nicht erlaubt'),
    });
    expect(getEmailMessageById(62)!.outbound_hold).toBe(1);
    expect(mockSendComposeDraft).not.toHaveBeenCalled();

    expect(await sendDraftSkippingOutboundReview(62, owner)).toEqual({ success: true });

    insertHeldDraft(63);
    setPolicy('none');
    expect((await sendDraftSkippingOutboundReview(63, owner)).success).toBe(false);
    expect(getEmailMessageById(63)!.outbound_hold).toBe(1);
  });

  test('nur angehaltene lokale Entwürfe; Versandfehler kommen unverändert zurück', async () => {
    db.prepare(
      `INSERT INTO email_messages (id, account_id, folder_id, uid, subject, folder_kind, body_text, date_received)
       VALUES (64, 1, 10, -64, 'Entwurf', 'draft', 'Text', '2026-09-26T07:00:00Z')`,
    ).run();
    expect(await sendDraftSkippingOutboundReview(64, owner)).toEqual({
      success: false,
      error: 'Der Entwurf ist nicht vom Ausgang angehalten.',
    });
    expect(await sendDraftSkippingOutboundReview(999, owner)).toEqual({
      success: false,
      error: 'Entwurf nicht gefunden',
    });
    expect(mockSendComposeDraft).not.toHaveBeenCalled();

    insertHeldDraft(65);
    mockSendComposeDraft.mockResolvedValueOnce({ ok: false, error: 'SMTP down' });
    expect(await sendDraftSkippingOutboundReview(65, owner)).toEqual({
      success: false,
      error: 'SMTP down',
      workflowRunId: null,
    });
  });

  test('TA-P3: der Versand trägt „Ausgangsprüfung übersprungen“; Banner-Entfernen ist keine Bearbeitung', async () => {
    insertHeldDraft(66);
    markDraftOrigin(66, 'ai', null);
    // Wie finalizeSentDraft: Kennzeichnung beim Übergang zu 'sent'.
    mockSendComposeDraft.mockImplementationOnce(async (input: { draftMessageId: number; actor: { userId: string } }) => {
      recordSentProvenance(input.draftMessageId, { kind: 'human', userId: input.actor.userId });
      return { ok: true };
    });

    expect(await sendDraftSkippingOutboundReview(66, user)).toEqual({ success: true });

    expect(db.prepare(
      `SELECT sent_by_kind, sent_by_user_id, sent_outbound_review_skipped FROM email_messages WHERE id = 66`,
    ).get()).toEqual({ sent_by_kind: 'ai_approved', sent_by_user_id: 'user-1', sent_outbound_review_skipped: 1 });
    expect(db.prepare(`SELECT 1 FROM sync_info WHERE key = 'outbound_review_skipped:66'`).get()).toBeUndefined();
  });
});

describe('Desktop: Überspringen nur für den unveränderten, angehaltenen Inhalt (Review B3/B4)', () => {
  const CHANGED =
    'Der Entwurf wurde nach dem Anhalten geändert. Bitte normal senden – die Ausgangsprüfung prüft dann den neuen Inhalt.';
  // Wie das Entwurfsfenster nach dem Öffnen speichert: Hinweis-Block als Absatz,
  // Text aus dem HTML ohne Umbrüche.
  const banner = `<p><strong>${OUTBOUND_WARNING_MARKER}</strong><br>Preisangabe fehlt<br><em>Bitte E-Mail prüfen, korrigieren und erneut senden.</em></p>`;
  function saveLikeComposeWindow(id: number, body: string, href?: string): void {
    updateComposeDraft(id, {
      subject: 'Re: Frage',
      bodyText: `${OUTBOUND_WARNING_MARKER} Preisangabe fehlt Bitte E-Mail prüfen, korrigieren und erneut senden. ${body}`,
      bodyHtml: `${banner}<p>${href ? `<a href="${href}">${body}</a>` : body}</p>`,
      toJson: JSON.stringify({ value: [{ address: 'kunde@example.com' }] }),
    });
  }

  test('unverändert — auch nach dem Speichern im Entwurfsfenster — wird gesendet, ohne Hinweis im Text', async () => {
    insertHeldDraft(71);
    expect(db.prepare(`SELECT value FROM sync_info WHERE key = 'outbound_hold_fingerprint:71'`).get())
      .toEqual({ value: expect.stringMatching(/^[a-f0-9]{32}$/) });
    saveLikeComposeWindow(71, 'Antwort an den Kunden');

    expect(await sendDraftSkippingOutboundReview(71, user)).toEqual({ success: true });

    const sendInput = mockSendComposeDraft.mock.calls[0]![0] as { bodyText: string; bodyHtml: string | null };
    expect(sendInput.bodyText).not.toContain('AUSGANGSPR');
    expect(sendInput.bodyText).not.toContain('erneut senden');
    expect(sendInput.bodyText).toContain('Antwort an den Kunden');
    expect(String(sendInput.bodyHtml)).not.toContain('AUSGANGSPR');
    // Die Freigabe räumt den Fingerprint auf.
    expect(db.prepare(`SELECT 1 FROM sync_info WHERE key = 'outbound_hold_fingerprint:71'`).get()).toBeUndefined();
  });

  test('nach dem Anhalten bearbeitet (Text oder nur ein Link-Ziel) ⇒ Fehler, kein Versand, bleibt angehalten', async () => {
    insertHeldDraft(72);
    saveLikeComposeWindow(72, 'Antwort an den Kunden, 10 % Rabatt');
    expect(await sendDraftSkippingOutboundReview(72, user)).toEqual({ success: false, error: CHANGED });
    expect(getEmailMessageById(72)!.outbound_hold).toBe(1);

    insertHeldDraft(73);
    saveLikeComposeWindow(73, 'Antwort an den Kunden', 'https://phish.example.test/');
    expect(await sendDraftSkippingOutboundReview(73, user)).toEqual({ success: false, error: CHANGED });

    expect(mockSendComposeDraft).not.toHaveBeenCalled();
    expect(db.prepare(`SELECT COUNT(*) AS n FROM auth_audit_log`).get()).toEqual({ n: 0 });
  });

  test('nach dem Anhalten das Absenderkonto gewechselt ⇒ Fehler, kein Versand (Gatekeeper #1)', async () => {
    insertHeldDraft(75);
    // Wie der „Von“-Wechsel im Entwurfsfenster (updateComposeDraft verschiebt
    // den Entwurf ins andere Konto); Text, Empfänger und Anhänge bleiben gleich.
    db.prepare('UPDATE email_messages SET account_id = 2, folder_id = 20 WHERE id = 75').run();
    expect(await sendDraftSkippingOutboundReview(75, user)).toEqual({ success: false, error: CHANGED });
    expect(getEmailMessageById(75)!.outbound_hold).toBe(1);
    expect(mockSendComposeDraft).not.toHaveBeenCalled();
  });

  test('Altbestand: angehalten ohne Fingerprint ⇒ Fehler wie nach einer Änderung', async () => {
    db.prepare(
      `INSERT INTO email_messages
         (id, account_id, folder_id, uid, subject, folder_kind, body_text, to_json, outbound_hold, outbound_block_reason, date_received)
       VALUES (74, 1, 10, -74, 'Alt', 'draft', 'Alter Text', ?, 1, 'Preisangabe fehlt', '2026-09-26T07:00:00Z')`,
    ).run(JSON.stringify({ value: [{ address: 'kunde@example.com' }] }));
    expect(await sendDraftSkippingOutboundReview(74, owner)).toEqual({ success: false, error: CHANGED });
    expect(mockSendComposeDraft).not.toHaveBeenCalled();
  });
});
