/**
 * KI-Knoten (electron/workflow/nodes/ai-nodes.ts): direkte execute()-Tests für
 * ai.classify, ai.transform_text, ai.agent, ai.agent_tool, ai.pick_canned,
 * ai.review und ai.outbound_review — nur Modulgrenzen (Stores, OpenAI, KB) gemockt.
 */
import type { RegisteredWorkflowNode, WorkflowContext } from '../../electron/workflow/types';

jest.mock('../../electron/email/email-openai', () => ({
  runChatCompletion: jest.fn(),
}));

jest.mock('../../electron/email/email-store', () => ({
  addMessageTag: jest.fn(),
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
  listAccountSignatureRows: jest.fn(() => []),
}));

jest.mock('../../electron/email/email-crm-store', () => ({
  listAiPrompts: jest.fn(() => []),
  listCannedResponses: jest.fn(() => []),
}));

jest.mock('../../electron/email/email-ai-profiles', () => ({
  resolvePromptProfileId: jest.fn(() => null),
}));

jest.mock('../../electron/workflow/knowledge-base', () => ({
  searchKnowledgeChunks: jest.fn(async () => [
    { id: 5, title: null, content: 'KB-Inhalt aus expliziter Wissensbasis.' },
  ]),
  searchKnowledgeForWorkflow: jest.fn(async () => [
    { id: 1, title: 'FAQ Retouren', content: 'Retouren über das Portal anmelden.' },
  ]),
}));

jest.mock('../../electron/email/email-draft-approval', () => ({
  markDraftAutoSubmitted: jest.fn(),
  setDraftApprovalPending: jest.fn(),
}));

jest.mock('../../electron/sqlite-service', () => ({
  getSyncInfo: jest.fn(() => null),
  setSyncInfo: jest.fn(),
}));

import { runChatCompletion } from '../../electron/email/email-openai';
import {
  addMessageTag,
  createComposeDraft,
  setOutboundHold,
  updateComposeDraft,
} from '../../electron/email/email-store';
import { listAiPrompts, listCannedResponses } from '../../electron/email/email-crm-store';
import {
  searchKnowledgeChunks,
  searchKnowledgeForWorkflow,
} from '../../electron/workflow/knowledge-base';
import { registerAiNodes } from '../../electron/workflow/nodes/ai-nodes';

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
  to_json: null,
  cc_json: null,
  attachments_json: null,
  has_attachments: 0,
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
    variables: {},
    strings: {
      subject: baseMessage.subject,
      from_address: 'kunde@firma.de',
      combined_text: 'Frage zu Bestellung 1234\nWo bleibt meine Bestellung?',
    },
    ai: {},
    ...overrides,
  } as WorkflowContext;
}

function outboundCtx(overrides: Partial<WorkflowContext> = {}): WorkflowContext {
  return ctx({
    direction: 'outbound',
    messageId: null,
    message: null,
    outbound: {
      messageId: 99,
      accountId: 1,
      subject: 'Ihr Angebot',
      bodyText: 'Anbei das versprochene Angebot.',
      to: 'kunde@firma.de',
      attachmentCount: 0,
    },
    strings: {
      subject: 'Ihr Angebot',
      from_address: '',
      combined_text: 'Ihr Angebot\nAnbei das versprochene Angebot.',
    },
    ...overrides,
  });
}

const defs = collect(registerAiNodes);

