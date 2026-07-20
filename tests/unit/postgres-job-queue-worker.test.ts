import {
  createProductionJobHandlers,
  runJobQueueOnce,
  startPostgresJobQueueWorker,
  type JobHandlerRegistry,
  type JobQueuePort,
  type QueuedJob,
} from '../../packages/server/src/jobs';
import { createPostgresJobQueuePort } from '../../packages/server/src/db/postgres-job-queue-port';

describe('startPostgresJobQueueWorker', () => {
  test('processes legacy job_queue rows with registered handlers', async () => {
    const jobs: QueuedJob[] = [{
      id: 1,
      type: 'workflow.forward_copy',
      payload: {
        workspaceId: 'ws-1',
        actorUserId: 'user-a',
        workflowId: 2,
        messageId: 3,
        to: 'audit@example.com',
      },
      runAfter: new Date(0).toISOString(),
      attempts: 0,
      maxAttempts: 5,
      lockedAt: null,
      lockedBy: null,
      lastError: null,
      workspaceId: 'ws-1',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }];
    const calls: string[] = [];
    const queue: JobQueuePort = {
      async enqueue() {
        throw new Error('not used');
      },
      async claimNext({ workerId }) {
        const next = jobs.shift();
        if (!next) return null;
        return {
          ...next,
          lockedAt: new Date().toISOString(),
          lockedBy: workerId,
        };
      },
      async complete(job) {
        calls.push(`complete:${job.type}:${job.id}`);
        return true;
      },
      async fail() {
        return null;
      },
      async failTerminal() {
        return null;
      },
      async releaseStaleLocks() {
        return [];
      },
    };
    const handlers: JobHandlerRegistry = createProductionJobHandlers({
      workflowForwardCopy: {
        async forwardCopy(input) {
          calls.push(`forward:${input.messageId}:${input.to}`);
        },
      },
    });

    const worker = startPostgresJobQueueWorker({
      queue,
      handlers,
      pollIntervalMs: 5,
      mailAccess: {
        async assertPermission() {
          return undefined;
        },
        async resolveScope() {
          return { kind: 'all' };
        },
      },
      mailResourceLookup: {
        async resolve() {
          return [{ type: 'message', accountId: '7', folderId: '8', messageId: '3' }];
        },
      },
      auth: {
        async listUsers() {
          // workflow.forward_copy is a workflow side-effect child; only an
          // owner/admin can legitimately have queued it (a non-admin initiator
          // is denied at workflow.execute), so the happy-path actor is owner.
          return [{ id: 'user-a', role: 'owner', disabledAt: null }];
        },
      },
    });

    await waitFor(() => calls.includes('complete:workflow.forward_copy:1'));
    await worker.stop();

    expect(calls).toEqual([
      'forward:3:audit@example.com',
      'complete:workflow.forward_copy:1',
    ]);
  });

  test('terminal authorization failures are persisted so a second legacy claim returns null', async () => {
    const now = new Date('2026-07-19T10:00:00.000Z');
    const db = makeFakePostgresJobQueueDb();
    db.rows.push({
      id: 7,
      type: 'ai.reply_suggestion',
      payload: { workspaceId: '11111111-1111-4111-8111-111111111111', actorUserId: 'user-a', messageId: 42 },
      run_after: now,
      attempts: 0,
      max_attempts: 5,
      locked_at: null,
      locked_by: null,
      last_error: null,
      workspace_id: '11111111-1111-4111-8111-111111111111',
      created_at: now,
      updated_at: now,
    });
    const queue = createPostgresJobQueuePort({
      db: db.db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
    });

    const first = await queue.claimNext({ workerId: 'worker-a', now });
    expect(first).not.toBeNull();
    await queue.failTerminal({
      job: first!,
      error: new Error('mail job authorization denied'),
      now,
    });

    expect(await queue.claimNext({ workerId: 'worker-b', now })).toBeNull();
    expect(db.rows[0]).toMatchObject({
      attempts: 5,
      max_attempts: 5,
      locked_at: null,
      locked_by: null,
      last_error: 'mail job authorization denied',
    });
  });
});

