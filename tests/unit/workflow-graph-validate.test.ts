import {
  WORKFLOW_TEMPLATES,
  collectWorkflowSendDraftStaticDraftIds,
  collectWorkflowSendDraftVariableStaticDraftIds,
  findOutboundGraphTraps,
  formatOutboundGraphTraps,
  outboundGraphReleasesMail,
  workflowGraphHasAnyNodeType,
  workflowGraphHasNodeType,
  workflowGraphHasSideEffectNode,
} from '@simplecrm/core';
import type { WorkflowGraphDocument } from '@simplecrm/core';
// The electron / renderer transport carries a parallel copy of the validator.
import { findOutboundGraphTraps as findOutboundGraphTrapsShared } from '../../electron/email/email-workflow-graph-compile';

const outboundSensitiveFixed: WorkflowGraphDocument = {
  version: 1,
  nodes: [
    { id: 't1', type: 'trigger', data: { kind: 'outbound' } },
    {
      id: 'c1',
      type: 'condition',
      data: { field: 'combined_text', op: 'regex', value: 'IBAN', caseInsensitive: true },
    },
    { id: 'a1', type: 'action', data: { actionType: 'hold_outbound', reason: 'x' } },
    { id: 'release', type: 'registry', data: { nodeType: 'email.release_outbound', config: { autoSend: true } } },
  ],
  edges: [
    { id: 'e0', source: 't1', target: 'c1' },
    { id: 'e1', source: 'c1', target: 'a1', label: 'ja' },
    { id: 'e2', source: 'c1', target: 'release', label: 'nein' },
  ],
};

// The exact shape of the old, broken "outbound-sensitive" template.
const outboundSensitiveBroken: WorkflowGraphDocument = {
  version: 1,
  nodes: [
    { id: 't1', type: 'trigger', data: { kind: 'outbound' } },
    {
      id: 'c1',
      type: 'condition',
      data: { field: 'combined_text', op: 'regex', value: 'IBAN', caseInsensitive: true },
    },
    { id: 'a1', type: 'action', data: { actionType: 'hold_outbound', reason: 'x' } },
  ],
  edges: [
    { id: 'e0', source: 't1', target: 'c1' },
    { id: 'e1', source: 'c1', target: 'a1', label: 'ja' },
  ],
};