describe('ai.classify — KI-Klassifizierung', () => {
  const node = defs.get('ai.classify')!;

  beforeEach(() => {
    jest.clearAllMocks();
    (runChatCompletion as jest.Mock).mockResolvedValue('Rechnung|85');
  });

  test('"Rechnung|85" → Variablen ai.class/ai.class_confidence und Tag ki:Rechnung', async () => {
    const r = await node.execute(ctx(), { labels: 'Rechnung,Support,Spam' }, 'k');
    expect(r.status).toBe('ok');
    expect(r.variables).toEqual({ 'ai.class': 'Rechnung', 'ai.class_confidence': 85 });
    expect(addMessageTag).toHaveBeenCalledWith(7, 'ki:Rechnung');

    // Standard-Kontextmodus "metadata": kein E-Mail-Volltext im Prompt.
    const [system, prompt] = (runChatCompletion as jest.Mock).mock.calls[0]!;
    expect(system).toBe('Du bist ein E-Mail-Klassifizierer.');
    expect(prompt).toContain('Rechnung, Support, Spam');
    expect(prompt).toContain('Frage zu Bestellung 1234');
    expect(prompt).not.toContain('Wo bleibt meine Bestellung?');
  });

  test('leere Label-Liste → skipped ohne KI-Aufruf', async () => {
    const r = await node.execute(ctx(), { labels: ' , ' }, 'k');
    expect(r.status).toBe('skipped');
    expect(runChatCompletion).not.toHaveBeenCalled();
    expect(addMessageTag).not.toHaveBeenCalled();
  });

  test('unbrauchbare KI-Antwort ohne "|Zahl" → Confidence 0', async () => {
    (runChatCompletion as jest.Mock).mockResolvedValue('Unbekannt');
    const r = await node.execute(ctx(), { labels: 'Rechnung,Support' }, 'k');
    expect(r.status).toBe('ok');
    expect(r.variables?.['ai.class']).toBe('Unbekannt');
    expect(r.variables?.['ai.class_confidence']).toBe(0);
  });
});

describe('ai.transform_text — Prompt-Auflösung und Zielvariable', () => {
  const node = defs.get('ai.transform_text')!;
  const prompts = [
    { id: 1, label: 'Kürzen', user_template: 'Kürze: {{text}}', target: '', profile_id: null, account_id: null },
    { id: 2, label: 'Übersetzen', user_template: 'Übersetze: {{subject}}', target: '', profile_id: null, account_id: null },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (listAiPrompts as jest.Mock).mockReturnValue(prompts);
    (runChatCompletion as jest.Mock).mockResolvedValue('Bearbeiteter Text');
  });

  test('promptId 0 → erster Bibliotheks-Prompt, Ergebnis unter ai.text', async () => {
    const r = await node.execute(ctx(), { promptId: 0 }, 't');
    expect(r.status).toBe('ok');
    expect(r.variables).toEqual({ 'ai.text': 'Bearbeiteter Text' });
    expect(runChatCompletion).toHaveBeenCalledWith(
      expect.stringContaining('Assistent für geschäftliche E-Mails'),
      'Kürze: Frage zu Bestellung 1234\nWo bleibt meine Bestellung?',
      null,
    );
  });

  test('expliziter Prompt + targetVariable + profileId werden durchgereicht', async () => {
    const r = await node.execute(ctx(), { promptId: 2, targetVariable: 'mail.uebersetzung', profileId: 7 }, 't');
    expect(r.variables).toEqual({ 'mail.uebersetzung': 'Bearbeiteter Text' });
    expect(runChatCompletion).toHaveBeenCalledWith(
      expect.any(String),
      'Übersetze: Frage zu Bestellung 1234',
      7,
    );
  });

  test('keine Prompts in der Bibliothek → error "Prompt nicht gefunden"', async () => {
    (listAiPrompts as jest.Mock).mockReturnValue([]);
    const r = await node.execute(ctx(), { promptId: 0 }, 't');
    expect(r).toMatchObject({ status: 'error', message: 'Prompt nicht gefunden' });
    expect(runChatCompletion).not.toHaveBeenCalled();
  });

  test('dry-run → ok ohne KI-Aufruf und ohne Variablen', async () => {
    const r = await node.execute(ctx({ dryRun: true }), { promptId: 0 }, 't');
    expect(r.status).toBe('ok');
    expect(r.variables).toBeUndefined();
    expect(runChatCompletion).not.toHaveBeenCalled();
  });
});

