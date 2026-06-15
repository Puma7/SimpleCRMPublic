import {
  assertServerJobType,
  calculateMailSyncPoolSize,
  normalizeAiJobConcurrency,
  normalizeMaxAttempts,
  SERVER_JOB_TYPES,
  type ServerJobType,
} from './policy';
import type { EnqueueJobInput, JobPayload } from './types';
import { scheduledSendDraftIdFromPayload, scheduledSendJobKey } from './scheduled-send-job-key';
import type { JobHandlerRegistry } from './worker';

export type GraphileTaskSpec = Readonly<{
  queueName?: string;
  runAt?: Date;
  maxAttempts?: number;
  jobKey?: string;
  jobKeyMode?: 'replace' | 'preserve_run_at' | 'unsafe_dedupe';
  priority?: number;
  flags?: string[];
}>;

export type GraphileWorkerUtilsPort = Readonly<{
  addJob(identifier: string, payload: JobPayload, spec?: GraphileTaskSpec): Promise<unknown>;
  release(): Promise<void> | void;
  migrate?(): Promise<void>;
}>;

export type GraphileWorkerRuntime = Readonly<{
  stop(): Promise<void>;
  promise: Promise<void>;
}>;

export type GraphileWorkerFactory = (options: {
  connectionString: string;
  concurrentJobs: number;
  taskList: Record<string, (payload: unknown) => Promise<void>>;
}) => Promise<GraphileWorkerRuntime>;

export type GraphileWorkerUtilsFactory = (options: {
  connectionString: string;
}) => Promise<GraphileWorkerUtilsPort>;

export type GraphileQueuePort = Readonly<{
  enqueue(input: EnqueueJobInput): Promise<void>;
  clearScheduledSendJob?(input: {
    workspaceId: string;
    draftId: number;
  }): Promise<void>;
  release(): Promise<void>;
  migrate(): Promise<void>;
}>;

export type GraphileWorkerPlan = Readonly<{
  connectionString: string;
  concurrentJobs: number;
  taskTypes: readonly ServerJobType[];
}>;

export type GraphileWorkerConcurrencyInput = Readonly<{
  mailAccountCount: number;
  aiConcurrency?: number;
}>;

export async function createGraphileQueuePort(input: {
  connectionString: string;
  createUtils?: GraphileWorkerUtilsFactory;
  migrateOnStart?: boolean;
}): Promise<GraphileQueuePort> {
  if (!input.connectionString.trim()) {
    throw new Error('connectionString is required for Graphile Worker queue');
  }
  const utils = await (input.createUtils ?? createDefaultGraphileWorkerUtils)({
    connectionString: input.connectionString,
  });
  if (input.migrateOnStart) {
    await utils.migrate?.();
  }

  return {
    async enqueue(job) {
      const type = assertServerJobType(job.type);
      await utils.addJob(type, job.payload, graphileSpecFromJob(job));
    },
    async clearScheduledSendJob(input) {
      const jobKey = scheduledSendJobKey(input.workspaceId, input.draftId);
      if (!jobKey) return;
      const withPgClient = (utils as { withPgClient?: (callback: (client: {
        query: (sql: string, values?: readonly unknown[]) => Promise<unknown>;
      }) => Promise<void>) => Promise<void> }).withPgClient;
      if (!withPgClient) return;
      await withPgClient(async (client) => {
        await client.query('select graphile_worker.remove_job($1)', [jobKey]);
      });
    },
    async migrate() {
      await utils.migrate?.();
    },
    async release() {
      await utils.release();
    },
  };
}

export async function startGraphileWorkerRuntime(input: {
  connectionString: string;
  handlers: JobHandlerRegistry;
  concurrency: GraphileWorkerConcurrencyInput;
  createWorker?: GraphileWorkerFactory;
}): Promise<GraphileWorkerRuntime> {
  const plan = buildGraphileWorkerPlan({
    connectionString: input.connectionString,
    concurrency: input.concurrency,
  });
  const taskList = buildGraphileTaskList(input.handlers);
  return (input.createWorker ?? createDefaultGraphileWorkerRuntime)({
    connectionString: plan.connectionString,
    concurrentJobs: plan.concurrentJobs,
    taskList,
  });
}

export function buildGraphileWorkerPlan(input: {
  connectionString: string;
  concurrency: GraphileWorkerConcurrencyInput;
}): GraphileWorkerPlan {
  if (!input.connectionString.trim()) {
    throw new Error('connectionString is required for Graphile Worker runtime');
  }
  const mailConcurrency = calculateMailSyncPoolSize(input.concurrency.mailAccountCount);
  const aiConcurrency = normalizeAiJobConcurrency(input.concurrency.aiConcurrency);

  return {
    connectionString: input.connectionString,
    concurrentJobs: Math.max(1, mailConcurrency + aiConcurrency),
    taskTypes: SERVER_JOB_TYPES,
  };
}