describe('findOutboundGraphTraps', () => {
  it('flags a dangling "no" branch on an outbound condition (the shipped bug)', () => {
    // ja -> hold_outbound is an intended hold; the missing "nein" branch is the
    // only real problem, so it is the only issue reported.
    expect(findOutboundGraphTraps(outboundSensitiveBroken)).toEqual([
      { code: 'dangling_condition_port', nodeId: 'c1', missing: 'no' },
    ]);
    expect(outboundGraphReleasesMail(outboundSensitiveBroken)).toBe(false);
  });

  it('passes once the "no" branch releases the mail', () => {
    expect(findOutboundGraphTraps(outboundSensitiveFixed)).toEqual([]);
    expect(outboundGraphReleasesMail(outboundSensitiveFixed)).toBe(true);
  });

  it('flags an outbound path that ends without releasing', () => {
    const graph: WorkflowGraphDocument = {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'outbound' } },
        { id: 'a1', type: 'action', data: { actionType: 'tag', tag: 'x' } },
      ],
      edges: [{ id: 'e0', source: 't1', target: 'a1' }],
    };
    expect(findOutboundGraphTraps(graph)).toEqual([{ code: 'dead_end', nodeId: 'a1' }]);
  });

  it('flags a condition whose "no" branch dead-ends even though a release node exists (P1)', () => {
    // ja -> release (safe), nein -> tag (dead-end). A single release node is NOT
    // enough — the "nein" path never releases, so those clean drafts get stuck.
    const graph: WorkflowGraphDocument = {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'outbound' } },
        { id: 'c1', type: 'condition', data: { field: 'combined_text', op: 'regex', value: 'IBAN' } },
        { id: 'release', type: 'registry', data: { nodeType: 'email.release_outbound', config: { autoSend: true } } },
        { id: 'tag', type: 'action', data: { actionType: 'tag', tag: 'sensibel' } },
      ],
      edges: [
        { id: 'e0', source: 't1', target: 'c1' },
        { id: 'e1', source: 'c1', target: 'release', label: 'ja' },
        { id: 'e2', source: 'c1', target: 'tag', label: 'nein' },
      ],
    };
    expect(findOutboundGraphTraps(graph)).toEqual([{ code: 'dead_end', nodeId: 'tag' }]);
  });

  it('accepts runtime edge-label aliases (success/error) like the engine', () => {
    // graph-walk-utils treats success->yes and error->no; the validator must too.
    const graph: WorkflowGraphDocument = {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'outbound' } },
        { id: 'c1', type: 'condition', data: { field: 'combined_text', op: 'regex', value: 'IBAN' } },
        { id: 'r1', type: 'registry', data: { nodeType: 'email.release_outbound', config: { autoSend: true } } },
        { id: 'r2', type: 'registry', data: { nodeType: 'email.send_draft', config: { draftId: 7 } } },
      ],
      edges: [
        { id: 'e0', source: 't1', target: 'c1' },
        { id: 'e1', source: 'c1', target: 'r1', label: 'success' },
        { id: 'e2', source: 'c1', target: 'r2', label: 'error' },
      ],
    };
    expect(findOutboundGraphTraps(graph)).toEqual([]);
  });

  it('requires both ports on a logic.threshold branch node', () => {
    const graph: WorkflowGraphDocument = {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'outbound' } },
        { id: 'th', type: 'registry', data: { nodeType: 'logic.threshold', config: {} } },
        { id: 'rel', type: 'registry', data: { nodeType: 'email.release_outbound', config: { autoSend: true } } },
      ],
      edges: [
        { id: 'e0', source: 't1', target: 'th' },
        { id: 'e1', source: 'th', target: 'rel', label: 'yes' },
      ],
    };
    expect(findOutboundGraphTraps(graph)).toEqual([
      { code: 'dangling_condition_port', nodeId: 'th', missing: 'no' },
    ]);
  });

  it('does not walk an auxiliary error edge when a default edge exists', () => {
    // email.tag emits 'default'; the runtime takes the default edge to release
    // and never the error branch, so the error dead-end must NOT be flagged.
    const graph: WorkflowGraphDocument = {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'outbound' } },
        { id: 'tag', type: 'action', data: { actionType: 'tag', tag: 'x' } },
        { id: 'rel', type: 'registry', data: { nodeType: 'email.release_outbound', config: { autoSend: true } } },
        { id: 'dead', type: 'action', data: { actionType: 'tag', tag: 'y' } },
      ],
      edges: [
        { id: 'e0', source: 't1', target: 'tag' },
        { id: 'e1', source: 'tag', target: 'rel' },
        { id: 'e2', source: 'tag', target: 'dead', label: 'error' },
      ],
    };
    expect(findOutboundGraphTraps(graph)).toEqual([]);
  });

  it('flags a non-branch node whose only edge is labeled (no default edge)', () => {
    // email.tag emits port 'default'. With only a 'success'-labeled edge and no
    // default/unlabeled edge, pickEdge(..., 'default') returns undefined so the
    // runtime stops at `tag` and the draft never releases — a dead end, even
    // though a release node sits just beyond the labeled edge.
    const graph: WorkflowGraphDocument = {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'outbound' } },
        { id: 'tag', type: 'action', data: { actionType: 'tag', tag: 'x' } },
        { id: 'rel', type: 'registry', data: { nodeType: 'email.release_outbound', config: { autoSend: true } } },
      ],
      edges: [
        { id: 'e0', source: 't1', target: 'tag' },
        { id: 'e1', source: 'tag', target: 'rel', label: 'success' },
      ],
    };
    expect(findOutboundGraphTraps(graph)).toEqual([{ code: 'dead_end', nodeId: 'tag' }]);
    expect(findOutboundGraphTrapsShared(graph as never)).toEqual([{ code: 'dead_end', nodeId: 'tag' }]);
  });

  it('does not count an unconfigured send_draft as a release', () => {
    const graph: WorkflowGraphDocument = {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'outbound' } },
        { id: 'sd', type: 'registry', data: { nodeType: 'email.send_draft', config: {} } },
      ],
      edges: [{ id: 'e0', source: 't1', target: 'sd' }],
    };
    expect(findOutboundGraphTraps(graph)).toEqual([{ code: 'dead_end', nodeId: 'sd' }]);
  });

  it('starts the walk at the trigger node matching the effective trigger', () => {
    // Multi-trigger graph: a safe inbound entry + a dead-ending outbound entry.
    const graph: WorkflowGraphDocument = {
      version: 1,
      nodes: [
        { id: 'tin', type: 'trigger', data: { kind: 'inbound' } },
        { id: 'tout', type: 'trigger', data: { kind: 'outbound' } },
        { id: 'rel', type: 'registry', data: { nodeType: 'email.release_outbound', config: { autoSend: true } } },
        { id: 'dead', type: 'action', data: { actionType: 'tag', tag: 'x' } },
      ],
      edges: [
        { id: 'e0', source: 'tin', target: 'rel' },
        { id: 'e1', source: 'tout', target: 'dead' },
      ],
    };
    // Walks from the OUTBOUND trigger (tout), which dead-ends.
    expect(findOutboundGraphTraps(graph, { effectiveTrigger: 'outbound' })).toEqual([
      { code: 'dead_end', nodeId: 'dead' },
    ]);
  });

  it('requires autoSend on email.release_outbound (non-autoSend re-enters review)', () => {
    const graph: WorkflowGraphDocument = {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'outbound' } },
        { id: 'c1', type: 'condition', data: { field: 'combined_text', op: 'regex', value: 'IBAN' } },
        { id: 'hold', type: 'action', data: { actionType: 'hold_outbound', reason: 'x' } },
        { id: 'rel', type: 'registry', data: { nodeType: 'email.release_outbound', config: { autoSend: false } } },
      ],
      edges: [
        { id: 'e0', source: 't1', target: 'c1' },
        { id: 'e1', source: 'c1', target: 'hold', label: 'ja' },
        { id: 'e2', source: 'c1', target: 'rel', label: 'nein' },
      ],
    };
    expect(findOutboundGraphTraps(graph)).toEqual([{ code: 'dead_end', nodeId: 'rel' }]);
  });

  it('flags a cycle that never releases', () => {
    const graph: WorkflowGraphDocument = {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'outbound' } },
        { id: 'tag', type: 'action', data: { actionType: 'tag', tag: 'x' } },
      ],
      edges: [
        { id: 'e0', source: 't1', target: 'tag' },
        { id: 'e1', source: 'tag', target: 'tag' },
      ],
    };
    expect(findOutboundGraphTraps(graph)).toEqual([{ code: 'dead_end', nodeId: 'tag' }]);
  });

  it('flags an edge that points at a missing node', () => {
    const graph: WorkflowGraphDocument = {
      version: 1,
      nodes: [{ id: 't1', type: 'trigger', data: { kind: 'outbound' } }],
      edges: [{ id: 'e0', source: 't1', target: 'ghost' }],
    };
    expect(findOutboundGraphTraps(graph)).toEqual([{ code: 'dead_end', nodeId: 'ghost' }]);
  });

  it('flags a trigger-only outbound graph as a dead end (no edges at all)', () => {
    // The most minimal trap: a lone outbound trigger with nothing wired. The
    // client save guard only checks nodes.length > 0, so this graph IS savable;
    // the validator must still flag it so the server 422 / client guard fire.
    const graph: WorkflowGraphDocument = {
      version: 1,
      nodes: [{ id: 't1', type: 'trigger', data: { kind: 'outbound' } }],
      edges: [],
    };
    expect(findOutboundGraphTraps(graph)).toEqual([{ code: 'dead_end', nodeId: 't1' }]);
    expect(outboundGraphReleasesMail(graph)).toBe(false);
    // Parity: the shared (electron/renderer) copy must agree.
    expect(findOutboundGraphTrapsShared(graph as never)).toEqual([{ code: 'dead_end', nodeId: 't1' }]);
  });

  it('validates against the effective trigger even if the graph trigger node differs', () => {
    const graph: WorkflowGraphDocument = {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'inbound' } },
        { id: 'tag', type: 'action', data: { actionType: 'tag', tag: 'x' } },
      ],
      edges: [{ id: 'e0', source: 't1', target: 'tag' }],
    };
    // Graph trigger says inbound → default gate skips it.
    expect(findOutboundGraphTraps(graph)).toEqual([]);
    // But the workflow is stored as trigger_name=outbound → validate and flag.
    expect(findOutboundGraphTraps(graph, { effectiveTrigger: 'outbound' })).toEqual([
      { code: 'dead_end', nodeId: 'tag' },
    ]);
  });

  it('never flags a non-outbound graph, even with a dangling port', () => {
    const inbound: WorkflowGraphDocument = {
      ...outboundSensitiveBroken,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'inbound' } },
        ...outboundSensitiveBroken.nodes.slice(1),
      ],
    };
    expect(findOutboundGraphTraps(inbound)).toEqual([]);
  });

  it('is defensive against malformed documents', () => {
    expect(findOutboundGraphTraps({} as unknown as WorkflowGraphDocument)).toEqual([]);
    expect(findOutboundGraphTraps(null as unknown as WorkflowGraphDocument)).toEqual([]);
  });

  it('formats a non-empty German message for real issues', () => {
    const msg = formatOutboundGraphTraps(findOutboundGraphTraps(outboundSensitiveBroken));
    expect(msg).toMatch(/Freigabe/);
    expect(msg.length).toBeGreaterThan(0);
    expect(formatOutboundGraphTraps([])).toBe('');
  });

  it('the shared (electron) copy agrees with the core copy', () => {
    expect(findOutboundGraphTrapsShared(outboundSensitiveBroken as never)).toEqual(
      findOutboundGraphTraps(outboundSensitiveBroken),
    );
    expect(findOutboundGraphTrapsShared(outboundSensitiveFixed as never)).toEqual([]);
  });
});

