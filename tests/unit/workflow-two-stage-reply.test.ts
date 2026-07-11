/**
 * Zwei-Stufen-KI-Antwort (Phase 3): Gate-Anti-Loop, ai.draft_reply,
 * ai.review_draft und der Review-Parser.
 */
import type { RegisteredWorkflowNode, WorkflowContext } from '../../electron/workflow/types';

jest.mock('../../electron/email/email-openai', () => ({
  runChatCompletion: jest.fn(),
}));

jest.mock('../../electron/email/email-store', () => ({
  addMessageTag: jest.fn(),
  clearMessageSeenSyncPending: jest.fn(),
  setMessageArchived: jest.fn(),
  setMessageSeenLocal: jest.fn(),
  setMessageSpam: jest.fn(),
  setMessageSpamStatus: jest.fn(),
  setMessageAssignedTo: jest.fn(),
  setOutboundHold: jest.fn(),
  getEmailAccountById: jest.fn(() => ({
    id: 1,
    email_address: 'service@firma.de',
    display_name: 'Service',
    protocol: 'imap',
  })),
  getEmailMessageById: jest.fn(),
  createComposeDraft: jest.fn(() => 42),
  updateComposeDraft: jest.fn(),
  listAccountSignatureRows: jest.fn(() => [
    { account_id: 1, display_name: 'Service', email_address: 'service@firma.de', signature_html: '<p>Mit freundlichen Grüßen<br/>{{user.name}}</p>' },
  ]),
}));

jest.mock('../../electron/email/email-crm-store', () => ({
  listAiPrompts: jest.fn(() => []),
  assignCategoryPathToMessage: jest.fn(),
}));

jest.mock('../../electron/email/email-ai-profiles', () => ({
  resolvePromptProfileId: jest.fn(() => null),
}));

jest.mock('../../electron/workflow/knowledge-base', () => ({
  searchKnowledgeChunks: jest.fn(async () => []),
  searchKnowledgeForWorkflow: jest.fn(async () => [
    { id: 1, title: 'FAQ Retouren', content: 'Retouren über das Portal anmelden.' },
  ]),
}));

jest.mock('../../electron/email/email-draft-approval', () => ({
  markDraftAutoSubmitted: jest.fn(),
  setDraftApprovalPending: jest.fn(),
}));

jest.mock('../../electron/workflow/auto-reply-guard', () => ({
  isAutoReplyRateLimited: jest.fn(() => false),
  markAutoReplySent: jest.fn(),
  tryReserveAutoReplySlot: jest.fn(() => true),
}));

jest.mock('../../electron/workflow/draft-send-prep', () => ({
  prepareDraftForWorkflowSend: jest.fn(() => ({ ok: true })),
  releaseOutboundHoldForDraft: jest.fn(() => ({ ok: true, autoSendScheduled: true })),
}));

jest.mock('../../electron/sqlite-service', () => ({
  getSyncInfo: jest.fn(() => '1'), // auto_reply_enabled = an
  setSyncInfo: jest.fn(),
}));

import { runChatCompletion } from '../../electron/email/email-openai';
import {
  createComposeDraft,
  getEmailMessageById,
  updateComposeDraft,
} from '../../electron/email/email-store';
import {
  markDraftAutoSubmitted,
  setDraftApprovalPending,
} from '../../electron/email/email-draft-approval';
import {
  isAutoReplyRateLimited,
  tryReserveAutoReplySlot,
} from '../../electron/workflow/auto-reply-guard';
import { parseDraftReviewResponse } from '../../electron/workflow/draft-review-parse';
import { registerAiNodes } from '../../electron/workflow/nodes/ai-nodes';
import { registerEmailNodes } from '../../electron/workflow/nodes/email-nodes';

function collect(registerNodes: (register: (def: RegisteredWorkflowNode) => void) => void) {
  const defs = new Map<string, RegisteredWorkflowNode>();
  registerNodes((def) => defs.set(def.type, def));
  return defs;
}

const baseMessage = {
  id: 7,
  account_id: 1,
  subject: 'Frage zu Bestellung 1234',
  from_json: JSON.stringify({ value: [{ address: 'kunde@firma.de', name: 'Max Meier' }] }),
  raw_headers: 'From: kunde@firma.de\nSubject: Frage',
  body_text: 'Wo bleibt meine Bestellung?',
  snippet: 'Wo bleibt…',
};

