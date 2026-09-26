import {
  AI_DECIDE_DRY_RUN_SUMMARY,
  AI_DECIDE_OUTBOUND_BLOCK_REASON,
  AI_DECIDE_OUTBOUND_ERROR_REASON,
  AI_DECISIONS_PROFILE_IN_CHAT_NODE_ERROR,
  aiDecideAnswerForProbability,
  aiDecideConfidence,
  aiDecideDryRunOutcome,
  aiDecideErrorOutcome,
  aiDecideOutboundBlockReason,
  aiDecidePortTripsInboundGate,
  aiDecideVariables,
  aiDecisionsEndpointUrl,
  buildAiDecideChatPrompts,
  buildAiDecideMailContext,
  buildAiDecisionsRequestBody,
  decisionsProbabilityToPercent,
  evaluateAiDecideOutcome,
  isAiDecisionsProvider,
  normalizeAiDecideContextMode,
  normalizeAiDecideThreshold,
  parseAiDecideChatResponse,
  parseAiDecisionsResponse,
} from '../../packages/core/src/workflow';

describe('ai.decide Schwellenlogik', () => {
  test.each([
    [80, 80, 'ja'],
    [100, 80, 'ja'],
    [79, 80, 'unsicher'],
    [21, 80, 'unsicher'],
    [20, 80, 'nein'],
    [0, 80, 'nein'],
    [50, 50, 'ja'],
    [49, 50, 'nein'],
    [99, 99, 'ja'],
    [1, 99, 'nein'],
    [2, 99, 'unsicher'],
  ] as const)('p=%i bei Schwelle %i ⇒ %s', (p, threshold, answer) => {
    expect(aiDecideAnswerForProbability(p, threshold)).toBe(answer);
  });

  test('Schwelle wird auf 50–99 begrenzt, fehlend ⇒ 80', () => {
    expect(normalizeAiDecideThreshold(undefined)).toBe(80);
    expect(normalizeAiDecideThreshold('')).toBe(80);
    expect(normalizeAiDecideThreshold('abc')).toBe(80);
    expect(normalizeAiDecideThreshold(10)).toBe(50);
    expect(normalizeAiDecideThreshold(100)).toBe(99);
    expect(normalizeAiDecideThreshold('90')).toBe(90);
    expect(normalizeAiDecideThreshold(85.6)).toBe(86);
  });

  test('Kontextmodus: nur „metadata“ ist datensparsam, sonst voller Text', () => {
    expect(normalizeAiDecideContextMode('metadata')).toBe('metadata');
    expect(normalizeAiDecideContextMode('full')).toBe('full');
    expect(normalizeAiDecideContextMode(undefined)).toBe('full');
  });

  test('Sicherheit der gewählten Antwort', () => {
    expect(aiDecideConfidence('ja', 91)).toBe(91);
    expect(aiDecideConfidence('nein', 12)).toBe(88);
    expect(aiDecideConfidence('unsicher', 40)).toBe(60);
    expect(aiDecideConfidence('error', 40)).toBeNull();
    expect(aiDecideConfidence('ja', null)).toBeNull();
  });

  test('Inbound-Gate: nur ja/nein zählen als erfüllte Bedingung', () => {
    expect(aiDecidePortTripsInboundGate('ja')).toBe(true);
    expect(aiDecidePortTripsInboundGate('nein')).toBe(true);
    expect(aiDecidePortTripsInboundGate('unsicher')).toBe(false);
    expect(aiDecidePortTripsInboundGate('error')).toBe(false);
  });
});

