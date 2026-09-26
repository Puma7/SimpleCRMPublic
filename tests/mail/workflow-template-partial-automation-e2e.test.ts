/**
 * TA-P6: Die Vorlagen „Teilautomatisierung“ laufen auf dem Desktop über den
 * echten Graph-Interpreter — je Ausgang der KI-Entscheidung ein Durchlauf.
 * Gemockt sind nur KI-Aufrufe (Entscheidung und Chat) und die Stores.
 * Muster: tests/mail/workflow-template-e2e.test.ts.
 */
import type { EmailMessageRow } from '../../electron/email/email-store';

const mockRunChatCompletion = jest.fn();
const mockRunAiDecideCall = jest.fn();
const mockAddMessageTag = jest.fn();
const mockSetMessageSpam = jest.fn();
const mockSetMessageSpamStatus = jest.fn();
const mockSetOutboundHold = jest.fn();
const mockMoveImapMessage = jest.fn(async (): Promise<void> => undefined);
const mockCreateComposeDraft = jest.fn(() => 42);
const mockUpdateComposeDraft = jest.fn();
const mockGetEmailMessageById = jest.fn();
const mockPrepareDraftForWorkflowSend = jest.fn(() => ({ ok: true }));
const mockReleaseOutboundHoldForDraft = jest.fn(() => ({ ok: true, autoSendScheduled: true }));
const mockSetDraftApprovalPending = jest.fn();
const mockMarkDraftAutoSubmitted = jest.fn();
const mockIsAutoReplyRateLimited = jest.fn(() => false);
const mockTryReserveAutoReplySlot = jest.fn(() => true);
const mockRunAiLearningsDigest = jest.fn();
const mockGetSyncInfo = jest.fn((key: string) => (key === 'auto_reply_enabled' ? '1' : null));
// Minimaler DB-Stub für Knoten mit direktem SQL (crm.create_task).
const mockDbRun = jest.fn(() => ({ lastInsertRowid: 99 }));
const mockGetDb = jest.fn(() => ({
  prepare: (sql: string) => ({
    run: (...args: unknown[]) => mockDbRun(sql, ...args),
    get: () => undefined,
    all: () => [],
  }),
  exec: jest.fn(),
}));

jest.mock('../../electron/email/email-openai', () => ({
  runChatCompletion: (...args: unknown[]) => mockRunChatCompletion(...args),
  runAiDecideCall: (...args: unknown[]) => mockRunAiDecideCall(...args),
}));

jest.mock('../../electron/email/email-store', () => ({
  addMessageTag: (...args: unknown[]) => mockAddMessageTag(...args),
  clearMessageSeenSyncPending: jest.fn(),
  setMessageArchived: jest.fn(),
  setMessageSeenLocal: jest.fn(),
  setMessageSpam: (...args: unknown[]) => mockSetMessageSpam(...args),
  setMessageSpamStatus: (...args: unknown[]) => mockSetMessageSpamStatus(...args),
  setMessageAssignedTo: jest.fn(),
  setOutboundHold: (...args: unknown[]) => mockSetOutboundHold(...args),
  getEmailAccountById: jest.fn(() => ({
    id: 1,
    email_address: 'service@firma.de',
    display_name: 'Service',
    protocol: 'imap',
  })),
  listEmailAccounts: jest.fn(() => []),
  getEmailMessageById: (...args: unknown[]) => mockGetEmailMessageById(...args),
  createComposeDraft: (...args: unknown[]) => mockCreateComposeDraft(...args),
  updateComposeDraft: (...args: unknown[]) => mockUpdateComposeDraft(...args),
  listAccountSignatureRows: jest.fn(() => [
    {
      account_id: 1,
      display_name: 'Service',
      email_address: 'service@firma.de',
      signature_html: '<p>Mit freundlichen Grüßen<br/>Ihr Service-Team</p>',
    },
  ]),
}));

jest.mock('../../electron/email/email-imap-move', () => ({
  moveImapMessage: (...args: unknown[]) => mockMoveImapMessage(...(args as [])),
}));

jest.mock('../../electron/email/email-ai-learnings', () => ({
  runAiLearningsDigest: (...args: unknown[]) => mockRunAiLearningsDigest(...args),
  preflightAiLearningsDigest: jest.fn(),
  // ai.draft_reply merkt sich die KI-Fassung für Learnings (TA-P5).
  storeDraftAiSuggestionSnapshot: jest.fn(),
}));