describe('ai.agent — Wissensbasis-Auswahl und Entwurf', () => {
  const node = defs.get('ai.agent')!;

  beforeEach(() => {
    jest.clearAllMocks();
    (runChatCompletion as jest.Mock).mockResolvedValue('Agent-Antwort');
  });

  test('knowledgeBaseId gesetzt → searchKnowledgeChunks, Chunk ohne Titel als "Chunk #id"', async () => {
    const r = await node.execute(ctx(), { knowledgeBaseId: 3, systemPrompt: 'Sys' }, 'a');
    expect(searchKnowledgeChunks).toHaveBeenCalledWith(
      3,
      'Frage zu Bestellung 1234\nWo bleibt meine Bestellung?',
      5,
    );
    expect(searchKnowledgeForWorkflow).not.toHaveBeenCalled();
    expect(r.variables).toMatchObject({
      'ai.agent.response': 'Agent-Antwort',
      'ai.agent.source_count': 1,
      'ai.agent.sources': 'Chunk #5',
    });
    // KB-Inhalt landet im User-Prompt.
    const [system, user] = (runChatCompletion as jest.Mock).mock.calls[0]!;
    expect(system).toBe('Sys');
    expect(user).toContain('KB-Inhalt aus expliziter Wissensbasis.');
  });

  test('ohne knowledgeBaseId → searchKnowledgeForWorkflow mit Konto und Richtung', async () => {
    const r = await node.execute(ctx(), {}, 'a');
    expect(searchKnowledgeForWorkflow).toHaveBeenCalledWith(
      1,
      'inbound',
      'Frage zu Bestellung 1234\nWo bleibt meine Bestellung?',
      5,
    );
    expect(searchKnowledgeChunks).not.toHaveBeenCalled();
    expect(r.variables?.['ai.agent.sources']).toBe('FAQ Retouren');
  });

  test('createDraft (Standard) → adressierter Antwort-Entwurf mit Thread-Bezug + draft.id', async () => {
    const r = await node.execute(ctx(), {}, 'a');
    expect(createComposeDraft).toHaveBeenCalledWith({
      accountId: 1,
      subject: 'Re: Frage zu Bestellung 1234',
      bodyText: 'Agent-Antwort',
      toJson: expect.stringContaining('kunde@firma.de'),
    });
    expect(updateComposeDraft).toHaveBeenCalledWith(42, { replyParentMessageId: 7 });
    expect(r.variables?.['draft.id']).toBe(42);
  });

  test('createDraft: false → kein Entwurf, keine draft.id-Variable', async () => {
    const r = await node.execute(ctx(), { createDraft: false }, 'a');
    expect(createComposeDraft).not.toHaveBeenCalled();
    expect(r.variables).not.toHaveProperty('draft.id');
    expect(r.variables?.['ai.agent.response']).toBe('Agent-Antwort');
  });
});

describe('ai.agent_tool — Werkzeuge', () => {
  const node = defs.get('ai.agent_tool')!;

  beforeEach(() => jest.clearAllMocks());

  test('search_knowledge mit Wissensbasis → Chunk-Inhalte als tool.result', async () => {
    const r = await node.execute(ctx(), { tool: 'search_knowledge', knowledgeBaseId: 3 }, 'w');
    expect(searchKnowledgeChunks).toHaveBeenCalledWith(
      3,
      'Frage zu Bestellung 1234\nWo bleibt meine Bestellung?',
      3,
    );
    expect(r.status).toBe('ok');
    expect(r.variables?.['tool.result']).toBe('KB-Inhalt aus expliziter Wissensbasis.');
  });

  test('search_knowledge ohne Wissensbasis → skipped', async () => {
    const r = await node.execute(ctx(), { tool: 'search_knowledge' }, 'w');
    expect(r).toMatchObject({ status: 'skipped', message: 'Keine Wissensbasis' });
    expect(searchKnowledgeChunks).not.toHaveBeenCalled();
  });

  test('get_canned → Titel der Textbausteine', async () => {
    (listCannedResponses as jest.Mock).mockReturnValue([
      { id: 11, title: 'Versandstatus', body: 'x' },
      { id: 12, title: 'Retoure', body: 'y' },
    ]);
    const r = await node.execute(ctx(), { tool: 'get_canned' }, 'w');
    expect(r.variables?.['tool.result']).toBe('Versandstatus, Retoure');
  });

  test('unbekanntes Tool → Echo des kombinierten Texts (max. 500 Zeichen)', async () => {
    const long = 'x'.repeat(600);
    const r = await node.execute(
      ctx({ strings: { combined_text: long } as never }),
      { tool: 'irgendwas' },
      'w',
    );
    expect(r.variables?.['tool.result']).toBe('x'.repeat(500));
  });
});

