import {
  createServerApi,
  type ServerApiPorts,
  type WorkflowRecord,
} from '../../packages/server/src';
import {
  MANUAL_ADMIN_WORKFLOW_EXECUTE_MARKER_FIELD,
  SERVER_JOB_POLICIES,
  SERVER_JOB_TYPES,
  createMaintenanceJobHandlers,
  graphileJobKeyForJob,
  graphileQueueNameForJob,
  graphileSpecFromJob,
  isTrustedServiceJobPayload,
  startMaintenanceJobTicker,
} from '../../packages/server/src/jobs';
import type { EnqueueJobInput } from '../../packages/server/src/jobs/types';
import {
  DEFAULT_WORKFLOW_SCHEDULE_TICK_INTERVAL_MS,
  SERVER_SCHEDULE_SYNC_LOG,
  buildScheduleWorkflowContext,
} from '../../packages/server/src/jobs/workflow-schedule-tick';
import { listServerWorkflowTemplates } from '../../packages/server/src/workflow-templates';
import { isServerWorkflowNodeTypeSupported } from '../../packages/server/src/workflow-node-catalog';
import { DESKTOP_ONLY_WORKFLOW_TRIGGERS, isServerWorkflowTrigger } from '../../packages/core/src/workflow';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

const admin = { userId: USER, workspaceId: WORKSPACE, role: 'admin' as const };
const editor = {
  userId: USER,
  workspaceId: WORKSPACE,
  role: 'user' as const,
  capabilities: ['workflows.view', 'workflows.edit', 'workflows.run'],
};

/** Zeitplan mit Seiteneffekt-Knoten (sync.run) — wie die Vorlage schedule-inbox-sync. */
const SCHEDULE_GRAPH = {
  version: 1,
  nodes: [
    { id: 't1', type: 'trigger', data: { kind: 'schedule' } },
    { id: 'sync1', type: 'registry', data: { nodeType: 'sync.run', config: {} } },
  ],
  edges: [{ id: 'e0', source: 't1', target: 'sync1' }],
};

function scheduleWorkflow(overrides: Partial<WorkflowRecord> = {}): WorkflowRecord {
  return {
    id: 41,
    sourceSqliteId: 41,
    name: 'Morgens',
    triggerName: 'schedule',
    enabled: true,
    priority: 100,
    definition: { version: 1, rules: [] },
    graph: SCHEDULE_GRAPH,
    cronExpr: '0 6 * * 1-5',
    scheduleAccountSourceSqliteId: 5,
    scheduleAccountId: 5,
    accountSourceSqliteId: null,
    accountId: null,
    overrideKey: null,
    executionMode: 'graph',
    engineVersion: 1,
    legacyCreatedByUserId: null,
    createdByUserId: USER,
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z',
    ...overrides,
  };
}

type Harness = {
  api: ReturnType<typeof createServerApi>;
  createCalls: Array<{ values: Record<string, unknown> }>;
  updateCalls: Array<{ values: Record<string, unknown>; expected?: Record<string, unknown> }>;
  enqueued: EnqueueJobInput[];
  dryRuns: Array<Record<string, unknown>>;
  syncInfo: Map<string, string | null>;
  syncWrites: Array<Record<string, string | null>>;
};

function harness(stored: WorkflowRecord = scheduleWorkflow()): Harness {
  const createCalls: Harness['createCalls'] = [];
  const updateCalls: Harness['updateCalls'] = [];
  const enqueued: EnqueueJobInput[] = [];
  const dryRuns: Array<Record<string, unknown>> = [];
  const syncInfo = new Map<string, string | null>();
  const syncWrites: Array<Record<string, string | null>> = [];
  const ports = {
    mailAccess: {
      async assertPermission() { return undefined; },
      async resolveScope() { return { kind: 'all' }; },
    },
    mailResourceLookup: {
      async resolve() { return []; },
    },
    workflows: {
      async list() { return { items: [stored], nextCursor: null }; },
      async get(input: { id: number }) { return input.id === stored.id ? stored : null; },
      async create(input: { values: Record<string, unknown> }) {
        createCalls.push(input);
        return { ok: true as const, workflow: { ...stored, id: 42, ...input.values } as WorkflowRecord };
      },
      async update(input: { values: Record<string, unknown>; expected?: Record<string, unknown> }) {
        updateCalls.push(input);
        return { ok: true as const, workflow: { ...stored, ...input.values } as WorkflowRecord };
      },
    },
    jobQueue: {
      async enqueue(input: EnqueueJobInput) {
        enqueued.push(input);
      },
    },
    workflowExecution: {
      async execute() { return undefined; },
      async dryRun(input: Record<string, unknown>) {
        dryRuns.push(input);
        return { success: true, dryRun: true, status: 'ok', log: [], blocked: false, blockReason: null };
      },
    },
    syncInfo: {
      async getMany(input: { keys: readonly string[] }) {
        return input.keys
          .filter((key) => syncInfo.has(key))
          .map((key) => ({ key, value: syncInfo.get(key) ?? null, updatedAt: '2026-09-26T00:00:00.000Z' }));
      },
      async setMany(input: { values: Record<string, string | null> }) {
        syncWrites.push(input.values);
        for (const [key, value] of Object.entries(input.values)) syncInfo.set(key, value);
        return [];
      },
    },
  } as unknown as ServerApiPorts;
  return { api: createServerApi(ports), createCalls, updateCalls, enqueued, dryRuns, syncInfo, syncWrites };
}

