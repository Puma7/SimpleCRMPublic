import { DEFAULT_INBOUND_WORKFLOW } from '../../electron/email/email-workflow-defaults';
import { definitionToGraphDocument } from '../../electron/workflow/definition-to-graph';
import {
  buildBlankWorkflowGraph,
  buildDefaultInboundGraph,
  graphHasRunnableNodes,
} from '../../packages/core/src/workflow';

describe('modular workflow graphs', () => {
  test('blank graph is trigger-only modular canvas', () => {
    const g = buildBlankWorkflowGraph('manual');
    expect(g.nodes).toHaveLength(1);
    expect(g.nodes[0].type).toBe('trigger');
    expect(graphHasRunnableNodes(g)).toBe(false);
  });

  test('default inbound graph uses condition/action nodes', () => {
    const g = buildDefaultInboundGraph();
    expect(g.nodes.filter((n) => n.type === 'condition').length).toBeGreaterThan(0);
    expect(g.nodes.filter((n) => n.type === 'action').length).toBeGreaterThan(0);
    expect(graphHasRunnableNodes(g)).toBe(true);
  });

  test('definitionToGraphDocument migrates legacy rules to graph', () => {
    const doc = definitionToGraphDocument(DEFAULT_INBOUND_WORKFLOW, 'inbound');
    expect(doc).not.toBeNull();
    expect(doc!.nodes.some((n) => n.type === 'action')).toBe(true);
  });

  test('definitionToGraphDocument preserves forward-copy options and registry steps', () => {
    const doc = definitionToGraphDocument({
      version: 1,
      rules: [{
        when: { field: 'subject', op: 'contains', value: 'Rechnung' },
        then: [
          { type: 'forward_copy', to: 'bank@example.com', includeAttachments: true, runOutboundReview: true },
          { type: 'registry', nodeType: 'email.send_draft', config: { draftIdVariable: 'draft.id', runOutboundReview: false } },
        ],
      }],
    }, 'inbound');

    expect(doc).not.toBeNull();
    expect(doc!.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'action',
          data: expect.objectContaining({
            actionType: 'forward_copy',
            to: 'bank@example.com',
            includeAttachments: true,
            runOutboundReview: true,
          }),
        }),
        expect.objectContaining({
          type: 'registry',
          data: expect.objectContaining({
            nodeType: 'email.send_draft',
            config: expect.objectContaining({ draftIdVariable: 'draft.id', runOutboundReview: false }),
          }),
        }),
      ]),
    );
  });

});
