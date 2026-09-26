/**
 * KI-Entscheidung (ai.decide) in der Desktop-Edition: Knoten (electron/workflow/
 * nodes/ai-nodes.ts) und Runtime (Port-Routing, fail-closed Ports, Versandsperre,
 * Inbound-Gate). Gemockt sind nur Modulgrenzen (KI-Aufruf, Stores).
 */
import type { RegisteredWorkflowNode, WorkflowContext } from '../../electron/workflow/types';

jest.mock('../../electron/email/email-openai', () => ({
  runChatCompletion: jest.fn(),
  runAiDecideCall: jest.fn(),
}));

jest.mock('../../electron/email/email-store', () => ({
  addMessageTag: jest.fn(),
  setOutboundHold: jest.fn(),
  getEmailMessageById: jest.fn(),
  getEmailAccountById: jest.fn(),
  setMessageArchived: jest.fn(),
  setMessageSeenLocal: jest.fn(),
  setMessageSpam: jest.fn(),
}));

jest.mock('../../electron/email/email-crm-store', () => ({
  listAiPrompts: jest.fn(() => []),
  listCannedResponses: jest.fn(() => []),
  assignCategoryPathToMessage: jest.fn(),
  tryLinkMessageToCustomer: jest.fn(),
}));

jest.mock('../../electron/email/email-ai-profiles', () => ({
  resolvePromptProfileId: jest.fn(() => null),
}));

jest.mock('../../electron/sqlite-service', () => ({
  getDb: jest.fn(),
  getSyncInfo: jest.fn(() => null),
  setSyncInfo: jest.fn(),
  getCustomerById: jest.fn(() => null),
}));

jest.mock('../../electron/workflow/run-steps', () => ({
  startWorkflowRun: () => 1,
  finishWorkflowRun: jest.fn(),
  insertWorkflowRunStep: jest.fn(),
}));

import { runAiDecideCall } from '../../electron/email/email-openai';
import { addMessageTag, setOutboundHold } from '../../electron/email/email-store';
import { registerAiNodes } from '../../electron/workflow/nodes/ai-nodes';
import { runWorkflowGraph } from '../../electron/workflow/runtime';
import { ensureBuiltinWorkflowNodes, listWorkflowNodeCatalog } from '../../electron/workflow/registry';

const decideMock = runAiDecideCall as jest.Mock;

function collect(registerNodes: (register: (def: RegisteredWorkflowNode) => void) => void) {
  const defs = new Map<string, RegisteredWorkflowNode>();
  registerNodes((def) => defs.set(def.type, def));
  return defs;
}

const message = {
  id: 7,
  account_id: 1,
  subject: 'Frage zur Bestellung',
  from_json: JSON.stringify({ value: [{ address: 'kunde@firma.de' }] }),
  to_json: JSON.stringify({ value: [{ address: 'support@firma.de' }] }),
  cc_json: null,
  attachments_json: null,
  has_attachments: 0,
  body_text: 'Wo bleibt meine Bestellung 1234?',
  snippet: 'Wo bleibt…',
} as never;

function inboundCtx(overrides: Partial<WorkflowContext> = {}): WorkflowContext {
  return {
    trigger: 'inbound',
    direction: 'inbound',
    messageId: 7,
    message,
    outbound: null,
    workflowId: 1,
    runId: 1,
    dryRun: false,
    variables: {},
    strings: {
      subject: 'Frage zur Bestellung',
      body_text: 'Wo bleibt meine Bestellung 1234?',
      snippet: 'Wo bleibt…',
      from_address: 'kunde@firma.de',
      to_address: 'support@firma.de',
      cc_address: '',
      combined_text: 'Frage zur Bestellung\nWo bleibt meine Bestellung 1234?',
      attachment_names: '',
    },
    ai: {},
    ...overrides,
  } as WorkflowContext;
}

function outboundCtx(overrides: Partial<WorkflowContext> = {}): WorkflowContext {
  return inboundCtx({
    trigger: 'outbound',
    direction: 'outbound',
    messageId: 99,
    message: null,
    outbound: {
      messageId: 99,
      accountId: 1,
      subject: 'Ihr Angebot',
      bodyText: 'Anbei das Angebot.',
      to: 'kunde@firma.de',
      attachmentCount: 0,
    },
    strings: {
      subject: 'Ihr Angebot',
      body_text: 'Anbei das Angebot.',
      to_address: 'kunde@firma.de',
      combined_text: 'Ihr Angebot\nAnbei das Angebot.',
    },
    ...overrides,
  });
}