const baseCreateBody = {
  name: 'Taeglich',
  triggerName: 'schedule',
  definition: { version: 1, rules: [] },
  graph: SCHEDULE_GRAPH,
};

describe('schedule trigger on the server (TA-P4)', () => {
  test('schedule is a server trigger now; the other desktop triggers stay desktop-only', () => {
    expect(isServerWorkflowTrigger('schedule')).toBe(true);
    expect(DESKTOP_ONLY_WORKFLOW_TRIGGERS.has('schedule')).toBe(false);
    for (const trigger of ['draft_created', 'crm.deal_stage_changed', 'task.due', 'calendar.event_start', 'crm.customer_created']) {
      expect(isServerWorkflowTrigger(trigger)).toBe(false);
    }
  });

  test('the schedule template is offered and runs on the server', () => {
    const scheduleTemplates = listServerWorkflowTemplates().filter((template) => template.trigger === 'schedule');
    expect(scheduleTemplates.map((template) => template.id)).toEqual(['schedule-inbox-sync']);
    for (const template of scheduleTemplates) {
      for (const node of template.graph.nodes) {
        const nodeType = node.data.nodeType;
        if (typeof nodeType === 'string') expect(isServerWorkflowNodeTypeSupported(nodeType)).toBe(true);
      }
      // sync.run liest email.account_id — der Taktgeber setzt es aus dem geplanten Konto.
      expect(template.graph.nodes.some((node) => node.data.nodeType === 'sync.run')).toBe(true);
    }
    const context = buildScheduleWorkflowContext({
      firedAt: new Date('2026-09-28T04:00:10.000Z'),
      slot: new Date('2026-09-28T04:00:00.000Z'),
      scheduleAccountId: 5,
    });
    expect(context.eventVariables).toEqual({
      'schedule.fired_at': '2026-09-28T04:00:10.000Z',
      'schedule.slot': '2026-09-28T04:00:00.000Z',
      'schedule.sync_log': SERVER_SCHEDULE_SYNC_LOG,
      'email.account_id': 5,
    });
    expect(SERVER_SCHEDULE_SYNC_LOG).toBe('server: Postfächer werden automatisch abgerufen');
    expect(buildScheduleWorkflowContext({
      firedAt: new Date(0),
      slot: new Date(0),
      scheduleAccountId: null,
      includeStrings: false,
    })).toEqual({
      eventVariables: {
        'schedule.fired_at': '1970-01-01T00:00:00.000Z',
        'schedule.slot': '1970-01-01T00:00:00.000Z',
        'schedule.sync_log': SERVER_SCHEDULE_SYNC_LOG,
      },
    });
  });
});

