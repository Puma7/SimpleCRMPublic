import {
  exportWorkflowBundle,
  parseWorkflowImport,
  type WorkflowExportSource,
} from '../../packages/core/src/workflow';
import {
  exportWorkflowBundle as exportSharedWorkflowBundle,
  parseWorkflowImport as parseSharedWorkflowImport,
  type WorkflowExportSource as SharedWorkflowExportSource,
} from '../../shared/workflow-export-import';

describe('workflow export/import', () => {
  test('exports stable workflow metadata and parsed graph json', () => {
    const row: WorkflowExportSource = {
      name: 'Inbound',
      trigger: 'inbound',
      priority: 10,
      enabled: 1,
      definition_json: '{"version":1,"rules":[]}',
      graph_json: JSON.stringify({
        version: 1,
        nodes: [{ id: 't1', type: 'trigger', data: { kind: 'inbound' } }],
        edges: [],
      }),
      cron_expr: null,
      schedule_account_id: null,
      execution_mode: null,
      engine_version: null,
    };

    const bundle = exportWorkflowBundle(row, new Date('2026-06-03T10:00:00.000Z'));

    expect(bundle.exportedAt).toBe('2026-06-03T10:00:00.000Z');
    expect(bundle.workflow.enabled).toBe(true);
    expect(bundle.workflow.execution_mode).toBe('graph');
    expect(bundle.workflow.engine_version).toBe(1);
    expect(bundle.workflow.graph_json?.nodes[0]?.id).toBe('t1');
  });

  test('drops invalid graph json instead of exporting malformed graph', () => {
    const bundle = exportWorkflowBundle(
      {
        name: 'Broken',
        trigger: 'manual',
        priority: 1,
        enabled: false,
        definition_json: '{}',
        graph_json: '{bad',
        cron_expr: null,
        schedule_account_id: null,
      },
      new Date('2026-06-03T10:00:00.000Z'),
    );

    expect(bundle.workflow.graph_json).toBeNull();
  });

  test('parseWorkflowImport validates bundle shape', () => {
    const json = JSON.stringify({
      version: 1,
      exportedAt: '2026-06-03T10:00:00.000Z',
      workflow: { name: 'Imported' },
    });

    expect(parseWorkflowImport(json).workflow.name).toBe('Imported');
    expect(() => parseWorkflowImport(JSON.stringify({ version: 2 }))).toThrow(
      /Workflow-Exportformat/,
    );
  });

  test('shared browser serializer matches core workflow bundle shape', () => {
    const row: SharedWorkflowExportSource = {
      name: 'Browser Import',
      trigger: 'manual',
      priority: 20,
      enabled: true,
      definition_json: '{"version":1,"rules":[]}',
      graph_json: JSON.stringify({
        version: 1,
        nodes: [{ id: 'trigger-1', type: 'trigger', data: { kind: 'manual' } }],
        edges: [],
      }),
      cron_expr: null,
      schedule_account_id: null,
      execution_mode: 'graph',
      engine_version: 1,
    };

    const exportedAt = new Date('2026-06-03T11:00:00.000Z');
    const sharedBundle = exportSharedWorkflowBundle(row, exportedAt);
    const coreBundle = exportWorkflowBundle(row as WorkflowExportSource, exportedAt);

    expect(sharedBundle).toEqual(coreBundle);
    expect(parseSharedWorkflowImport(JSON.stringify(sharedBundle)).workflow.name).toBe(
      'Browser Import',
    );
  });
});