function ctx(overrides: Partial<WorkflowContext> = {}): WorkflowContext {
  return {
    trigger: 'inbound',
    direction: 'inbound',
    messageId: 7,
    message: baseMessage,
    outbound: null,
    workflowId: 1,
    runId: 1,
    dryRun: false,
    variables: { 'ai.class_confidence': 95 },
    strings: {
      subject: baseMessage.subject,
      from_address: 'kunde@firma.de',
      combined_text: 'Frage zu Bestellung 1234\nWo bleibt meine Bestellung?',
    },
    ai: {},
    ...overrides,
  } as WorkflowContext;
}

describe('parseDraftReviewResponse (fail-safe Richtung Mensch)', () => {
  test.each([
    ['STATUS: SEND\nANSWERED: yes\nREASON: Alles gut', 'send', true, true],
    ['status: hold\nanswered: no\nreason: Preiszusage', 'hold', false, true],
    ['STATUS: SENDEN\nANSWERED: ja\nREASON: passt', 'send', true, true],
    ['Blabla ohne Format', 'hold', false, false],
    ['STATUS: SEND\nANSWERED: no\nREASON: widersprüchlich', 'hold', false, true],
    // SEND ohne ANSWERED-Zeile = unvollständige Antwort → darf NICHT senden.
    ['STATUS: SEND\nREASON: sieht gut aus', 'hold', false, false],
    ['STATUS: HOLD\nREASON: unsicher', 'hold', false, true],
  ])('%s → %s', (raw, verdict, answered, parsed) => {
    const r = parseDraftReviewResponse(raw);
    expect(r.verdict).toBe(verdict);
    expect(r.answered).toBe(answered);
    expect(r.parsed).toBe(parsed);
  });

  test('zitierte Format-Anweisung vor der echten Antwort kippt NICHT auf send (letzter Treffer, zeilen-verankert)', () => {
    const echo = [
      'Antworte NUR in diesem Format:',
      'STATUS: SEND oder HOLD',
      'ANSWERED: yes oder no',
      '',
      'STATUS: HOLD',
      'ANSWERED: no',
      'REASON: Preiszusage gehört vor einen Menschen',
    ].join('\n');
    const r = parseDraftReviewResponse(echo);
    expect(r.verdict).toBe('hold');
    expect(r.answered).toBe(false);
    expect(r.reason).toBe('Preiszusage gehört vor einen Menschen');
  });

  test('Substring wie "Bestellstatus: senden" im Fließtext zählt nicht als STATUS-Zeile', () => {
    const r = parseDraftReviewResponse('Der Bestellstatus: senden wir morgen raus.');
    expect(r.verdict).toBe('hold');
    expect(r.parsed).toBe(false);
  });
});

describe('email.auto_reply Gate — Anti-Loop', () => {
  const defs = collect(registerEmailNodes);
  const gate = defs.get('email.auto_reply')!;

  beforeEach(() => jest.clearAllMocks());

  test('blockt automatisch erzeugte Mails (Auto-Submitted-Header)', async () => {
    const c = ctx({
      message: { ...baseMessage, raw_headers: 'Auto-Submitted: auto-replied\nFrom: x' } as never,
    });
    const r = await gate.execute(c, { minConfidence: 50 }, 'g');
    expect(r).toMatchObject({ port: 'blocked' });
    expect(r.variables?.['auto_reply.blocked_reason']).toBe('automated_sender');
  });

  test('blockt Newsletter (List-Unsubscribe)', async () => {
    const c = ctx({
      message: { ...baseMessage, raw_headers: 'List-Unsubscribe: <mailto:x>\nFrom: x' } as never,
    });
    const r = await gate.execute(c, { minConfidence: 50 }, 'g');
    expect(r.variables?.['auto_reply.blocked_reason']).toBe('automated_sender');
  });

  test('blockt bei erreichtem Tageslimit', async () => {
    (isAutoReplyRateLimited as jest.Mock).mockReturnValueOnce(true);
    const r = await gate.execute(ctx(), { minConfidence: 50 }, 'g');
    expect(r.variables?.['auto_reply.blocked_reason']).toBe('rate_limited');
  });

  test('approved, wenn alle Prüfungen bestehen', async () => {
    const r = await gate.execute(ctx(), { minConfidence: 50 }, 'g');
    expect(r).toMatchObject({ port: 'approved' });
  });

  test('blockt, wenn das ANTWORT-Ziel (Reply-To) eine No-Reply-Adresse ist', async () => {
    // From ist ein Mensch, aber die Antwort GEHT an Reply-To = no-reply@ —
    // ohne Prüfung des Ziels würde eine sinnlose Auto-Antwort geplant.
    const c = ctx({
      message: {
        ...baseMessage,
        raw_headers: 'Reply-To: no-reply@vendor.com\nFrom: kunde@firma.de',
      } as never,
    });
    const r = await gate.execute(c, { minConfidence: 50 }, 'g');
    expect(r).toMatchObject({ port: 'blocked' });
    expect(r.variables?.['auto_reply.blocked_reason']).toBe('noreply_sender');
  });
});