describe('saving schedule workflows', () => {
  test('creates an active schedule workflow with a valid expression', async () => {
    const h = harness();
    const response = await h.api.handle({
      method: 'POST',
      path: '/api/v1/workflows',
      body: { ...baseCreateBody, cronExpr: ' 0 6 * * MON-FRI ', scheduleAccountId: 5 },
      principal: admin,
    });
    expect(response.status).toBe(201);
    expect(h.createCalls[0]?.values).toMatchObject({ triggerName: 'schedule', cronExpr: '0 6 * * MON-FRI' });
  });

  test.each([
    [undefined, /brauchen einen Cron-Ausdruck/],
    [null, /brauchen einen Cron-Ausdruck/],
    ['0 0 6 * * *', /Sekunden-Feld/],
    ['*/5 * * * *', /Intervall zu kurz/],
    ['* * * * *', /Minütliche Ausführung/],
    ['0 6 31 2 *', /trifft nie zu/],
    ['0 6 * * FOO', /Ungültiger Wert/],
  ])('rejects an active schedule with cron %p', async (cronExpr, message) => {
    const h = harness();
    const response = await h.api.handle({
      method: 'POST',
      path: '/api/v1/workflows',
      body: { ...baseCreateBody, ...(cronExpr === undefined ? {} : { cronExpr }) },
      principal: admin,
    });
    expect(response.status).toBe(400);
    expect((response.body as any).error.code).toBe('invalid_schedule');
    expect((response.body as any).error.message).toMatch(message);
    expect(h.createCalls).toEqual([]);
  });

  test('a disabled schedule may be stored with a desktop expression and is checked on activation', async () => {
    const h = harness(scheduleWorkflow({ enabled: false, cronExpr: '0 0 6 * * *' }));
    const created = await h.api.handle({
      method: 'POST',
      path: '/api/v1/workflows',
      body: { ...baseCreateBody, enabled: false, cronExpr: '0 0 6 * * *' },
      principal: admin,
    });
    expect(created.status).toBe(201);

    const activated = await h.api.handle({
      method: 'PATCH',
      path: '/api/v1/workflows/41',
      body: { enabled: true },
      principal: admin,
    });
    expect(activated.status).toBe(400);
    expect((activated.body as any).error.message).toMatch(/Sekunden-Feld/);
    expect(h.updateCalls).toEqual([]);
  });

  test('activating a stored valid schedule pins the checked expression for the write', async () => {
    const h = harness(scheduleWorkflow({ enabled: false }));
    const response = await h.api.handle({
      method: 'PATCH',
      path: '/api/v1/workflows/41',
      body: { enabled: true },
      principal: admin,
    });
    expect(response.status).toBe(200);
    expect(h.updateCalls[0]?.expected).toMatchObject({ cronExpr: '0 6 * * 1-5' });
  });

  test('switching the trigger to schedule and changing the expression are validated', async () => {
    const inbound = scheduleWorkflow({ triggerName: 'inbound', cronExpr: null, graph: null });
    const h = harness(inbound);
    const switched = await h.api.handle({
      method: 'PATCH',
      path: '/api/v1/workflows/41',
      body: { triggerName: 'schedule' },
      principal: admin,
    });
    expect(switched.status).toBe(400);
    expect((switched.body as any).error.code).toBe('invalid_schedule');

    const withCron = await h.api.handle({
      method: 'PATCH',
      path: '/api/v1/workflows/41',
      body: { triggerName: 'schedule', cronExpr: '30 7 * * *' },
      principal: admin,
    });
    expect(withCron.status).toBe(200);
    // Der Ausdruck kommt aus dem Patch selbst — kein Pin auf den alten Wert.
    expect(h.updateCalls[0]?.expected ?? {}).not.toHaveProperty('cronExpr');

    const tooOften = await harness().api.handle({
      method: 'PATCH',
      path: '/api/v1/workflows/41',
      body: { cronExpr: '*/5 * * * *' },
      principal: admin,
    });
    expect(tooOften.status).toBe(400);
  });

  test('changing the schedule of an active side-effect workflow keeps the manage gate', async () => {
    const h = harness();
    const response = await h.api.handle({
      method: 'PATCH',
      path: '/api/v1/workflows/41',
      body: { cronExpr: '0 7 * * *' },
      principal: editor,
    });
    expect(response.status).toBe(403);
    const account = await h.api.handle({
      method: 'PATCH',
      path: '/api/v1/workflows/41',
      body: { scheduleAccountId: 6 },
      principal: editor,
    });
    expect(account.status).toBe(403);
    expect(h.updateCalls).toEqual([]);
  });

  test('a rename of a schedule workflow needs no expression check', async () => {
    const h = harness(scheduleWorkflow({ cronExpr: '0 0 6 * * *' }));
    const response = await h.api.handle({
      method: 'PATCH',
      path: '/api/v1/workflows/41',
      body: { name: 'Neu' },
      principal: admin,
    });
    expect(response.status).toBe(200);
  });
});