export function buildGraphileTaskList(
  handlers: JobHandlerRegistry,
): Record<string, (payload: unknown) => Promise<void>> {
  return Object.fromEntries(SERVER_JOB_TYPES.map((type) => [
    type,
    async (payload: unknown) => {
      const handler = handlers[type];
      if (!handler) {
        throw new Error(`No handler registered for job type ${type}`);
      }
      await handler({
        id: 0,
        type,
        payload: normalizePayload(payload),
        runAfter: new Date(0).toISOString(),
        attempts: 0,
        maxAttempts: 1,
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        workspaceId: workspaceIdFromPayload(payload),
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      });
    },
  ]));
}

export function graphileSpecFromJob(input: EnqueueJobInput): GraphileTaskSpec {
  const type = assertServerJobType(input.type);
  return {
    queueName: graphileQueueNameForJob(type, input.payload),
    runAt: input.runAfter,
    maxAttempts: normalizeMaxAttempts(input.maxAttempts),
    jobKey: graphileJobKeyForJob(type, input.payload, input.workspaceId),
    jobKeyMode: 'replace',
  };
}

export function graphileQueueNameForJob(type: ServerJobType, payload: JobPayload): string | undefined {
  const accountId = graphileKeyScalar(payload.accountId);
  if ((type === 'mail.sync.imap' || type === 'mail.sync.pop3') && accountId) {
    return `account-${accountId}`;
  }
  if (
    type === 'ai.reply_suggestion'
    || type === 'ai.agent'
    || type === 'ai.classify'
    || type === 'ai.review'
    || type === 'ai.transform_text'
  ) {
    return 'ai';
  }
  if (type === 'mail.spam.score') {
    return 'spam';
  }
  if (type === 'mail.vacation.auto_reply') {
    return 'mail';
  }
  if (type === 'webhook.fire') {
    return 'webhook';
  }
  if (type === 'workflow.execute' || type === 'workflow.http_request' || type === 'workflow.forward_copy') {
    return 'workflow';
  }
  return undefined;
}

