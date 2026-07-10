/**
 * End-to-End über den echten Graph-Interpreter: beide Auto-Antwort-Vorlagen
 * laufen komplett durch (send-, hold-, blocked-Pfade) — nur KI und DB-Stores
 * sind gemockt. Beweist, dass die ausgelieferten Vorlagen wirklich
 * funktionieren (Verdrahtung, Ports, Variablenfluss, Inbound-Gate).
 */
import type { EmailMessageRow } from '../../electron/email/email-store';

const mockRunChatCompletion = jest.fn();
const mockAddMessageTag = jest.fn();
const mockCreateComposeDraft = jest.fn(() => 42);
const mockUpdateComposeDraft = jest.fn();
const mockGetEmailMessageById = jest.fn();
const mockPrepareDraftForWorkflowSend = jest.fn(() => ({ ok: true }));
const mockSetDraftApprovalPending = jest.fn();
const mockMarkDraftAutoSubmitted = jest.fn();
const mockMarkAutoReplySent = jest.fn();
const mockIsAutoReplyRateLimited = jest.fn(() => false);
const mockTryReserveAutoReplySlot = jest.fn(() => true);
const mockGetSyncInfo = jest.fn((key: string) =>
  key === 'auto_reply_enabled' ? '1' : null,
);
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
}));