describe('ai.draft_reply (Agent 1)', () => {
  const defs = collect(registerAiNodes);
  const node = defs.get('ai.draft_reply')!;

  beforeEach(() => {
    jest.clearAllMocks();
    (runChatCompletion as jest.Mock).mockResolvedValue(
      'Ihre Bestellung 1234 ist unterwegs und kommt morgen an.',
    );
  });

  test('legt adressierten Antwort-Entwurf mit Anrede, Signatur und Thread-Bezug an', async () => {
    const r = await node.execute(ctx(), {}, 'd');
    expect(r.status).toBe('ok');
    expect(r.variables?.['draft.id']).toBe(42);

    const draftInput = (createComposeDraft as jest.Mock).mock.calls[0]![0];
    expect(draftInput.subject).toBe('Re: Frage zu Bestellung 1234');
    expect(draftInput.toJson).toContain('kunde@firma.de');
    expect(draftInput.bodyText).toContain('Guten Tag Max Meier,');
    expect(draftInput.bodyText).toContain('Ihre Bestellung 1234 ist unterwegs');
    expect(draftInput.bodyText).toContain('Mit freundlichen Grüßen');

    expect(updateComposeDraft).toHaveBeenCalledWith(42, { replyParentMessageId: 7 });
    // Kein RFC-3834-Stempel beim Anlegen: der gehört an den tatsächlichen
    // Versand (email.send_draft / ApproveDraftSend) — ein liegen gebliebener
    // Entwurf, den ein Mensch später sendet, ist keine automatische Antwort.
    expect(markDraftAutoSubmitted).not.toHaveBeenCalled();
  });

  test('unterdrückt die Anrede, wenn die KI schon eine schreibt', async () => {
    (runChatCompletion as jest.Mock).mockResolvedValue('Hallo Herr Meier, alles gut.');
    await node.execute(ctx(), {}, 'd');
    const draftInput = (createComposeDraft as jest.Mock).mock.calls[0]![0];
    expect(draftInput.bodyText.startsWith('Hallo Herr Meier,')).toBe(true);
  });

  test('KI-Fehler → error (Branch endet, nichts wird angelegt)', async () => {
    (runChatCompletion as jest.Mock).mockRejectedValue(new Error('API down'));
    const r = await node.execute(ctx(), {}, 'd');
    expect(r.status).toBe('error');
    expect(createComposeDraft).not.toHaveBeenCalled();
  });

  test('entartet lange KI-Antwort → error statt stillem Abschneiden', async () => {
    (runChatCompletion as jest.Mock).mockResolvedValue('lorem '.repeat(4000)); // 24k Zeichen
    const r = await node.execute(ctx(), {}, 'd');
    expect(r.status).toBe('error');
    expect(r.message).toContain('unplausibel lang');
    expect(createComposeDraft).not.toHaveBeenCalled();
  });

  test('nur inbound; dry-run ohne Seiteneffekte', async () => {
    await expect(
      node.execute(ctx({ direction: 'outbound' }), {}, 'd'),
    ).resolves.toMatchObject({ status: 'skipped' });
    const r = await node.execute(ctx({ dryRun: true }), {}, 'd');
    expect(r.status).toBe('ok');
    expect(createComposeDraft).not.toHaveBeenCalled();
  });
});

