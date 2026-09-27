import {
  WORKFLOW_STEP_DETAIL_MAX_CHARS,
  WORKFLOW_STEP_MAIL_EXCERPT_MAX_CHARS,
  buildWorkflowStepDetail,
  buildWorkflowStepMailSnapshot,
  parseWorkflowStepDetail,
  sanitizeWorkflowStepRecord,
  serializeWorkflowStepDetail,
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
});