describe('ai.decide Ergebnis, Zusammenfassung und Versandsperre', () => {
  test('Entscheidungsmodell: Nein mit Standardtext und Ja-Wahrscheinlichkeit', () => {
    const outcome = evaluateAiDecideOutcome({ probability: 12, threshold: 80, source: 'decisions', model: 'typesafe/jev-1.13' });
    expect(outcome).toEqual({
      answer: 'nein',
      probability: 12,
      confidence: 88,
      reason: '',
      summary: 'Entscheidungsmodell: Nein (Ja-Wahrscheinlichkeit 12 %)',
      model: 'typesafe/jev-1.13',
    });
    expect(aiDecideOutboundBlockReason(outcome)).toBe(
      'Vom Entscheidungsmodell als nicht versandfähig blockiert – bitte E-Mail prüfen. (Ja-Wahrscheinlichkeit 12 %)',
    );
    expect(aiDecideVariables(outcome)).toEqual({
      'ai.decide.answer': 'nein',
      'ai.decide.probability': 12,
      'ai.decide.confidence': 88,
      'ai.decide.reason': '',
      'ai.decide.summary': 'Entscheidungsmodell: Nein (Ja-Wahrscheinlichkeit 12 %)',
      'ai.decide.model': 'typesafe/jev-1.13',
    });
  });

  test('Chat-Modell: Begründung wird Sperrgrund, „ja“ sperrt nicht', () => {
    const no = evaluateAiDecideOutcome({
      probability: 40,
      threshold: 80,
      source: 'chat',
      model: 'gpt-4o-mini',
      modelAnswer: 'nein',
      reason: '  Rabattzusage  ohne Freigabe. ',
    });
    expect(no.answer).toBe('unsicher');
    expect(no.summary).toBe('KI-Entscheidung: Unsicher (Ja-Wahrscheinlichkeit 40 %)');
    expect(aiDecideOutboundBlockReason(no)).toBe('Rabattzusage ohne Freigabe.');
    const yes = evaluateAiDecideOutcome({ probability: 95, threshold: 80, source: 'chat', model: 'm', modelAnswer: 'ja' });
    expect(yes.answer).toBe('ja');
    expect(aiDecideOutboundBlockReason(yes)).toBeNull();
  });

  test('widersprüchliche Chat-Antwort ⇒ unsicher', () => {
    const outcome = evaluateAiDecideOutcome({ probability: 90, threshold: 80, source: 'chat', model: 'm', modelAnswer: 'nein' });
    expect(outcome.answer).toBe('unsicher');
    expect(outcome.summary).toContain('widersprüchlich');
  });

  test('KI-Fehler: eigener Sperrtext und Zusammenfassung', () => {
    const outcome = aiDecideErrorOutcome({ message: 'KI API HTTP 500', model: 'm' });
    expect(outcome.answer).toBe('error');
    expect(outcome.probability).toBeNull();
    expect(outcome.summary).toBe('KI-Fehler bei der Entscheidung: KI API HTTP 500');
    expect(aiDecideOutboundBlockReason(outcome)).toBe(AI_DECIDE_OUTBOUND_ERROR_REASON);
  });

  test('Testlauf ohne KI: unsicher, Standardtext ohne Wahrscheinlichkeit', () => {
    const outcome = aiDecideDryRunOutcome();
    expect(outcome.answer).toBe('unsicher');
    expect(outcome.summary).toBe(AI_DECIDE_DRY_RUN_SUMMARY);
    expect(outcome.summary).toBe('Testlauf: keine KI-Anfrage');
    expect(aiDecideOutboundBlockReason(outcome)).toBe(AI_DECIDE_OUTBOUND_BLOCK_REASON);
  });
});

