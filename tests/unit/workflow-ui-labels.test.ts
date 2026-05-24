import {
  resolveRegistryNodeLabel,
  resolveRunStepNodeLabel,
} from '../../shared/workflow-ui-labels';

describe('workflow-ui-labels', () => {
  const labelByType = new Map([
    ['code.javascript', 'JavaScript'],
    ['ai.agent', 'KI-Agent'],
  ]);

  it('resolveRegistryNodeLabel prefers stored label', () => {
    expect(resolveRegistryNodeLabel('code.javascript', labelByType, 'Skript')).toBe('Skript');
  });

  it('resolveRegistryNodeLabel falls back to catalog', () => {
    expect(resolveRegistryNodeLabel('ai.agent', labelByType)).toBe('KI-Agent');
  });

  it('resolveRunStepNodeLabel uses graph registry label', () => {
    const { title } = resolveRunStepNodeLabel({
      nodeId: 'r1',
      nodeType: 'code.javascript',
      labelByType,
      graphNodes: [
        {
          id: 'r1',
          type: 'registry',
          data: { nodeType: 'code.javascript', label: 'Mein Skript' },
        },
      ],
    });
    expect(title).toBe('Mein Skript');
  });
});