jest.mock('../../electron/email/email-crm-store', () => ({
  assignCategoryPathToMessage: jest.fn(),
  tryLinkMessageToCustomer: jest.fn(),
  listAiPrompts: jest.fn(() => []),
  listCannedResponses: jest.fn(() => []),
}));

jest.mock('../../electron/email/email-ai-profiles', () => ({
  resolvePromptProfileId: jest.fn(() => null),
}));

jest.mock('../../electron/workflow/knowledge-base', () => ({
  searchKnowledgeChunks: jest.fn(async () => []),
  searchKnowledgeForWorkflow: jest.fn(async () => []),
}));

jest.mock('../../electron/email/email-draft-approval', () => ({
  markDraftAutoSubmitted: (...args: unknown[]) => mockMarkDraftAutoSubmitted(...args),
  setDraftApprovalPending: (...args: unknown[]) => mockSetDraftApprovalPending(...args),
}));

jest.mock('../../electron/workflow/auto-reply-guard', () => ({
  isAutoReplyRateLimited: (...args: unknown[]) => mockIsAutoReplyRateLimited(...args),
  markAutoReplySent: jest.fn(),
  tryReserveAutoReplySlot: (...args: unknown[]) => mockTryReserveAutoReplySlot(...args),
}));

jest.mock('../../electron/workflow/draft-send-prep', () => ({
  prepareDraftForWorkflowSend: (...args: unknown[]) => mockPrepareDraftForWorkflowSend(...args),
  releaseOutboundHoldForDraft: (...args: unknown[]) => mockReleaseOutboundHoldForDraft(...args),
}));

jest.mock('../../electron/workflow/run-steps', () => ({
  insertWorkflowRunStep: jest.fn(),
}));

jest.mock('../../electron/email/mail-security-store', () => ({
  securityVariablesFromRow: jest.fn(() => ({})),
}));

jest.mock('../../electron/sqlite-service', () => ({
  getDb: (...args: unknown[]) => mockGetDb(...args),
  getSyncInfo: (...args: unknown[]) => mockGetSyncInfo(...(args as [string])),
  setSyncInfo: jest.fn(),
  getCustomerById: jest.fn(() => ({ id: 5, name: 'Meier GmbH', email: 'kunde@firma.de' })),
  createActivityLog: jest.fn(),
  updateDealStage: jest.fn(() => ({ success: true })),
}));

import { PARTIAL_AUTOMATION_TEMPLATE_IDS as IDS, getWorkflowTemplate } from '../../packages/core/src/workflow';
import { runWorkflowGraph } from '../../electron/workflow/runtime';

const inboundMessage = {
  id: 7,
  account_id: 1,
  uid: 100,
  subject: 'Frage zu Bestellung 1234',
  from_json: JSON.stringify({ value: [{ address: 'kunde@firma.de', name: 'Max Meier' }] }),
  to_json: JSON.stringify({ value: [{ address: 'service@firma.de' }] }),
  cc_json: null,
  snippet: 'Wo bleibt meine Bestellung?',
  body_text: 'Hallo, wo bleibt meine Bestellung 1234?',
  raw_headers: 'From: kunde@firma.de\nSubject: Frage zu Bestellung 1234',
  has_attachments: 0,
  attachments_json: null,
  customer_id: 5,
  is_spam: 0,
  spam_status: null,
} as unknown as EmailMessageRow;

const outboundDraft = {
  ...(inboundMessage as object),
  id: 99,
  uid: -99,
  subject: 'Re: Frage zu Bestellung 1234',
  body_text: 'Guten Tag Herr Meier, Ihre Bestellung ist unterwegs.',
} as unknown as EmailMessageRow;

/** Antwort eines Entscheidungsmodells: Ja-Wahrscheinlichkeit in Prozent. */
function decisions(probability: number) {
  return { source: 'decisions', probability, modelAnswer: null, reason: '', model: 'typesafe/jev-1.13' };
}

function graphJson(templateId: string): string {
  const template = getWorkflowTemplate(templateId);
  if (!template) throw new Error(`Vorlage ${templateId} fehlt`);
  return JSON.stringify(template.graph);
}

function runInbound(templateId: string, message: EmailMessageRow = inboundMessage) {
  return runWorkflowGraph({
    workflow: { id: 1, graph_json: graphJson(templateId) } as never,
    trigger: 'inbound',
    direction: 'inbound',
    runId: 1,
    message,
    dryRun: false,
  });
}