describe('parseAiDecideChatResponse', () => {
  test('liest das geforderte JSON', () => {
    expect(parseAiDecideChatResponse('{"antwort":"nein","wahrscheinlichkeit_ja":12,"begruendung":"Kundenanfrage."}')).toEqual({
      ok: true,
      probability: 12,
      answer: 'nein',
      reason: 'Kundenanfrage.',
    });
  });

  test('toleriert Codeblock und Text drumherum', () => {
    const raw = 'Hier meine Einschätzung:\n```json\n{\n  "antwort": "ja",\n  "wahrscheinlichkeit_ja": "85 %",\n  "begruendung": "Werbung"\n}\n```\nViele Grüße';
    expect(parseAiDecideChatResponse(raw)).toEqual({ ok: true, probability: 85, answer: 'ja', reason: 'Werbung' });
  });

  test('englische Schlüssel und Anteil 0–1', () => {
    expect(parseAiDecideChatResponse('{"answer":"yes","probability":0.91,"reason":"spam"}')).toEqual({
      ok: true,
      probability: 91,
      answer: 'ja',
      reason: 'spam',
    });
    expect(parseAiDecideChatResponse('{"yes": "70%", "reason": "x"}')).toMatchObject({ ok: true, probability: 70 });
    expect(parseAiDecideChatResponse('{"no": 30}')).toMatchObject({ ok: true, probability: 70 });
    expect(parseAiDecideChatResponse('{"Begründung":"kurz","Wahrscheinlichkeit_Ja":"60,5"}')).toMatchObject({
      ok: true,
      probability: 61,
      reason: 'kurz',
    });
  });

  test('Schlüssel-Wert-Zeilen ohne JSON', () => {
    expect(parseAiDecideChatResponse('Antwort: nein\nWahrscheinlichkeit_ja: 5 %\nBegründung: Rechnung eines Lieferanten')).toEqual({
      ok: true,
      probability: 5,
      answer: 'nein',
      reason: 'Rechnung eines Lieferanten',
    });
  });

  test('fail-closed: ohne Wahrscheinlichkeit, leer, unlesbar oder mehrdeutig', () => {
    expect(parseAiDecideChatResponse('{"antwort":"ja"}')).toMatchObject({ ok: false });
    expect(parseAiDecideChatResponse('')).toMatchObject({ ok: false });
    expect(parseAiDecideChatResponse('Das kann ich nicht sagen.')).toMatchObject({ ok: false });
    expect(parseAiDecideChatResponse('{"wahrscheinlichkeit_ja": 150}')).toMatchObject({ ok: false });
    expect(parseAiDecideChatResponse(
      '{"antwort":"nein","wahrscheinlichkeit_ja":5} {"antwort":"ja","wahrscheinlichkeit_ja":99}',
    )).toMatchObject({ ok: false, error: expect.stringContaining('mehrdeutig') });
    expect(parseAiDecideChatResponse('wahrscheinlichkeit_ja: 5\nwahrscheinlichkeit_ja: 95')).toMatchObject({ ok: false });
  });

  test('entartete Ausgabe bleibt schnell', () => {
    const started = Date.now();
    expect(parseAiDecideChatResponse('{'.repeat(200_000)).ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('Kontext und Prompts', () => {
  const strings = {
    subject: 'Frage zur Bestellung',
    body_text: 'x'.repeat(13_000),
    snippet: 'Hallo',
    from_address: 'kunde@example.com',
    to_address: 'support@example.com',
    cc_address: '',
    has_attachments: 'true',
    attachment_names: 'rechnung.pdf',
    attachment_types: 'application/pdf',
  };

  test('voller Text: Kopfdaten, gekürzter Text, Anhangsnamen', () => {
    const ctx = buildAiDecideMailContext({ direction: 'inbound', mode: 'full', strings });
    expect(ctx.text).toContain('Betreff: Frage zur Bestellung');
    expect(ctx.text).toContain('Von: kunde@example.com');
    expect(ctx.text).toContain('Anhänge: rechnung.pdf');
    const email = ctx.state.email as Record<string, string>;
    expect(email.body).toHaveLength(12_000);
    expect(email.from).toBe('kunde@example.com');
  });

  test('nur Kopfdaten: kein Volltext', () => {
    const ctx = buildAiDecideMailContext({ direction: 'inbound', mode: 'metadata', strings });
    expect(ctx.text).not.toContain('xxxxxxxx');
    expect(ctx.text).toContain('Volltext wurde aus Datenschutzgründen nicht übermittelt');
    expect(JSON.stringify(ctx.state)).not.toContain('xxxxxxxx');
  });

  test('ausgehend: der Entwurf ohne Absender', () => {
    const ctx = buildAiDecideMailContext({
      direction: 'outbound',
      mode: 'full',
      strings: { subject: 'Angebot', body_text: 'Anbei das Angebot', to_address: 'kunde@example.com' },
    });
    expect(ctx.text).toContain('Ausgehender E-Mail-Entwurf');
    expect(ctx.text).not.toContain('Von:');
    expect(ctx.state).toEqual({
      email: { direction: 'outbound', subject: 'Angebot', to: 'kunde@example.com', attachments: '', body: 'Anbei das Angebot' },
    });
  });

  test('Chat-Prompt fordert das JSON-Format und nennt Kriterien', () => {
    const prompts = buildAiDecideChatPrompts({
      question: 'Ist das Spam?',
      yesCriteria: 'Werbung',
      noCriteria: '',
      contextText: 'E-Mail',
    });
    expect(prompts.system).toContain('{"antwort":"ja|nein","wahrscheinlichkeit_ja":0-100,"begruendung":"kurz"}');
    expect(prompts.user).toContain('Frage: Ist das Spam?');
    expect(prompts.user).toContain('„Ja“, wenn: Werbung');
    expect(prompts.user).not.toContain('„Nein“, wenn');
  });
});

describe('OpenRouter Decisions API', () => {
  test('Profil-Typ und Endpunkt', () => {
    expect(isAiDecisionsProvider('openrouter_decisions')).toBe(true);
    expect(isAiDecisionsProvider(' OpenRouter_Decisions ')).toBe(true);
    expect(isAiDecisionsProvider('openrouter')).toBe(false);
    expect(aiDecisionsEndpointUrl('https://openrouter.ai/api')).toBe('https://openrouter.ai/api/alpha/decisions');
    expect(aiDecisionsEndpointUrl('https://openrouter.ai/api/v1/')).toBe('https://openrouter.ai/api/alpha/decisions');
    expect(AI_DECISIONS_PROFILE_IN_CHAT_NODE_ERROR).toContain('„KI-Entscheidung“');
  });

  test('Anfrage mit noul-Frage und Kriterien (Standard Ja/Nein)', () => {
    expect(buildAiDecisionsRequestBody({
      model: 'typesafe/jev-1.13',
      question: 'Ist das Spam?',
      yesCriteria: '',
      noCriteria: 'Kundenanfrage',
      state: { email: { subject: 'x' } },
    })).toEqual({
      model: 'typesafe/jev-1.13',
      state: { email: { subject: 'x' } },
      questions: {
        decision: {
          type: 'noul',
          instructions: 'Ist das Spam?',
          criteria: { true: 'Ja', false: 'Kundenanfrage' },
        },
      },
    });
  });

  test('Antwort: noul 0–1, Kosten in Mikro-USD, Tokens', () => {
    expect(parseAiDecisionsResponse(JSON.stringify({
      answers: { decision: { type: 'noul', noul: 0.96 } },
      usage: { input_tokens: 120, output_tokens: 3, cost: 0.00042 },
    }))).toEqual({
      ok: true,
      probability: 96,
      costMicroUsd: 420,
      usage: { promptTokens: 120, completionTokens: 3, totalTokens: 123 },
    });
  });

  test('Antwort: alternative Formen probability/p_present/yes, 0–100', () => {
    expect(parseAiDecisionsResponse({ answers: { decision: { probability: 0.3 } } })).toMatchObject({ ok: true, probability: 30 });
    expect(parseAiDecisionsResponse({ answers: { decision: { p_present: 55 } } })).toMatchObject({ ok: true, probability: 55 });
    expect(parseAiDecisionsResponse({ answers: { decision: { yes: '0.7' } } })).toMatchObject({ ok: true, probability: 70 });
    expect(parseAiDecisionsResponse({ answers: { decision: { noul: { p_present: 0.2 } } } })).toMatchObject({ ok: true, probability: 20 });
    expect(parseAiDecisionsResponse({ answers: { other: { noul: 0.1 } } })).toMatchObject({ ok: true, probability: 10 });
    expect(parseAiDecisionsResponse({ probability: 0.5 })).toMatchObject({ ok: true, probability: 50 });
    expect(decisionsProbabilityToPercent(1)).toBe(100);
    expect(decisionsProbabilityToPercent(101)).toBeNull();
  });

  test('kein verwertbarer Wert ⇒ Fehler (Kosten bleiben erhalten)', () => {
    expect(parseAiDecisionsResponse('kein json')).toMatchObject({ ok: false });
    expect(parseAiDecisionsResponse({ answers: { decision: { noul: 'vielleicht' } }, usage: { cost: 0.001 } })).toEqual({
      ok: false,
      error: 'Antwort der Decisions API enthielt keine verwertbare Ja-Wahrscheinlichkeit',
      costMicroUsd: 1000,
      usage: null,
    });
    expect(parseAiDecisionsResponse({ answers: { decision: { noul: -0.5 } } })).toMatchObject({ ok: false });
  });
});
