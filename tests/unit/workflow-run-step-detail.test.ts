import {
  WORKFLOW_RUN_DETAIL_BUDGET_CHARS,
  WORKFLOW_RUN_DETAIL_BUDGET_NOTE,
  WORKFLOW_STEP_DETAIL_MAX_CHARS,
  WORKFLOW_STEP_MAIL_EXCERPT_MAX_CHARS,
  buildWorkflowStepDetail,
  buildWorkflowStepMailSnapshot,
  createWorkflowRunDetailState,
  maskWorkflowUrlSecrets,
  parseWorkflowStepDetail,
  redactWorkflowStepDetailForViewer,
  sanitizeWorkflowStepRecord,
  serializeWorkflowStepDetail,
  serializeWorkflowStepDetailWithinBudget,
  workflowTemplateUsesProtectedData,
  workflowUnwiredPortNote,
} from '../../packages/core/src/workflow';

describe('workflow run step detail', () => {
  test('mail snapshot keeps header and a bounded excerpt', () => {
    const body = 'x'.repeat(WORKFLOW_STEP_MAIL_EXCERPT_MAX_CHARS + 50);
    const snapshot = buildWorkflowStepMailSnapshot({
      direction: 'inbound',
      strings: {
        subject: 'Gewinn!!!',
        from_address: 'spam@example.test',
        to_address: 'info@example.test',
        attachment_names: 'rechnung.zip',
        body_text: body,
      },
    });
    expect(snapshot).toEqual({
      direction: 'inbound',
      subject: 'Gewinn!!!',
      from: 'spam@example.test',
      to: 'info@example.test',
      attachments: 'rechnung.zip',
      excerpt: body.slice(0, WORKFLOW_STEP_MAIL_EXCERPT_MAX_CHARS),
      truncated: true,
    });
  });

  test('mail snapshot is null without mail data', () => {
    expect(buildWorkflowStepMailSnapshot({ strings: {}, direction: 'inbound' })).toBeNull();
  });

  test('config secrets are redacted and internal variables omitted', () => {
    expect(sanitizeWorkflowStepRecord({
      url: 'https://api.example.test',
      apiKey: 'sk-live-123',
      headers: { Authorization: 'Bearer abc', Accept: 'json' },
      password: '',
      __inbound_condition_ok: true,
    })).toEqual({
      url: 'https://api.example.test',
      apiKey: '[geschwärzt]',
      headers: { Authorization: '[geschwärzt]', Accept: 'json' },
      password: '',
    });
  });

  test('output lists only variables the step changed', () => {
    const detail = buildWorkflowStepDetail({
      config: { question: 'Ist das Spam?' },
      variablesBefore: { 'spam.score': 10 },
      variablesOut: { 'spam.score': 10, 'ai.decide.answer': 'nein', 'ai.decide.probability': 12 },
      port: 'nein',
      note: workflowUnwiredPortNote('Nein'),
    });
    expect(detail.input).toEqual({
      config: { question: 'Ist das Spam?' },
      variables: { 'spam.score': 10 },
    });
    expect(detail.output).toEqual({
      port: 'nein',
      variables: { 'ai.decide.answer': 'nein', 'ai.decide.probability': 12 },
      note: 'Ausgang „Nein“ ist mit keinem Knoten verbunden – der Lauf endet hier, es passiert nichts weiter.',
    });
  });

  test('serialized detail stays within the size limit and keeps the output', () => {
    const hugeVariables: Record<string, string> = {};
    for (let i = 0; i < 59; i += 1) hugeVariables[`v${i}`] = 'y'.repeat(900);
    const detail = buildWorkflowStepDetail({
      config: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`c${i}`, 'z'.repeat(900)])),
      variablesBefore: hugeVariables,
      port: 'ja',
      note: 'Hinweis',
    });
    const json = serializeWorkflowStepDetail(detail);
    expect(json.length).toBeLessThanOrEqual(WORKFLOW_STEP_DETAIL_MAX_CHARS);
    const parsed = parseWorkflowStepDetail(json);
    expect(parsed?.truncated).toBe(true);
    expect(parsed?.output?.port).toBe('ja');
    expect(parsed?.output?.note).toBe('Hinweis');
  });

  test('parse accepts jsonb objects and rejects garbage', () => {
    expect(parseWorkflowStepDetail({ v: 1, output: { port: 'yes' } })).toEqual({ v: 1, output: { port: 'yes' } });
    expect(parseWorkflowStepDetail('not json')).toBeNull();
    expect(parseWorkflowStepDetail(null)).toBeNull();
    expect(parseWorkflowStepDetail({ foo: 1 })).toBeNull();
  });

  test('runs without a message never get a mail snapshot, even with event strings', () => {
    // CRM-/Aufgaben-Trigger füllen subject/body_text mit Ereignisdaten.
    expect(buildWorkflowStepMailSnapshot({
      hasMessage: false,
      direction: 'crm_event',
      strings: { subject: 'Kunde angelegt: Müller GmbH', body_text: 'Neuer Kunde', from_address: 'crm@example.test' },
    })).toBeNull();
  });

  test('run budget keeps only the chosen port once the run has written enough detail', () => {
    const state = createWorkflowRunDetailState();
    state.charsUsed = WORKFLOW_RUN_DETAIL_BUDGET_CHARS - 10;
    const detail = buildWorkflowStepDetail({ config: { tag: 'spam' }, variablesBefore: { a: 'x'.repeat(200) }, port: 'yes' });
    const json = serializeWorkflowStepDetailWithinBudget(detail, state);
    expect(parseWorkflowStepDetail(json)).toEqual({
      v: 1,
      truncated: true,
      output: { port: 'yes', note: WORKFLOW_RUN_DETAIL_BUDGET_NOTE },
    });
    expect(state.charsUsed).toBeGreaterThan(WORKFLOW_RUN_DETAIL_BUDGET_CHARS - 10);

    const fresh = createWorkflowRunDetailState();
    const full = serializeWorkflowStepDetailWithinBudget(detail, fresh);
    expect(parseWorkflowStepDetail(full)?.input?.config).toEqual({ tag: 'spam' });
    expect(fresh.charsUsed).toBe(full.length);
  });

  test('template detection flags placeholders with CRM/integration data', () => {
    expect(workflowTemplateUsesProtectedData('Ist „{{subject}}“ von {{from_address}} Spam?')).toBe(false);
    expect(workflowTemplateUsesProtectedData('Spam-Score {{spam.score}}, KI {{ai.decide.answer}}')).toBe(false);
    expect(workflowTemplateUsesProtectedData('Ist {{customer.name}} ein Bestandskunde?')).toBe(true);
    expect(workflowTemplateUsesProtectedData('Bestellung {{jtl.order_no}}')).toBe(true);
    expect(workflowTemplateUsesProtectedData('Eigene Variable {{kunde}}')).toBe(true);
  });

  test('viewer without crm.read/tracking.view sees keys but not protected values', () => {
    const detail = buildWorkflowStepDetail({
      config: { question: 'Ist {{customer.name}} VIP?' },
      variablesBefore: {
        'spam.score': 4,
        'customer.name': 'Müller GmbH',
        'jtl.data': '{"umsatz":12000}',
        'mssql.rows': '[{"iban":"DE00…"}]',
        'tracking.opened': true,
        'ai.agent.answer': 'Kunde hat 3 offene Rechnungen',
        kunde: 'Müller',
      },
      variablesOut: { 'ai.decide.answer': 'ja', 'customer.id': 7 },
      inputExtra: { question: 'Ist Müller GmbH VIP?', threshold: 70 },
      protectedExtra: ['question'],
      result: { answer: 'ja', probability: 91, items: ['Müller GmbH'] },
      port: 'ja',
    });
    const hiddenCrm = '[ausgeblendet – nur mit CRM-Leserecht sichtbar]';
    const redacted = redactWorkflowStepDetailForViewer(detail, { crmRead: false, trackingView: false }) as typeof detail;
    expect(redacted.input?.variables).toEqual({
      'spam.score': 4,
      'customer.name': hiddenCrm,
      'jtl.data': hiddenCrm,
      'mssql.rows': hiddenCrm,
      'tracking.opened': '[ausgeblendet – nur mit Tracking-Leserecht sichtbar]',
      'ai.agent.answer': hiddenCrm,
      kunde: hiddenCrm,
    });
    expect(redacted.input?.extra).toEqual({ question: hiddenCrm, threshold: 70 });
    expect(redacted.input?.config).toEqual({ question: 'Ist {{customer.name}} VIP?' });
    expect(redacted.output?.variables).toEqual({ 'ai.decide.answer': 'ja', 'customer.id': hiddenCrm });
    expect(redacted.output?.result).toEqual({ answer: 'ja', probability: 91, items: hiddenCrm });

    expect(redactWorkflowStepDetailForViewer(detail, { crmRead: true, trackingView: true })).toEqual(detail);
    const crmOnly = redactWorkflowStepDetailForViewer(detail, { crmRead: true, trackingView: false }) as typeof detail;
    expect(crmOnly.input?.variables?.['customer.name']).toBe('Müller GmbH');
    expect(crmOnly.input?.variables?.['tracking.opened']).toBe('[ausgeblendet – nur mit Tracking-Leserecht sichtbar]');
    expect(crmOnly.input?.extra?.question).toBe('Ist Müller GmbH VIP?');
  });

  test('secrets inside URL values are masked, ordinary URLs stay readable', () => {
    expect(maskWorkflowUrlSecrets('https://hooks.slack.com/services/T0001/B0002/XXXXXXXXXXXXXXXXXXXXXXXX'))
      .toBe('https://hooks.slack.com/services/T0001/B0002/***');
    expect(maskWorkflowUrlSecrets('https://api.example.test/v1/orders?status=open&api_key=abc123&token=xyz'))
      .toBe('https://api.example.test/v1/orders?status=open&api_key=***&token=***');
    expect(maskWorkflowUrlSecrets('https://user:pass@erp.example.test/export#access_token=abc'))
      .toBe('https://***@erp.example.test/export#***');
    expect(maskWorkflowUrlSecrets('https://n8n.example.test/webhook/2f1c0b7e-3a4d-4c55-9a8e-1f2b3c4d5e6f'))
      .toBe('https://n8n.example.test/webhook/***');
    expect(maskWorkflowUrlSecrets('https://api.example.test/v1/customers?limit=10'))
      .toBe('https://api.example.test/v1/customers?limit=10');
    expect(maskWorkflowUrlSecrets('Kein Link: token=abc')).toBe('Kein Link: token=abc');
    expect(sanitizeWorkflowStepRecord({ url: 'https://discord.com/api/webhooks/123456/abcdefghijklmnopqrstuvwxyz0123456789' }))
      .toEqual({ url: 'https://discord.com/api/webhooks/123456/***' });
  });
});
