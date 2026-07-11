import { WORKFLOW_TEMPLATES } from '@simplecrm/core';
import { ensureBuiltinWorkflowNodes, listWorkflowNodeCatalog } from '../../electron/workflow/registry';
import {
  parseCannedPickNumber,
  parseClassificationOutput,
} from '../../electron/workflow/ai-classification-parse';
import { registerLogicNodes } from '../../electron/workflow/nodes/logic-nodes';
import { registerEmailNodes } from '../../electron/workflow/nodes/email-nodes';
import type { RegisteredWorkflowNode, WorkflowContext } from '../../electron/workflow/types';
import { runWorkflowGraph } from '../../electron/workflow/runtime';
import { assignCategoryPathToMessage } from '../../electron/email/email-crm-store';

jest.mock('../../electron/email/email-crm-store', () => ({
  assignCategoryPathToMessage: jest.fn(),
  tryLinkMessageToCustomer: jest.fn(),
  listAiPrompts: jest.fn(() => []),
}));

jest.mock('../../electron/workflow/run-steps', () => ({
  insertWorkflowRunStep: jest.fn(),
}));

// Das Auto-Antwort-Gate prüft seine (rein lesenden) Guards auch im Dry-Run —
// Schalter an, kein Rate-Limit, damit der Confidence-Pfad testbar bleibt.
jest.mock('../../electron/sqlite-service', () => ({
  getSyncInfo: jest.fn((key: string) => (key === 'auto_reply_enabled' ? '1' : null)),
  setSyncInfo: jest.fn(),
  getDb: jest.fn(),
  getCustomerById: jest.fn(() => null),
}));

jest.mock('../../electron/workflow/auto-reply-guard', () => ({
  isAutoReplyRateLimited: jest.fn(() => false),
  markAutoReplySent: jest.fn(),
  tryReserveAutoReplySlot: jest.fn(() => true),
}));

function collect(registerNodes: (register: (def: RegisteredWorkflowNode) => void) => void) {
  const defs = new Map<string, RegisteredWorkflowNode>();
  registerNodes((def) => defs.set(def.type, def));
  return defs;
}

describe('workflow desktop parity', () => {
  test('electron registry includes all template node types', () => {
    ensureBuiltinWorkflowNodes();
    const registryTypes = new Set(listWorkflowNodeCatalog().map((e) => e.type));
    const missing: string[] = [];
    for (const template of WORKFLOW_TEMPLATES) {
      for (const node of template.graph.nodes) {
        if (node.type !== 'registry') continue;
        const nodeType = String((node.data as { nodeType?: string }).nodeType ?? '');
        if (!registryTypes.has(nodeType)) missing.push(`${template.id}:${nodeType}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test('parseClassificationOutput extracts label and confidence', () => {
    expect(parseClassificationOutput('Rechnung|85')).toEqual({
      label: 'Rechnung',
      confidence: 85,
    });
    expect(parseClassificationOutput('Support')).toEqual({
      label: 'Support',
      confidence: null,
    });
  });

  test('parseCannedPickNumber bounds pick index', () => {
    expect(parseCannedPickNumber('3', 5)).toBe(3);
    expect(parseCannedPickNumber('0', 5)).toBe(0);
    expect(parseCannedPickNumber('9', 5)).toBe(0);
  });

  test('logic.delay honors delaySeconds from editor', async () => {
    const def = collect(registerLogicNodes).get('logic.delay')!;
    expect(def.defaultConfig).toMatchObject({ delaySeconds: 60 });
    const r = await def.execute(
      {
        trigger: 'manual',
        direction: 'manual',
        messageId: null,
        message: null,
        outbound: null,
        workflowId: 1,
        runId: 1,
        dryRun: true,
        variables: {},
        strings: {},
        ai: {},
      },
      { delaySeconds: 45 },
      'delay1',
    );
    expect(r.message).toContain('45s');
  });

  test('inbound KI routing runs set_category after logic.switch', async () => {
    const graph = {
      version: 1 as const,
      nodes: [
        { id: 't1', type: 'trigger' as const, data: { kind: 'inbound' } },
        {
          id: 'sw1',
          type: 'registry' as const,
          data: { nodeType: 'logic.switch', config: { field: 'ai.class', cases: 'rechnung,support' } },
        },
        { id: 'cat_r', type: 'action' as const, data: { actionType: 'set_category', path: 'Buchhaltung/Rechnungen' } },
      ],
      edges: [
        { id: 'e0', source: 't1', target: 'sw1' },
        { id: 'e1', source: 'sw1', target: 'cat_r', label: 'rechnung' },
      ],
    };

    const message = { id: 99, account_id: 1, has_attachments: false } as never;
    const result = await runWorkflowGraph({
      workflow: { id: 1, graph_json: JSON.stringify(graph) } as never,
      trigger: 'inbound',
      direction: 'inbound',
      runId: 1,
      message,
      dryRun: false,
      initialVariables: { 'ai.class': 'Rechnung' },
    });

    expect(result.status).toBe('ok');
    expect(result.log).not.toContain('skip:cat_r:no_prior_condition');
    expect(assignCategoryPathToMessage).toHaveBeenCalledWith(99, 'Buchhaltung/Rechnungen');
  });

  test('email.auto_reply blocks low confidence and approves high confidence', async () => {
    const def = collect(registerEmailNodes).get('email.auto_reply')!;
    const baseCtx = (): WorkflowContext => ({
      trigger: 'inbound',
      direction: 'inbound',
      messageId: 1,
      message: { id: 1, account_id: 1 } as never,
      outbound: null,
      workflowId: 1,
      runId: 1,
      dryRun: true,
      variables: {},
      strings: { from_address: 'kunde@example.com' } as WorkflowContext['strings'],
      ai: {},
    });

    const blocked = await def.execute(
      baseCtx(),
      { confidenceVar: 'ai.class_confidence', minConfidence: 80 },
      'gate',
    );
    expect(blocked).toMatchObject({ port: 'blocked' });

    const approved = await def.execute(
      {
        ...baseCtx(),
        variables: { 'ai.class_confidence': 90 },
      },
      { confidenceVar: 'ai.class_confidence', minConfidence: 80 },
      'gate',
    );
    expect(approved).toMatchObject({ port: 'approved' });
  });
});
