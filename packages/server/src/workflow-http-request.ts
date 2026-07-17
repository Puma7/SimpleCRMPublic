import { lookup as dnsLookup } from 'node:dns/promises';

import type { Kysely } from 'kysely';

import type { ServerDatabase } from './db/schema';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
  type WorkspaceTransaction,
} from './db/workspace-context';
import { createPinnedFetch, type GuardedFetch } from './jobs/pinned-fetch';
import { assertWebhookUrlAllowed, guardedFetch } from './jobs/webhook-handlers';
import type { JobPayload } from './jobs/types';

export type WorkflowHttpMethod = 'GET' | 'POST';

export type WorkflowHttpRequestContinuation = Readonly<{
  workflowId: number;
  triggerName?: string;
  resumeNodeId?: string;
  errorResumeNodeId?: string;
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
  idempotencyKey?: string;
  timeoutMs: number;
  eventStrings?: JobPayload;
  eventVariables?: JobPayload;
  continuation?: WorkflowHttpRequestContinuation;
}>;

export type WorkflowHttpRequestJobPort = Readonly<{
  request(input: WorkflowHttpRequestJobPlan): Promise<void>;
}>;

export type WorkflowHttpRequestFetch = GuardedFetch;

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
  const fetchImpl = options.fetchImpl ?? createPinnedFetch();
  const lookup = options.lookup ?? ((hostname: string) => dnsLookup(hostname, { all: true, verbatim: true }));

  return {
    async request(input): Promise<void> {
      const allowlist = await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => readWorkflowHttpAllowlist(trx, input.workspaceId),
        { applySession: options.applyWorkspaceSession },
      );

      let status = 0;
      let body = '';
      let ok = false;
      let errorMessage: string | null = null;
      try {
        const response = await guardedFetch({
          url: input.url,
          allowlist,
          lookup,
          fetchImpl,
          init: {
            method: input.method,
            headers: input.method === 'GET'
              ? {}
              : {
                'Content-Type': 'application/json',
                ...(input.idempotencyKey ? { 'Idempotency-Key': input.idempotencyKey } : {}),
              },
            ...(input.method === 'GET' || input.body === undefined ? {} : { body: input.body }),
            timeoutMs: input.timeoutMs,
          },
        });
        status = response.status;
        body = (await response.text()).slice(0, HTTP_RESPONSE_BODY_MAX);
        ok = response.ok;
        if (!ok) errorMessage = `HTTP ${status}`;
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
      }

      const resumeNodeId = ok
        ? input.continuation?.resumeNodeId
        : input.continuation?.errorResumeNodeId;
      // Fail closed: an HTTP error must never enter the normal successor path.
      // Without an explicit error edge the job remains failed/retryable.
      if (!ok && !resumeNodeId) {
        throw new Error(`workflow HTTP request failed (${status || 'no response'}): ${errorMessage ?? ''}`);
      }
      if (input.continuation && resumeNodeId) {
        await withWorkspaceTransaction(
          options.db,
          { workspaceId: input.workspaceId, role: 'system' },
          async (trx) => enqueueWorkflowHttpContinuation(
            trx,
            input,
            resumeNodeId,
            status,
            body,
            now(),
            ok,
            errorMessage,
          ),
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
  resumeNodeId: string,
  status: number,
  body: string,
  now: Date,
  ok: boolean,
  error: string | null,
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
          resumeNodeId,
          eventStrings: continuation.eventStrings ?? {},
          eventVariables: {
            ...(continuation.eventVariables ?? {}),
            'http.status': status,
            'http.body': body,
            'http.ok': ok,
            ...(error ? { 'http.error': error } : {}),
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