describe('shipped outbound templates never trap mail', () => {
  const outboundTemplates = WORKFLOW_TEMPLATES.filter((t) => {
    const trigger = t.graph?.nodes.find((n) => n.type === 'trigger');
    return String((trigger?.data as { kind?: string } | undefined)?.kind) === 'outbound';
  });

  it('covers at least the two outbound templates', () => {
    expect(outboundTemplates.length).toBeGreaterThanOrEqual(2);
  });

  it.each(outboundTemplates.map((t) => [t.id, t]))('%s releases mail', (_id, template) => {
    expect(findOutboundGraphTraps((template as { graph: WorkflowGraphDocument }).graph)).toEqual([]);
  });
});

describe('workflowGraphHasSideEffectNode', () => {
  const trigger = { id: 't1', type: 'trigger', data: { kind: 'inbound' } } as const;

  const graphOf = (nodes: WorkflowGraphDocument['nodes']): WorkflowGraphDocument => ({
    version: 1,
    nodes,
    edges: [],
  });

  it('returns false for null / non-object / graph without nodes', () => {
    expect(workflowGraphHasSideEffectNode(null)).toBe(false);
    expect(workflowGraphHasSideEffectNode(undefined)).toBe(false);
    expect(workflowGraphHasSideEffectNode(42)).toBe(false);
    expect(workflowGraphHasSideEffectNode({})).toBe(false);
    expect(workflowGraphHasSideEffectNode({ nodes: 'x' })).toBe(false);
  });

  it('ignores triggers, conditions, in-memory logic.* helpers and known read-only nodes', () => {
    expect(
      workflowGraphHasSideEffectNode(
        graphOf([
          trigger,
          { id: 'c1', type: 'condition', data: { field: 'subject', op: 'contains', value: 'x' } },
          { id: 'l1', type: 'registry', data: { nodeType: 'logic.set_variable', config: { name: 'v', value: '1' } } },
          { id: 'r1', type: 'registry', data: { nodeType: 'email.read_tracking_evidence', config: {} } },
          { id: 'r3', type: 'registry', data: { nodeType: 'email.sender_filter', config: {} } },
        ]),
      ),
    ).toBe(false);
  });

  it('exempts every in-memory logic.* helper but never logic.delay', () => {
    for (const nodeType of ['logic.stop', 'logic.set_variable', 'logic.merge', 'logic.threshold', 'logic.switch', 'logic.loop']) {
      expect(
        workflowGraphHasSideEffectNode(graphOf([trigger, { id: 'n', type: 'registry', data: { nodeType, config: {} } }])),
      ).toBe(false);
    }
  });

  it('flags logic.delay as side-effecting (it schedules a delayed job + future workflow.execute)', () => {
    expect(
      workflowGraphHasSideEffectNode(
        graphOf([trigger, { id: 'd', type: 'registry', data: { nodeType: 'logic.delay', config: { delaySeconds: 60 } } }]),
      ),
    ).toBe(true);
  });

  it('fails closed on an unrecognized logic.* type (allowlist, not prefix)', () => {
    expect(
      workflowGraphHasSideEffectNode(graphOf([trigger, { id: 'x', type: 'registry', data: { nodeType: 'logic.webhook', config: {} } }])),
    ).toBe(true);
  });

  it('flags ai.classify as side-effecting (it persists a tag)', () => {
    expect(
      workflowGraphHasSideEffectNode(
        graphOf([
          trigger,
          { id: 'r2', type: 'registry', data: { nodeType: 'ai.classify', config: {} } },
        ]),
      ),
    ).toBe(true);
  });

  it('flags jtl.order_context and ai.reply_suggestion side-effecting, keeps jtl.lookup read-only', () => {
    // jtl.order_context runs a caller-configurable SELECT against the workspace's
    // external MSSQL/ERP connection; ai.reply_suggestion enqueues a child that calls the
    // external AI provider and writes email_messages.reply_suggestion_* — both reach
    // outside/write, so a non-admin live run must be blocked.
    for (const nodeType of ['jtl.order_context', 'ai.reply_suggestion']) {
      expect(
        workflowGraphHasSideEffectNode(graphOf([trigger, { id: 'n1', type: 'registry', data: { nodeType, config: {} } }])),
      ).toBe(true);
    }
    // jtl.lookup only reads the workspace's own synced JTL tables (local Postgres,
    // workspace-scoped) — no external reach — so it stays read-only.
    expect(
      workflowGraphHasSideEffectNode(graphOf([trigger, { id: 'jl', type: 'registry', data: { nodeType: 'jtl.lookup', config: {} } }])),
    ).toBe(false);
  });

  it('flags a writing registry node (email.delete_server)', () => {
    expect(
      workflowGraphHasSideEffectNode(
        graphOf([trigger, { id: 'd1', type: 'registry', data: { nodeType: 'email.delete_server', config: {} } }]),
      ),
    ).toBe(true);
  });

  it('flags a legacy action node by actionType (tag / archive / forward_copy)', () => {
    for (const actionType of ['tag', 'archive', 'forward_copy', 'mark_seen', 'set_category']) {
      expect(
        workflowGraphHasSideEffectNode(graphOf([trigger, { id: 'a1', type: 'action', data: { actionType } }])),
      ).toBe(true);
    }
  });

  it('flags CRM writes, http.request, sync.run and subflow', () => {
    for (const nodeType of ['crm.update_deal', 'http.request', 'sync.run', 'workflow.subflow', 'mssql.query']) {
      expect(
        workflowGraphHasSideEffectNode(graphOf([trigger, { id: 'n', type: 'registry', data: { nodeType, config: {} } }])),
      ).toBe(true);
    }
  });

  it('fails closed on an unknown canvas type', () => {
    expect(
      workflowGraphHasSideEffectNode(graphOf([trigger, { id: 'x', type: 'mystery-node', data: {} }])),
    ).toBe(true);
  });

  it('accepts a JSON-string graph', () => {
    const json = JSON.stringify(
      graphOf([trigger, { id: 'a1', type: 'action', data: { actionType: 'archive' } }]),
    );
    expect(workflowGraphHasSideEffectNode(json)).toBe(true);
    expect(workflowGraphHasSideEffectNode('{not json')).toBe(false);
  });
});

