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
    priority: 100,
  };
  const unchanged = { ...baseline };
  // Baseline und Kandidat teilen denselben Seiteneffekt-Graphen.
  const sideEffects = { canManageWorkflows: false, hasSideEffects: true, baselineHasSideEffects: true };

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
    // G2 (C-A20): Einen AKTIVEN Seiteneffekt-Workflow stillzulegen verlangt
    // serverseitig workflows.manage, symmetrisch zum Aktivieren — frueher hing
    // needsManage nur am NEUEN Zustand und das Deaktivieren lief ohne manage
    // durch. Weggelassen werden darf es trotzdem nie.
    const disabling = decideWorkflowSaveGate(baseline, { ...unchanged, enabled: false }, sideEffects);
    expect(disabling.executionChanged).toBe(true);
    expect(disabling.omitExecutionFields).toBe(false);
    expect(disabling.blocked).toBe(true);
  });

  test('a changed priority is an execution change: it reorders live workflows', () => {
    const decision = decideWorkflowSaveGate(baseline, { ...unchanged, priority: 10 }, sideEffects);

    expect(decision.executionChanged).toBe(true);
    expect(decision.blocked).toBe(true);
  });

  test('workflows.manage always sends the full payload', () => {
    const decision = decideWorkflowSaveGate(baseline, unchanged, {
      canManageWorkflows: true,
      hasSideEffects: true,
      baselineHasSideEffects: true,
    });

    expect(decision.omitExecutionFields).toBe(false);
    expect(decision.blocked).toBe(false);
  });

  test('a graph without side effects is never gated', () => {
    const decision = decideWorkflowSaveGate(
      baseline,
      { ...unchanged, cronExpr: '*/5 * * * *' },
      { canManageWorkflows: false, hasSideEffects: false, baselineHasSideEffects: false },
    );

    expect(decision.omitExecutionFields).toBe(false);
    expect(decision.blocked).toBe(false);
  });

  // C-A20: Das Gate sah nur den neuen Graphen — ein harmloser Ersatz fuer einen
  // aktiven Seiteneffekt-Graphen ging ohne workflows.manage an den Server.
  test('replacing an active side-effect graph with a harmless one needs workflows.manage', () => {
    const decision = decideWorkflowSaveGate(
      baseline,
      { ...unchanged, graphJson: '{"version":1,"nodes":[{"id":"trigger-1","type":"trigger"}],"edges":[]}' },
      { canManageWorkflows: false, hasSideEffects: false, baselineHasSideEffects: true },
    );

    expect(decision.executionChanged).toBe(true);
    expect(decision.omitExecutionFields).toBe(false);
    expect(decision.blocked).toBe(true);
  });

  test('an inactive side-effect draft stays editable without workflows.manage', () => {
    const decision = decideWorkflowSaveGate(
      { ...baseline, enabled: false },
      { ...unchanged, enabled: false, graphJson: '{"version":1}' },
      sideEffects,
    );

    expect(decision.executionChanged).toBe(true);
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

  // TA-P4: Ein aktiver, noch nicht scharfer Zeitplan (Server) wird erst durch
  // ein Speichern mit den Ausfuehrungsfeldern scharf — das ist ein Aktivieren.
  test('arming a not-armed schedule sends the execution fields and keeps the manage gate', () => {
    const withManage = decideWorkflowSaveGate(baseline, unchanged, {
      canManageWorkflows: true,
      hasSideEffects: true,
      baselineHasSideEffects: true,
      armsSchedule: true,
    });
    expect(withManage.executionChanged).toBe(true);
    expect(withManage.omitExecutionFields).toBe(false);
    expect(withManage.blocked).toBe(false);

    const withoutManage = decideWorkflowSaveGate(baseline, unchanged, { ...sideEffects, armsSchedule: true });
    expect(withoutManage.omitExecutionFields).toBe(false);
    expect(withoutManage.blocked).toBe(true);
  });

  test('a missing baseline counts as changed', () => {
    const decision = decideWorkflowSaveGate(null, unchanged, sideEffects);

    expect(decision.executionChanged).toBe(true);
    expect(decision.omitExecutionFields).toBe(false);
    expect(decision.blocked).toBe(true);
  });
});
