import type { WorkflowGraphNode } from '../../shared/email-workflow-graph';
import { inboundNodeRequiresConditionGate } from '../../electron/workflow/inbound-gate';

function node(
  type: WorkflowGraphNode['type'],
  data: Record<string, unknown>,
): WorkflowGraphNode {
  return { id: 'n1', type, data: data as WorkflowGraphNode['data'] };
}

describe('inboundNodeRequiresConditionGate', () => {
  test('allows sender_filter and ai.classify without prior condition', () => {
    expect(
      inboundNodeRequiresConditionGate(
        node('registry', { nodeType: 'email.sender_filter', config: {} }),
      ),
    ).toBe(false);
    expect(
      inboundNodeRequiresConditionGate(node('registry', { nodeType: 'ai.classify', config: {} })),
    ).toBe(false);
  });

  test('gates crm, code, and email side-effect nodes', () => {
    expect(
      inboundNodeRequiresConditionGate(
        node('registry', { nodeType: 'crm.create_task', config: {} }),
      ),
    ).toBe(true);
    expect(
      inboundNodeRequiresConditionGate(
        node('registry', { nodeType: 'code.javascript', config: { code: '1' } }),
      ),
    ).toBe(true);
    expect(
      inboundNodeRequiresConditionGate(node('registry', { nodeType: 'email.archive', config: {} })),
    ).toBe(true);
  });

  test('allows logic routing nodes', () => {
    expect(
      inboundNodeRequiresConditionGate(node('registry', { nodeType: 'logic.switch', config: {} })),
    ).toBe(false);
  });

  test('runOnEveryInbound opts out of gate', () => {
    expect(
      inboundNodeRequiresConditionGate(
        node('registry', {
          nodeType: 'crm.log_activity',
          config: { runOnEveryInbound: true },
        }),
      ),
    ).toBe(false);
  });

  test('legacy action nodes are gated', () => {
    expect(inboundNodeRequiresConditionGate(node('action', { actionType: 'archive' }))).toBe(true);
  });
});