describe('ai.review_draft (Agent 2)', () => {
  const defs = collect(registerAiNodes);
  const node = defs.get('ai.review_draft')!;

  beforeEach(() => {
    jest.clearAllMocks();
    (getEmailMessageById as jest.Mock).mockReturnValue({
      id: 42,
      subject: 'Re: Frage zu Bestellung 1234',
      body_text: 'Guten Tag, Ihre Bestellung kommt morgen. MfG',
    });
  });

  test('SEND → Port send, keine Freigabe-Markierung', async () => {
    (runChatCompletion as jest.Mock).mockResolvedValue('STATUS: SEND\nANSWERED: yes\nREASON: ok');
    const r = await node.execute(ctx({ variables: { 'draft.id': 42 } }), {}, 'r');
    expect(r).toMatchObject({ status: 'ok', port: 'send' });
    expect(r.variables?.['ai.review.verdict']).toBe('send');
    expect(setDraftApprovalPending).not.toHaveBeenCalled();
  });

  test('HOLD → Port hold + Entwurf wartet auf Freigabe (mit Grund)', async () => {
    (runChatCompletion as jest.Mock).mockResolvedValue(
      'STATUS: HOLD\nANSWERED: no\nREASON: Liefertermin unbelegt',
    );
    const r = await node.execute(ctx({ variables: { 'draft.id': 42 } }), {}, 'r');
    expect(r).toMatchObject({ status: 'ok', port: 'hold' });
    expect(setDraftApprovalPending).toHaveBeenCalledWith(42, 'Liefertermin unbelegt');
  });

  test('unparsebare KI-Antwort → hold (fail-safe)', async () => {
    (runChatCompletion as jest.Mock).mockResolvedValue('Klar, kannst du senden!');
    const r = await node.execute(ctx({ variables: { 'draft.id': 42 } }), {}, 'r');
    expect(r.port).toBe('hold');
    expect(setDraftApprovalPending).toHaveBeenCalled();
  });

  test('KI-Fehler → hold + Freigabe-Markierung statt Abbruch', async () => {
    (runChatCompletion as jest.Mock).mockRejectedValue(new Error('timeout'));
    const r = await node.execute(ctx({ variables: { 'draft.id': 42 } }), {}, 'r');
    expect(r).toMatchObject({ status: 'ok', port: 'hold' });
    expect(setDraftApprovalPending).toHaveBeenCalledWith(42, expect.stringContaining('timeout'));
  });

  test('fehlender Entwurf → error', async () => {
    const r = await node.execute(ctx({ variables: {} }), {}, 'r');
    expect(r.status).toBe('error');
    (getEmailMessageById as jest.Mock).mockReturnValue(undefined);
    const r2 = await node.execute(ctx({ variables: { 'draft.id': 42 } }), {}, 'r');
    expect(r2.status).toBe('error');
  });

  test('dry-run → hold ohne Seiteneffekte', async () => {
    const r = await node.execute(ctx({ dryRun: true, variables: { 'draft.id': 42 } }), {}, 'r');
    expect(r.port).toBe('hold');
    expect(setDraftApprovalPending).not.toHaveBeenCalled();
    expect(runChatCompletion).not.toHaveBeenCalled();
  });
});