describe('mail job ACL revalidation', () => {
  test('legacy worker rejects a revoked initiating-user mail job before handler and terminally fails it', async () => {
    const now = new Date('2026-07-19T10:00:00.000Z');
    const calls: string[] = [];
    const job = makeQueuedJob({
      id: 42,
      type: 'ai.reply_suggestion',
      workspaceId: 'workspace-a',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', messageId: 12 },
    });
    const queue: JobQueuePort = {
      async enqueue() {
        throw new Error('not used');
      },
      async claimNext({ workerId }) {
        return { ...job, lockedBy: workerId, lockedAt: now.toISOString() };
      },
      async complete() {
        calls.push('complete');
        return true;
      },
      async fail() {
        calls.push('retryable-fail');
        return null;
      },
      async failTerminal(input) {
        calls.push(`terminal:${input.error instanceof Error ? input.error.message : String(input.error)}`);
        return { ...input.job, attempts: input.job.maxAttempts, lockedAt: null, lockedBy: null };
      },
      async releaseStaleLocks() {
        return [];
      },
    };

    const result = await runJobQueueOnce({
      queue,
      workerId: 'worker-a',
      now,
      handlers: {
        'ai.reply_suggestion': async () => {
          calls.push('handler');
        },
      },
      mailAccess: {
        async assertPermission() {
          throw new Error('mail_access_denied');
        },
        async resolveScope() {
          return { kind: 'none' };
        },
      },
      mailResourceLookup: {
        async resolve() {
          return [{ type: 'message', accountId: '7', folderId: '8', messageId: '12' }];
        },
      },
    });

    expect(result.status).toBe('failed');
    expect(calls).toEqual(['terminal:mail_access_denied']);
  });

  test('legacy worker resolves a delayed workflow effective message before invoking the executor', async () => {
    const calls: string[] = [];
    const queued = makeQueuedJob({
      id: 43,
      type: 'workflow.execute',
      workspaceId: 'workspace-a',
      payload: {
        workspaceId: 'workspace-a',
        actorUserId: 'user-a',
        workflowId: 7,
        delayedJobId: 88,
      },
    });
    let claimed = false;
    const queue: JobQueuePort = {
      async enqueue() { throw new Error('not used'); },
      async claimNext() {
        if (claimed) return null;
        claimed = true;
        return queued;
      },
      async complete() {
        calls.push('complete');
        return true;
      },
      async fail() {
        calls.push('retryable-fail');
        return null;
      },
      async failTerminal() {
        calls.push('terminal');
        return { ...queued, attempts: queued.maxAttempts };
      },
      async releaseStaleLocks() { return []; },
    };

    const result = await runJobQueueOnce({
      queue,
      workerId: 'worker-a',
      handlers: {
        'workflow.execute': async () => { calls.push('executor'); },
      },
      mailAccess: {
        async assertPermission(input) {
          if (input.resource.type === 'message' && input.resource.messageId === '101') {
            throw new Error('mail_access_denied');
          }
        },
        async resolveScope() { return { kind: 'none' }; },
      },
      mailResourceLookup: {
        async resolve() { return []; },
        async classifyWorkflowDelayedJob() {
          return {
            kind: 'message',
            resource: { type: 'message', accountId: '7', folderId: '8', messageId: '101' },
          };
        },
      },
      auth: {
        async listUsers() {
          return [{ id: 'user-a', role: 'user', disabledAt: null }];
        },
      },
    });

    expect(result.status).toBe('failed');
    expect(calls).toEqual(['terminal']);
  });

  test('legacy worker carries the authorized delayed message linkage to the executor', async () => {
    const queued = makeQueuedJob({
      id: 44,
      type: 'workflow.execute',
      workspaceId: 'workspace-a',
      payload: {
        workspaceId: 'workspace-a',
        actorUserId: 'user-a',
        workflowId: 7,
        delayedJobId: 88,
      },
    });
    let claimed = false;
    let handledJob: QueuedJob | null = null;
    const queue: JobQueuePort = {
      async enqueue() { throw new Error('not used'); },
      async claimNext() {
        if (claimed) return null;
        claimed = true;
        return queued;
      },
      async complete() { return true; },
      async fail() { return null; },
      async failTerminal() { return null; },
      async releaseStaleLocks() { return []; },
    };

    const result = await runJobQueueOnce({
      queue,
      workerId: 'worker-a',
      handlers: {
        'workflow.execute': async (job) => { handledJob = job; },
      },
      mailAccess: {
        async assertPermission() {},
        async resolveScope() { return { kind: 'none' }; },
      },
      mailResourceLookup: {
        async resolve() { return []; },
        async classifyWorkflowDelayedJob() {
          return {
            kind: 'message',
            resource: { type: 'message', accountId: '7', folderId: '8', messageId: '14' },
          };
        },
      },
      auth: {
        async listUsers() {
          return [{ id: 'user-a', role: 'user', disabledAt: null }];
        },
      },
    });

    expect(result.status).toBe('completed');
    expect(handledJob).toMatchObject({
      mailAuthorization: {
        kind: 'workflow_execute_delayed_message',
        delayedJobId: 88,
        messageId: 14,
      },
    });
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('timed out waiting for worker');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function makeQueuedJob(input: {
  id: number;
  type: string;
  payload: Record<string, unknown>;
  workspaceId: string;
}): QueuedJob {
  return {
    id: input.id,
    type: input.type,
    payload: input.payload,
    runAfter: '2026-07-19T10:00:00.000Z',
    attempts: 0,
    maxAttempts: 5,
    lockedAt: null,
    lockedBy: null,
    lastError: null,
    workspaceId: input.workspaceId,
    createdAt: '2026-07-19T10:00:00.000Z',
    updatedAt: '2026-07-19T10:00:00.000Z',
  };
}

type FakePostgresJobQueueRow = {
  id: number;
  type: string;
  payload: Record<string, unknown>;
  run_after: Date;
  attempts: number;
  max_attempts: number;
  locked_at: Date | null;
  locked_by: string | null;
  last_error: string | null;
  workspace_id: string;
  created_at: Date;
  updated_at: Date;
};

function makeFakePostgresJobQueueDb() {
  const rows: FakePostgresJobQueueRow[] = [];
  const db = {
    selectFrom(table: string) {
      if (table !== 'job_queue') throw new Error(`unexpected select ${table}`);
      return new FakeJobSelect(rows);
    },
    updateTable(table: string) {
      if (table !== 'job_queue') throw new Error(`unexpected update ${table}`);
      return new FakeJobUpdate(rows);
    },
    transaction() {
      return {
        execute: async <T>(operation: (trx: unknown) => Promise<T>) => operation(db),
      };
    },
  };
  return { db: db as any, rows };
}

class FakeJobSelect {
  private requireUnlocked = false;
  private requireAttemptsRemaining = false;
  private readyAt: Date | null = null;

  constructor(private readonly rows: FakePostgresJobQueueRow[]) {}

  selectAll(): this { return this; }
  select(): this { return this; }
  orderBy(): this { return this; }
  limit(): this { return this; }

  where(column: string, operator: string, value: unknown): this {
    if (column === 'locked_at' && operator === 'is') this.requireUnlocked = true;
    if (column === 'run_after' && operator === '<=') this.readyAt = value as Date;
    return this;
  }

  whereRef(left: string, operator: string, right: string): this {
    if (left === 'attempts' && operator === '<' && right === 'max_attempts') {
      this.requireAttemptsRemaining = true;
    }
    return this;
  }

  async executeTakeFirst(): Promise<FakePostgresJobQueueRow | undefined> {
    return this.rows.find((row) => (
      (!this.requireUnlocked || row.locked_at === null)
      && (!this.requireAttemptsRemaining || row.attempts < row.max_attempts)
      && (!this.readyAt || row.run_after <= this.readyAt)
    ));
  }
}

class FakeJobUpdate {
  private values: Partial<FakePostgresJobQueueRow> = {};
  private id: number | null = null;
  private lockedBy: string | null = null;
  private requireUnlocked = false;

  constructor(private readonly rows: FakePostgresJobQueueRow[]) {}

  set(values: Partial<FakePostgresJobQueueRow>): this {
    this.values = values;
    return this;
  }

  where(column: string, operator: string, value: unknown): this {
    if (column === 'id' && operator === '=') this.id = Number(value);
    if (column === 'locked_by' && operator === '=') this.lockedBy = String(value);
    if (column === 'locked_at' && operator === 'is') this.requireUnlocked = true;
    return this;
  }

  returningAll(): this { return this; }

  async executeTakeFirst(): Promise<FakePostgresJobQueueRow | undefined> {
    const row = this.rows.find((candidate) => (
      (this.id === null || candidate.id === this.id)
      && (this.lockedBy === null || candidate.locked_by === this.lockedBy)
      && (!this.requireUnlocked || candidate.locked_at === null)
    ));
    if (!row) return undefined;
    Object.assign(row, this.values);
    return row;
  }
}
