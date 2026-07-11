/**
 * Systematischer Beweis für den zentralen Interpolations-Pre-Pass:
 *
 * 1) Inventar: Alle (Knotentyp, Feld)-Paare mit interpolate:true im Katalog
 *    werden als feste Liste festgeschrieben — jede Änderung am Flag ist damit
 *    eine bewusste Entscheidung (Test anpassen).
 * 2) Verhalten: Für einen repräsentativen Querschnitt (email, crm, logic,
 *    integration, ai) läuft der ECHTE Graph-Interpreter (runWorkflowGraph)
 *    und die Tests prüfen, dass {{Platzhalter}} bereits AUFGELÖST beim
 *    gemockten Store/HTTP/KI-Aufruf ankommen.
 * 3) Negativ: Code-/SQL-Felder (mssql.query.sql, code.javascript.code,
 *    code.python.code) dürfen NIE zentral interpoliert werden.
 */
import type { EmailMessageRow } from '../../electron/email/email-store';

const mockRunChatCompletion = jest.fn(async () => 'OK');
const mockAddMessageTag = jest.fn();
const mockCreateComposeDraft = jest.fn(() => 42);
const mockUpdateComposeDraft = jest.fn();
const mockSendWorkflowForwardCopy = jest.fn(async () => ({ ok: true as const }));
const mockAssertWorkflowHttpUrlAllowed = jest.fn(async () => ({ ok: true as const }));
const mockFetch = jest.fn(async () => ({
  ok: true,
  status: 200,
  text: async () => 'OK',
}));
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

import { listBuiltinWorkflowNodeCatalog } from '../../packages/core/src/workflow/node-catalog';
import { runWorkflowGraph } from '../../electron/workflow/runtime';

const message = {
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

type GraphNode = { id: string; type: string; data: Record<string, unknown> };
type GraphEdge = { id: string; source: string; target: string; label?: string };

function graphJson(nodes: GraphNode[], edges: GraphEdge[]): string {
  return JSON.stringify({ version: 1, nodes, edges });
}

function registryNode(id: string, nodeType: string, config: Record<string, unknown>): GraphNode {
  return { id, type: 'registry', data: { nodeType, config } };
}

/** trigger(manual) → Knoten: Inbound-Gate greift nicht (direction !== 'inbound'). */
function runManualChain(...steps: Array<[string, Record<string, unknown>]>) {
  const nodes: GraphNode[] = [{ id: 't', type: 'trigger', data: { kind: 'manual' } }];
  const edges: GraphEdge[] = [];
  let prev = 't';
  steps.forEach(([nodeType, config], i) => {
    const id = `n${i + 1}`;
    nodes.push(registryNode(id, nodeType, config));
    edges.push({ id: `e${i + 1}`, source: prev, target: id });
    prev = id;
  });
  return runWorkflowGraph({
    workflow: { id: 1, graph_json: graphJson(nodes, edges) } as never,
    trigger: 'manual',
    direction: 'manual',
    runId: 1,
    message,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRunChatCompletion.mockResolvedValue('OK');
  mockCreateComposeDraft.mockReturnValue(42);
  mockSendWorkflowForwardCopy.mockResolvedValue({ ok: true });
  mockAssertWorkflowHttpUrlAllowed.mockResolvedValue({ ok: true });
  mockDbRun.mockReturnValue({ lastInsertRowid: 99 });
  mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => 'OK' });
  (globalThis as { fetch: unknown }).fetch = mockFetch;
});

describe('Interpolations-Inventar (Schema-Flag interpolate:true)', () => {
  const pairs = listBuiltinWorkflowNodeCatalog()
    .flatMap(
      (entry) =>
        entry.fields
          ?.filter((f) => f.interpolate === true)
          .map((f) => `${entry.type}:${f.key}`) ?? [],
    )
    .sort();

  test('exakt diese (Knotentyp, Feld)-Paare sind interpolierbar — Änderungen sind bewusste Entscheidungen', () => {
    expect(pairs).toEqual([
      'ai.agent:systemPrompt',
      'ai.draft_reply:systemPrompt',
      'ai.review_draft:reviewPrompt',
      'crm.create_task:title',
      'crm.log_activity:title',
      'crm.update_deal:title',
      'email.create_draft:bodyPrefix',
      'email.forward_copy:to',
      'email.hold_outbound:reason',
      'email.mark_spam:tag',
      'email.move_imap:folderPath',
      'email.set_category:path',
      'email.set_spam_status:tag',
      'email.tag:tag',
      'email.tag_attachment_meta:tag',
      'http.request:body',
      'http.request:url',
      'jtl.prepare_action:note',
      'logic.set_variable:value',
    ]);
  });

  test('Negativ: SQL- und Code-Felder werden NIE zentral interpoliert', () => {
    expect(pairs).not.toContain('mssql.query:sql');
    expect(pairs).not.toContain('code.javascript:code');
    expect(pairs).not.toContain('code.python:code');
  });

  test('Negativ: kein Feld vom Typ "code" trägt das interpolate-Flag', () => {
    const codeFieldsWithFlag = listBuiltinWorkflowNodeCatalog().flatMap(
      (entry) =>
        entry.fields
          ?.filter((f) => f.type === 'code' && f.interpolate === true)
          .map((f) => `${entry.type}:${f.key}`) ?? [],
    );
    expect(codeFieldsWithFlag).toEqual([]);
  });
});