describe('workflowGraphHasNodeType', () => {
  const trigger = { id: 't1', type: 'trigger', data: { kind: 'inbound' } } as const;

  const graphOf = (nodes: WorkflowGraphDocument['nodes']): WorkflowGraphDocument => ({
    version: 1,
    nodes,
    edges: [],
  });

  it('returns false for null / non-object / graph without nodes', () => {
    expect(workflowGraphHasNodeType(null, 'email.delete_server')).toBe(false);
    expect(workflowGraphHasNodeType(undefined, 'email.delete_server')).toBe(false);
    expect(workflowGraphHasNodeType(42, 'email.delete_server')).toBe(false);
    expect(workflowGraphHasNodeType({}, 'email.delete_server')).toBe(false);
    expect(workflowGraphHasNodeType({ nodes: 'x' }, 'email.delete_server')).toBe(false);
  });

  it('matches a registry node by its runtime type, regardless of reachability', () => {
    expect(
      workflowGraphHasNodeType(
        graphOf([
          trigger,
          { id: 'c1', type: 'condition', data: { field: 'subject', op: 'contains', value: 'x' } },
          { id: 'd1', type: 'registry', data: { nodeType: 'email.delete_server', config: {} } },
        ]),
        'email.delete_server',
      ),
    ).toBe(true);
  });

  it('matches a legacy action node by its actionType', () => {
    expect(
      workflowGraphHasNodeType(
        graphOf([trigger, { id: 'a1', type: 'action', data: { actionType: 'email.delete_server' } }]),
        'email.delete_server',
      ),
    ).toBe(true);
  });

  it('returns false when no node has the requested type', () => {
    expect(
      workflowGraphHasNodeType(
        graphOf([
          trigger,
          { id: 'r1', type: 'registry', data: { nodeType: 'ai.classify', config: {} } },
          { id: 'r2', type: 'registry', data: { nodeType: 'email.move_imap', config: {} } },
        ]),
        'email.delete_server',
      ),
    ).toBe(false);
  });

  it('never matches trigger or condition nodes', () => {
    expect(
      workflowGraphHasNodeType(
        graphOf([{ id: 't', type: 'trigger', data: { kind: 'email.delete_server' } }]),
        'email.delete_server',
      ),
    ).toBe(false);
  });

  it('accepts a JSON-string graph', () => {
    const json = JSON.stringify(
      graphOf([trigger, { id: 'd1', type: 'registry', data: { nodeType: 'email.delete_server', config: {} } }]),
    );
    expect(workflowGraphHasNodeType(json, 'email.delete_server')).toBe(true);
    expect(workflowGraphHasNodeType('{not json', 'email.delete_server')).toBe(false);
  });
});