describe('ai.pick_canned — KI wählt Textbaustein', () => {
  const node = defs.get('ai.pick_canned')!;
  const canned = [
    { id: 11, title: 'Versandstatus', body: 'Ihre Sendung zu "{{subject}}" ist unterwegs.' },
    { id: 12, title: 'Retoure', body: 'Retoure zu "{{subject}}" bitte im Portal anmelden.' },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (listCannedResponses as jest.Mock).mockReturnValue(canned);
  });

  test('Antwort "2" → zweiter Baustein, interpolierter Entwurf mit Thread-Bezug', async () => {
    (runChatCompletion as jest.Mock).mockResolvedValue('2');
    const r = await node.execute(ctx(), { profileId: 5 }, 'p');
    expect(r.status).toBe('ok');
    expect(r.variables).toMatchObject({
      'ai.canned.pick': 2,
      'ai.canned.id': 12,
      'ai.canned.title': 'Retoure',
      'ai.canned.text': 'Retoure zu "Frage zu Bestellung 1234" bitte im Portal anmelden.',
      'draft.id': 42,
    });

    // profileId wird als drittes Argument an die KI durchgereicht.
    expect(runChatCompletion).toHaveBeenCalledWith(
      expect.stringContaining('Textbaustein'),
      expect.stringContaining('1. Versandstatus'),
      5,
    );

    const draftInput = (createComposeDraft as jest.Mock).mock.calls[0]![0];
    expect(draftInput.subject).toBe('Re: Frage zu Bestellung 1234');
    expect(draftInput.bodyText).toContain('Retoure zu "Frage zu Bestellung 1234"');
    expect(draftInput.toJson).toContain('kunde@firma.de');
    expect(updateComposeDraft).toHaveBeenCalledWith(42, { replyParentMessageId: 7 });
  });

  test('Antwort "0" → kein Entwurf, ai.canned.no_match', async () => {
    (runChatCompletion as jest.Mock).mockResolvedValue('0');
    const r = await node.execute(ctx(), {}, 'p');
    expect(r.status).toBe('ok');
    expect(r.variables).toMatchObject({ 'ai.canned.pick': 0, 'ai.canned.no_match': true });
    expect(createComposeDraft).not.toHaveBeenCalled();
    expect(r.variables).not.toHaveProperty('draft.id');
  });

  test('Nummer außerhalb der Liste → wie kein Treffer (pick 0)', async () => {
    (runChatCompletion as jest.Mock).mockResolvedValue('7');
    const r = await node.execute(ctx(), {}, 'p');
    expect(r.variables?.['ai.canned.pick']).toBe(0);
    expect(createComposeDraft).not.toHaveBeenCalled();
  });

  test('keine Textbausteine → error ohne KI-Aufruf', async () => {
    (listCannedResponses as jest.Mock).mockReturnValue([]);
    const r = await node.execute(ctx(), {}, 'p');
    expect(r).toMatchObject({ status: 'error', message: 'Keine Textbausteine vorhanden' });
    expect(runChatCompletion).not.toHaveBeenCalled();
  });
});

