import {
  decideWorkflowSaveGate,
  type WorkflowSaveBaseline,
} from '../../src/components/email/workflow/workflow-save-gate';

/**
 * Regression: Die API wertet cronExpr/scheduleAccountId als ausfuehrungsrelevant
 * (patchTouchesOutbound) und verlangt dann workflows.manage — auch wenn der Wert
 * unveraendert mitgeschickt wurde. Der Editor darf sie deshalb nur bei echter
 * Aenderung senden, sonst scheitert eine reine Namensaenderung an einem aktiven
 * Seiteneffekt-Workflow garantiert mit 403.
 */
describe('workflow save gate', () => {
  const baseline: WorkflowSaveBaseline = {
    enabled: true,
    graphJson: '{"version":1,"nodes":[],"edges":[]}',
    cronExpr: '0 8 * * 1',
    scheduleAccountId: 7,
  };
  const unchanged = { ...baseline };
  const sideEffects = { canManageWorkflows: false, hasSideEffects: true };

  test('omits execution fields for a name-only save without workflows.manage', () => {
    const decision = decideWorkflowSaveGate(baseline, unchanged, sideEffects);

    expect(decision.executionChanged).toBe(false);
    expect(decision.omitExecutionFields).toBe(true);
    expect(decision.blocked).toBe(false);
  });

  test('a changed schedule is an execution change and gets blocked locally', () => {
    const decision = decideWorkflowSaveGate(
      baseline,
      { ...unchanged, cronExpr: '*/5 * * * *' },
      sideEffects,
    );

    expect(decision.executionChanged).toBe(true);
    expect(decision.omitExecutionFields).toBe(false);
    expect(decision.blocked).toBe(true);
  });

  test('a changed schedule account is an execution change too', () => {
    const decision = decideWorkflowSaveGate(
      baseline,
      { ...unchanged, scheduleAccountId: null },
      sideEffects,
    );

    expect(decision.executionChanged).toBe(true);
    expect(decision.blocked).toBe(true);
  });

  test('graph and enabled stay execution changes', () => {
    expect(
      decideWorkflowSaveGate(baseline, { ...unchanged, graphJson: '{"version":1}' }, sideEffects).blocked,
    ).toBe(true);
    // enabled: true -> false ist keine Manage-Pflicht mehr (needsManage haengt am
    // NEUEN Zustand), aber es bleibt eine Aenderung und darf nicht weggelassen
    // werden — sonst wuerde das Deaktivieren still verschluckt.
    const disabling = decideWorkflowSaveGate(baseline, { ...unchanged, enabled: false }, sideEffects);
    expect(disabling.executionChanged).toBe(true);
    expect(disabling.omitExecutionFields).toBe(false);
    expect(disabling.blocked).toBe(false);
  });

  test('workflows.manage always sends the full payload', () => {
    const decision = decideWorkflowSaveGate(baseline, unchanged, {
      canManageWorkflows: true,
      hasSideEffects: true,
    });

    expect(decision.omitExecutionFields).toBe(false);
    expect(decision.blocked).toBe(false);
  });

  test('a graph without side effects is never gated', () => {
    const decision = decideWorkflowSaveGate(
      baseline,
      { ...unchanged, cronExpr: '*/5 * * * *' },
      { canManageWorkflows: false, hasSideEffects: false },
    );

    expect(decision.omitExecutionFields).toBe(false);
    expect(decision.blocked).toBe(false);
  });

  test('activating a previously inactive workflow is never omitted', () => {
    const decision = decideWorkflowSaveGate(
      { ...baseline, enabled: false },
      { ...unchanged, enabled: true },
      sideEffects,
    );

    expect(decision.omitExecutionFields).toBe(false);
    expect(decision.blocked).toBe(true);
  });

  test('a missing baseline counts as changed', () => {
    const decision = decideWorkflowSaveGate(null, unchanged, sideEffects);

    expect(decision.executionChanged).toBe(true);
    expect(decision.omitExecutionFields).toBe(false);
    expect(decision.blocked).toBe(true);
  });
});