const decisions = (probability: number) => ({
  source: 'decisions',
  probability,
  modelAnswer: null,
  reason: '',
  model: 'typesafe/jev-1.13',
});

const node = collect(registerAiNodes).get('ai.decide')!;
const config = { question: 'Ist das Spam?', yesCriteria: 'Werbung', noCriteria: '', contextMode: 'full', threshold: 80, profileId: 4 };

describe('ai.decide Desktop-Knoten', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('ist im Desktop-Katalog registriert (in Vorlagen verwendbar)', () => {
    ensureBuiltinWorkflowNodes();
    expect(listWorkflowNodeCatalog().map((entry) => entry.type)).toContain('ai.decide');
  });

  test.each([
    [91, 'ja', 'Entscheidungsmodell: Ja (Ja-Wahrscheinlichkeit 91 %)'],
    [5, 'nein', 'Entscheidungsmodell: Nein (Ja-Wahrscheinlichkeit 5 %)'],
    [50, 'unsicher', 'Entscheidungsmodell: Unsicher (Ja-Wahrscheinlichkeit 50 %)'],
  ])('eingehend p=%i ⇒ Ausgang %s ohne Sperre', async (probability, port, summary) => {
    decideMock.mockResolvedValue(decisions(probability));
    const r = await node.execute(inboundCtx(), config, 'd');
    expect(r).toMatchObject({ status: 'ok', port, message: summary });
    expect(r.blocked).toBeUndefined();
    expect(r.variables).toMatchObject({
      'ai.decide.answer': port,
      'ai.decide.probability': probability,
      'ai.decide.summary': summary,
      'ai.decide.model': 'typesafe/jev-1.13',
    });
    expect(setOutboundHold).not.toHaveBeenCalled();
    const call = decideMock.mock.calls[0]![0];
    expect(call).toMatchObject({ profileId: 4, question: 'Ist das Spam?', yesCriteria: 'Werbung', noCriteria: '' });
    expect(call.contextText).toContain('Wo bleibt meine Bestellung 1234?');
    expect(call.state.email).toMatchObject({ subject: 'Frage zur Bestellung', from: 'kunde@firma.de' });
  });

  test('Mindest-Sicherheit aus dem Knoten gilt', async () => {
    decideMock.mockResolvedValue(decisions(70));
    expect((await node.execute(inboundCtx(), { ...config, threshold: 60 }, 'd')).port).toBe('ja');
    expect((await node.execute(inboundCtx(), config, 'd')).port).toBe('unsicher');
  });

  test('KI-Fehler ⇒ Ausgang error mit Modell und Zusammenfassung', async () => {
    decideMock.mockRejectedValue(Object.assign(new Error('offline'), { aiModel: 'typesafe/jev-1.13' }));
    const r = await node.execute(inboundCtx(), config, 'd');
    expect(r).toMatchObject({
      status: 'ok',
      port: 'error',
      variables: {
        'ai.decide.answer': 'error',
        'ai.decide.probability': null,
        'ai.decide.summary': 'KI-Fehler bei der Entscheidung: offline',
        'ai.decide.model': 'typesafe/jev-1.13',
      },
    });
    expect(r.blocked).toBeUndefined();
  });

  test('„Nur Kopfdaten“ schickt keinen Volltext', async () => {
    decideMock.mockResolvedValue(decisions(10));
    await node.execute(inboundCtx(), { ...config, contextMode: 'metadata' }, 'd');
    const call = decideMock.mock.calls[0]![0];
    expect(call.contextText).not.toContain('meine Bestellung 1234');
    expect(JSON.stringify(call.state)).not.toContain('meine Bestellung 1234');
  });

  test('ausgehend „nein“ (Entscheidungsmodell) ⇒ Sperre mit Standardtext und Ja-Wahrscheinlichkeit', async () => {
    decideMock.mockResolvedValue(decisions(12));
    const r = await node.execute(outboundCtx(), config, 'd');
    const reason = 'Vom Entscheidungsmodell als nicht versandfähig blockiert – bitte E-Mail prüfen. (Ja-Wahrscheinlichkeit 12 %)';
    expect(setOutboundHold).toHaveBeenCalledWith(99, true, reason);
    expect(r).toMatchObject({ status: 'ok', port: 'nein', blocked: true, blockReason: reason });
    const call = decideMock.mock.calls[0]![0];
    expect(call.contextText).toContain('Ausgehender E-Mail-Entwurf');
    expect(call.contextText).toContain('Anbei das Angebot.');
  });

  test('ausgehend „unsicher“ (Chat-Modell) ⇒ Begründung des Modells als Grund', async () => {
    decideMock.mockResolvedValue({ source: 'chat', probability: 60, modelAnswer: 'ja', reason: 'Preis fehlt.', model: 'gpt' });
    const r = await node.execute(outboundCtx(), config, 'd');
    expect(setOutboundHold).toHaveBeenCalledWith(99, true, 'Preis fehlt.');
    expect(r).toMatchObject({ port: 'unsicher', blocked: true, blockReason: 'Preis fehlt.' });
  });

  test('ausgehend KI-Fehler ⇒ Sperre mit festem Text', async () => {
    decideMock.mockRejectedValue(new Error('HTTP 500'));
    const r = await node.execute(outboundCtx(), config, 'd');
    const reason = 'KI-Fehler bei der Versandentscheidung – bitte E-Mail prüfen.';
    expect(setOutboundHold).toHaveBeenCalledWith(99, true, reason);
    expect(r).toMatchObject({ port: 'error', blocked: true, blockReason: reason });
  });

  test('ausgehend „ja“ ⇒ keine Sperre', async () => {
    decideMock.mockResolvedValue(decisions(95));
    const r = await node.execute(outboundCtx(), config, 'd');
    expect(r).toMatchObject({ status: 'ok', port: 'ja' });
    expect(r.blocked).toBeUndefined();
    expect(setOutboundHold).not.toHaveBeenCalled();
  });

  test('Testlauf: keine KI-Anfrage, „unsicher“; ausgehend ohne gespeicherte Sperre', async () => {
    const inbound = await node.execute(inboundCtx({ dryRun: true }), config, 'd');
    expect(inbound).toMatchObject({
      status: 'ok',
      port: 'unsicher',
      message: 'Testlauf: keine KI-Anfrage',
      variables: { 'ai.decide.answer': 'unsicher', 'ai.decide.summary': 'Testlauf: keine KI-Anfrage' },
    });
    const outbound = await node.execute(outboundCtx({ dryRun: true }), config, 'd');
    expect(outbound).toMatchObject({ port: 'unsicher', blocked: true });
    expect(decideMock).not.toHaveBeenCalled();
    expect(setOutboundHold).not.toHaveBeenCalled();
  });

  test('Versandvorschau (previewOutbound) entscheidet echt, speichert aber keine Sperre', async () => {
    decideMock.mockResolvedValue(decisions(3));
    const r = await node.execute(outboundCtx({ dryRun: true, previewOutbound: true }), config, 'd');
    expect(decideMock).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ port: 'nein', blocked: true });
    expect(setOutboundHold).not.toHaveBeenCalled();
  });

  test('ohne Frage ⇒ KI-Fehler ohne Aufruf', async () => {
    const r = await node.execute(inboundCtx(), { ...config, question: '  ' }, 'd');
    expect(r).toMatchObject({ port: 'error', variables: { 'ai.decide.summary': 'KI-Fehler bei der Entscheidung: Keine Frage angegeben' } });
    expect(decideMock).not.toHaveBeenCalled();
  });
});

