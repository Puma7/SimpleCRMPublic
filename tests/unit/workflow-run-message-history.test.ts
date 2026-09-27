import {
  groupRunsWithContinuations,
  summarizeRunSteps,
  type MessageWorkflowRunSummary,
} from '../../shared/workflow-run-message-history';

/**
 * Plan 046: „Was ist mit dieser Mail passiert?“ – Zusammenfassung der Läufe
 * einer Mail (letzter Schritt, KI-Entscheidung, Fortsetzung) für das
 * Lesefenster. Beide Editionen liefern Schritte im selben Format.
 */
type Step = Parameters<typeof summarizeRunSteps>[0][number];

function step(overrides: Partial<Step>): Step {
  return { node_type: 'email.tag', status: 'ok', port: null, message: null, detail: null, ...overrides };
}

function run(id: number, overrides: Partial<MessageWorkflowRunSummary> = {}): MessageWorkflowRunSummary {
  return {
    id,
    server_id: id,
    workflow_id: 1,
    workflow_name: `Workflow ${id}`,
    direction: 'inbound',
    status: 'completed',
    started_at: null,
    finished_at: null,
    last_step: null,
    decision: null,
    continued_from_run_id: null,
    ...overrides,
  };
}

describe('summarizeRunSteps', () => {
  test('Desktop: KI-Entscheidung aus den Variablen, letzter Schritt', () => {
    const summary = summarizeRunSteps([
      step({ node_type: 'trigger', port: null }),
      step({
        node_type: 'ai.decide',
        port: 'yes',
        message: 'Kunde fragt nach Rückgabe',
        detail: JSON.stringify({
          v: 1,
          output: {
            port: 'yes',
            variables: { 'ai.decide.answer': 'yes', 'ai.decide.probability': 91, 'ai.decide.summary': 'Kunde fragt nach Rückgabe' },
          },
        }),
      }),
      step({ node_type: 'email.tag', port: 'default' }),
    ]);
    expect(summary).toEqual({
      last_step: { node_type: 'email.tag', status: 'ok', port: 'default' },
      decision: { answer: 'yes', probability: 91, summary: 'Kunde fragt nach Rückgabe' },
      continued_from_run_id: null,
    });
  });

  test('Server: nachgereichtes Ergebnis aus output.result, Platzhalter übersprungen', () => {
    const summary = summarizeRunSteps([
      step({ node_type: 'ai.decide', status: 'ok', port: null, message: 'queued_ai_decide:77' }),
      step({
        node_type: 'ai.decide',
        port: 'no',
        message: null,
        detail: { v: 1, output: { port: 'no', result: { answer: 'no', probability: 12, confidence: 0.8, summary: 'Werbung' } } },
      }),
    ]);
    expect(summary.decision).toEqual({ answer: 'no', probability: 12, summary: 'Werbung' });
    expect(summary.last_step).toEqual({ node_type: 'ai.decide', status: 'ok', port: 'no' });
  });

  test('nur Platzhalter: kein letzter Schritt, keine Entscheidung', () => {
    expect(summarizeRunSteps([step({ node_type: 'ai.decide', message: 'queued_ai_decide:5' })])).toEqual({
      last_step: null,
      decision: null,
      continued_from_run_id: null,
    });
  });

  test('ohne Schritte: alles leer', () => {
    expect(summarizeRunSteps([])).toEqual({ last_step: null, decision: null, continued_from_run_id: null });
  });

  test('Fortsetzung: Herkunft aus dem ersten Schritt', () => {
    const summary = summarizeRunSteps([
      step({ node_type: 'email.tag', detail: { v: 1, continuedFrom: { runId: 401, nodeId: 'd1', port: 'yes' } } }),
    ]);
    expect(summary.continued_from_run_id).toBe(401);
  });
});

describe('groupRunsWithContinuations', () => {
  test('Fortsetzung unter dem Ursprungslauf, neueste Gruppe zuerst, Waise eigene Gruppe', () => {
    const groups = groupRunsWithContinuations([
      run(403, { continued_from_run_id: 402 }),
      run(402, { continued_from_run_id: 401 }),
      run(401),
      run(500),
      run(600, { continued_from_run_id: 999 }),
    ]);
    expect(groups.map((group) => [group.run.id, group.continuations.map((c) => c.id)])).toEqual([
      [600, []],
      [500, []],
      [401, [402, 403]],
    ]);
  });
});
