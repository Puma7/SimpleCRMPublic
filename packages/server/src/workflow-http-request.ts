import { lookup as dnsLookup } from 'node:dns/promises';

import type { Kysely } from 'kysely';

import type { ServerDatabase } from './db/schema';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
  type WorkspaceTransaction,
} from './db/workspace-context';
import { assertWebhookUrlAllowed } from './jobs/webhook-handlers';
import type { JobPayload } from './jobs/types';

export type WorkflowHttpMethod = 'GET' | 'POST';

export type WorkflowHttpRequestContinuation = Readonly<{
  workflowId: number;
  triggerName?: string;
  resumeNodeId: string;
  eventStrings?: JobPayload;
  eventVariables?: JobPayload;
}>;

export type WorkflowHttpRequestJobPlan = Readonly<{
  workspaceId: string;
  messageId?: number;
  actorUserId?: string;
  method: WorkflowHttpMethod;
  url: string;
  body?: string;
  timeoutMs: number;
  eventStrings?: JobPayload;
  eventVariables?: JobPayload;
  continuation?: WorkflowHttpRequestContinuation;
}>;

export type WorkflowHttpRequestJobPort = Readonly<{
  request(input: WorkflowHttpRequestJobPlan): Promise<void>;
}>;

export type WorkflowHttpRequestFetch = (
  url: string,
  init: {
    method: WorkflowHttpMethod;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export type WorkflowHttpRequestLookup = (
  hostname: string,
) => Promise<readonly { address: string }[]>;

export type PostgresWorkflowHttpRequestPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  fetchImpl?: WorkflowHttpRequestFetch;
  lookup?: WorkflowHttpRequestLookup;
  now?: () => Date;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}>;

const WORKFLOW_HTTP_ALLOWLIST_KEY = 'workflow_http_allowlist';
const HTTP_RESPONSE_BODY_MAX = 8000;

export function createPostgresWorkflowHttpRequestPort(
  options: PostgresWorkflowHttpRequestPortOptions,
): WorkflowHttpRequestJobPort {
  const now = () => options.now?.() ?? new Date();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const lookup = options.lookup ?? ((hostname: string) => dnsLookup(hostname, { all: true, verbatim: true }));

  if (!fetchImpl) {
    throw new Error('global fetch is not available for workflow HTTP requests');
  }

  return {
    async request(input): Promise<void> {
      const allowlist = await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => readWorkflowHttpAllowlist(trx, input.workspaceId),
        { applySession: options.applyWorkspaceSession },
      );

      await assertWebhookUrlAllowed(input.url, allowlist, lookup);
      const response = await fetchImpl(input.url, {
        method: input.method,
        headers: input.method === 'GET' ? {} : { 'Content-Type': 'application/json' },
        ...(input.method === 'GET' || input.body === undefined ? {} : { body: input.body }),
        signal: AbortSignal.timeout(input.timeoutMs),
      });
      const body = (await response.text()).slice(0, HTTP_RESPONSE_BODY_MAX);
      if (!response.ok) {
        throw new Error(`workflow HTTP request failed with status ${response.status}: ${body.slice(0, 200)}`);
      }

      if (input.continuation) {
        await withWorkspaceTransaction(
          options.db,
          { workspaceId: input.workspaceId, role: 'system' },
          async (trx) => enqueueWorkflowHttpContinuation(trx, input, response.status, body, now()),
          { applySession: options.applyWorkspaceSession },
        );
      }
    },
  };
}

async function readWorkflowHttpAllowlist(
  trx: WorkspaceTransaction,
  workspaceId: string,
): Promise<string> {
  const row = await trx
    .selectFrom('sync_info')
    .select('value')
    .where('workspace_id', '=', workspaceId)
    .where('key', '=', WORKFLOW_HTTP_ALLOWLIST_KEY)
    .executeTakeFirst();
  return String(row?.value ?? '');
}

async function enqueueWorkflowHttpContinuation(
  trx: WorkspaceTransaction,
  input: WorkflowHttpRequestJobPlan,
  status: number,
  body: string,
  now: Date,
): Promise<void> {
  const continuation = input.continuation;
  if (!continuation) return;

  await trx
    .insertInto('job_queue')
    .values({
      type: 'workflow.execute',
      payload: {
        workspaceId: input.workspaceId,
        workflowId: continuation.workflowId,
        ...(input.messageId === undefined ? {} : { messageId: input.messageId }),
        ...(continuation.triggerName ? { triggerName: continuation.triggerName } : {}),
        context: {
          resumeNodeId: continuation.resumeNodeId,
          eventStrings: continuation.eventStrings ?? {},
          eventVariables: {
            ...(continuation.eventVariables ?? {}),
            'http.status': status,
            'http.body': body,
          },
        },
      },
      run_after: now,
      max_attempts: 3,
      workspace_id: input.workspaceId,
      updated_at: now,
    })
    .execute();
}