describe('„Jetzt ausführen" for schedule workflows', () => {
  test('a live run is queued as schedule with the schedule variables', async () => {
    const h = harness();
    const response = await h.api.handle({
      method: 'POST',
      path: '/api/v1/workflows/41/execute',
      body: { dryRun: false },
      principal: admin,
    });
    expect(response.status).toBe(202);
    expect(h.enqueued).toHaveLength(1);
    const payload = h.enqueued[0]!.payload as Record<string, any>;
    expect(payload.triggerName).toBe('schedule');
    expect(payload.actorUserId).toBe(USER);
    // Rechte unveraendert: derselbe Admin-Nachweis wie jeder manuelle Live-Lauf.
    expect(payload[MANUAL_ADMIN_WORKFLOW_EXECUTE_MARKER_FIELD]).toBe(true);
    // Kein Taktgeber-Slot — der manuelle Lauf teilt sich keinen Job-Key mit ihm.
    expect(payload).not.toHaveProperty('scheduleSlot');
    expect(payload.context.eventVariables).toMatchObject({
      'schedule.sync_log': SERVER_SCHEDULE_SYNC_LOG,
      'email.account_id': 5,
    });
    expect(payload.context.eventVariables['schedule.slot']).toBe(payload.context.eventVariables['schedule.fired_at']);
    expect(Number.isNaN(Date.parse(payload.context.eventVariables['schedule.slot']))).toBe(false);
  });

  test('a dry run uses the schedule trigger too', async () => {
    const h = harness(scheduleWorkflow({ scheduleAccountId: null }));
    const response = await h.api.handle({
      method: 'POST',
      path: '/api/v1/workflows/41/execute',
      body: { dryRun: true },
      principal: admin,
    });
    expect(response.status).toBe(200);
    expect(h.dryRuns[0]).toMatchObject({ triggerName: 'schedule' });
    expect((h.dryRuns[0]!.context as any).eventVariables).not.toHaveProperty('email.account_id');
  });

  test('other workflows keep running as manual', async () => {
    const h = harness(scheduleWorkflow({ triggerName: 'manual', graph: null }));
    const response = await h.api.handle({
      method: 'POST',
      path: '/api/v1/workflows/41/execute',
      body: { dryRun: false },
      principal: admin,
    });
    expect(response.status).toBe(202);
    expect(h.enqueued[0]!.payload).toMatchObject({ triggerName: 'manual', context: {} });
  });

  test('without workflows.run nothing is queued', async () => {
    const h = harness();
    const response = await h.api.handle({
      method: 'POST',
      path: '/api/v1/workflows/41/execute',
      body: { dryRun: false },
      principal: { userId: USER, workspaceId: WORKSPACE, role: 'user' as const, capabilities: ['workflows.view'] },
    });
    expect(response.status).toBe(403);
    expect(h.enqueued).toEqual([]);
  });
});

describe('workspace time zone setting', () => {
  test('GET returns the default until a zone is stored, invalid stored values fall back', async () => {
    const h = harness();
    const read = async () => h.api.handle({
      method: 'GET',
      path: '/api/v1/workflow/settings/automation',
      principal: editor,
    });
    expect(((await read()).body as any).data.scheduleTimezone).toBe('Europe/Berlin');
    h.syncInfo.set('workflow_schedule_timezone', 'America/New_York');
    expect(((await read()).body as any).data.scheduleTimezone).toBe('America/New_York');
    h.syncInfo.set('workflow_schedule_timezone', 'Mars/Olympus');
    expect(((await read()).body as any).data.scheduleTimezone).toBe('Europe/Berlin');
  });

  test('PATCH stores the canonical IANA name and rejects anything else', async () => {
    const h = harness();
    const saved = await h.api.handle({
      method: 'PATCH',
      path: '/api/v1/workflow/settings/automation',
      body: { scheduleTimezone: ' europe/vienna ' },
      principal: admin,
    });
    expect(saved.status).toBe(200);
    expect(h.syncWrites).toEqual([{ workflow_schedule_timezone: 'Europe/Vienna' }]);

    for (const scheduleTimezone of ['Mars/Olympus', '+01:00', '', 7]) {
      const rejected = await h.api.handle({
        method: 'PATCH',
        path: '/api/v1/workflow/settings/automation',
        body: { scheduleTimezone },
        principal: admin,
      });
      expect(rejected.status).toBe(400);
    }
    expect(h.syncWrites).toHaveLength(1);
  });

  test('PATCH stays admin-only like the neighbouring workflow settings', async () => {
    const h = harness();
    const denied = await h.api.handle({
      method: 'PATCH',
      path: '/api/v1/workflow/settings/automation',
      body: { scheduleTimezone: 'Europe/Berlin' },
      principal: { ...editor, capabilities: [...editor.capabilities, 'workflows.manage', 'settings.manage'] },
    });
    expect(denied.status).toBe(403);
    expect(h.syncWrites).toEqual([]);
  });
});