describe('email.send_draft — Anti-Loop-Buchhaltung', () => {
  const defs = collect(registerEmailNodes);
  const node = defs.get('email.send_draft')!;

  beforeEach(() => jest.clearAllMocks());

  test('inbound: reserviert Antwort-Slot atomar und markiert Entwurf als auto-submitted', async () => {
    const r = await node.execute(ctx({ variables: { 'draft.id': 42 } }), {}, 's');
    expect(r.status).toBe('ok');
    // Geschlüsselt auf den Antwort-Empfänger (Reply-To vor From).
    expect(tryReserveAutoReplySlot).toHaveBeenCalledWith(1, 'kunde@firma.de', 7);
    expect(markDraftAutoSubmitted).toHaveBeenCalledWith(42);
  });

  test('dry-run: keine Buchhaltung', async () => {
    await node.execute(ctx({ dryRun: true, variables: { 'draft.id': 42 } }), {}, 's');
    expect(tryReserveAutoReplySlot).not.toHaveBeenCalled();
  });

  // Dieselben Guards wie im Gate: auch OHNE email.auto_reply davor darf
  // send_draft weder Automaten antworten noch das Tageslimit umgehen.
  test('inbound: blockt automatisch erzeugte Mails auch ohne Gate davor', async () => {
    const { prepareDraftForWorkflowSend } = jest.requireMock('../../electron/workflow/draft-send-prep');
    const c = ctx({
      variables: { 'draft.id': 42 },
      message: { ...baseMessage, raw_headers: 'Auto-Submitted: auto-replied\nFrom: x' } as never,
    });
    const r = await node.execute(c, {}, 's');
    expect(r).toMatchObject({ status: 'skipped', message: 'automated_sender_blocked' });
    expect(prepareDraftForWorkflowSend).not.toHaveBeenCalled();
    expect(tryReserveAutoReplySlot).not.toHaveBeenCalled();
  });

  test('inbound: blockt bei erschöpftem Tageslimit VOR dem Einplanen', async () => {
    const { prepareDraftForWorkflowSend } = jest.requireMock('../../electron/workflow/draft-send-prep');
    (tryReserveAutoReplySlot as jest.Mock).mockReturnValueOnce(false);
    const r = await node.execute(ctx({ variables: { 'draft.id': 42 } }), {}, 's');
    expect(r).toMatchObject({ status: 'skipped', message: 'auto_reply_rate_limited' });
    expect(prepareDraftForWorkflowSend).not.toHaveBeenCalled();
    expect(markDraftAutoSubmitted).not.toHaveBeenCalled();
  });

  test('inbound: skippt, wenn das ANTWORT-Ziel (Reply-To) eine No-Reply-Adresse ist', async () => {
    const { prepareDraftForWorkflowSend } = jest.requireMock('../../electron/workflow/draft-send-prep');
    const c = ctx({
      variables: { 'draft.id': 42 },
      message: {
        ...baseMessage,
        raw_headers: 'Reply-To: no-reply@vendor.com\nFrom: kunde@firma.de',
      } as never,
    });
    const r = await node.execute(c, {}, 's');
    expect(r).toMatchObject({ status: 'skipped', message: 'noreply_sender_blocked' });
    expect(prepareDraftForWorkflowSend).not.toHaveBeenCalled();
    expect(tryReserveAutoReplySlot).not.toHaveBeenCalled();
  });

  test('inbound: Reply-To gewinnt als Limit-Schlüssel über wechselnde From-Adressen', async () => {
    const c = ctx({
      variables: { 'draft.id': 42 },
      message: {
        ...baseMessage,
        from_json: JSON.stringify({ value: [{ address: 'ticket-4711@vendor.com' }] }),
        raw_headers: 'Reply-To: support@vendor.com\nFrom: ticket-4711@vendor.com',
      } as never,
      strings: {
        subject: baseMessage.subject,
        from_address: 'ticket-4711@vendor.com',
        combined_text: 'x',
      },
    });
    await node.execute(c, {}, 's');
    expect(tryReserveAutoReplySlot).toHaveBeenCalledWith(1, 'support@vendor.com', 7);
  });
});

describe('isAutomatedInboundMessage — Header-Werte statt Substring (RFC 3834)', () => {
  test.each([
    // "Auto-Submitted: no" markiert explizit MANUELL erzeugte Mails.
    ['Auto-Submitted: no\nFrom: mensch@firma.de', false],
    ['Auto-Submitted: auto-generated\nFrom: x', true],
    ['Auto-Submitted: auto-replied; owner-email=x@y\nFrom: x', true],
    // Microsoft: "None" = nichts unterdrücken → kein Automat.
    ['X-Auto-Response-Suppress: None\nFrom: exchange@firma.de', false],
    ['X-Auto-Response-Suppress: All\nFrom: x', true],
    ['X-Auto-Response-Suppress: OOF, DR\nFrom: x', true],
    ['Precedence: bulk\nFrom: x', true],
    // Wert-basiert: auch ohne Leerzeichen nach dem Doppelpunkt …
    ['Precedence:junk\nFrom: x', true],
    // … aber "list" ist kein Auto-Reply-Blocker.
    ['Precedence: list\nFrom: x', false],
    ['From: kunde@firma.de\nSubject: Frage', false],
  ])('%s → %s', async (rawHeaders, automated) => {
    const { isAutomatedInboundMessage } = await import('../../electron/email/email-automation-headers');
    expect(isAutomatedInboundMessage(rawHeaders)).toBe(automated);
  });

  test('Gate blockt "Auto-Submitted: no" NICHT mehr', async () => {
    const defs = collect(registerEmailNodes);
    const gate = defs.get('email.auto_reply')!;
    const c = ctx({
      message: { ...baseMessage, raw_headers: 'Auto-Submitted: no\nFrom: kunde@firma.de' } as never,
    });
    const r = await gate.execute(c, { minConfidence: 50 }, 'g');
    expect(r).toMatchObject({ port: 'approved' });
  });
});
