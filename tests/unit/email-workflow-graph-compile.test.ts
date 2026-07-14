import { WORKFLOW_TEMPLATES } from '@simplecrm/core';
import { compileGraphToDefinition } from '../../electron/email/email-workflow-graph-compile';
import type { WorkflowGraphDocument } from '../../shared/email-workflow-graph';

describe('email-workflow-graph-compile', () => {
  it('compiles if/else branches into separate rules', () => {
    const doc: WorkflowGraphDocument = {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'inbound' } },
        { id: 'c1', type: 'condition', data: { field: 'subject', op: 'contains', value: 'Rechnung' } },
        { id: 'a1', type: 'action', data: { actionType: 'tag', tag: 'rechnung' } },
        { id: 'a2', type: 'action', data: { actionType: 'tag', tag: 'sonst' } },
      ],
      edges: [
        { id: 'e0', source: 't1', target: 'c1' },
        { id: 'e1', source: 'c1', target: 'a1', label: 'ja' },
        { id: 'e2', source: 'c1', target: 'a2', label: 'nein' },
      ],
    };
    const def = compileGraphToDefinition(doc);
    expect(def.rules.length).toBe(2);
    const tags = def.rules.map((r) => r.then[0]).filter((s) => s?.type === 'tag');
    expect(tags).toHaveLength(2);
  });

  it('preserves negated condition nodes as not conditions', () => {
    const doc: WorkflowGraphDocument = {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'inbound' } },
        { id: 'c1', type: 'condition', data: { field: 'subject', op: 'contains', value: 'Rechnung', negated: true } },
        { id: 'a1', type: 'action', data: { actionType: 'tag', tag: 'keine-rechnung' } },
      ],
      edges: [
        { id: 'e0', source: 't1', target: 'c1' },
        { id: 'e1', source: 'c1', target: 'a1', label: 'ja' },
      ],
    };

    const def = compileGraphToDefinition(doc);
    expect(def.rules[0]?.when).toEqual({ not: { field: 'subject', op: 'contains', value: 'Rechnung' } });
  });

  it('preserves registry forward_copy options from templates in compiled fallback', () => {
    const template = WORKFLOW_TEMPLATES.find((item) => item.id === 'inbound-rechnung-inbox-forward');
    expect(template).toBeDefined();

    const def = compileGraphToDefinition(template!.graph as WorkflowGraphDocument);
    const steps = def.rules.flatMap((rule) => rule.then);

    expect(steps).toEqual(
      expect.arrayContaining([
        { type: 'tag', tag: 'rechnung-postfach' },
        expect.objectContaining({
          type: 'forward_copy',
          to: 'bank@example.com, buchhaltung@example.com',
          includeAttachments: false,
          runOutboundReview: false,
        }),
      ]),
    );
  });

  it('preserves registry-only workflow steps instead of silently dropping them', () => {
    const template = WORKFLOW_TEMPLATES.find((item) => item.id === 'inbound-ai-auto-reply');
    expect(template).toBeDefined();

    const def = compileGraphToDefinition(template!.graph as WorkflowGraphDocument);
    const steps = def.rules.flatMap((rule) => rule.then);

    expect(steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'registry', nodeType: 'ai.classify' }),
        expect.objectContaining({ type: 'registry', nodeType: 'email.auto_reply' }),
        expect.objectContaining({ type: 'registry', nodeType: 'ai.pick_canned' }),
        expect.objectContaining({ type: 'registry', nodeType: 'email.send_draft' }),
      ]),
    );
  });

  it('preserves outbound-review registry nodes that use the default prompt', () => {
    const template = WORKFLOW_TEMPLATES.find((item) => item.id === 'outbound-quality-check');
    expect(template).toBeDefined();

    const def = compileGraphToDefinition(template!.graph as WorkflowGraphDocument);
    const steps = def.rules.flatMap((rule) => rule.then);

    expect(steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'registry',
          nodeType: 'ai.outbound_review',
          config: expect.objectContaining({ promptId: 0, checkReplyContext: true }),
        }),
        expect.objectContaining({
          type: 'registry',
          nodeType: 'email.release_outbound',
          config: expect.objectContaining({ autoSend: true }),
        }),
      ]),
    );
  });

  it('ships a delayed outbound evidence follow-up template', () => {
    const template = WORKFLOW_TEMPLATES.find((item) => item.id === 'outbound-evidence-follow-up');
    expect(template).toBeDefined();

    const nodes = template!.graph.nodes.map((node) => node.data as { nodeType?: string; config?: Record<string, unknown> });
    expect(nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeType: 'email.release_outbound', config: expect.objectContaining({ autoSend: true }) }),
      expect.objectContaining({ nodeType: 'logic.delay', config: expect.objectContaining({ delaySeconds: 172800 }) }),
      expect.objectContaining({ nodeType: 'email.read_tracking_evidence' }),
      expect.objectContaining({ nodeType: 'logic.switch', config: expect.objectContaining({ field: 'tracking.tracked', cases: 'true' }) }),
      expect.objectContaining({ nodeType: 'logic.switch', config: expect.objectContaining({ field: 'tracking.transport', cases: 'smtp_accepted' }) }),
      expect.objectContaining({ nodeType: 'logic.threshold', config: expect.objectContaining({ variable: 'tracking.probable_open_count' }) }),
      expect.objectContaining({ nodeType: 'logic.threshold', config: expect.objectContaining({ variable: 'tracking.probable_click_count' }) }),
      expect.objectContaining({ nodeType: 'crm.create_task' }),
    ]));
  });

  it('preserves forward_copy attachment and outbound-review options when compiling registry nodes', () => {
    const template = WORKFLOW_TEMPLATES.find((item) => item.id === 'inbound-invoice-auto-forward');
    expect(template).toBeDefined();

    const def = compileGraphToDefinition(template!.graph as WorkflowGraphDocument);
    const steps = def.rules.flatMap((rule) => rule.then);

    expect(steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'forward_copy',
          to: 'bank@example.com, buchhaltung@example.com',
          includeAttachments: true,
          runOutboundReview: false,
        }),
      ]),
    );
  });

  it('preserves forward_copy options from legacy action nodes too', () => {
    const doc: WorkflowGraphDocument = {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'inbound' } },
        { id: 'c1', type: 'condition', data: { field: 'subject', op: 'contains', value: 'Rechnung' } },
        {
          id: 'a1',
          type: 'action',
          data: {
            actionType: 'forward_copy',
            to: 'bank@example.com',
            includeAttachments: true,
            runOutboundReview: true,
          },
        },
      ],
      edges: [
        { id: 'e0', source: 't1', target: 'c1' },
        { id: 'e1', source: 'c1', target: 'a1', label: 'ja' },
      ],
    };

    const def = compileGraphToDefinition(doc);
    expect(def.rules[0]?.then).toEqual([
      expect.objectContaining({
        type: 'forward_copy',
        to: 'bank@example.com',
        includeAttachments: true,
        runOutboundReview: true,
      }),
    ]);
  });

});