describe('workflow.schedule.tick job', () => {
  test('is a classified service job with a per-workspace key outside the workflow queue', () => {
    expect(SERVER_JOB_TYPES).toContain('workflow.schedule.tick');
    expect(SERVER_JOB_POLICIES.find((policy) => policy.type === 'workflow.schedule.tick')).toEqual({
      type: 'workflow.schedule.tick',
      kind: 'non_mail',
      actorMode: 'service',
      classification: 'system_maintenance',
    });
    expect(graphileJobKeyForJob('workflow.schedule.tick', { workspaceId: WORKSPACE }))
      .toBe(`workflow.schedule.tick:${WORKSPACE}`);
    expect(graphileSpecFromJob({
      type: 'workflow.schedule.tick',
      workspaceId: WORKSPACE,
      payload: { workspaceId: WORKSPACE },
    })).toMatchObject({ jobKeyMode: 'replace', jobKey: `workflow.schedule.tick:${WORKSPACE}` });
    // Nicht in der seriellen Workflow-Queue: der Takt soll nicht hinter
    // langen Workflow-Laeufen warten.
    expect(graphileQueueNameForJob('workflow.schedule.tick', { workspaceId: WORKSPACE }, WORKSPACE)).toBeUndefined();
  });

  test('a scheduled run is keyed by workflow and slot', () => {
    const slot = '2026-09-28T04:00:00.000Z';
    expect(graphileJobKeyForJob('workflow.execute', {
      workspaceId: WORKSPACE,
      workflowId: 41,
      triggerName: 'schedule',
      scheduleSlot: slot,
      context: {},
    }, WORKSPACE)).toBe(`workflow.execute:${WORKSPACE}:41:schedule:${slot}`);
    // Ohne Slot (Jetzt ausfuehren) bleibt es beim bisherigen Verhalten: kein Key.
    expect(graphileJobKeyForJob('workflow.execute', {
      workspaceId: WORKSPACE,
      workflowId: 41,
      triggerName: 'schedule',
      context: {},
    }, WORKSPACE)).toBeUndefined();
    // Fortsetzungen eines Zeitplan-Laufs behalten ihren Lauf-Key.
    expect(graphileJobKeyForJob('workflow.execute', {
      workspaceId: WORKSPACE,
      workflowId: 41,
      runId: 9,
      triggerName: 'schedule',
      scheduleSlot: slot,
    }, WORKSPACE)).toBe(`workflow.execute:${WORKSPACE}:run:9`);
    expect(graphileQueueNameForJob('workflow.execute', { workspaceId: WORKSPACE }, WORKSPACE))
      .toBe(`workflow-${WORKSPACE}`);
  });

  test('the maintenance ticker takes the schedule tick every minute as trusted service', async () => {
    const realSetTimeout = globalThis.setTimeout;
    const pending: Array<{ fn: () => void; delayMs: number }> = [];
    (globalThis as { setTimeout: unknown }).setTimeout = ((fn: () => void, delayMs: number) => {
      pending.push({ fn, delayMs });
      return { unref() { /* no-op */ } };
    }) as unknown as typeof globalThis.setTimeout;
    try {
      const enqueued: EnqueueJobInput[] = [];
      const builder = {
        selectFrom() { return this; },
        select() { return this; },
        orderBy() { return this; },
        async execute() { return [{ id: WORKSPACE }]; },
      };
      const ticker = startMaintenanceJobTicker({
        db: { transaction: () => ({ execute: (callback: (trx: unknown) => unknown) => callback(builder) }) } as never,
        queue: { async enqueue(input) { enqueued.push(input); } },
        jobType: 'workflow.schedule.tick',
        applyWorkspaceSession: async () => undefined,
      });
      pending.shift()!.fn();
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
      expect(enqueued.map((job) => [job.type, job.workspaceId])).toEqual([['workflow.schedule.tick', WORKSPACE]]);
      expect(isTrustedServiceJobPayload(enqueued[0]!.payload)).toBe(true);
      expect(pending[0]?.delayMs).toBe(DEFAULT_WORKFLOW_SCHEDULE_TICK_INTERVAL_MS);
      expect(DEFAULT_WORKFLOW_SCHEDULE_TICK_INTERVAL_MS).toBe(60_000);
      ticker.stop();
    } finally {
      (globalThis as { setTimeout: unknown }).setTimeout = realSetTimeout;
    }
  });

  test('the handler is registered and refuses to run without a queue', async () => {
    const handlers = createMaintenanceJobHandlers({ db: {} as never });
    expect(typeof handlers['workflow.schedule.tick']).toBe('function');
    await expect(handlers['workflow.schedule.tick']!({
      id: 'job-1',
      type: 'workflow.schedule.tick',
      workspaceId: WORKSPACE,
      payload: { workspaceId: WORKSPACE },
      attempts: 1,
      maxAttempts: 5,
    } as never)).rejects.toThrow('requires a job queue');
  });
});