describe('workflowGraphHasAnyNodeType', () => {
  const trigger = { id: 't1', type: 'trigger', data: { kind: 'inbound' } } as const;
  const graphOf = (nodes: WorkflowGraphDocument['nodes']): WorkflowGraphDocument => ({
    version: 1,
    nodes,
    edges: [],
  });
  const TRIAGE = new Set(['email.tag', 'tag', 'email.archive', 'archive']);

  it('matches any registry node whose runtime type is in the set', () => {
    expect(
      workflowGraphHasAnyNodeType(
        graphOf([trigger, { id: 'n', type: 'registry', data: { nodeType: 'email.tag', config: {} } }]),
        TRIAGE,
      ),
    ).toBe(true);
  });

  it('matches a legacy action node by its bare actionType', () => {
    expect(
      workflowGraphHasAnyNodeType(
        graphOf([trigger, { id: 'a', type: 'action', data: { actionType: 'archive' } }]),
        TRIAGE,
      ),
    ).toBe(true);
  });

  it('returns false when no node type is in the set', () => {
    expect(
      workflowGraphHasAnyNodeType(
        graphOf([trigger, { id: 'n', type: 'registry', data: { nodeType: 'email.create_draft', config: {} } }]),
        TRIAGE,
      ),
    ).toBe(false);
  });

  it('returns false for null / non-object / graph without nodes', () => {
    expect(workflowGraphHasAnyNodeType(null, TRIAGE)).toBe(false);
    expect(workflowGraphHasAnyNodeType({ nodes: 'x' }, TRIAGE)).toBe(false);
  });
});