jest.mock('../../electron/email/email-store', () => ({
  addMessageTag: (...args: unknown[]) => mockAddMessageTag(...args),
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

jest.mock('../../electron/email/email-crm-store', () => ({
  assignCategoryPathToMessage: jest.fn(),
  tryLinkMessageToCustomer: jest.fn(),
  listAiPrompts: jest.fn(() => []),
  listCannedResponses: jest.fn(() => [
    { id: 1, title: 'Bestellstatus', body: 'Ihre Bestellung {{customer.name}} ist unterwegs.' },
  ]),
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
  markAutoReplySent: (...args: unknown[]) => mockMarkAutoReplySent(...args),
  tryReserveAutoReplySlot: (...args: unknown[]) => mockTryReserveAutoReplySlot(...args),
}));

jest.mock('../../electron/workflow/draft-send-prep', () => ({
  prepareDraftForWorkflowSend: (...args: unknown[]) => mockPrepareDraftForWorkflowSend(...args),
  releaseOutboundHoldForDraft: jest.fn(() => ({ ok: true, autoSendScheduled: true })),
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

import { getWorkflowTemplate } from '../../packages/core/src/workflow/templates';
import { runWorkflowGraph } from '../../electron/workflow/runtime';

const inboundMessage = {
  id: 7,
  account_id: 1,
  uid: 100,
  subject: 'Frage zu Bestellung 1234',
  from_json: JSON.stringify({ value: [{ address: 'kunde@firma.de', name: 'Max Meier' }] }),
  to_json: null,
  cc_json: null,
  snippet: 'Wo bleibt meine Bestellung?',
  body_text: 'Hallo, wo bleibt meine Bestellung 1234?',
  raw_headers: 'From: kunde@firma.de\nSubject: Frage zu Bestellung 1234',
  has_attachments: 0,
  attachments_json: null,
  customer_id: 5,
} as unknown as EmailMessageRow;

function runTemplate(templateId: string) {
  const template = getWorkflowTemplate(templateId);
  if (!template) throw new Error(`Vorlage ${templateId} fehlt`);
  return runWorkflowGraph({
    workflow: { id: 1, graph_json: JSON.stringify(template.graph) } as never,
    trigger: 'inbound',
    direction: 'inbound',
    runId: 1,
    message: inboundMessage,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSyncInfo.mockImplementation((key: string) =>
    key === 'auto_reply_enabled' ? '1' : null,
  );
  mockIsAutoReplyRateLimited.mockReturnValue(false);
  mockTryReserveAutoReplySlot.mockReturnValue(true);
  mockCreateComposeDraft.mockReturnValue(42);
  mockPrepareDraftForWorkflowSend.mockReturnValue({ ok: true });
  mockDbRun.mockReturnValue({ lastInsertRowid: 99 });
  // ai.review_draft lädt den zuvor angelegten Entwurf.
  mockGetEmailMessageById.mockImplementation((id: number) =>
    id === 42
      ? { id: 42, subject: 'Re: Frage zu Bestellung 1234', body_text: 'Entwurfstext' }
      : undefined,
  );
});

describe('Vorlage "KI-Antwort mit Gegenprüfung" (inbound-ai-two-stage-reply)', () => {
  test('send-Pfad: Entwurf wird erstellt, gegengelesen und eingeplant', async () => {
    mockRunChatCompletion
      // 1) classify
      .mockResolvedValueOnce('Bestellstatus|92')
      // 2) draft_reply
      .mockResolvedValueOnce('Ihre Bestellung 1234 ist unterwegs und kommt morgen an.')
      // 3) review_draft
      .mockResolvedValueOnce('STATUS: SEND\nANSWERED: yes\nREASON: vollständig beantwortet');

    const r = await runTemplate('inbound-ai-two-stage-reply');
    expect(r.status).toBe('ok');

    // Entwurf korrekt adressiert + Thread-Bezug + RFC-3834-Marker
    const draftInput = mockCreateComposeDraft.mock.calls[0]![0] as Record<string, unknown>;
    expect(draftInput.toJson).toContain('kunde@firma.de');
    expect(String(draftInput.bodyText)).toContain('Mit freundlichen Grüßen');
    expect(mockUpdateComposeDraft).toHaveBeenCalledWith(42, { replyParentMessageId: 7 });

    // Versand eingeplant + Anti-Loop-Buchhaltung; keine Freigabe-Markierung
    expect(mockPrepareDraftForWorkflowSend).toHaveBeenCalledWith(42, {
      runOutboundReview: false,
      dryRun: false,
    });
    expect(mockTryReserveAutoReplySlot).toHaveBeenCalledWith(1, 'kunde@firma.de', 7);
    expect(mockSetDraftApprovalPending).not.toHaveBeenCalled();
  });

  test('hold-Pfad: Entwurf wartet auf Freigabe, Tag + Aufgabe statt Versand', async () => {
    mockRunChatCompletion
      .mockResolvedValueOnce('Bestellstatus|92')
      .mockResolvedValueOnce('Wir erstatten Ihnen pauschal 50 Euro.')
      .mockResolvedValueOnce('STATUS: HOLD\nANSWERED: no\nREASON: Kulanz-Zusage gehört vor einen Menschen');

    const r = await runTemplate('inbound-ai-two-stage-reply');
    expect(r.status).toBe('ok');

    expect(mockSetDraftApprovalPending).toHaveBeenCalledWith(
      42,
      'Kulanz-Zusage gehört vor einen Menschen',
    );
    expect(mockPrepareDraftForWorkflowSend).not.toHaveBeenCalled();
    expect(mockAddMessageTag).toHaveBeenCalledWith(7, 'ki-freigabe');
    // Aufgabe "KI-Entwurf prüfen: {{subject}}" — Platzhalter zentral gefüllt.
    // crm.create_task schreibt per SQL: (customer_id, title, …)
    const taskArgs = mockDbRun.mock.calls.find((c) => String(c[0]).includes('INSERT INTO'));
    expect(taskArgs?.[2]).toBe('KI-Entwurf prüfen: Frage zu Bestellung 1234');
  });

  test('unvollständiges Prüf-Urteil (SEND ohne ANSWERED): fail-safe in den hold-Pfad', async () => {
    mockRunChatCompletion
      .mockResolvedValueOnce('Bestellstatus|92')
      .mockResolvedValueOnce('Ihre Bestellung 1234 ist unterwegs.')
      // Kaputte/teilweise KI-Antwort — darf NICHT automatisch senden.
      .mockResolvedValueOnce('STATUS: SEND');

    const r = await runTemplate('inbound-ai-two-stage-reply');
    expect(r.status).toBe('ok');
    expect(mockPrepareDraftForWorkflowSend).not.toHaveBeenCalled();
    expect(mockSetDraftApprovalPending).toHaveBeenCalled();
    expect(mockAddMessageTag).toHaveBeenCalledWith(7, 'ki-freigabe');
  });

  test('blocked-Pfad (KI unsicher): kein Entwurf, Tag ki-manuell', async () => {
    mockRunChatCompletion.mockResolvedValueOnce('Sonstiges|40'); // unter minConfidence 80

    const r = await runTemplate('inbound-ai-two-stage-reply');
    expect(r.status).toBe('ok');
    expect(mockCreateComposeDraft).not.toHaveBeenCalled();
    expect(mockAddMessageTag).toHaveBeenCalledWith(7, 'ki-manuell');
  });

  test('blocked-Pfad (Schalter aus): kein Entwurf und KEIN Tag (kein Spam im Postfach)', async () => {
    mockGetSyncInfo.mockImplementation(() => null); // auto_reply_enabled aus
    mockRunChatCompletion.mockResolvedValueOnce('Bestellstatus|92');

    const r = await runTemplate('inbound-ai-two-stage-reply');
    expect(r.status).toBe('ok');
    expect(mockCreateComposeDraft).not.toHaveBeenCalled();
    expect(mockAddMessageTag).not.toHaveBeenCalledWith(7, 'ki-manuell');
  });
});

describe('Vorlage "KI antwortet mit Textbaustein" (inbound-ai-auto-reply)', () => {
  test('approved-Pfad: Baustein-Entwurf wird erstellt und eingeplant', async () => {
    mockRunChatCompletion
      .mockResolvedValueOnce('Bestellstatus|92') // classify
      .mockResolvedValueOnce('1'); // pick_canned wählt Baustein 1

    const r = await runTemplate('inbound-ai-auto-reply');
    expect(r.status).toBe('ok');
    // Baustein-Platzhalter gefüllt ({{customer.name}} aus CRM-Verknüpfung)
    const draftInput = mockCreateComposeDraft.mock.calls[0]![0] as Record<string, unknown>;
    expect(String(draftInput.bodyText)).toContain('Meier GmbH');
    expect(mockPrepareDraftForWorkflowSend).toHaveBeenCalledWith(42, {
      runOutboundReview: false,
      dryRun: false,
    });
  });

  test('kein passender Baustein (0): Versand schlägt kontrolliert fehl, kein Crash', async () => {
    mockRunChatCompletion
      .mockResolvedValueOnce('Bestellstatus|92')
      .mockResolvedValueOnce('0');

    const r = await runTemplate('inbound-ai-auto-reply');
    // send_draft findet kein draft.id → error im Branch, aber sauber gemeldet
    expect(r.status).toBe('error');
    expect(mockPrepareDraftForWorkflowSend).not.toHaveBeenCalled();
  });
});
