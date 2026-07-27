import {
  findOutboundGraphTraps as coreFindOutboundGraphTraps,
  LOGIC_INMEMORY_NODE_TYPES as CORE_LOGIC_INMEMORY_NODE_TYPES,
  READ_ONLY_WORKFLOW_NODE_TYPES as CORE_READ_ONLY_WORKFLOW_NODE_TYPES,
  workflowGraphHasChainStopNode as coreWorkflowGraphHasChainStopNode,
  workflowGraphHasSideEffectNode as coreWorkflowGraphHasSideEffectNode,
} from '../../packages/core/src/workflow/graph-validate';
import {
  findOutboundGraphTraps as sharedFindOutboundGraphTraps,
  LOGIC_INMEMORY_NODE_TYPES as SHARED_LOGIC_INMEMORY_NODE_TYPES,
  READ_ONLY_WORKFLOW_NODE_TYPES as SHARED_READ_ONLY_WORKFLOW_NODE_TYPES,
  workflowGraphHasChainStopNode as sharedWorkflowGraphHasChainStopNode,
  workflowGraphHasSideEffectNode as sharedWorkflowGraphHasSideEffectNode,
} from '../../shared/email-workflow-graph-validate';

/**
 * Der Editor (shared) und die kanonische Implementierung (packages/core, die der
 * Server benutzt) entscheiden mit zwei getrennten Allowlists, ob ein Graph
 * Seiteneffekte hat. Driften sie auseinander, sperrt die UI Nutzern mit
 * workflows.edit Aenderungen, die der Server zulaesst (oder — schlimmer —
 * umgekehrt). Dieser Test haelt die Spiegel deckungsgleich.
 */