function runOutbound() {
  return runWorkflowGraph({
    workflow: { id: 1, graph_json: graphJson(IDS.outboundDecision) } as never,
    trigger: 'outbound',
    direction: 'outbound',
    runId: 1,
    // Wie evaluateOutboundWorkflows: die Entwurfszeile ist die Nachricht.
    message: outboundDraft,
    outbound: {
      messageId: 99,
      accountId: 1,
      subject: 'Re: Frage zu Bestellung 1234',
      bodyText: 'Guten Tag Herr Meier, Ihre Bestellung ist unterwegs.',
      to: 'kunde@firma.de',
      attachmentCount: 0,
    },
    dryRun: false,
  } as never);
}

function tags(): unknown[] {
  return mockAddMessageTag.mock.calls.map((call) => call[1]);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSyncInfo.mockImplementation((key: string) => (key === 'auto_reply_enabled' ? '1' : null));
  mockIsAutoReplyRateLimited.mockReturnValue(false);
  mockTryReserveAutoReplySlot.mockReturnValue(true);
  mockCreateComposeDraft.mockReturnValue(42);
  mockPrepareDraftForWorkflowSend.mockReturnValue({ ok: true });
  mockReleaseOutboundHoldForDraft.mockReturnValue({ ok: true, autoSendScheduled: true });
  mockDbRun.mockReturnValue({ lastInsertRowid: 99 });
  // ai.review_draft lädt den zuvor angelegten Entwurf; die Eingangsmail
  // bleibt beim Snapshot (logic.stop_after_spam liest sonst die Live-Zeile).
  mockGetEmailMessageById.mockImplementation((id: number) =>
    id === 42 ? { id: 42, subject: 'Re: Frage zu Bestellung 1234', body_text: 'Entwurfstext' } : undefined,
  );
});

describe('a) Eingehend: Spam-Entscheidung (Entscheidungsmodell)', () => {
  test('fragt die KI mit Frage und Kriterien der Vorlage (kompletter Text)', async () => {
    mockRunAiDecideCall.mockResolvedValueOnce(decisions(5));
    await runInbound(IDS.spamDecision);
    expect(mockRunAiDecideCall).toHaveBeenCalledTimes(1);
    const input = mockRunAiDecideCall.mock.calls[0]![0] as Record<string, unknown>;
    expect(input).toMatchObject({
      profileId: null,
      question: 'Ist diese E-Mail Spam, Phishing oder unerwünschte Werbung?',
    });
    expect(String(input.yesCriteria)).toContain('Phishing');
    expect(String(input.noCriteria)).toContain('Kunden');
    expect(String(input.contextText)).toContain('wo bleibt meine Bestellung 1234');
  });

  test('Ja: als Spam markiert, in den Spam-Ordner verschoben, Kette stoppt', async () => {
    mockRunAiDecideCall.mockResolvedValueOnce(decisions(95));
    const r = await runInbound(IDS.spamDecision);
    expect(r).toMatchObject({ status: 'ok', inboundChainStop: true });
    expect(mockSetMessageSpam).toHaveBeenCalledWith(7, true, { train: false, source: 'workflow' });
    expect(mockMoveImapMessage).toHaveBeenCalledWith(inboundMessage, 'Spam');
    expect(tags()).toEqual(['ki-spam']);
    expect(mockSetMessageSpamStatus).not.toHaveBeenCalled();
    expect(r.log.join('\n')).not.toContain('no_prior_condition');
  });

  test('Ja bei einem POP3-Konto: Verschieben scheitert, Mail bleibt Spam, Kette stoppt trotzdem', async () => {
    mockRunAiDecideCall.mockResolvedValueOnce(decisions(95));
    mockMoveImapMessage.mockRejectedValueOnce(
      new Error('POP3- oder Entwurfs-Nachrichten können nicht per IMAP verschoben werden'),
    );
    const r = await runInbound(IDS.spamDecision);
    expect(r).toMatchObject({ status: 'ok', inboundChainStop: true });
    expect(mockSetMessageSpam).toHaveBeenCalledWith(7, true, { train: false, source: 'workflow' });
    expect(tags()).toEqual(['ki-spam']);
  });

  test('Unsicher: Spam-Status „prüfen“, Kette stoppt, nichts verschoben', async () => {
    mockRunAiDecideCall.mockResolvedValueOnce(decisions(50));
    const r = await runInbound(IDS.spamDecision);
    expect(r).toMatchObject({ status: 'ok', inboundChainStop: true });
    expect(mockSetMessageSpamStatus).toHaveBeenCalledWith(7, 'review', { train: false, source: 'workflow' });
    expect(tags()).toEqual(['spam-pruefen']);
    expect(mockSetMessageSpam).not.toHaveBeenCalled();
    expect(mockMoveImapMessage).not.toHaveBeenCalled();
  });

  test('Nein: nichts passiert, nachfolgende Workflows laufen weiter', async () => {
    mockRunAiDecideCall.mockResolvedValueOnce(decisions(5));
    const r = await runInbound(IDS.spamDecision);
    expect(r.status).toBe('ok');
    expect(r.inboundChainStop).toBeFalsy();
    expect(tags()).toEqual([]);
    expect(mockSetMessageSpam).not.toHaveBeenCalled();
    expect(mockSetMessageSpamStatus).not.toHaveBeenCalled();
  });

  test('KI-Fehler: nur Tag ki-fehler, Mail bleibt im Posteingang, Kette läuft weiter', async () => {
    mockRunAiDecideCall.mockRejectedValueOnce(new Error('Decisions API HTTP 502'));
    const r = await runInbound(IDS.spamDecision);
    expect(r.status).toBe('ok');
    expect(r.inboundChainStop).toBeFalsy();
    expect(tags()).toEqual(['ki-fehler']);
    expect(mockSetMessageSpam).not.toHaveBeenCalled();
    expect(mockSetMessageSpamStatus).not.toHaveBeenCalled();
  });
});

