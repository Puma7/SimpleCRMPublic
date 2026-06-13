import type { RegisteredWorkflowNode, WorkflowContext } from '../../electron/workflow/types';

jest.mock('../../electron/workflow/registry', () => ({
  ensureBuiltinWorkflowNodes: jest.fn(),
  getWorkflowNode: jest.fn(() => undefined),
}));

jest.mock('../../electron/email/email-store', () => ({
  addMessageTag: jest.fn(),
  clearMessageSeenSyncPending: jest.fn(),
  setMessageArchived: jest.fn(),
  setMessageSeenLocal: jest.fn(),
  setMessageSpam: jest.fn(),
  setMessageSpamStatus: jest.fn(),
  setMessageAssignedTo: jest.fn(),
  setOutboundHold: jest.fn(),
  getEmailAccountById: jest.fn(() => null),
}));

jest.mock('../../electron/email/email-crm-store', () => ({
  assignCategoryPathToMessage: jest.fn(),
  tryLinkMessageToCustomer: jest.fn(),
}));

jest.mock('../../electron/sqlite-service', () => ({
  getDb: jest.fn(),
  getSyncInfo: jest.fn(() => null),
  updateDealStage: jest.fn(() => ({ success: true })),
}));

jest.mock('../../electron/email/email-imap-flags', () => ({
  syncSeenFlagToServer: jest.fn().mockResolvedValue(undefined),
}));

import {
  addMessageTag,
  clearMessageSeenSyncPending,
  getEmailAccountById,
  setMessageSeenLocal,
} from '../../electron/email/email-store';
import { syncSeenFlagToServer } from '../../electron/email/email-imap-flags';
import { tryLinkMessageToCustomer } from '../../electron/email/email-crm-store';
import { registerCodeNodes } from '../../electron/workflow/nodes/code-nodes';
import { registerCrmNodes } from '../../electron/workflow/nodes/crm-nodes';
import { registerEmailNodes } from '../../electron/workflow/nodes/email-nodes';
import { registerIntegrationNodes } from '../../electron/workflow/nodes/integration-nodes';
import { registerLogicNodes } from '../../electron/workflow/nodes/logic-nodes';
import { runWorkflowGraph } from '../../electron/workflow/runtime';

function collect(registerNodes: (register: (def: RegisteredWorkflowNode) => void) => void) {
  const defs = new Map<string, RegisteredWorkflowNode>();
  registerNodes((def) => defs.set(def.type, def));
  return defs;
}

function ctx(overrides: Partial<WorkflowContext> = {}): WorkflowContext {
  return {
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
    ...overrides,
  };
}

