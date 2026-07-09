import {
  WORKFLOW_TEMPLATES,
  findOutboundGraphTraps,
  formatOutboundGraphTraps,
  outboundGraphReleasesMail,
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
        { id: 'r2', type: 'registry', data: { nodeType: 'email.send_draft', config: {} } },
      ],
      edges: [
        { id: 'e0', source: 't1', target: 'c1' },
        { id: 'e1', source: 'c1', target: 'r1', label: 'success' },
        { id: 'e2', source: 'c1', target: 'r2', label: 'error' },
      ],
    };
    expect(findOutboundGraphTraps(graph)).toEqual([]);
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