describe('ai.review — KI-Prüfung (ein- und ausgehend)', () => {
  const node = defs.get('ai.review')!;

  beforeEach(() => {
    jest.clearAllMocks();
    (listAiPrompts as jest.Mock).mockReturnValue([
      { id: 1, label: 'Check', user_template: 'Prüfe: {{text}}', target: '', profile_id: null, account_id: null },
    ]);
  });

  test('outbound BLOCK → setOutboundHold mit Grund + blocked:true', async () => {
    (runChatCompletion as jest.Mock).mockResolvedValue('STATUS: BLOCK\nREASON: Unhöflicher Ton');
    const r = await node.execute(outboundCtx(), {}, 'r');
    expect(setOutboundHold).toHaveBeenCalledWith(99, true, 'Unhöflicher Ton');
    expect(r).toMatchObject({ status: 'ok', blocked: true, blockReason: 'Unhöflicher Ton' });
  });

  test('inbound BLOCK → Tag ki-review-block, aber schlichtes ok (kein blocked/port)', async () => {
    (runChatCompletion as jest.Mock).mockResolvedValue('BLOCK');
    const r = await node.execute(ctx(), {}, 'r');
    expect(addMessageTag).toHaveBeenCalledWith(7, 'ki-review-block');
    expect(setOutboundHold).not.toHaveBeenCalled();
    expect(r.status).toBe('ok');
    expect(r.blocked).toBeUndefined();
    expect(r.port).toBeUndefined();
  });

  test('OK → ok ohne Tag und ohne Hold', async () => {
    (runChatCompletion as jest.Mock).mockResolvedValue('OK');
    const r = await node.execute(ctx(), {}, 'r');
    expect(r).toMatchObject({ status: 'ok' });
    expect(addMessageTag).not.toHaveBeenCalled();
    expect(setOutboundHold).not.toHaveBeenCalled();
  });

  test('keine Prompts → error "Prompt nicht gefunden"', async () => {
    (listAiPrompts as jest.Mock).mockReturnValue([]);
    const r = await node.execute(ctx(), {}, 'r');
    expect(r).toMatchObject({ status: 'error', message: 'Prompt nicht gefunden' });
  });
});

describe('ai.outbound_review — KI-Ausgangsprüfung (fail-closed)', () => {
  const node = defs.get('ai.outbound_review')!;

  beforeEach(() => {
    jest.clearAllMocks();
    (listAiPrompts as jest.Mock).mockReturnValue([]);
  });

  test('nicht-outbound → skipped', async () => {
    const r = await node.execute(ctx(), {}, 'o');
    expect(r).toMatchObject({ status: 'skipped', message: 'Nur für ausgehende E-Mails' });
    expect(runChatCompletion).not.toHaveBeenCalled();
  });

  test('STATUS: BLOCK → setOutboundHold mit deutschem Grund', async () => {
    (runChatCompletion as jest.Mock).mockResolvedValue(
      'STATUS: BLOCK\nREASON: Anhang fehlt laut Text\nCODE: MISSING_ATTACHMENT',
    );
    const r = await node.execute(outboundCtx(), {}, 'o');
    expect(setOutboundHold).toHaveBeenCalledWith(99, true, 'Anhang fehlt laut Text');
    expect(r).toMatchObject({ status: 'ok', blocked: true, blockReason: 'Anhang fehlt laut Text' });
  });

  test('STATUS: OK → ok ohne Hold', async () => {
    (runChatCompletion as jest.Mock).mockResolvedValue('STATUS: OK');
    const r = await node.execute(outboundCtx(), {}, 'o');
    expect(r).toMatchObject({ status: 'ok' });
    expect(setOutboundHold).not.toHaveBeenCalled();
  });

  test('KI-Fehler → Hold + blocked (fail-closed statt Versand)', async () => {
    (runChatCompletion as jest.Mock).mockRejectedValue(new Error('offline'));
    const r = await node.execute(outboundCtx(), {}, 'o');
    expect(setOutboundHold).toHaveBeenCalledWith(99, true, 'KI-Fehler: offline');
    expect(r).toMatchObject({ status: 'error', blocked: true, blockReason: 'KI-Fehler: offline' });
  });
});