describe('ai.decide in der Desktop-Runtime', () => {
  const workflow = (graph: unknown) => ({ id: 1, graph_json: JSON.stringify(graph) }) as never;
  const tag = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
    id,
    type: 'registry' as const,
    data: { nodeType: 'email.tag', config: { tag: name, ...extra } },
  });
  const decideNode = { id: 'dec', type: 'registry' as const, data: { nodeType: 'ai.decide', config: { ...config, question: 'Spam {{subject}}?' } } };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  async function runInbound(graph: unknown) {
    return runWorkflowGraph({
      workflow: workflow(graph),
      trigger: 'inbound',
      direction: 'inbound',
      runId: 1,
      message: { ...(message as object), is_spam: 0 } as never,
      dryRun: false,
    });
  }

  const threeWay = {
    version: 1,
    nodes: [
      { id: 't', type: 'trigger', data: { kind: 'inbound' } },
      decideNode,
      tag('tJa', 'ja'),
      tag('tNein', 'nein'),
      tag('tUnsicher', 'unsicher'),
    ],
    edges: [
      { id: 'e0', source: 't', target: 'dec' },
      { id: 'e1', source: 'dec', target: 'tJa', label: 'ja' },
      { id: 'e2', source: 'dec', target: 'tNein', label: 'nein' },
      { id: 'e3', source: 'dec', target: 'tUnsicher', label: 'unsicher' },
    ],
  };

  test.each([
    [95, 'ja'],
    [5, 'nein'],
    [50, 'unsicher'],
  ])('p=%i folgt der Kante %s (jeder Ausgang öffnet das Inbound-Gate)', async (probability, expectedTag) => {
    decideMock.mockResolvedValue(decisions(probability));
    const r = await runInbound(threeWay);
    expect(r.status).toBe('ok');
    expect(addMessageTag).toHaveBeenCalledTimes(1);
    expect(addMessageTag).toHaveBeenCalledWith(7, expectedTag);
    // Platzhalter in der Frage werden vor dem Aufruf gefüllt.
    expect(decideMock.mock.calls[0]![0].question).toBe('Spam Frage zur Bestellung?');
  });

  test('KI-Fehler nimmt nicht die „nein“-Kante (kein Umschreiben auf „no“)', async () => {
    decideMock.mockRejectedValue(new Error('offline'));
    const r = await runInbound(threeWay);
    expect(r.status).toBe('ok');
    expect(addMessageTag).not.toHaveBeenCalled();
    const withError = {
      ...threeWay,
      // Ohne runOnEveryInbound: auch der Ausgang „KI-Fehler“ öffnet das Gate.
      nodes: [...threeWay.nodes, tag('tErr', 'fehler')],
      edges: [...threeWay.edges, { id: 'e4', source: 'dec', target: 'tErr', label: 'error' }],
    };
    const r2 = await runInbound(withError);
    expect(addMessageTag).toHaveBeenCalledTimes(1);
    expect(addMessageTag).toHaveBeenCalledWith(7, 'fehler');
    expect(r2.log.join(' ')).not.toContain('no_prior_condition');
  });

  test('nur unbeschriftete Kante: „ja“ läuft weiter, „nein“/„unsicher“ enden (fail-closed)', async () => {
    const graph = {
      version: 1,
      nodes: [{ id: 't', type: 'trigger', data: { kind: 'inbound' } }, decideNode, tag('next', 'weiter')],
      edges: [
        { id: 'e0', source: 't', target: 'dec' },
        { id: 'e1', source: 'dec', target: 'next' },
      ],
    };
    decideMock.mockResolvedValue(decisions(5));
    await runInbound(graph);
    decideMock.mockResolvedValue(decisions(50));
    await runInbound(graph);
    expect(addMessageTag).not.toHaveBeenCalled();
    decideMock.mockResolvedValue(decisions(99));
    await runInbound(graph);
    expect(addMessageTag).toHaveBeenCalledWith(7, 'weiter');
  });

  test('ausgehend „nein“: Zusatzschritt am Ausgang läuft, der Lauf endet gesperrt', async () => {
    decideMock.mockResolvedValue(decisions(12));
    const graph = {
      version: 1,
      nodes: [
        { id: 't', type: 'trigger', data: { kind: 'outbound' } },
        decideNode,
        tag('tNein', 'ki-halt'),
      ],
      edges: [
        { id: 'e0', source: 't', target: 'dec' },
        { id: 'e2', source: 'dec', target: 'tNein', label: 'nein' },
      ],
    };
    const r = await runWorkflowGraph({
      workflow: workflow(graph),
      trigger: 'outbound',
      direction: 'outbound',
      runId: 1,
      // Wie evaluateOutboundWorkflows: die Entwurfszeile ist die Nachricht.
      message: { ...(message as object), id: 99 } as never,
      outbound: outboundCtx().outbound,
      dryRun: false,
    });
    expect(r.blocked).toBe(true);
    expect(r.blockReason).toBe(
      'Vom Entscheidungsmodell als nicht versandfähig blockiert – bitte E-Mail prüfen. (Ja-Wahrscheinlichkeit 12 %)',
    );
    expect(addMessageTag).toHaveBeenCalledWith(99, 'ki-halt');
    expect(setOutboundHold).toHaveBeenCalledWith(99, true, r.blockReason);
  });

  test('ausgehend „unsicher“ ohne Kante: gesperrt, keine weiteren Schritte', async () => {
    decideMock.mockResolvedValue(decisions(60));
    const graph = {
      version: 1,
      nodes: [{ id: 't', type: 'trigger', data: { kind: 'outbound' } }, decideNode, tag('next', 'weiter')],
      edges: [
        { id: 'e0', source: 't', target: 'dec' },
        { id: 'e1', source: 'dec', target: 'next' },
      ],
    };
    const r = await runWorkflowGraph({
      workflow: workflow(graph),
      trigger: 'outbound',
      direction: 'outbound',
      runId: 1,
      outbound: outboundCtx().outbound,
      dryRun: false,
    });
    expect(r).toMatchObject({ status: 'blocked', blocked: true });
    expect(addMessageTag).not.toHaveBeenCalled();
  });
});