export function graphileJobKeyForJob(
  type: ServerJobType,
  payload: JobPayload,
  workspaceId?: string,
): string | undefined {
  const accountId = graphileKeyScalar(payload.accountId);
  const workspaceKey = graphileKeyScalar(workspaceId) ?? graphileKeyScalar(payload.workspaceId);
  if ((type === 'mail.sync.imap' || type === 'mail.sync.pop3') && accountId && workspaceKey) {
    return `${type}:${workspaceKey}:${accountId}`;
  }
  if (type === 'mail.spam.score') {
    const messageId = graphileKeyScalar(payload.messageId);
    if (workspaceKey && messageId) return `${type}:${workspaceKey}:${messageId}`;
  }
  if (type === 'mail.vacation.auto_reply') {
    const messageId = graphileKeyScalar(payload.messageId);
    if (workspaceKey && messageId) return `${type}:${workspaceKey}:${messageId}`;
  }
  if (type === 'mail.send.scheduled') {
    const draftId = graphileKeyScalar(payload.draftId);
    if (workspaceKey && draftId) return scheduledSendJobKey(workspaceKey, draftId);
  }
  if (type === 'ai.reply_suggestion') {
    const messageId = graphileKeyScalar(payload.messageId);
    if (workspaceKey && messageId) return `${type}:${workspaceKey}:${messageId}`;
  }
  if (type === 'ai.agent') {
    const messageId = graphileKeyScalar(payload.messageId);
    const workflowId = graphileKeyScalar(payload.workflowId);
    const resumeNodeId = graphileKeyScalar(payload.resumeNodeId);
    if (workspaceKey && workflowId && resumeNodeId) {
      return `${type}:${workspaceKey}:${workflowId}:${messageId ?? 'none'}:${resumeNodeId}`;
    }
    if (workspaceKey && messageId) return `${type}:${workspaceKey}:${messageId}`;
  }
  if (type === 'ai.classify') {
    const messageId = graphileKeyScalar(payload.messageId);
    const workflowId = graphileKeyScalar(payload.workflowId);
    const resumeNodeId = graphileKeyScalar(payload.resumeNodeId);
    if (workspaceKey && messageId && workflowId && resumeNodeId) {
      return `${type}:${workspaceKey}:${workflowId}:${messageId}:${resumeNodeId}`;
    }
    if (workspaceKey && messageId) return `${type}:${workspaceKey}:${messageId}`;
  }
  if (type === 'ai.review') {
    const messageId = graphileKeyScalar(payload.messageId);
    const workflowId = graphileKeyScalar(payload.workflowId);
    const resumeNodeId = graphileKeyScalar(payload.resumeNodeId);
    if (workspaceKey && workflowId && resumeNodeId) {
      return `${type}:${workspaceKey}:${workflowId}:${messageId ?? 'none'}:${resumeNodeId}`;
    }
    if (workspaceKey && messageId) return `${type}:${workspaceKey}:${messageId}`;
  }
  if (type === 'ai.transform_text') {
    const messageId = graphileKeyScalar(payload.messageId);
    const workflowId = graphileKeyScalar(payload.workflowId);
    const resumeNodeId = graphileKeyScalar(payload.resumeNodeId);
    const targetVariable = graphileKeyScalar(payload.targetVariable);
    if (workspaceKey && workflowId && resumeNodeId && targetVariable) {
      return `${type}:${workspaceKey}:${workflowId}:${messageId ?? 'none'}:${resumeNodeId}:${targetVariable}`;
    }
    if (workspaceKey && messageId && targetVariable) return `${type}:${workspaceKey}:${messageId}:${targetVariable}`;
  }
  if (type === 'webhook.fire') {
    const dedupeKey = graphileKeyScalar(payload.dedupeKey);
    if (workspaceKey && dedupeKey) return `${type}:${workspaceKey}:${dedupeKey}`;
  }
  if (type === 'workflow.http_request') {
    const workflowId = graphileKeyScalar(payload.workflowId);
    const resumeNodeId = graphileKeyScalar(payload.resumeNodeId);
    const messageId = graphileKeyScalar(payload.messageId);
    if (workspaceKey && workflowId && resumeNodeId) {
      return `${type}:${workspaceKey}:${workflowId}:${messageId ?? 'none'}:${resumeNodeId}`;
    }
  }
  if (type === 'workflow.forward_copy') {
    const workflowId = graphileKeyScalar(payload.workflowId);
    const messageId = graphileKeyScalar(payload.messageId);
    const to = graphileKeyScalar(payload.to);
    if (workspaceKey && workflowId && messageId && to) {
      return `${type}:${workspaceKey}:${workflowId}:${messageId}:${to}`;
    }
  }
  if (type === 'workflow.execute') {
    const workflowId = graphileKeyScalar(payload.workflowId);
    const delayedJobId = graphileKeyScalar(payload.delayedJobId);
    const runId = graphileKeyScalar(payload.runId);
    const messageId = graphileKeyScalar(payload.messageId);
    if (workspaceKey && workflowId && delayedJobId) return `${type}:${workspaceKey}:delayed:${delayedJobId}`;
    if (workspaceKey && workflowId && runId) return `${type}:${workspaceKey}:run:${runId}`;
    if (workspaceKey && workflowId && messageId) return `${type}:${workspaceKey}:${workflowId}:message:${messageId}`;
  }
  if (type === 'lock.cleanup' && workspaceKey) {
    return `${type}:${workspaceKey}`;
  }
  return undefined;
}

async function createDefaultGraphileWorkerUtils(options: {
  connectionString: string;
}): Promise<GraphileWorkerUtilsPort> {
  const { makeWorkerUtils } = require('graphile-worker') as typeof import('graphile-worker');
  const utils = await makeWorkerUtils({ connectionString: options.connectionString });
  return {
    async addJob(identifier, payload, spec) {
      return utils.addJob(identifier, payload, spec);
    },
    async migrate() {
      await utils.migrate();
    },
    async release() {
      await utils.release();
    },
  };
}

async function createDefaultGraphileWorkerRuntime(options: {
  connectionString: string;
  concurrentJobs: number;
  taskList: Record<string, (payload: unknown) => Promise<void>>;
}): Promise<GraphileWorkerRuntime> {
  const { run } = require('graphile-worker') as typeof import('graphile-worker');
  const runner = await run({
    connectionString: options.connectionString,
    concurrency: options.concurrentJobs,
    taskList: options.taskList,
  });
  return {
    async stop() {
      await runner.stop();
    },
    promise: runner.promise,
  };
}

function normalizePayload(payload: unknown): JobPayload {
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as JobPayload
    : {};
}

function workspaceIdFromPayload(payload: unknown): string {
  const normalized = normalizePayload(payload);
  return typeof normalized.workspaceId === 'string' ? normalized.workspaceId : '';
}

function graphileKeyScalar(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}
