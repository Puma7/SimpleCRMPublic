/**
 * F-A9-03 (Desktop): email.forward_copy muss eine Mail, die selbst schon eine
 * automatische Weiterleitung ist (Auto-Submitted: auto-forwarded), ueberspringen.
 * Sonst leitet ein Workflow seine eigene Kopie endlos weiter.
 */
import type { EmailMessageRow } from '../../electron/email/email-store';

const mockRunChatCompletion = jest.fn(async () => 'OK');
const mockAddMessageTag = jest.fn();
const mockCreateComposeDraft = jest.fn(() => 42);
const mockUpdateComposeDraft = jest.fn();
const mockSendWorkflowForwardCopy = jest.fn(async () => ({ ok: true as const }));
const mockAssertWorkflowHttpUrlAllowed = jest.fn(async () => ({ ok: true as const }));
const mockGetSyncInfo = jest.fn(() => null);
const mockInsertRunStep = jest.fn();
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
  runChatCompletion: (...args: unknown[]) => mockRunChatCompletion(...(args as [])),
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
  getEmailMessageById: jest.fn(() => undefined),
  createComposeDraft: (...args: unknown[]) => mockCreateComposeDraft(...(args as [])),
  updateComposeDraft: (...args: unknown[]) => mockUpdateComposeDraft(...args),
  listAccountSignatureRows: jest.fn(() => []),
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

jest.mock('../../electron/workflow/run-steps', () => ({
  insertWorkflowRunStep: (...args: unknown[]) => mockInsertRunStep(...args),
}));

jest.mock('../../electron/email/mail-security-store', () => ({
  securityVariablesFromRow: jest.fn(() => ({})),
}));

jest.mock('../../electron/sqlite-service', () => ({
  getDb: (...args: unknown[]) => mockGetDb(...(args as [])),
  getSyncInfo: (...args: unknown[]) => mockGetSyncInfo(...(args as [])),
  setSyncInfo: jest.fn(),
  getCustomerById: jest.fn(() => ({ id: 5, name: 'Meier GmbH', email: 'kunde@firma.de' })),
  createActivityLog: jest.fn(),
  updateDealStage: jest.fn(() => ({ success: true })),
}));

// Modul-Grenze für email.forward_copy (dynamischer Import im Executor).
jest.mock('../../electron/email/email-forward-copy', () => ({
  sendWorkflowForwardCopy: (...args: unknown[]) => mockSendWorkflowForwardCopy(...(args as [])),
}));

// Modul-Grenze für http.request: SSRF-Guard weggemockt, damit kein DNS läuft.
jest.mock('../../electron/workflow/http-request-guard', () => ({
  assertWorkflowHttpUrlAllowed: (...args: unknown[]) =>
    mockAssertWorkflowHttpUrlAllowed(...(args as [])),
}));

import { runWorkflowGraph } from '../../electron/workflow/runtime';

function messageWithHeaders(rawHeaders: string): EmailMessageRow {
  return {
    id: 7,
    account_id: 1,
    uid: 100,
    subject: 'Rechnung 4711',
    from_json: JSON.stringify({ value: [{ address: 'rechnung@lieferant.example' }] }),
    to_json: null,
    cc_json: null,
    snippet: 'Rechnung im Anhang',
    body_text: 'Rechnung im Anhang',
    raw_headers: rawHeaders,
    has_attachments: 0,
    attachments_json: null,
    customer_id: null,
  } as unknown as EmailMessageRow;
}

function runForward(rawHeaders: string) {
  const graph = {
    version: 1,
    nodes: [
      { id: 't', type: 'trigger', data: { kind: 'manual' } },
      { id: 'fwd', type: 'registry', data: { nodeType: 'email.forward_copy', config: { to: 'buchhaltung@firma.de' } } },
    ],
    edges: [{ id: 'e1', source: 't', target: 'fwd' }],
  };
  return runWorkflowGraph({
    workflow: { id: 1, graph_json: JSON.stringify(graph) } as never,
    trigger: 'manual',
    direction: 'manual',
    runId: 1,
    message: messageWithHeaders(rawHeaders),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSendWorkflowForwardCopy.mockResolvedValue({ ok: true });
});

describe('desktop email.forward_copy anti-loop', () => {
  // F-A9-03: Die Kopie trug Auto-Submitted: auto-forwarded, der Knoten prüfte das
  // aber nicht und schickte die zurückkommende Kopie erneut weiter.
  test('skips a message that is itself an automatic forward', async () => {
    const result = await runForward('Auto-Submitted: auto-forwarded\r\nSubject: Fwd: Rechnung 4711');

    expect(result.status).toBe('ok');
    expect(mockSendWorkflowForwardCopy).not.toHaveBeenCalled();
    expect(mockInsertRunStep).toHaveBeenCalledWith(
      expect.objectContaining({ nodeId: 'fwd', status: 'skipped', message: 'skip:auto_forwarded_source' }),
    );
  });

  test.each([
    ['auto-generated', 'Auto-Submitted: auto-generated'],
    ['bulk', 'Precedence: bulk'],
  ])('still forwards %s mail such as invoices', async (_label, rawHeaders) => {
    await runForward(rawHeaders);

    expect(mockSendWorkflowForwardCopy).toHaveBeenCalledTimes(1);
  });
});