describe('side-effect allowlist mirror', () => {
  const sorted = (values: ReadonlySet<string>) => [...values].sort();

  test('read-only node types are identical', () => {
    expect(sorted(SHARED_READ_ONLY_WORKFLOW_NODE_TYPES)).toEqual(sorted(CORE_READ_ONLY_WORKFLOW_NODE_TYPES));
  });

  test('in-memory logic node types are identical', () => {
    expect(sorted(SHARED_LOGIC_INMEMORY_NODE_TYPES)).toEqual(sorted(CORE_LOGIC_INMEMORY_NODE_TYPES));
  });

  test('every exempt node type is judged the same by both implementations', () => {
    const exempt = [...CORE_READ_ONLY_WORKFLOW_NODE_TYPES, ...CORE_LOGIC_INMEMORY_NODE_TYPES];
    for (const nodeType of exempt) {
      const doc = {
        version: 1,
        nodes: [
          { id: 't1', type: 'trigger', data: { kind: 'inbound' } },
          { id: 'n1', type: 'registry', data: { nodeType } },
        ],
        edges: [{ id: 'e1', source: 't1', target: 'n1' }],
      } as never;
      expect({ nodeType, sideEffect: sharedWorkflowGraphHasSideEffectNode(doc) })
        .toEqual({ nodeType, sideEffect: coreWorkflowGraphHasSideEffectNode(doc) });
      expect(sharedWorkflowGraphHasSideEffectNode(doc)).toBe(false);
    }
  });

  test('logic.stop_after_spam is exempt in both — several shipped templates use it', () => {
    expect(SHARED_LOGIC_INMEMORY_NODE_TYPES.has('logic.stop_after_spam')).toBe(true);
    expect(CORE_LOGIC_INMEMORY_NODE_TYPES.has('logic.stop_after_spam')).toBe(true);
  });

  test('chain-stop detection matches in both implementations', () => {
    // Der Kettenabbruch ist KEIN Seiteneffekt (die Knoten schreiben nichts),
    // schaltet aber alle nachrangigen Inbound-Workflows ab — er wird deshalb
    // separat erkannt und in der Berechtigungsschicht gleich behandelt.
    const cases: Array<{ label: string; doc: unknown; expected: boolean }> = [
      {
        label: 'logic.stop_after_spam',
        doc: {
          version: 1,
          nodes: [
            { id: 't1', type: 'trigger', data: { kind: 'inbound' } },
            { id: 'v1', type: 'registry', data: { nodeType: 'logic.set_variable', config: { name: 'email.is_spam', value: true } } },
            { id: 's1', type: 'registry', data: { nodeType: 'logic.stop_after_spam' } },
          ],
          edges: [],
        },
        expected: true,
      },
      {
        label: 'stopFurtherWorkflows am Knoten',
        doc: {
          version: 1,
          nodes: [
            { id: 't1', type: 'trigger', data: { kind: 'inbound' } },
            { id: 'n1', type: 'registry', data: { nodeType: 'logic.stop', config: { stopFurtherWorkflows: true } } },
          ],
          edges: [],
        },
        expected: true,
      },
      {
        label: 'stopFurtherWorkflows als String "true" (JSON-Altbestand)',
        doc: {
          version: 1,
          nodes: [{ id: 'n1', type: 'registry', data: { nodeType: 'logic.stop', config: { stopFurtherWorkflows: 'true' } } }],
          edges: [],
        },
        expected: true,
      },
      {
        label: 'harmloser Graph',
        doc: {
          version: 1,
          nodes: [
            { id: 't1', type: 'trigger', data: { kind: 'inbound' } },
            { id: 'n1', type: 'registry', data: { nodeType: 'logic.stop' } },
          ],
          edges: [],
        },
        expected: false,
      },
    ];
    for (const testCase of cases) {
      expect({ label: testCase.label, chainStop: sharedWorkflowGraphHasChainStopNode(testCase.doc) })
        .toEqual({ label: testCase.label, chainStop: testCase.expected });
      expect({ label: testCase.label, chainStop: coreWorkflowGraphHasChainStopNode(testCase.doc) })
        .toEqual({ label: testCase.label, chainStop: testCase.expected });
    }
  });

  test('a release node disguised as a condition does not satisfy the outbound guard', () => {
    // nodeRuntimeType (workflow-execution) wertet data.nodeType NUR bei den
    // Canvas-Typen registry/action aus. Ein als condition gespeicherter
    // „Freigabe"-Knoten laeuft zur Laufzeit als blosse Bedingung und gibt nie
    // frei — die Trap-Erkennung darf ihn deshalb nicht als Freigabe zaehlen,
    // sonst passiert ein aktiver Ausgangs-Workflow den Guard, der jede Mail
    // dauerhaft festhaelt.
    const disguised = {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'outbound' } },
        { id: 'r1', type: 'condition', data: { nodeType: 'email.release_outbound', config: { autoSend: true } } },
      ],
      edges: [{ id: 'e1', source: 't1', target: 'r1' }],
    } as never;
    expect(sharedFindOutboundGraphTraps(disguised, { effectiveTrigger: 'outbound' }).length).toBeGreaterThan(0);
    expect(coreFindOutboundGraphTraps(disguised, { effectiveTrigger: 'outbound' }).length).toBeGreaterThan(0);

    // Derselbe Knoten als registry-Typ ist eine echte Freigabe.
    const genuine = {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'outbound' } },
        { id: 'r1', type: 'registry', data: { nodeType: 'email.release_outbound', config: { autoSend: true } } },
      ],
      edges: [{ id: 'e1', source: 't1', target: 'r1' }],
    } as never;
    expect(sharedFindOutboundGraphTraps(genuine, { effectiveTrigger: 'outbound' })).toEqual([]);
    expect(coreFindOutboundGraphTraps(genuine, { effectiveTrigger: 'outbound' })).toEqual([]);
  });

  test('a genuine side-effect node still trips both', () => {
    const doc = {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'inbound' } },
        { id: 'n1', type: 'registry', data: { nodeType: 'logic.delay' } },
      ],
      edges: [{ id: 'e1', source: 't1', target: 'n1' }],
    } as never;
    expect(sharedWorkflowGraphHasSideEffectNode(doc)).toBe(true);
    expect(coreWorkflowGraphHasSideEffectNode(doc)).toBe(true);
  });
});