describe('b) Eingehend: Mensch oder KI? → KI-Antwort mit Gegenprüfung', () => {
  test('Nein + Gegenprüfung „senden“: Entwurf wird mit Ausgangsprüfung eingeplant', async () => {
    mockRunAiDecideCall.mockResolvedValueOnce(decisions(5));
    mockRunChatCompletion
      .mockResolvedValueOnce('Ihre Bestellung 1234 ist unterwegs und kommt morgen an.')
      .mockResolvedValueOnce('STATUS: SEND\nANSWERED: yes\nREASON: vollständig beantwortet');

    const r = await runInbound(IDS.humanOrAiReply);
    expect(r.status).toBe('ok');
    expect(mockRunAiDecideCall.mock.calls[0]![0]).toMatchObject({ question: 'Muss ein Mensch diese Anfrage bearbeiten?' });
    const draftInput = mockCreateComposeDraft.mock.calls[0]![0] as Record<string, unknown>;
    expect(draftInput.toJson).toContain('kunde@firma.de');
    expect(String(draftInput.bodyText)).toContain('Mit freundlichen Grüßen');
    expect(mockPrepareDraftForWorkflowSend).toHaveBeenCalledWith(42, { runOutboundReview: true, dryRun: false });
    expect(mockTryReserveAutoReplySlot).toHaveBeenCalledWith(1, 'kunde@firma.de', 7);
    expect(mockSetDraftApprovalPending).not.toHaveBeenCalled();
    expect(tags()).toEqual([]);
    expect(r.log.join('\n')).not.toContain('no_prior_condition');
  });

  test('Nein + Gegenprüfung „prüfen“: Entwurf wartet, Tag ki-freigabe + Aufgabe', async () => {
    mockRunAiDecideCall.mockResolvedValueOnce(decisions(10));
    mockRunChatCompletion
      .mockResolvedValueOnce('Wir erstatten Ihnen pauschal 50 Euro.')
      .mockResolvedValueOnce('STATUS: HOLD\nANSWERED: no\nREASON: Kulanz-Zusage gehört vor einen Menschen');

    const r = await runInbound(IDS.humanOrAiReply);
    expect(r.status).toBe('ok');
    expect(mockSetDraftApprovalPending).toHaveBeenCalledWith(42, 'Kulanz-Zusage gehört vor einen Menschen');
    expect(mockPrepareDraftForWorkflowSend).not.toHaveBeenCalled();
    expect(tags()).toEqual(['ki-freigabe']);
    const taskArgs = mockDbRun.mock.calls.find((c) => String(c[0]).includes('INSERT INTO'));
    expect(taskArgs?.[2]).toBe('KI-Entwurf prüfen: Frage zu Bestellung 1234');
  });

  test.each([
    ['Ja', () => mockRunAiDecideCall.mockResolvedValueOnce(decisions(92))],
    ['Unsicher', () => mockRunAiDecideCall.mockResolvedValueOnce(decisions(45))],
    ['KI-Fehler', () => mockRunAiDecideCall.mockRejectedValueOnce(new Error('Zeitüberschreitung'))],
  ])('%s: Tag manuell, kein Entwurf, keine Chat-KI', async (_label, arrange) => {
    arrange();
    const r = await runInbound(IDS.humanOrAiReply);
    expect(r.status).toBe('ok');
    expect(tags()).toEqual(['manuell']);
    expect(mockCreateComposeDraft).not.toHaveBeenCalled();
    expect(mockRunChatCompletion).not.toHaveBeenCalled();
    expect(mockPrepareDraftForWorkflowSend).not.toHaveBeenCalled();
  });

  test('Nein, aber Gate blockiert (Schalter aus): Tag ki-manuell, kein Entwurf', async () => {
    mockGetSyncInfo.mockImplementation(() => null);
    mockRunAiDecideCall.mockResolvedValueOnce(decisions(5));
    const r = await runInbound(IDS.humanOrAiReply);
    expect(r.status).toBe('ok');
    expect(tags()).toEqual(['ki-manuell']);
    expect(mockCreateComposeDraft).not.toHaveBeenCalled();
  });

  test('als Spam markierte Mail: keine KI-Anfrage, Kette stoppt', async () => {
    const spam = { ...(inboundMessage as object), is_spam: 1, spam_status: 'spam' } as unknown as EmailMessageRow;
    const r = await runInbound(IDS.humanOrAiReply, spam);
    expect(r).toMatchObject({ status: 'ok', inboundChainStop: true });
    expect(mockRunAiDecideCall).not.toHaveBeenCalled();
    expect(tags()).toEqual([]);
  });
});

