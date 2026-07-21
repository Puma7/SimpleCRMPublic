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
import { buildTrustedServiceJobPayload, MANUAL_ADMIN_WORKFLOW_EXECUTE_MARKER_FIELD } from './jobs/policy';
import type { JobPayload } from './jobs/types';

export type WorkflowHttpMethod = 'GET' | 'POST';

export type WorkflowHttpRequestContinuation = Readonly<{
  workflowId: number;
  triggerName?: string;
  actorUserId?: string;
  trustedService?: boolean;
  // See AiClassificationContinuation.manualAdminExecute — carried across the async
  // HTTP boundary so the resumed workflow.execute keeps its owner/admin recheck.
  manualAdminExecute?: boolean;
  resumeNodeId?: string;
  errorResumeNodeId?: string;
  completeOnSuccess?: boolean;
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
      const terminalSuccess = Boolean(
        ok
        && input.continuation?.completeOnSuccess
        && !resumeNodeId,
      );
      // Fail closed: an HTTP error must never enter the normal successor path.
      // Without an explicit error edge the job remains failed/retryable.
      if (!ok && !resumeNodeId) {
        throw new Error(`workflow HTTP request failed (${status || 'no response'}): ${errorMessage ?? ''}`);
      }
      if (input.continuation && (resumeNodeId || terminalSuccess)) {
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
  resumeNodeId: string | undefined,
  status: number,
  body: string,
  now: Date,
  ok: boolean,
  error: string | null,
): Promise<void> {
  const continuation = input.continuation;
  if (!continuation) return;

  const payload = workflowContinuationPayload({
    workspaceId: input.workspaceId,
    workflowId: continuation.workflowId,
    ...(input.messageId === undefined ? {} : { messageId: input.messageId }),
    ...(continuation.actorUserId ? { actorUserId: continuation.actorUserId } : {}),
    ...(continuation.triggerName ? { triggerName: continuation.triggerName } : {}),
    // Keep the resumed workflow.execute marked so the owner/admin recheck still fires.
    ...(continuation.manualAdminExecute === true ? { [MANUAL_ADMIN_WORKFLOW_EXECUTE_MARKER_FIELD]: true } : {}),
    context: {
      ...(resumeNodeId
        ? { resumeNodeId }
        : { workflowTerminalSuccess: true }),
      eventStrings: continuation.eventStrings ?? {},
      eventVariables: {
        ...(continuation.eventVariables ?? {}),
        'http.status': status,
        'http.body': body,
        'http.ok': ok,
        ...(error ? { 'http.error': error } : {}),
      },
    },
  }, continuation.trustedService === true);

  await trx
    .insertInto('job_queue')
    .values({
      type: 'workflow.execute',
      payload,
      run_after: now,
      max_attempts: 3,
      workspace_id: input.workspaceId,
      updated_at: now,
    })
    .execute();
}

function workflowContinuationPayload(payload: Record<string, unknown>, trustedService: boolean): Record<string, unknown> {
  return trustedService && !payload.actorUserId ? buildTrustedServiceJobPayload(payload) : payload;
}