describe('collectWorkflowSendDraftStaticDraftIds', () => {
  const trigger = { id: 't1', type: 'trigger', data: { kind: 'inbound' } } as const;
  const graphOf = (nodes: WorkflowGraphDocument['nodes']): WorkflowGraphDocument => ({
    version: 1,
    nodes,
    edges: [],
  });

  it('collects positive-integer config.draftId from email.send_draft nodes, deduped', () => {
    expect(
      collectWorkflowSendDraftStaticDraftIds(graphOf([
        trigger,
        { id: 's1', type: 'registry', data: { nodeType: 'email.send_draft', config: { draftId: 13 } } },
        { id: 's2', type: 'registry', data: { nodeType: 'email.send_draft', config: { draftId: 13 } } },
        { id: 's3', type: 'registry', data: { nodeType: 'email.send_draft', config: { draftId: 20 } } },
      ])).sort((a, b) => a - b),
    ).toEqual([13, 20]);
  });

  it('ignores runtime draftIdVariable, missing/invalid ids, and non-send_draft nodes', () => {
    expect(
      collectWorkflowSendDraftStaticDraftIds(graphOf([
        trigger,
        { id: 'v', type: 'registry', data: { nodeType: 'email.send_draft', config: { draftIdVariable: 'draft.id' } } },
        { id: 'z', type: 'registry', data: { nodeType: 'email.send_draft', config: { draftId: 0 } } },
        { id: 'n', type: 'registry', data: { nodeType: 'email.send_draft', config: { draftId: -4 } } },
        { id: 'f', type: 'registry', data: { nodeType: 'email.send_draft', config: { draftId: 1.5 } } },
        { id: 's', type: 'registry', data: { nodeType: 'email.send_draft', config: { draftId: '7' } } },
        { id: 'o', type: 'registry', data: { nodeType: 'email.create_draft', config: { draftId: 99 } } },
      ])),
    ).toEqual([]);
  });

  it('returns [] for null / non-object / graph without nodes / bad JSON string', () => {
    expect(collectWorkflowSendDraftStaticDraftIds(null)).toEqual([]);
    expect(collectWorkflowSendDraftStaticDraftIds({})).toEqual([]);
    expect(collectWorkflowSendDraftStaticDraftIds({ nodes: 'x' })).toEqual([]);
    expect(collectWorkflowSendDraftStaticDraftIds('{not json')).toEqual([]);
  });
});