describe('c) Ausgehend: KI-Entscheidung vor dem Versand', () => {
  test('Ja: Versand freigegeben (autoSend), keine Sperre', async () => {
    mockRunAiDecideCall.mockResolvedValueOnce(decisions(96));
    const r = await runOutbound();
    expect(r).toMatchObject({ status: 'ok', blocked: false });
    expect(mockRunAiDecideCall.mock.calls[0]![0]).toMatchObject({
      question: 'Ist diese E-Mail in dieser Form an den Kunden versandfähig?',
    });
    expect(mockReleaseOutboundHoldForDraft).toHaveBeenCalledWith(99, true, false);
    expect(mockSetOutboundHold).not.toHaveBeenCalled();
    expect(tags()).toEqual([]);
  });

  test.each([
    ['Nein', 12, 'Vom Entscheidungsmodell als nicht versandfähig blockiert – bitte E-Mail prüfen. (Ja-Wahrscheinlichkeit 12 %)'],
    ['Unsicher', 60, 'Vom Entscheidungsmodell als nicht versandfähig blockiert – bitte E-Mail prüfen. (Ja-Wahrscheinlichkeit 60 %)'],
  ])('%s: Versand angehalten, Tag ausgang-blockiert', async (_label, probability, reason) => {
    mockRunAiDecideCall.mockResolvedValueOnce(decisions(probability as number));
    const r = await runOutbound();
    expect(r).toMatchObject({ status: 'blocked', blocked: true, blockReason: reason });
    expect(mockSetOutboundHold).toHaveBeenCalledWith(99, true, reason);
    expect(tags()).toEqual(['ausgang-blockiert']);
    expect(mockReleaseOutboundHoldForDraft).not.toHaveBeenCalled();
  });

  test('KI-Fehler: Versand angehalten, Tag ausgang-blockiert', async () => {
    mockRunAiDecideCall.mockRejectedValueOnce(new Error('Decisions API HTTP 502'));
    const r = await runOutbound();
    expect(r).toMatchObject({ status: 'blocked', blocked: true });
    expect(String(r.blockReason)).toContain('KI-Fehler bei der Versandentscheidung');
    expect(mockSetOutboundHold).toHaveBeenCalledWith(99, true, r.blockReason);
    expect(tags()).toEqual(['ausgang-blockiert']);
    expect(mockReleaseOutboundHoldForDraft).not.toHaveBeenCalled();
  });
});

describe('d) Learnings wöchentlich auswerten', () => {
  test('Zeitplan-Lauf wertet die letzte Woche ab 3 Einträgen aus', async () => {
    mockRunAiLearningsDigest.mockResolvedValueOnce({ status: 'created', digestId: 3, candidateCount: 5, error: null });
    const r = await runWorkflowGraph({
      workflow: { id: 1, graph_json: graphJson(IDS.learningsWeekly) } as never,
      trigger: 'schedule',
      direction: 'schedule',
      runId: 1,
      message: null,
      dryRun: false,
    } as never);
    expect(r.status).toBe('ok');
    expect(mockRunAiLearningsDigest).toHaveBeenCalledWith({
      knowledgeBaseId: null,
      period: 'week',
      minCandidates: 3,
      profileId: null,
      trigger: 'workflow',
      workflowId: 1,
    });
  });
});