describe('Pre-Pass löst {{Platzhalter}} vor execute() auf (echter Interpreter)', () => {
  test('email.tag: Tag kommt mit aufgelöstem {{subject}} im Store an — inklusive Inbound-Gate nach Bedingung', async () => {
    // Inbound-Variante mit vorgeschalteter Bedingung (Gate-Regel: Seiteneffekt
    // nur nach passender Bedingung) — beweist Interpolation auch hinter dem Gate.
    const nodes: GraphNode[] = [
      { id: 't', type: 'trigger', data: { kind: 'inbound' } },
      {
        id: 'c',
        type: 'condition',
        data: { field: 'subject', op: 'contains', value: 'Bestellung' },
      },
      registryNode('n1', 'email.tag', { tag: 'thema-{{subject}}' }),
    ];
    const edges: GraphEdge[] = [
      { id: 'e1', source: 't', target: 'c' },
      { id: 'e2', source: 'c', target: 'n1', label: 'yes' },
    ];
    const r = await runWorkflowGraph({
      workflow: { id: 1, graph_json: graphJson(nodes, edges) } as never,
      trigger: 'inbound',
      direction: 'inbound',
      runId: 1,
      message,
    });
    expect(r.status).toBe('ok');
    expect(mockAddMessageTag).toHaveBeenCalledWith(7, 'thema-Frage zu Bestellung 1234');
  });

  test('email.create_draft: bodyPrefix mit {{subject}} landet aufgelöst im Entwurfstext', async () => {
    const r = await runManualChain([
      'email.create_draft',
      { bodyPrefix: 'Bezug: {{subject}}' },
    ]);
    expect(r.status).toBe('ok');
    const draftInput = mockCreateComposeDraft.mock.calls[0]![0] as Record<string, unknown>;
    expect(String(draftInput.bodyText)).toContain('Bezug: Frage zu Bestellung 1234');
    expect(String(draftInput.bodyText)).not.toContain('{{subject}}');
  });

  test('email.forward_copy: Empfänger {{customer.email}} wird vor dem Versand aufgelöst', async () => {
    const r = await runManualChain(['email.forward_copy', { to: '{{customer.email}}' }]);
    expect(r.status).toBe('ok');
    const call = mockSendWorkflowForwardCopy.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.to).toBe('kunde@firma.de');
    expect(call.sourceMessageId).toBe(7);
  });

  test('crm.create_task: Titel mit {{subject}} kommt aufgelöst im SQL-INSERT an', async () => {
    const r = await runManualChain(['crm.create_task', { title: 'Prüfen: {{subject}}' }]);
    expect(r.status).toBe('ok');
    const insert = mockDbRun.mock.calls.find((c) => String(c[0]).includes('INSERT INTO'));
    // run(customerId, title, description, dueDate, priority) — Titel ist Arg 2.
    expect(insert?.[1]).toBe(5);
    expect(insert?.[2]).toBe('Prüfen: Frage zu Bestellung 1234');
  });

  test('logic.set_variable: Wert wird interpoliert und steht Folgeknoten als Variable bereit', async () => {
    const r = await runManualChain(
      ['logic.set_variable', { name: 'gruss', value: 'Hallo {{customer.name}}' }],
      ['email.tag', { tag: '{{gruss}}' }],
    );
    expect(r.status).toBe('ok');
    // Beweist beides: value wurde beim Setzen aufgelöst UND die Variable
    // ist im nächsten interpolate-Feld verfügbar.
    expect(mockAddMessageTag).toHaveBeenCalledWith(7, 'Hallo Meier GmbH');
  });

  test('http.request: url UND body werden vor Guard/fetch aufgelöst', async () => {
    const r = await runManualChain([
      'http.request',
      {
        method: 'POST',
        url: 'https://api.example.com/hook?betreff={{subject}}',
        body: '{"betreff":"{{subject}}"}',
      },
    ]);
    expect(r.status).toBe('ok');
    // SSRF-Guard sieht bereits die aufgelöste URL.
    expect(mockAssertWorkflowHttpUrlAllowed).toHaveBeenCalledWith(
      'https://api.example.com/hook?betreff=Frage zu Bestellung 1234',
      '',
    );
    const [url, init] = mockFetch.mock.calls[0]! as unknown as [string, { method: string; body?: string }];
    expect(url).toBe('https://api.example.com/hook?betreff=Frage zu Bestellung 1234');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"betreff":"Frage zu Bestellung 1234"}');
  });

  test('ai.agent: systemPrompt erreicht die KI mit aufgelöstem {{subject}}', async () => {
    const r = await runManualChain([
      'ai.agent',
      { systemPrompt: 'Fasse zusammen: {{subject}}', createDraft: false },
    ]);
    expect(r.status).toBe('ok');
    const [system] = mockRunChatCompletion.mock.calls[0]! as unknown as [string, string];
    expect(system).toBe('Fasse zusammen: Frage zu Bestellung 1234');
  });

  test('Gegenprobe mssql.query: {{q}} im SQL bleibt UNVERÄNDERT stehen (keine Interpolation in SQL)', async () => {
    // Unterscheidungskräftiger Aufbau: die Variable q enthält ein GÜLTIGES
    // SELECT. WÜRDE der Pre-Pass config.sql interpolieren, käme der Knoten am
    // Nur-SELECT-Guard vorbei. Da mssql.query kein interpolate-Flag hat, sieht
    // der Guard den Roh-String "{{q}}" und lehnt ab.
    const r = await runManualChain(
      ['logic.set_variable', { name: 'q', value: 'SELECT 1 AS ok' }],
      ['mssql.query', { sql: '{{q}}' }],
    );
    expect(r.status).toBe('error');
    const step = mockInsertRunStep.mock.calls
      .map((c) => c[0] as { nodeType: string; status: string; message: string | null })
      .find((s) => s.nodeType === 'mssql.query');
    expect(step?.status).toBe('error');
    expect(step?.message).toBe('Query muss mit SELECT beginnen');
  });
});