describe('collectWorkflowSendDraftVariableStaticDraftIds', () => {
  const trigger = { id: 't1', type: 'trigger', data: { kind: 'inbound' } } as const;
  const graphOf = (nodes: WorkflowGraphDocument['nodes']): WorkflowGraphDocument => ({
    version: 1,
    nodes,
    edges: [],
  });

  it('resolves a draftIdVariable pinned by a logic.set_variable node (number and numeric string)', () => {
    expect(
      collectWorkflowSendDraftVariableStaticDraftIds(graphOf([
        trigger,
        { id: 'v1', type: 'registry', data: { nodeType: 'logic.set_variable', config: { name: 'reply.draft', value: 42 } } },
        { id: 's1', type: 'registry', data: { nodeType: 'email.send_draft', config: { draftIdVariable: 'reply.draft' } } },
        // The bare `set_variable` action alias with a numeric string, feeding the default `draft.id`.
        { id: 'v2', type: 'action', data: { actionType: 'set_variable', config: { name: 'draft.id', value: '7' } } },
        { id: 's2', type: 'registry', data: { nodeType: 'email.send_draft', config: {} } },
      ])).sort((a, b) => a - b),
    ).toEqual([7, 42]);
  });

  it('ignores dynamic/interpolated values, static config.draftId nodes, and mismatched variable names', () => {
    expect(
      collectWorkflowSendDraftVariableStaticDraftIds(graphOf([
        trigger,
        // Interpolated value → unknown at policy time.
        { id: 'vi', type: 'registry', data: { nodeType: 'logic.set_variable', config: { name: 'draft.id', value: '{{customer.draftId}}' } } },
        { id: 'si', type: 'registry', data: { nodeType: 'email.send_draft', config: { draftIdVariable: 'draft.id' } } },
        // send_draft hard-codes draftId → runtime consults that, NOT the variable.
        { id: 'vs', type: 'registry', data: { nodeType: 'logic.set_variable', config: { name: 'other', value: 5 } } },
        { id: 'ss', type: 'registry', data: { nodeType: 'email.send_draft', config: { draftId: 9, draftIdVariable: 'other' } } },
        // set_variable exists but no send_draft reads that variable name.
        { id: 'vm', type: 'registry', data: { nodeType: 'logic.set_variable', config: { name: 'unused', value: 3 } } },
      ])),
    ).toEqual([]);
  });

  it('returns [] for null / non-object / graph without nodes / bad JSON string', () => {
    expect(collectWorkflowSendDraftVariableStaticDraftIds(null)).toEqual([]);
    expect(collectWorkflowSendDraftVariableStaticDraftIds({})).toEqual([]);
    expect(collectWorkflowSendDraftVariableStaticDraftIds({ nodes: 'x' })).toEqual([]);
    expect(collectWorkflowSendDraftVariableStaticDraftIds('{not json')).toEqual([]);
  });
});