describe('workflow builtin nodes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('logic.switch routes matching cases and falls back to default', async () => {
    const def = collect(registerLogicNodes).get('logic.switch')!;

    await expect(
      def.execute(
        ctx({ variables: { 'ai.class': 'Support' } }),
        { field: 'ai.class', cases: 'rechnung,support' },
        'sw',
      ),
    ).resolves.toMatchObject({ status: 'ok', port: 'support' });

    await expect(
      def.execute(
        ctx({ strings: { 'ai.class': 'vertrieb' } }),
        { field: 'ai.class', cases: 'rechnung,support' },
        'sw',
      ),
    ).resolves.toMatchObject({ status: 'ok', port: 'default' });
  });

  test('logic.loop exposes maxItems default and runtime logs truncation', async () => {
    const loopDef = collect(registerLogicNodes).get('logic.loop')!;
    expect(loopDef.defaultConfig).toMatchObject({ sourceVariable: 'attachment_names', maxItems: 50 });

    const graph = {
      version: 1 as const,
      nodes: [
        { id: 'trigger', type: 'trigger' as const, data: { kind: 'manual' } },
        {
          id: 'loop',
          type: 'registry' as const,
          data: { nodeType: 'logic.loop', config: { sourceVariable: 'items', maxItems: 2 } },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'loop' },
        { id: 'e2', source: 'loop', target: 'missing-each', label: 'each' },
        { id: 'e3', source: 'loop', target: 'missing-done', label: 'done' },
      ],
    };

    const result = await runWorkflowGraph({
      workflow: { id: 1, graph_json: JSON.stringify(graph) } as never,
      trigger: 'manual',
      direction: 'manual',
      runId: 1,
      dryRun: true,
      eventStrings: { items: 'a,b,c,d' },
    });

    expect(result.log).toContain('loop:limit:2');
    expect(result.log).toContain('loop:0:a');
    expect(result.log).toContain('loop:1:b');
    expect(result.log).not.toContain('loop:2:c');
  });

  test('code nodes handle dry-run, variables and errors', async () => {
    const defs = collect(registerCodeNodes);
    const js = defs.get('code.javascript')!;
    const python = defs.get('code.python')!;

    await expect(js.execute(ctx({ dryRun: true }), { code: 'result = { ok: true }' }, 'js')).resolves.toMatchObject({
      status: 'ok',
      message: 'dry-run js',
    });

    await expect(
      js.execute(
        ctx({ dryRun: false, variables: { count: 2 } }),
        { code: 'result = { count: Number(ctx.variables.count) + 1, nested: { ok: true } };' },
        'js',
      ),
    ).resolves.toMatchObject({
      status: 'ok',
      variables: { count: 3, nested: '{"ok":true}' },
    });

    await expect(js.execute(ctx({ dryRun: false }), { code: 'throw new Error("kaputt")' }, 'js')).resolves.toMatchObject({
      status: 'error',
      message: expect.stringContaining('kaputt'),
    });

    await expect(python.execute(ctx({ dryRun: true }), { code: 'print("ok")' }, 'py')).resolves.toMatchObject({
      status: 'ok',
      message: 'dry-run python',
    });
  });

  test('email and CRM nodes skip side effects in dry-run', async () => {
    const email = collect(registerEmailNodes).get('email.tag')!;
    const crm = collect(registerCrmNodes).get('crm.link_customer')!;
    const message = { id: 42, account_id: 1, has_attachments: false } as never;

    await expect(
      email.execute(ctx({ messageId: 42, message, dryRun: true }), { tag: 'wf' }, 'tag'),
    ).resolves.toMatchObject({ status: 'ok' });
    expect(addMessageTag).not.toHaveBeenCalled();

    await expect(
      crm.execute(ctx({ messageId: 42, message, dryRun: true }), {}, 'crm'),
    ).resolves.toMatchObject({ status: 'ok' });
    expect(tryLinkMessageToCustomer).not.toHaveBeenCalled();
  });

  test('email.mark_seen keeps local seen state pending until IMAP push succeeds', async () => {
    const email = collect(registerEmailNodes).get('email.mark_seen')!;
    const message = { id: 42, account_id: 1, folder_id: 2, uid: 5, pop3_uidl: null } as never;
    jest.mocked(getEmailAccountById).mockReturnValue({
      id: 1,
      protocol: 'imap',
      imap_sync_seen_on_open: 1,
    } as never);

    await expect(
      email.execute(ctx({ messageId: 42, message, dryRun: false }), {}, 'mark-seen'),
    ).resolves.toMatchObject({ status: 'ok' });

    expect(setMessageSeenLocal).toHaveBeenCalledWith(42, true, true);
    expect(syncSeenFlagToServer).toHaveBeenCalledWith(message, true);
    expect(clearMessageSeenSyncPending).toHaveBeenCalledWith(42);
  });

  test('email.mark_seen skips IMAP sync when account disabled seen sync on open', async () => {
    const email = collect(registerEmailNodes).get('email.mark_seen')!;
    const message = { id: 42, account_id: 1, folder_id: 2, uid: 5, pop3_uidl: null } as never;
    jest.mocked(getEmailAccountById).mockReturnValue({
      id: 1,
      protocol: 'imap',
      imap_sync_seen_on_open: 0,
    } as never);

    await expect(
      email.execute(ctx({ messageId: 42, message, dryRun: false }), {}, 'mark-seen-disabled'),
    ).resolves.toMatchObject({ status: 'ok' });

    expect(setMessageSeenLocal).toHaveBeenCalledWith(42, true, false);
    expect(syncSeenFlagToServer).not.toHaveBeenCalled();
    expect(clearMessageSeenSyncPending).not.toHaveBeenCalled();
  });

  test('integration nodes expose dry-run/error paths without external calls', async () => {
    const defs = collect(registerIntegrationNodes);

    await expect(
      defs
        .get('sync.run')!
        .execute(ctx({ message: { id: 1, account_id: 2 } as never, dryRun: true }), {}, 'sync'),
    ).resolves.toMatchObject({ status: 'ok', message: 'dry-run sync' });

    await expect(
      defs.get('mssql.query')!.execute(ctx(), { sql: 'DELETE FROM Kunden' }, 'sql'),
    ).resolves.toMatchObject({
      status: 'error',
      message: expect.stringContaining('Nur SELECT erlaubt'),
    });
  });
});
