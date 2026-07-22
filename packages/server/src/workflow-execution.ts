import { createHash } from 'node:crypto';

import { sql, type Kysely, type Selectable } from 'kysely';
import {
  addressesFromRecipientJson,
  buildSpamDecision,
  buildFeaturePreview,
  emailEvidenceWorkflowVariables,
  emailEvidenceSummaryWorkflowVariables,
  encodeOutboundApprovalMarker,
  ensureTicketInSubject,
  evaluateSenderFilterFromLists,
  extractDraftBodyForOutboundBlock,
  emailAddressForDelivery,
  generateTicketCode,
  interpolateWorkflowPlaceholders,
  isTrashMailboxName,
  isUnsafeAutoReplyTarget,
  listBuiltinWorkflowNodeCatalog,
  normalizeMailboxName,
  normalizeEmailAddress,
  outboundDraftFingerprint,
  outgoing,
  parseGraphDocument,
  parseSenderList,
  pickEdge,
  workflowDirectionForTrigger,
  workflowTriggerNeedsMessage,
  type WorkflowDirection,
  type WorkflowGraphDocument,
  type WorkflowGraphNode,
  type WorkflowTriggerKind,
  type SpamDecisionMessageInput,
  type SpamEngineSettings,
  type SpamFeatureStatInput,
  type SpamListMatch,
} from '@simplecrm/core';

import type {
  WorkflowExecutionDryRunResult,
  WorkflowExecutionJobPlan,
  WorkflowExecutionJobPort,
} from './jobs';
import { buildTrustedServiceJobPayload, MANUAL_ADMIN_WORKFLOW_EXECUTE_MARKER_FIELD, TRUSTED_SERVICE_JOB_MARKER_VALUE } from './jobs/policy';
import {
  createAiReviewPreviewRunner,
  type AiReviewPreviewRunner,
} from './ai-classification';
import type { PostgresSecretPort } from './db/postgres-secret-port';
import { validateReadOnlyMssqlQuery, type MssqlSettingsPort } from './mssql-settings';
import type { ServerWorkflowImapActionPort, ServerWorkflowImapActionResult } from './workflow-imap-actions';
import type {
  EmailMessagesTable,
  EmailWorkflowRunsTable,
  EmailWorkflowsTable,
  ReturnItemCondition,
  ReturnItemsTable,
  ReturnOutcome,
  ReturnsTable,
  ReturnStatus,
  ServerDatabase,
  WorkflowDelayedJobsTable,
} from './db';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
  type WorkspaceTransaction,
} from './db/workspace-context';
import { createPostgresComposeDraftInTransaction } from './db/postgres-mail-read-ports';
import { autoSubmittedDraftKey, outboundReviewApprovedKey } from './mail-compose-send';
import { extractWorkspaceTicketFromSubject, listWorkspaceTicketPrefixes } from './mail-ticket-prefixes';
import { loadEmailEvidenceSummaryForTracking } from './email-tracking';

const MAX_REGEX_PATTERN_LEN = 240;
const MAX_GRAPH_STEPS = 500;
const MAX_WORKFLOW_LOOP_ITEMS = 500;
/** Hard cap on chained workflow.subflow depth (cycle / runaway fan-out guard). */
const MAX_SUBFLOW_DEPTH = 8;
/** Reserved variable carrying the current subflow chain depth across child runs. */
const SUBFLOW_DEPTH_VARIABLE = '__subflow_depth';
const MAX_EMAIL_CATEGORY_DEPTH = 3;
const WORKFLOW_SENDER_WHITELIST_KEY = 'workflow_sender_whitelist';
const WORKFLOW_SENDER_BLACKLIST_KEY = 'workflow_sender_blacklist';
const WORKFLOW_SPAM_SCORE_THRESHOLD_KEY = 'workflow_spam_score_threshold';
const AUTO_REPLY_ENABLED_KEY = 'auto_reply_enabled';
const AUTO_REPLY_MAX_PER_SENDER_PER_DAY_KEY = 'auto_reply_max_per_sender_per_day';
const AUTO_REPLY_MAX_PER_SENDER_DEFAULT = 1;
// Anti-loop (RFC 3834 spirit): never auto-reply to automated/no-reply senders.
const AUTO_REPLY_NOREPLY_RE = /(^|[._+-])(no[._-]?reply|do[._-]?not[._-]?reply|mailer[._-]?daemon|postmaster|bounce|notifications?|automated)([._+-]|@)/i;
const MAX_WORKFLOW_JTL_LOOKUP_LIMIT = 50;
const WORKFLOW_JTL_LOOKUP_RESULT_LIMIT = 8_000;
const SERVER_CREATED_SOURCE_ID_OFFSET = 1_000_000_000_000n;
const SERVER_CREATED_SOURCE_ID_SPAN = 7_000_000_000_000_000n;
const safeRegex = require('safe-regex') as (pattern: string) => boolean;

type WorkflowRow = Pick<
  Selectable<EmailWorkflowsTable>,
  | 'id'
  | 'source_sqlite_id'
  | 'trigger_name'
  | 'enabled'
  | 'definition_json'
  | 'graph_json'
  | 'execution_mode'
>;

type MessageRow = Pick<
  Selectable<EmailMessagesTable>,
  | 'id'
  | 'source_sqlite_id'
  | 'account_id'
  | 'subject'
  | 'from_json'
  | 'to_json'
  | 'cc_json'
  | 'snippet'
  | 'body_text'
  | 'body_html'
  | 'has_attachments'
  | 'attachments_json'
  | 'customer_id'
  | 'customer_source_sqlite_id'
  | 'auth_spf'
  | 'auth_dkim'
  | 'auth_dmarc'
  | 'auth_arc'
  | 'rspamd_score'
  | 'rspamd_action'
  | 'is_spam'
  | 'spam_status'
  | 'spam_score'
  | 'spam_score_label'
  | 'spam_decision_source'
  | 'spam_score_breakdown_json'
  | 'raw_headers'
>;

type RunRow = Pick<Selectable<EmailWorkflowRunsTable>, 'id' | 'source_sqlite_id'>;
type DelayedJobRow = Pick<
  Selectable<WorkflowDelayedJobsTable>,
  | 'id'
  | 'workflow_id'
  | 'message_id'
  | 'message_source_sqlite_id'
  | 'resume_node_id'
  | 'context_json'
  | 'status'
>;

type WorkflowRunStatus = 'ok' | 'error' | 'blocked';
type WorkflowStepStatus = 'ok' | 'error' | 'skipped';
type WorkflowMessagePatch = {
  archived?: boolean;
  assigned_to?: string | null;
  done_local?: boolean;
  folder_kind?: string;
  is_spam?: boolean;
  seen_local?: boolean;
  soft_deleted?: boolean;
  spam_decided_at?: Date;
  spam_status?: string;
  trash_prev_archived?: boolean | null;
  trash_prev_folder_kind?: string | null;
  trash_prev_is_spam?: boolean | null;
  updated_at?: Date;
};

type WorkflowStringContext = Record<string, string>;
type WorkflowVariableContext = Record<string, string | number | boolean | null>;

type ServerWorkflowContext = {
  workspaceId: string;
  workflowId: number;
  workflowSourceSqliteId: number;
  runId: number;
  runSourceSqliteId: number;
  messageId: number | null;
  messageSourceSqliteId: number | null;
  trigger: WorkflowTriggerKind;
  direction: WorkflowDirection;
  message: MessageRow | null;
  strings: WorkflowStringContext;
  variables: WorkflowVariableContext;
  actorUserId?: string;
  trustedService?: boolean;
  manualAdminExecute?: boolean;
  previewOutbound?: boolean;
};

type PreparedWorkflowRun =
  | {
    ok: true;
  workflow: WorkflowRow;
  trigger: WorkflowTriggerKind;
  direction: WorkflowDirection;
  message: MessageRow | null;
  jobContext: Record<string, unknown>;
  resumeNodeId: string | null;
  delayedJob: DelayedJobRow | null;
}
  | {
    ok: false;
    workflow: WorkflowRow | null;
    message: MessageRow | null;
    error: string;
    log: string[];
  };

type NodeResult = {
  status: WorkflowStepStatus;
  port?: string | null;
  message?: string | null;
  stop?: boolean;
  blocked?: boolean;
  deferred?: boolean;
  blockReason?: string | null;
  variables?: WorkflowVariableContext;
};

type GraphRunResult = {
  status: WorkflowRunStatus;
  blocked: boolean;
  deferred: boolean;
  blockReason: string | null;
  log: string[];
};

type DeferredWorkflowImapEffect =
  | { kind: 'set_seen'; workspaceId: string; messageId: number }
  | {
    kind: 'move';
    workspaceId: string;
    messageId: number;
    targetFolderPath: string;
    context: ServerWorkflowContext;
    now: Date;
  }
  | {
    kind: 'delete';
    workspaceId: string;
    messageId: number;
    context: ServerWorkflowContext;
    now: Date;
  };

type ServerWorkflowRuntimePorts = Readonly<{
  mssql?: Pick<MssqlSettingsPort, 'executeReadOnlyQuery'>;
  workflowImapActions?: ServerWorkflowImapActionPort;
  deferredImapEffects?: DeferredWorkflowImapEffect[];
  aiReviewPreview?: AiReviewPreviewRunner;
}>;

type ServerInboundBranchGate = {
  conditionOk: boolean;
};

export type PostgresWorkflowExecutionJobPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  now?: () => Date;
  applyWorkspaceSession?: WorkspaceSessionApplier;
  mssql?: Pick<MssqlSettingsPort, 'executeReadOnlyQuery'>;
  workflowImapActions?: ServerWorkflowImapActionPort;
  secrets?: PostgresSecretPort;
  aiReviewPreview?: AiReviewPreviewRunner;
}>;

export function createPostgresWorkflowExecutionJobPort(
  options: PostgresWorkflowExecutionJobPortOptions,
): WorkflowExecutionJobPort {
  const aiReviewPreview = options.aiReviewPreview
    ?? (options.secrets
      ? createAiReviewPreviewRunner({
        db: options.db,
        secrets: options.secrets,
        applyWorkspaceSession: options.applyWorkspaceSession,
        now: options.now,
      })
      : undefined);
  const runtimePorts: ServerWorkflowRuntimePorts = {
    mssql: options.mssql,
    workflowImapActions: options.workflowImapActions,
    aiReviewPreview,
  };
  return {
    async execute(input) {
      const deferredImapEffects: DeferredWorkflowImapEffect[] = [];
      await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const now = options.now?.() ?? new Date();
          const workflow = await loadWorkflow(trx, input.workspaceId, input.workflowId);
          if (!workflow) {
            if (input.runId !== undefined) {
              await finishExistingRun(trx, input.workspaceId, input.runId, {
                status: 'error',
                log: ['error:workflow_not_found'],
                now,
              });
            }
            return;
          }

          const trigger = normalizeWorkflowTrigger(input.triggerName ?? workflow.trigger_name);
          const direction = workflowDirectionForTrigger(trigger);
          const delayedJob = input.delayedJobId === undefined
            ? null
            : await loadDelayedJob(trx, input.workspaceId, input.delayedJobId, Number(workflow.id));
          if (input.delayedJobId !== undefined && !delayedJob) {
            const run = await startOrReuseRun(trx, {
              workspaceId: input.workspaceId,
              workflow,
              message: null,
              direction,
              requestedRunId: input.runId,
              now,
            });
            await finishRun(trx, input.workspaceId, run.id, {
              status: 'error',
              log: ['error:delayed_job_not_found'],
              now,
            });
            return;
          }

          if (delayedJob && delayedJobAuthorizationMismatch(input, delayedJob.message_id)) {
            const run = await startOrReuseRun(trx, {
              workspaceId: input.workspaceId,
              workflow,
              message: null,
              direction,
              requestedRunId: input.runId,
              now,
            });
            await finishRun(trx, input.workspaceId, run.id, {
              status: 'error',
              log: ['error:delayed_job_authorization_mismatch'],
              now,
            });
            return;
          }

          const messageId = input.messageId ?? delayedJob?.message_id ?? undefined;
          if (
            input.messageId !== undefined
            && delayedJob !== null
            && normalizeDelayedJobMessageId(delayedJob.message_id) !== input.messageId
          ) {
            const run = await startOrReuseRun(trx, {
              workspaceId: input.workspaceId,
              workflow,
              message: null,
              direction,
              requestedRunId: input.runId,
              now,
            });
            await finishRun(trx, input.workspaceId, run.id, {
              status: 'error',
              log: ['error:delayed_job_message_mismatch'],
              now,
            });
            return;
          }

          const message = messageId === undefined || messageId === null
            ? null
            : await loadMessage(trx, input.workspaceId, Number(messageId));
          if (messageId !== undefined && messageId !== null && !message) {
            const run = await startOrReuseRun(trx, {
              workspaceId: input.workspaceId,
              workflow,
              message: null,
              direction,
              requestedRunId: input.runId,
              now,
            });
            await finishRun(trx, input.workspaceId, run.id, {
              status: 'error',
              log: ['error:message_not_found'],
              now,
            });
            return;
          }

          const jobContext = mergeJobContexts(delayedJob?.context_json, input.context);
          const resumeNodeId = delayedJob?.resume_node_id
            ?? stringFromContext(jobContext.resumeNodeId)
            ?? null;

          if (
            trigger === 'inbound'
            && message
            && input.delayedJobId === undefined
            && !contextForcesWorkflowReapply(jobContext)
            && await wasInboundWorkflowApplied(trx, input.workspaceId, workflow, message)
          ) {
            const run = await startOrReuseRun(trx, {
              workspaceId: input.workspaceId,
              workflow,
              message,
              direction,
              requestedRunId: input.runId,
              now,
            });
            await finishRun(trx, input.workspaceId, run.id, {
              status: 'ok',
              log: ['skip:workflow_already_applied'],
              now,
            });
            return;
          }

          const run = await startOrReuseRun(trx, {
            workspaceId: input.workspaceId,
            workflow,
            message,
            direction,
            requestedRunId: input.runId,
            now,
          });

          if (contextCompletesWorkflow(jobContext) && !resumeNodeId) {
            await finishRun(trx, input.workspaceId, run.id, {
              status: 'ok',
              log: ['continuation:terminal_success'],
              now,
            });
            if (trigger === 'inbound' && message) {
              await markInboundWorkflowApplied(trx, input.workspaceId, workflow, message, now);
            }
            return;
          }

          if (!workflow.enabled) {
            await finishRun(trx, input.workspaceId, run.id, {
              status: 'ok',
              log: ['skip:workflow_disabled'],
              now,
            });
            return;
          }

          if (
            trigger === 'inbound'
            && message
            && contextSkipsSpamOrReview(jobContext)
            && messageIsSpamOrReview(message)
          ) {
            await finishRun(trx, input.workspaceId, run.id, {
              status: 'ok',
              log: ['skip:message_spam_or_review'],
              now,
            });
            return;
          }

          if (delayedJob && delayedJob.status === 'done') {
            await finishRun(trx, input.workspaceId, run.id, {
              status: 'ok',
              log: ['skip:delayed_job_done'],
              now,
            });
            return;
          }
          if (delayedJob && !resumeNodeId) {
            await markDelayedJobStatus(trx, input.workspaceId, Number(delayedJob.id), 'failed', now);
            await finishRun(trx, input.workspaceId, run.id, {
              status: 'error',
              log: ['error:delayed_job_resume_node_missing'],
              now,
            });
            return;
          }

          if (delayedJob) {
            await markDelayedJobStatus(trx, input.workspaceId, Number(delayedJob.id), 'running', now);
          }

          if (workflowTriggerNeedsMessage(trigger) && !message && !contextHasOutbound(jobContext)) {
            await finishRun(trx, input.workspaceId, run.id, {
              status: 'error',
              log: ['error:message_required'],
              now,
            });
            return;
          }

          const context = buildWorkflowContext({
            workspaceId: input.workspaceId,
            workflowId: Number(workflow.id),
            workflowSourceSqliteId: workflowSourceSqliteId(workflow),
            runId: run.id,
            runSourceSqliteId: run.sourceSqliteId,
            messageId: message?.id === undefined ? outboundMessageIdFromContext(jobContext) : Number(message.id),
            trigger,
            direction,
            message,
            actorUserId: input.actorUserId,
            trustedService: input.trustedService,
            manualAdminExecute: input.manualAdminExecute,
            jobContext,
          });
          const result = await runServerWorkflowGraph(trx, {
            workspaceId: input.workspaceId,
            workflow,
            context,
            startNodeId: resumeNodeId,
            now,
            ports: {
              ...runtimePorts,
              deferredImapEffects,
            },
          });
          await finishRun(trx, input.workspaceId, run.id, {
            status: result.status,
            log: result.log,
            now,
          });
          if (trigger === 'inbound' && message && result.status === 'ok' && !result.deferred) {
            await markInboundWorkflowApplied(trx, input.workspaceId, workflow, message, now);
          }
          if (delayedJob) {
            await markDelayedJobStatus(
              trx,
              input.workspaceId,
              Number(delayedJob.id),
              result.status === 'ok' ? 'done' : 'failed',
              now,
            );
          }
        },
        { applySession: options.applyWorkspaceSession },
      );
      await flushDeferredWorkflowImapEffects({
        effects: deferredImapEffects,
        db: options.db,
        workflowImapActions: options.workflowImapActions,
        applyWorkspaceSession: options.applyWorkspaceSession,
      });
    },

    async dryRun(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const now = options.now?.() ?? new Date();
          const prepared = await prepareWorkflowRun(trx, input);
          if (!prepared.ok) {
            return dryRunFailure(prepared.error, prepared.log, {
              ...(prepared.workflow ? { workflowId: workflowSourceSqliteId(prepared.workflow) } : {}),
              ...(prepared.message ? { messageId: Number(prepared.message.id) } : {}),
            });
          }
          if (!prepared.workflow.enabled) {
            return {
              success: true,
              dryRun: true,
              workflowId: workflowSourceSqliteId(prepared.workflow),
              ...(prepared.message === null ? {} : { messageId: Number(prepared.message.id) }),
              status: 'ok',
              blocked: false,
              blockReason: null,
              log: ['skip:workflow_disabled'],
            };
          }

          const context = buildWorkflowContext({
            workspaceId: input.workspaceId,
            workflowId: Number(prepared.workflow.id),
            workflowSourceSqliteId: workflowSourceSqliteId(prepared.workflow),
            runId: 0,
            runSourceSqliteId: 0,
            messageId: prepared.message?.id === undefined
              ? outboundMessageIdFromContext(prepared.jobContext)
              : Number(prepared.message.id),
            trigger: prepared.trigger,
            direction: prepared.direction,
            message: prepared.message,
            actorUserId: input.actorUserId,
            trustedService: input.trustedService,
            jobContext: prepared.jobContext,
          });
          const result = await runServerWorkflowGraph(trx, {
            workspaceId: input.workspaceId,
            workflow: prepared.workflow,
            context,
            startNodeId: prepared.resumeNodeId,
            now,
            dryRun: true,
            ports: runtimePorts,
          });
          return {
            success: true,
            dryRun: true,
            workflowId: workflowSourceSqliteId(prepared.workflow),
            ...(prepared.message === null ? {} : { messageId: Number(prepared.message.id) }),
            status: result.status,
            blocked: result.blocked,
            blockReason: result.blockReason,
            log: ['dry_run:server', ...result.log],
          };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

async function prepareWorkflowRun(
  trx: WorkspaceTransaction,
  input: WorkflowExecutionJobPlan,
): Promise<PreparedWorkflowRun> {
  const workflow = await loadWorkflow(trx, input.workspaceId, input.workflowId);
  if (!workflow) {
    return {
      ok: false,
      workflow: null,
      message: null,
      error: 'Workflow nicht gefunden',
      log: ['error:workflow_not_found'],
    };
  }

  const trigger = normalizeWorkflowTrigger(input.triggerName ?? workflow.trigger_name);
  const direction = workflowDirectionForTrigger(trigger);
  const delayedJob = input.delayedJobId === undefined
    ? null
    : await loadDelayedJob(trx, input.workspaceId, input.delayedJobId, Number(workflow.id));
  if (input.delayedJobId !== undefined && !delayedJob) {
    return {
      ok: false,
      workflow,
      message: null,
      error: 'delayed_job_not_found',
      log: ['error:delayed_job_not_found'],
    };
  }

  if (delayedJob && delayedJobAuthorizationMismatch(input, delayedJob.message_id)) {
    return {
      ok: false,
      workflow,
      message: null,
      error: 'delayed_job_authorization_mismatch',
      log: ['error:delayed_job_authorization_mismatch'],
    };
  }

  const messageId = input.messageId ?? delayedJob?.message_id ?? undefined;
  if (
    input.messageId !== undefined
    && delayedJob !== null
    && normalizeDelayedJobMessageId(delayedJob.message_id) !== input.messageId
  ) {
    return {
      ok: false,
      workflow,
      message: null,
      error: 'delayed_job_message_mismatch',
      log: ['error:delayed_job_message_mismatch'],
    };
  }

  const message = messageId === undefined || messageId === null
    ? null
    : await loadMessage(trx, input.workspaceId, Number(messageId));
  if (messageId !== undefined && messageId !== null && !message) {
    return {
      ok: false,
      workflow,
      message: null,
      error: 'Nachricht nicht gefunden',
      log: ['error:message_not_found'],
    };
  }

  const jobContext = mergeJobContexts(delayedJob?.context_json, input.context);
  const resumeNodeId = delayedJob?.resume_node_id
    ?? stringFromContext(jobContext.resumeNodeId)
    ?? null;
  if (delayedJob && delayedJob.status === 'done') {
    return {
      ok: false,
      workflow,
      message,
      error: 'delayed_job_done',
      log: ['skip:delayed_job_done'],
    };
  }
  if (delayedJob && !resumeNodeId) {
    return {
      ok: false,
      workflow,
      message,
      error: 'delayed_job_resume_node_missing',
      log: ['error:delayed_job_resume_node_missing'],
    };
  }
  if (workflowTriggerNeedsMessage(trigger) && !message && !contextHasOutbound(jobContext)) {
    return {
      ok: false,
      workflow,
      message,
      error: 'Fuer diesen Trigger ist eine Nachricht-ID erforderlich',
      log: ['error:message_required'],
    };
  }

  return {
    ok: true,
    workflow,
    trigger,
    direction,
    message,
    jobContext,
    resumeNodeId,
    delayedJob,
  };
}

function delayedJobAuthorizationMismatch(
  input: WorkflowExecutionJobPlan,
  actualMessageId: unknown,
): boolean {
  if (!Object.prototype.hasOwnProperty.call(input, 'authorizedDelayedJobMessageId')) return true;
  return input.authorizedDelayedJobMessageId !== normalizeDelayedJobMessageId(actualMessageId);
}

function normalizeDelayedJobMessageId(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : Number.NaN;
}

function dryRunFailure(
  errorMessage: string,
  log: readonly string[],
  ids: { workflowId?: number; messageId?: number } = {},
): WorkflowExecutionDryRunResult {
  return {
    success: false,
    dryRun: true,
    ...ids,
    status: 'error',
    blocked: false,
    blockReason: null,
    log,
    error: errorMessage,
  };
}

async function loadWorkflow(
  trx: WorkspaceTransaction,
  workspaceId: string,
  workflowId: number,
): Promise<WorkflowRow | null> {
  const row = await trx
    .selectFrom('email_workflows')
    .select([
      'id',
      'source_sqlite_id',
      'trigger_name',
      'enabled',
      'definition_json',
      'graph_json',
      'execution_mode',
    ])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', workflowId)
    .executeTakeFirst();
  return row ?? null;
}

async function loadDelayedJob(
  trx: WorkspaceTransaction,
  workspaceId: string,
  delayedJobId: number,
  workflowId: number,
): Promise<DelayedJobRow | null> {
  const row = await trx
    .selectFrom('workflow_delayed_jobs')
    .select([
      'id',
      'workflow_id',
      'message_id',
      'message_source_sqlite_id',
      'resume_node_id',
      'context_json',
      'status',
    ])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', delayedJobId)
    .where('workflow_id', '=', workflowId)
    .forUpdate()
    .executeTakeFirst();
  return row ?? null;
}

async function loadMessage(
  trx: WorkspaceTransaction,
  workspaceId: string,
  messageId: number,
): Promise<MessageRow | null> {
  const row = await trx
    .selectFrom('email_messages')
    .select([
      'id',
      'source_sqlite_id',
      'account_id',
      'subject',
      'from_json',
      'to_json',
      'cc_json',
      'snippet',
      'body_text',
      'body_html',
      'has_attachments',
      'attachments_json',
      'customer_id',
      'customer_source_sqlite_id',
      'auth_spf',
      'auth_dkim',
      'auth_dmarc',
      'auth_arc',
      'rspamd_score',
      'rspamd_action',
      'is_spam',
      'spam_status',
      'spam_score',
      'spam_score_label',
      'spam_decision_source',
      'spam_score_breakdown_json',
      // Anti-Loop-Guards (email.auto_reply / email.send_draft) prüfen
      // Auto-Submitted/X-Auto-Response-Suppress/Precedence/List-Header.
      'raw_headers',
    ])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', messageId)
    .executeTakeFirst();
  return row ?? null;
}

async function wasInboundWorkflowApplied(
  trx: WorkspaceTransaction,
  workspaceId: string,
  workflow: WorkflowRow,
  message: MessageRow,
): Promise<boolean> {
  const row = await trx
    .selectFrom('email_message_workflow_applied')
    .select(['id'])
    .where('workspace_id', '=', workspaceId)
    .where('message_source_sqlite_id', '=', Number(message.source_sqlite_id))
    .where('workflow_source_sqlite_id', '=', workflowSourceSqliteId(workflow))
    .executeTakeFirst();
  return Boolean(row);
}

async function markInboundWorkflowApplied(
  trx: WorkspaceTransaction,
  workspaceId: string,
  workflow: WorkflowRow,
  message: MessageRow,
  now: Date,
): Promise<void> {
  const messageSourceSqliteId = Number(message.source_sqlite_id);
  const workflowSource = workflowSourceSqliteId(workflow);
  await trx
    .insertInto('email_message_workflow_applied')
    .values({
      workspace_id: workspaceId,
      source_sqlite_id: serverCreatedSourceSqliteId(
        'email_message_workflow_applied',
        workspaceId,
        String(messageSourceSqliteId),
        String(workflowSource),
      ),
      message_source_sqlite_id: messageSourceSqliteId,
      workflow_source_sqlite_id: workflowSource,
      message_id: Number(message.id),
      workflow_id: Number(workflow.id),
      source_row: serverWorkerSourceRow(),
      imported_in_run_id: null,
      applied_at: now,
      updated_at: now,
    })
    .onConflict((oc) => oc
      .columns(['workspace_id', 'message_source_sqlite_id', 'workflow_source_sqlite_id'])
      .doUpdateSet({
        message_id: Number(message.id),
        workflow_id: Number(workflow.id),
        applied_at: now,
        updated_at: now,
        source_row: serverWorkerSourceRow(),
      }))
    .execute();
}

async function markDelayedJobStatus(
  trx: WorkspaceTransaction,
  workspaceId: string,
  delayedJobId: number,
  status: 'pending' | 'running' | 'done' | 'failed',
  now: Date,
): Promise<void> {
  await trx
    .updateTable('workflow_delayed_jobs')
    .set({
      status,
      updated_at: now,
    })
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', delayedJobId)
    .execute();
}

async function startOrReuseRun(
  trx: WorkspaceTransaction,
  input: {
    workspaceId: string;
    workflow: WorkflowRow;
    message: MessageRow | null;
    direction: WorkflowDirection;
    requestedRunId?: number;
    now: Date;
  },
): Promise<{ id: number; sourceSqliteId: number }> {
  if (input.requestedRunId !== undefined) {
    const existing = await trx
      .selectFrom('email_workflow_runs')
      .select(['id', 'source_sqlite_id'])
      .where('workspace_id', '=', input.workspaceId)
      .where('id', '=', input.requestedRunId)
      .executeTakeFirst();
    if (existing) {
      const id = Number(existing.id);
      const sourceSqliteId = nullableSourceSqliteId(existing.source_sqlite_id, id);
      await trx
        .updateTable('email_workflow_runs')
        .set({
          workflow_id: Number(input.workflow.id),
          workflow_source_sqlite_id: workflowSourceSqliteId(input.workflow),
          message_id: input.message === null ? null : Number(input.message.id),
          message_source_sqlite_id: input.message === null ? null : Number(input.message.source_sqlite_id),
          direction: input.direction,
          status: 'running',
          // Persist the (synthetic) source id so run-step lookups by source match
          // the run_source_sqlite_id written onto the steps.
          source_sqlite_id: sourceSqliteId,
          started_at: input.now,
          finished_at: null,
          updated_at: input.now,
        })
        .where('workspace_id', '=', input.workspaceId)
        .where('id', '=', id)
        .execute();
      return { id, sourceSqliteId };
    }
  }

  const inserted = await trx
    .insertInto('email_workflow_runs')
    .values({
      workspace_id: input.workspaceId,
      source_sqlite_id: null,
      workflow_source_sqlite_id: workflowSourceSqliteId(input.workflow),
      message_source_sqlite_id: input.message === null ? null : Number(input.message.source_sqlite_id),
      workflow_id: Number(input.workflow.id),
      message_id: input.message === null ? null : Number(input.message.id),
      direction: input.direction,
      status: 'running',
      // jsonb column: node-postgres serializes a JS array as a Postgres array
      // literal ({...}), which is invalid JSON. Pass a JSON string instead.
      log_json: JSON.stringify([] as string[]),
      source_row: serverWorkerSourceRow(),
      imported_in_run_id: null,
      started_at: input.now,
      finished_at: null,
      updated_at: input.now,
    })
    .returning(['id', 'source_sqlite_id'])
    .executeTakeFirstOrThrow();
  const id = Number(inserted.id);
  const sourceSqliteId = nullableSourceSqliteId(inserted.source_sqlite_id, id);
  if (inserted.source_sqlite_id === null || inserted.source_sqlite_id === undefined) {
    // Worker-created run: persist the synthetic source id (-id) so run-step
    // lookups by source resolve (the steps carry run_source_sqlite_id = -id).
    await trx
      .updateTable('email_workflow_runs')
      .set({ source_sqlite_id: sourceSqliteId })
      .where('workspace_id', '=', input.workspaceId)
      .where('id', '=', id)
      .execute();
  }
  return { id, sourceSqliteId };
}

async function finishExistingRun(
  trx: WorkspaceTransaction,
  workspaceId: string,
  runId: number,
  input: { status: WorkflowRunStatus; log: string[]; now: Date },
): Promise<void> {
  await trx
    .updateTable('email_workflow_runs')
    .set({
      status: input.status,
      // jsonb column: stringify the array so node-postgres sends valid JSON
      // instead of a Postgres array literal ({...}) -> 22P02 invalid input.
      log_json: JSON.stringify(input.log),
      finished_at: input.now,
      updated_at: input.now,
    })
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', runId)
    .execute();
}

async function finishRun(
  trx: WorkspaceTransaction,
  workspaceId: string,
  runId: number,
  input: { status: WorkflowRunStatus; log: string[]; now: Date },
): Promise<void> {
  await finishExistingRun(trx, workspaceId, runId, input);
}

async function runServerWorkflowGraph(
  trx: WorkspaceTransaction,
  input: {
    workspaceId: string;
    workflow: WorkflowRow;
    context: ServerWorkflowContext;
    startNodeId?: string | null;
    now: Date;
    dryRun?: boolean;
    ports: ServerWorkflowRuntimePorts;
  },
): Promise<GraphRunResult> {
  if (input.workflow.execution_mode === 'compiled') {
    return blockedResult('compiled_unsupported:server_workflow_execution');
  }

  const doc = parseWorkflowGraph(input.workflow.graph_json);
  if (!doc) {
    return definitionHasRules(input.workflow.definition_json)
      ? blockedResult('legacy_definition_unsupported:server_workflow_execution')
      : { status: 'ok', blocked: false, deferred: false, blockReason: null, log: ['graph_empty:keine ausführbaren Knoten'] };
  }

  if (input.startNodeId) {
    if (!doc.nodes.some((node) => node.id === input.startNodeId)) {
      return blockedResult(`resume_node_missing:${input.startNodeId}`);
    }
    return walkGraph(trx, {
      doc,
      context: input.context,
      startNodeId: input.startNodeId,
      log: [`graph_resume:${input.startNodeId}`],
      now: input.now,
      dryRun: input.dryRun === true,
      ports: input.ports,
      inboundGate: inboundGateFromContext(input.context),
    });
  }

  const triggerNode = doc.nodes.find((node) => {
    if (node.type !== 'trigger') return false;
    const kind = String((node.data as Record<string, unknown>).kind ?? '');
    return kind === input.context.trigger || !kind;
  }) ?? doc.nodes.find((node) => node.type === 'trigger');
  if (!triggerNode) {
    return blockedResult('trigger_missing:server_workflow_execution');
  }

  const triggerEdges = outgoing(doc.edges, triggerNode.id);
  if (triggerEdges.length === 0) {
    if (input.dryRun !== true) {
      await insertRunStep(trx, input.context, triggerNode, {
        status: 'ok',
        port: 'default',
        message: null,
        durationMs: 0,
        now: input.now,
      });
    }
    return { status: 'ok', blocked: false, deferred: false, blockReason: null, log: ['trigger_no_edges'] };
  }

  const log: string[] = [];
  let result: GraphRunResult = { status: 'ok', blocked: false, deferred: false, blockReason: null, log };
  for (const edge of triggerEdges) {
    const branchContext = cloneServerWorkflowContext(input.context);
    result = await walkGraph(trx, {
      doc,
      context: branchContext,
      startNodeId: edge.target,
      log,
      now: input.now,
      dryRun: input.dryRun === true,
      ports: input.ports,
      inboundGate: branchContext.direction === 'inbound' ? { conditionOk: false } : undefined,
    });
    if (result.status !== 'ok' || result.blocked || result.deferred) return result;
  }
  return result;
}

function cloneServerWorkflowContext(context: ServerWorkflowContext): ServerWorkflowContext {
  return {
    ...context,
    strings: { ...context.strings },
    variables: { ...context.variables },
  };
}

async function walkGraph(
  trx: WorkspaceTransaction,
  input: {
    doc: WorkflowGraphDocument;
    context: ServerWorkflowContext;
    startNodeId: string;
    log: string[];
    now: Date;
    dryRun: boolean;
    ports: ServerWorkflowRuntimePorts;
    seen?: Set<string>;
    allowRevisit?: boolean;
    stopBeforeNodeIds?: ReadonlySet<string>;
    inboundGate?: ServerInboundBranchGate;
  },
): Promise<GraphRunResult> {
  const nodesById = new Map(input.doc.nodes.map((node) => [node.id, node]));
  const seen = input.seen ?? new Set<string>();
  let currentId: string | undefined = input.startNodeId;
  let stepCount = 0;

  while (currentId) {
    if (input.stopBeforeNodeIds?.has(currentId)) break;
    if (stepCount++ >= MAX_GRAPH_STEPS) {
      return blockedResult('graph_step_limit:server_workflow_execution', input.log);
    }
    if (input.allowRevisit !== true && seen.has(currentId)) {
      input.log.push(`cycle:${currentId}`);
      break;
    }
    seen.add(currentId);

    const node = nodesById.get(currentId);
    if (!node) break;

    if (
      input.context.direction === 'inbound'
      && input.inboundGate
      && inboundNodeRequiresConditionGate(node)
      && !input.inboundGate.conditionOk
    ) {
      input.log.push(`skip:${node.id}:no_prior_condition`);
      // Record the skip as a run step so the run history shows *why* nothing
      // happened (otherwise an inbound side-effect node is silently dropped and
      // the run looks like an empty "OK").
      if (!input.dryRun) {
        await insertRunStep(trx, input.context, node, {
          status: 'skipped',
          port: 'blocked',
          message: 'übersprungen: keine vorausgehende erfüllte Bedingung (Inbound-Schutz)',
          durationMs: 0,
          now: input.now,
        });
      }
      break;
    }

    if (nodeRuntimeType(node) === 'logic.loop') {
      const loopEdges = outgoing(input.doc.edges, currentId);
      const eachEdge = pickEdge(loopEdges, 'each');
      const doneEdge = pickEdge(loopEdges, 'done');
      if (eachEdge || doneEdge) {
        const started = Date.now();
        const items = workflowLoopItems(nodeConfig(node), input.context, input.log);
        const activeItems = eachEdge ? items : [];
        if (!input.dryRun) {
          await insertRunStep(trx, input.context, node, {
            status: 'ok',
            port: activeItems.length > 0 ? 'each' : 'done',
            message: activeItems.length > 0
              ? `loop_items:${activeItems.length}`
              : eachEdge
                ? 'loop_empty'
                : 'loop_each_missing',
            durationMs: Math.max(0, Date.now() - started),
            now: input.now,
          });
        }

        if (!eachEdge || activeItems.length === 0) {
          input.log.push(eachEdge ? 'loop:empty' : 'loop:each_missing');
          currentId = doneEdge?.target;
          continue;
        }

        const stopBeforeNodeIds = new Set<string>([currentId]);
        if (doneEdge?.target) stopBeforeNodeIds.add(doneEdge.target);
        for (let index = 0; index < activeItems.length; index += 1) {
          const item = activeItems[index]!;
          input.context.variables['loop.item'] = item;
          input.context.variables['loop.index'] = index;
          input.log.push(`loop:${index}:${item}`);
          const branchResult = await walkGraph(trx, {
            doc: input.doc,
            context: input.context,
            startNodeId: eachEdge.target,
            log: input.log,
            now: input.now,
            dryRun: input.dryRun,
            ports: input.ports,
            seen: new Set<string>(),
            allowRevisit: true,
            stopBeforeNodeIds,
            inboundGate: input.inboundGate,
          });
          if (branchResult.status !== 'ok' || branchResult.blocked || branchResult.deferred) {
            return branchResult;
          }
        }

        currentId = doneEdge?.target;
        continue;
      }
    }

    const started = Date.now();
    const result = await executeServerNode(
      trx,
      input.doc,
      input.context,
      node,
      input.log,
      input.now,
      input.ports,
      input.dryRun,
    );
    const durationMs = Math.max(0, Date.now() - started);
    if (!input.dryRun) {
      await insertRunStep(trx, input.context, node, {
        status: result.status,
        port: result.port ?? null,
        message: result.message ?? null,
        durationMs,
        now: input.now,
      });
    }

    if (result.variables) {
      const subflowDepth = input.context.variables[SUBFLOW_DEPTH_VARIABLE];
      Object.assign(input.context.variables, result.variables);
      if (subflowDepth === undefined) {
        delete input.context.variables[SUBFLOW_DEPTH_VARIABLE];
      } else {
        input.context.variables[SUBFLOW_DEPTH_VARIABLE] = subflowDepth;
      }
    }
    // Inbound gate: condition.yes, auto_reply.approved, threshold.yes oder
    // ein getroffener switch-Fall autorisieren nachgelagerte Side-Effect-
    // Knoten — gleiche harte (nodeType, port)-Liste wie die Desktop-Runtime
    // (electron/workflow/runtime.ts), bewusst KEINE Schema-Ableitung: welcher
    // Ausgang als "bestandene Bedingung" zählt, ist ein Sicherheitsmechanismus.
    // Ohne den switch-Fall bliebe z. B. der blocked→switch(low_confidence)→tag-
    // Pfad der Auto-Antwort-Vorlagen im Server-Modus als no_prior_condition
    // hängen.
    const gateRegistryType = node.type === 'registry' ? nodeRuntimeType(node) : null;
    const trippedInboundGate =
      (node.type === 'condition' && result.port === 'yes')
      || (gateRegistryType === 'email.auto_reply' && result.port === 'approved')
      || (gateRegistryType === 'logic.threshold' && result.port === 'yes')
      || (gateRegistryType === 'logic.switch'
        && typeof result.port === 'string'
        && result.port !== 'default');
    if (trippedInboundGate && input.inboundGate) {
      input.inboundGate.conditionOk = true;
      input.context.variables.__inbound_condition_ok = true;
    }
    if (result.blocked) {
      if (!input.dryRun && input.context.direction === 'outbound' && input.context.messageId !== null) {
        await trx
          .updateTable('email_messages')
          .set({
            outbound_hold: true,
            outbound_block_reason: result.blockReason ?? result.message ?? 'Workflow blockiert',
            updated_at: input.now,
          })
          .where('workspace_id', '=', input.context.workspaceId)
          .where('id', '=', input.context.messageId)
          .execute();
      }
      return {
        status: 'blocked',
        blocked: true,
        deferred: false,
        blockReason: result.blockReason ?? result.message ?? 'Workflow blockiert',
        log: input.log,
      };
    }
    if (result.status === 'error') {
      return {
        status: 'error',
        blocked: false,
        deferred: false,
        blockReason: result.message ?? null,
        log: input.log,
      };
    }
    if (result.stop) {
      input.log.push('stop');
      return {
        status: 'ok',
        blocked: false,
        deferred: result.deferred === true,
        blockReason: null,
        log: input.log,
      };
    }

    const next = pickEdge(outgoing(input.doc.edges, currentId), result.port ?? 'default');
    currentId = next?.target;
  }

  return { status: 'ok', blocked: false, deferred: false, blockReason: null, log: input.log };
}

function workflowLoopItems(
  config: Record<string, unknown>,
  context: ServerWorkflowContext,
  log: string[],
): string[] {
  const sourceKey = String(config.sourceVariable ?? 'attachment_names').trim() || 'attachment_names';
  const raw = String(context.strings[sourceKey] ?? '')
    || String(context.variables[sourceKey] ?? '')
    || String(config.items ?? '');
  const allItems = raw
    .split(/[,;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const maxItems = boundedWorkflowLoopItems(config.maxItems);
  if (allItems.length > maxItems) log.push(`loop:limit:${maxItems}`);
  return allItems.slice(0, maxItems);
}

function boundedWorkflowLoopItems(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? 50).trim());
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(MAX_WORKFLOW_LOOP_ITEMS, Math.trunc(parsed)));
}

async function executePreviewOutboundAiReview(
  ports: ServerWorkflowRuntimePorts,
  context: ServerWorkflowContext,
  config: Record<string, unknown>,
  type: 'ai.outbound_review' | 'ai.review' | 'ai_review',
): Promise<NodeResult> {
  if (!ports.aiReviewPreview) {
    const message = 'KI-Vorschau nicht verfuegbar';
    return {
      status: 'error',
      port: 'error',
      blocked: true,
      blockReason: message,
      message,
    };
  }
  const promptId = optionalPositiveIntegerConfig(config.promptId, 'promptId');
  if (!promptId.ok) return { status: 'error', port: 'error', message: promptId.message };
  const profileId = optionalPositiveIntegerConfig(config.profileId, 'profileId');
  if (!profileId.ok) return { status: 'error', port: 'error', message: profileId.message };
  const blockKeyword = workflowAiBlockKeyword(config.blockKeyword);
  if (!blockKeyword.ok) return { status: 'error', port: 'error', message: blockKeyword.message };

  const preview = await ports.aiReviewPreview({
    workspaceId: context.workspaceId,
    direction: context.direction === 'inbound' ? 'inbound' : 'outbound',
    ...(promptId.value === undefined ? {} : { promptId: promptId.value }),
    ...(profileId.value === undefined ? {} : { profileId: profileId.value }),
    blockKeyword: blockKeyword.value,
    ...(type === 'ai.outbound_review'
      ? {
        parseMode: 'outbound_structured' as const,
        systemPrompt: typeof config.systemPrompt === 'string' && config.systemPrompt.trim()
          ? config.systemPrompt.trim()
          : workflowOutboundReviewSystemPrompt(),
        fallbackUserTemplate: typeof config.fallbackUserTemplate === 'string' && config.fallbackUserTemplate.trim()
          ? config.fallbackUserTemplate.trim()
          : workflowOutboundReviewUserTemplate(),
      }
      : { parseMode: 'block_keyword' as const }),
    eventStrings: context.strings,
    eventVariables: context.variables,
  });

  if (!preview.ok) {
    return {
      status: 'ok',
      blocked: true,
      blockReason: preview.reason,
      message: preview.reason,
    };
  }
  return { status: 'ok', port: 'default', message: 'preview_ai:ok' };
}

async function executeServerNode(
  trx: WorkspaceTransaction,
  doc: WorkflowGraphDocument,
  context: ServerWorkflowContext,
  node: WorkflowGraphNode,
  log: string[],
  now: Date,
  ports: ServerWorkflowRuntimePorts,
  dryRun: boolean,
): Promise<NodeResult> {
  if (node.type === 'trigger') return { status: 'ok', port: 'default' };
  if (node.type === 'condition') {
    const match = matchCondition(conditionFromNodeData(node.data), context.strings);
    const field = String(node.data.field ?? 'unknown');
    log.push(match ? `condition:${field}:yes` : `condition:${field}:no`);
    return { status: 'ok', port: match ? 'yes' : 'no' };
  }

  const type = nodeRuntimeType(node);
  const config = interpolateServerSchemaFields(type, nodeConfig(node), context);
  if (type === 'logic.stop' || type === 'stop') {
    return { status: 'ok', port: 'default', stop: true };
  }
  if (type === 'logic.merge' || type === 'logic.loop') {
    return { status: 'ok', port: 'default' };
  }
  if (type === 'logic.set_variable') {
    const name = String(config.name ?? 'var').trim() || 'var';
    if (name === SUBFLOW_DEPTH_VARIABLE) {
      return { status: 'error', port: 'error', message: `Variable ${name} ist reserviert` };
    }
    const value = config.value;
    return {
      status: 'ok',
      port: 'default',
      variables: {
        [name]: typeof value === 'boolean' || typeof value === 'number' ? value : String(value ?? ''),
      },
    };
  }
  if (type === 'logic.delay') {
    // Accept either delaySeconds (what the UI writes) or legacy minutes. When
    // both are present, delaySeconds wins; when neither is set, fall back to 5
    // minutes as before. boundedDelayMs caps the total delay.
    const totalMs = config.delaySeconds !== undefined
      ? boundedDelayMs(Number(config.delaySeconds ?? 60) * 1000)
      : boundedDelayMinutes(config.minutes) * 60_000;
    const resumeNodeId = String(config.resumeNodeId ?? '').trim()
      || resolveResumeNodeAfter(doc, node.id);
    if (!resumeNodeId) {
      return { status: 'error', port: 'error', message: 'Kein Folgeknoten fuer Resume' };
    }
    const executeAt = new Date(now.getTime() + totalMs);
    if (dryRun) {
      return dryRunSideEffectResult('logic.delay', log, {
        stop: true,
        deferred: true,
        message: `delayed_until:${executeAt.toISOString()}`,
        variables: { 'workflow.delayed_until': executeAt.toISOString() },
      });
    }
    const continuationContextError = workflowContinuationContextError(context);
    if (continuationContextError) {
      return { status: 'error', port: 'error', message: continuationContextError };
    }
    const delayedJobId = await scheduleWorkflowDelay(trx, context, {
      resumeNodeId,
      executeAt,
      now,
    });
    return {
      status: 'ok',
      port: 'default',
      stop: true,
      deferred: true,
      message: `delayed_until:${executeAt.toISOString()}`,
      variables: { 'workflow.delayed_job.id': delayedJobId, 'workflow.delayed_until': executeAt.toISOString() },
    };
  }
  if (type === 'logic.threshold') {
    const field = String(config.variable ?? 'ai.spam_score');
    const raw = context.variables[field];
    const num = typeof raw === 'number' ? raw : Number.parseFloat(String(raw ?? ''));
    if (!Number.isFinite(num)) {
      return { status: 'error', port: 'error', message: `Variable ${field} ist keine Zahl` };
    }
    const useGlobalThreshold = booleanConfig(config.useGlobalThreshold, 'useGlobalThreshold', false);
    if (!useGlobalThreshold.ok) return { status: 'error', port: 'error', message: useGlobalThreshold.message };
    const threshold = useGlobalThreshold.value
      ? await loadWorkflowSpamScoreThreshold(trx, context.workspaceId)
      : Number(config.value ?? 70);
    if (!Number.isFinite(threshold)) {
      return { status: 'error', port: 'error', message: 'Schwellwert ungueltig' };
    }
    const op = String(config.operator ?? 'gte') === 'lte' ? 'lte' : 'gte';
    const matched = op === 'gte' ? num >= threshold : num <= threshold;
    return { status: 'ok', port: matched ? 'yes' : 'no', variables: { 'threshold.matched': matched } };
  }
  if (type === 'logic.switch') {
    const field = String(config.field ?? 'ai.class');
    const raw = context.variables[field] != null
      ? String(context.variables[field])
      : context.strings[field] ?? '';
    const value = raw.trim().toLowerCase();
    const cases = String(config.cases ?? '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    return { status: 'ok', port: cases.includes(value) ? value : 'default' };
  }
  if (dryRun && context.previewOutbound) {
    if (type === 'ai.outbound_review') {
      if (context.direction !== 'outbound') {
        return { status: 'skipped', port: 'default', message: 'Nur fuer ausgehende Nachrichten' };
      }
      return executePreviewOutboundAiReview(ports, context, config, type);
    }
    if (type === 'ai.review' || type === 'ai_review') {
      return executePreviewOutboundAiReview(ports, context, config, type);
    }
  }
  if (dryRun) {
    const dryRunResult = dryRunMutatingNodeResult(type, config, node, log);
    if (dryRunResult) return dryRunResult;
  }
  if (type === 'ai.reply_suggestion') {
    const result = await scheduleAiReplySuggestionJob(trx, context, config, now);
    return result ?? { status: 'ok', port: 'default' };
  }
  if (type === 'ai.outbound_review') {
    if (context.direction !== 'outbound') {
      return { status: 'skipped', port: 'default', message: 'Nur fuer ausgehende Nachrichten' };
    }
    return await scheduleAiReviewJob(trx, doc, context, node, {
      ...config,
      blockKeyword: 'BLOCK',
      systemPrompt: workflowOutboundReviewSystemPrompt(),
      fallbackUserTemplate: workflowOutboundReviewUserTemplate(),
    }, now);
  }
  if (type === 'ai.review' || type === 'ai_review') {
    return await scheduleAiReviewJob(trx, doc, context, node, config, now);
  }
  if (type === 'ai.classify') {
    return await scheduleAiClassificationJob(trx, doc, context, node, config, now);
  }
  if (type === 'ai.transform_text') {
    return await scheduleAiTransformTextJob(trx, doc, context, node, config, now);
  }
  if (type === 'ai.agent') {
    const createDraft = booleanConfig(config.createDraft, 'createDraft', true);
    if (!createDraft.ok) return { status: 'error', port: 'error', message: createDraft.message };
    return await scheduleAiAgentJob(trx, doc, context, node, config, createDraft.value, now);
  }
  if (type === 'ai.pick_canned') {
    const createDraft = booleanConfig(config.createDraft, 'createDraft', true);
    if (!createDraft.ok) return { status: 'error', port: 'error', message: createDraft.message };
    return await scheduleAiPickCannedJob(trx, doc, context, node, config, createDraft.value, now);
  }
  if (type === 'ai.agent_tool') {
    return await executeWorkflowAgentTool(trx, context, config);
  }
  if (type === 'ai.spam_score') {
    return await workflowAiSpamScoreResult(trx, context, config);
  }
  if (type === 'email.hold_outbound' || type === 'hold_outbound') {
    const reason = String(config.reason ?? node.data.reason ?? '').trim()
      || 'Ausgehende Nachricht durch Workflow zurueckgestellt.';
    return {
      status: 'ok',
      port: 'blocked',
      blocked: true,
      blockReason: reason,
      message: reason,
    };
  }
  if (type === 'email.release_outbound') {
    if (dryRun) {
      return dryRunSideEffectResult('email.release_outbound', log, {
        message: 'dry_run:email.release_outbound',
      });
    }
    return await releaseWorkflowOutboundHold(trx, context, config, now);
  }
  if (type === 'email.send_draft') {
    if (dryRun) {
      return dryRunSideEffectResult('email.send_draft', log, { message: 'dry_run:email.send_draft' });
    }
    return await sendWorkflowDraft(trx, context, config, now);
  }
  if (type === 'email.tag' || type === 'tag') {
    const tag = String(config.tag ?? node.data.tag ?? '').trim();
    if (!tag) return { status: 'skipped', port: 'default', message: 'leerer Tag' };
    const result = await addWorkflowMessageTag(trx, context, tag, now);
    return result ?? { status: 'ok', port: 'default', variables: { 'email.last_tag': tag } };
  }
  if (type === 'email.set_category' || type === 'set_category') {
    // Prefer a stable category reference (source_sqlite_id from the dropdown) so
    // the workflow survives category renames; fall back to the path otherwise
    // (and when the referenced category was deleted).
    const categorySourceSqliteId = optionalPositiveIntegerConfig(config.categorySourceSqliteId, 'categorySourceSqliteId');
    if (!categorySourceSqliteId.ok) return { status: 'error', port: 'error', message: categorySourceSqliteId.message };
    if (categorySourceSqliteId.value !== undefined) {
      const byId = await setWorkflowMessageCategoryById(trx, context, categorySourceSqliteId.value, now);
      if (byId) return byId;
    }
    const path = String(config.path ?? '').trim();
    if (!path) return { status: 'skipped', port: 'default' };
    return await setWorkflowMessageCategoryPath(trx, context, path, now);
  }
  if (type === 'email.auto_reply') {
    return await evaluateWorkflowAutoReply(trx, context, config);
  }
  if (type === 'email.tag_attachment_meta' || type === 'tag_attachment_meta') {
    if (context.strings.has_attachments !== 'true') {
      return { status: 'skipped', port: 'default', message: 'keine Anhaenge' };
    }
    const tag = String(config.tag ?? node.data.tag ?? 'attachment').trim() || 'attachment';
    const result = await addWorkflowMessageTag(trx, context, tag, now);
    return result ?? { status: 'ok', port: 'default', variables: { 'email.last_tag': tag } };
  }
  if (type === 'email.create_draft') {
    return await createWorkflowComposeDraft(trx, context, config);
  }
  if (type === 'email.set_priority') {
    const level = String(config.level ?? 'normal').toLowerCase();
    const allowed = new Set(['hoch', 'high', 'normal', 'niedrig', 'low']);
    if (!allowed.has(level)) {
      return { status: 'error', port: 'error', message: 'level muss hoch, normal oder niedrig sein' };
    }
    const tag = level === 'hoch' || level === 'high'
      ? 'priority:hoch'
      : level === 'niedrig' || level === 'low'
        ? 'priority:niedrig'
        : 'priority:normal';
    const result = await addWorkflowMessageTag(trx, context, tag, now);
    return result ?? {
      status: 'ok',
      port: 'default',
      variables: { 'email.priority': tag, 'email.last_tag': tag },
    };
  }
  if (type === 'email.auth_check') {
    const protocol = authProtocolConfig(config.protocol);
    const value = String(context.variables[`auth.${protocol}`] ?? 'none').toLowerCase();
    const softfailAsFail = booleanConfig(config.treatSoftfailAsFail, 'treatSoftfailAsFail', true);
    if (!softfailAsFail.ok) return { status: 'error', port: 'error', message: softfailAsFail.message };
    const failSet = new Set([
      'fail',
      'permerror',
      ...(softfailAsFail.value ? ['softfail', 'policy'] : []),
    ]);
    const port = value === 'pass'
      ? 'pass'
      : failSet.has(value)
        ? 'fail'
        : value === 'none' || value === 'neutral' || value === 'skipped'
          ? 'none'
          : 'default';
    return { status: 'ok', port, variables: { [`auth.check.${protocol}`]: value } };
  }
  if (type === 'email.read_tracking_evidence') {
    return readWorkflowTrackingEvidence(trx, context);
  }
  if (type === 'email.sender_filter') {
    return await evaluateWorkflowSenderFilter(trx, context, config);
  }
  if (type === 'email.mark_seen' || type === 'mark_seen') {
    return await markWorkflowMessageSeen(trx, context, now, ports, log);
  }
  if (type === 'email.archive' || type === 'archive') {
    const result = await updateWorkflowMessage(trx, context, {
      archived: true,
      done_local: true,
      is_spam: false,
      spam_status: 'clean',
      updated_at: now,
    });
    return result ?? { status: 'ok', port: 'default', variables: { 'email.archived': true } };
  }
  if (type === 'email.set_spam_status') {
    const train = booleanConfig(config.train, 'train', false);
    if (!train.ok) return { status: 'error', port: 'error', message: train.message };
    const status = spamStatusConfig(config.status);
    const tag = String(config.tag ?? '').trim();
    return await setWorkflowSpamStatus(trx, context, status, tag, train.value, now);
  }
  if (type === 'email.mark_spam') {
    const train = booleanConfig(config.train, 'train', false);
    if (!train.ok) return { status: 'error', port: 'error', message: train.message };
    const spam = booleanConfig(config.spam, 'spam', true);
    if (!spam.ok) return { status: 'error', port: 'error', message: spam.message };
    const moveImap = booleanConfig(config.moveImap, 'moveImap', false);
    if (!moveImap.ok) return { status: 'error', port: 'error', message: moveImap.message };
    if (moveImap.value && spam.value) {
      const moveResult = await runWorkflowImapMoveAction(context, 'Spam', ports, log, 'email.mark_spam.move_imap', now);
      if (!moveResult.ok) return moveResult.node;
    }
    const tag = String(config.tag ?? 'auto-spam').trim();
    return await setWorkflowSpamStatus(trx, context, spam.value ? 'spam' : 'clean', tag, train.value, now);
  }
  if (type === 'email.move_imap') {
    return await moveWorkflowMessageOnImap(trx, context, config, now, ports, log);
  }
  if (type === 'email.delete_server') {
    return await deleteWorkflowMessageOnImap(trx, context, now, ports, log);
  }
  if (type === 'email.assign') {
    const raw = config.teamMemberId;
    const teamMemberId = raw === null || raw === undefined || raw === ''
      ? null
      : String(raw).trim();
    if (teamMemberId !== null && !teamMemberId) {
      return { status: 'error', port: 'error', message: 'teamMemberId leer' };
    }
    const result = await updateWorkflowMessage(trx, context, {
      assigned_to: teamMemberId,
      updated_at: now,
    });
    return result ?? { status: 'ok', port: 'default', variables: { 'email.assigned_to': teamMemberId } };
  }
  if (type === 'crm.create_task') {
    return await createWorkflowTask(trx, context, node, config, now);
  }
  if (type === 'crm.log_activity') {
    return await createWorkflowActivityLog(trx, context, node, config, now);
  }
  if (type === 'crm.update_deal') {
    return await updateWorkflowDeal(trx, context, node, config, now);
  }
  if (type === 'crm.link_customer' || type === 'link_customer') {
    return await linkWorkflowMessageCustomer(trx, context, now);
  }
  if (type === 'sync.run') {
    return await enqueueWorkflowSyncRun(trx, context, now);
  }
  if (type === 'email.forward_copy' || type === 'forward_copy') {
    return await scheduleWorkflowForwardCopyJob(trx, doc, context, node, config, now);
  }
  if (type === 'email.ingest_dmarc_report') {
    return await scheduleWorkflowDmarcIngestJob(trx, doc, context, node, config, now);
  }
  if (type === 'http.request') {
    return await scheduleWorkflowHttpRequestJob(trx, doc, context, node, config, now);
  }
  if (type === 'jtl.lookup') {
    return await executeWorkflowJtlLookup(trx, context, config);
  }
  if (type === 'mssql.query') {
    return await executeWorkflowMssqlQuery(context, config, ports.mssql);
  }
  if (type === 'jtl.order_context') {
    return await executeWorkflowJtlOrderContext(context, config, ports.mssql);
  }
  if (type === 'jtl.prepare_action') {
    return executeWorkflowJtlPrepareAction(context, config);
  }
  if (type === 'returns.evaluate') {
    return await evaluateWorkflowReturn(trx, context, config);
  }
  if (type === 'returns.offer_exchange') {
    return await applyWorkflowReturnOutcome(trx, context, config, 'exchange', now);
  }
  if (type === 'returns.offer_credit') {
    return await applyWorkflowReturnOutcome(trx, context, config, 'credit', now);
  }
  if (type === 'workflow.subflow') {
    return await enqueueWorkflowSubflow(trx, context, node, config, now);
  }

  return unsupportedWorkflowNodeResult(type, log);
}

async function readWorkflowTrackingEvidence(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
): Promise<NodeResult> {
  if (context.messageId === null) {
    return { status: 'error', port: 'error', message: 'Keine Nachricht fuer Versandstatus vorhanden' };
  }
  const tracking = await trx
    .selectFrom('email_tracking_messages')
    .select('id')
    .where('workspace_id', '=', context.workspaceId)
    .where('message_id', '=', context.messageId)
    .executeTakeFirst();
  if (!tracking) {
    return {
      status: 'ok',
      port: 'default',
      message: 'tracking_not_configured_for_message',
      variables: { ...emailEvidenceWorkflowVariables({ tracked: false, events: [] }) },
    };
  }
  const summary = await loadEmailEvidenceSummaryForTracking(trx, context.workspaceId, tracking.id);
  return {
    status: 'ok',
    port: 'default',
    variables: {
      ...emailEvidenceSummaryWorkflowVariables({
        tracked: true,
        summary,
      }),
    },
  };
}

async function markWorkflowMessageSeen(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  now: Date,
  ports: ServerWorkflowRuntimePorts,
  log: string[],
): Promise<NodeResult> {
  const localResult = await updateWorkflowMessage(trx, context, { seen_local: true, updated_at: now });
  if (localResult) return localResult;

  const variables: WorkflowVariableContext = { 'email.seen': true };
  if (ports.workflowImapActions && context.messageId !== null) {
    if (ports.deferredImapEffects) {
      ports.deferredImapEffects.push({
        kind: 'set_seen',
        workspaceId: context.workspaceId,
        messageId: context.messageId,
      });
    } else {
      const remoteResult = await ports.workflowImapActions.setSeen({
        workspaceId: context.workspaceId,
        messageId: context.messageId,
        seen: true,
      });
      if (remoteResult.ok) {
        variables['imap.seen_synced'] = true;
        variables['imap.source_folder'] = remoteResult.sourceFolderPath;
      } else {
        variables['imap.seen_synced'] = false;
        log.push(`imap_seen_sync_failed:${remoteResult.error}`);
      }
    }
  }

  return { status: 'ok', port: 'default', variables };
}

function unsupportedWorkflowNodeResult(type: string, log: string[]): NodeResult {
  const reason = `server_workflow_node_unsupported:${type}`;
  log.push(reason);
  return {
    status: 'skipped',
    port: 'blocked',
    blocked: true,
    blockReason: reason,
    message: reason,
  };
}

function dryRunMutatingNodeResult(
  type: string,
  config: Record<string, unknown>,
  node: WorkflowGraphNode,
  log: string[],
): NodeResult | null {
  switch (type) {
    case 'ai.reply_suggestion':
      return dryRunSideEffectResult(type, log, {
        variables: { 'reply_suggestion.status': 'dry_run' },
      });
    case 'ai.outbound_review':
    case 'ai.review':
    case 'ai_review':
      return dryRunAsyncContinuationResult(type, config, node, log, {
        'ai.review.status': 'dry_run',
      });
    case 'ai.classify':
      return dryRunAsyncContinuationResult(type, config, node, log, {
        'ai.classification.status': 'dry_run',
      });
    case 'ai.transform_text':
      return dryRunAsyncContinuationResult(type, config, node, log, {
        'ai.transform_text.status': 'dry_run',
      });
    case 'ai.agent':
      return dryRunAsyncContinuationResult(type, config, node, log, {
        'ai.agent.status': 'dry_run',
      });
    case 'email.tag':
    case 'tag': {
      const tag = String(config.tag ?? node.data.tag ?? '').trim();
      return tag
        ? dryRunSideEffectResult(type, log, { variables: { 'email.last_tag': tag } })
        : { status: 'skipped', port: 'default', message: 'leerer Tag' };
    }
    case 'email.set_category': {
      const path = String(config.path ?? '').trim();
      return path
        ? dryRunSideEffectResult(type, log, { variables: { 'email.category_path': path } })
        : { status: 'skipped', port: 'default' };
    }
    case 'email.tag_attachment_meta':
    case 'tag_attachment_meta': {
      const tag = String(config.tag ?? node.data.tag ?? 'attachment').trim() || 'attachment';
      return dryRunSideEffectResult(type, log, { variables: { 'email.last_tag': tag } });
    }
    case 'email.create_draft':
      return dryRunSideEffectResult(type, log, { variables: { 'draft.status': 'dry_run' } });
    case 'email.set_priority': {
      const level = String(config.level ?? 'normal').toLowerCase();
      const allowed = new Set(['hoch', 'high', 'normal', 'niedrig', 'low']);
      if (!allowed.has(level)) return { status: 'error', port: 'error', message: 'level muss hoch, normal oder niedrig sein' };
      const tag = level === 'hoch' || level === 'high'
        ? 'priority:hoch'
        : level === 'niedrig' || level === 'low'
          ? 'priority:niedrig'
          : 'priority:normal';
      return dryRunSideEffectResult(type, log, {
        variables: { 'email.priority': tag, 'email.last_tag': tag },
      });
    }
    case 'email.mark_seen':
    case 'mark_seen':
      return dryRunSideEffectResult(type, log, { variables: { 'email.seen': true } });
    case 'email.archive':
    case 'archive':
      return dryRunSideEffectResult(type, log, { variables: { 'email.archived': true } });
    case 'email.set_spam_status': {
      const status = spamStatusConfig(config.status);
      return dryRunSideEffectResult(type, log, {
        variables: { 'email.is_spam': status === 'spam', 'spam.status': status },
      });
    }
    case 'email.mark_spam': {
      const spam = booleanConfig(config.spam, 'spam', true);
      if (!spam.ok) return { status: 'error', port: 'error', message: spam.message };
      return dryRunSideEffectResult(type, log, {
        variables: { 'email.is_spam': spam.value, 'spam.status': spam.value ? 'spam' : 'clean' },
      });
    }
    case 'email.move_imap':
      return dryRunSideEffectResult(type, log, {
        variables: { 'imap.moved_to': String(config.folderPath ?? config.folder ?? config.targetFolderPath ?? 'Spam') },
      });
    case 'email.delete_server':
      return dryRunSideEffectResult(type, log, { variables: { 'imap.deleted': true } });
    case 'email.assign': {
      const raw = config.teamMemberId;
      const teamMemberId = raw === null || raw === undefined || raw === '' ? null : String(raw).trim();
      if (teamMemberId !== null && !teamMemberId) return { status: 'error', port: 'error', message: 'teamMemberId leer' };
      return dryRunSideEffectResult(type, log, { variables: { 'email.assigned_to': teamMemberId } });
    }
    case 'crm.create_task':
      return dryRunSideEffectResult(type, log, { variables: { 'task.status': 'dry_run' } });
    case 'crm.log_activity':
      return dryRunSideEffectResult(type, log, { variables: { 'activity_log.status': 'dry_run' } });
    case 'crm.update_deal':
      return dryRunSideEffectResult(type, log, { variables: { 'deal.status': 'dry_run' } });
    case 'crm.link_customer':
    case 'link_customer':
      return dryRunSideEffectResult(type, log, { variables: { 'customer.link_status': 'dry_run' } });
    case 'sync.run':
      return dryRunSideEffectResult(type, log, { variables: { 'sync.status': 'dry_run' } });
    case 'email.forward_copy':
    case 'forward_copy':
      return dryRunAsyncContinuationResult(type, config, node, log, {
        'forward_copy.status': 'dry_run',
      });
    case 'email.ingest_dmarc_report':
      return dryRunAsyncContinuationResult(type, config, node, log, {
        'dmarc.status': 'dry_run',
      });
    case 'http.request':
      return dryRunAsyncContinuationResult(type, config, node, log, {
        'http.status': 'dry_run',
      });
    case 'workflow.subflow':
      return dryRunSideEffectResult(type, log, { variables: { 'subflow.status': 'dry_run' } });
    // returns.evaluate is intentionally NOT listed: it is read-only and runs live
    // even in dry-run so the previewed routing port reflects the real decision.
    case 'returns.offer_exchange':
      return dryRunSideEffectResult(type, log, { variables: { 'returns.outcome': 'exchange' } });
    case 'returns.offer_credit':
      return dryRunSideEffectResult(type, log, { variables: { 'returns.outcome': 'credit' } });
    default:
      return null;
  }
}

function dryRunAsyncContinuationResult(
  type: string,
  config: Record<string, unknown>,
  node: WorkflowGraphNode,
  log: string[],
  variables: WorkflowVariableContext,
): NodeResult {
  const resumeNodeId = String(config.resumeNodeId ?? '').trim() || '';
  return dryRunSideEffectResult(type, log, {
    stop: Boolean(resumeNodeId),
    deferred: Boolean(resumeNodeId),
    variables: {
      ...variables,
      ...(resumeNodeId ? { 'workflow.resume_node_id': resumeNodeId } : {}),
      'workflow.node_id': node.id,
    },
  });
}

function dryRunSideEffectResult(
  type: string,
  log: string[],
  options: Partial<Pick<NodeResult, 'stop' | 'deferred' | 'message' | 'variables'>> = {},
): NodeResult {
  const message = options.message ?? `dry_run:${type}`;
  log.push(message);
  return {
    status: 'ok',
    port: 'default',
    message,
    ...(options.stop === undefined ? {} : { stop: options.stop }),
    ...(options.deferred === undefined ? {} : { deferred: options.deferred }),
    ...(options.variables === undefined ? {} : { variables: options.variables }),
  };
}

async function moveWorkflowMessageOnImap(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  config: Record<string, unknown>,
  now: Date,
  ports: ServerWorkflowRuntimePorts,
  log: string[],
): Promise<NodeResult> {
  const targetFolderPath = String(
    config.folderPath ?? config.folder ?? config.targetFolderPath ?? 'Spam',
  ).trim();
  if (!targetFolderPath) return { status: 'skipped', port: 'default', message: 'Zielordner leer' };

  const moveResult = await runWorkflowImapMoveAction(context, targetFolderPath, ports, log, 'email.move_imap', now);
  if (!moveResult.ok) return moveResult.node;

  if (!ports.deferredImapEffects) {
    const localResult = await applyWorkflowImapMoveLocalState(trx, context, targetFolderPath, now);
    if (localResult) return localResult;
  }

  return {
    status: 'ok',
    port: 'default',
    variables: {
      ...(moveResult.value.sourceFolderPath
        ? { 'imap.source_folder': moveResult.value.sourceFolderPath }
        : {}),
      'imap.moved_to': moveResult.value.targetFolderPath ?? targetFolderPath,
      'message.id': context.messageId,
    },
  };
}

async function deleteWorkflowMessageOnImap(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  now: Date,
  ports: ServerWorkflowRuntimePorts,
  log: string[],
): Promise<NodeResult> {
  if (context.messageId === null) {
    return { status: 'error', port: 'error', message: 'Keine Nachricht im Kontext' };
  }
  if (!ports.workflowImapActions) {
    return unsupportedWorkflowNodeResult('email.delete_server', log);
  }
  if (ports.deferredImapEffects) {
    ports.deferredImapEffects.push({
      kind: 'delete',
      workspaceId: context.workspaceId,
      messageId: context.messageId,
      context,
      now,
    });
    return {
      status: 'ok',
      port: 'default',
      variables: {
        'imap.deleted': true,
        'message.id': context.messageId,
      },
    };
  }

  const deleted = await ports.workflowImapActions.delete({
    workspaceId: context.workspaceId,
    messageId: context.messageId,
  });
  if (!deleted.ok) return { status: 'error', port: 'error', message: deleted.error };

  const localResult = await softDeleteWorkflowMessage(trx, context, now);
  if (localResult) return localResult;

  return {
    status: 'ok',
    port: 'default',
    variables: {
      'imap.source_folder': deleted.sourceFolderPath,
      'imap.deleted': true,
      'message.id': context.messageId,
    },
  };
}

async function runWorkflowImapMoveAction(
  context: ServerWorkflowContext,
  targetFolderPath: string,
  ports: ServerWorkflowRuntimePorts,
  log: string[],
  unsupportedType: string,
  now: Date,
): Promise<
  | { ok: true; value: ServerWorkflowImapActionResult & { ok: true } }
  | { ok: false; node: NodeResult }
> {
  if (context.messageId === null) {
    return { ok: false, node: { status: 'error', port: 'error', message: 'Keine Nachricht im Kontext' } };
  }
  if (!ports.workflowImapActions) {
    return { ok: false, node: unsupportedWorkflowNodeResult(unsupportedType, log) };
  }
  if (ports.deferredImapEffects) {
    ports.deferredImapEffects.push({
      kind: 'move',
      workspaceId: context.workspaceId,
      messageId: context.messageId,
      targetFolderPath,
      context,
      now,
    });
    return {
      ok: true,
      value: {
        ok: true,
        sourceFolderPath: '',
        targetFolderPath,
      },
    };
  }
  const result = await ports.workflowImapActions.move({
    workspaceId: context.workspaceId,
    messageId: context.messageId,
    targetFolderPath,
  });
  if (!result.ok) return { ok: false, node: { status: 'error', port: 'error', message: result.error } };
  return { ok: true, value: result };
}

async function flushDeferredWorkflowImapEffects(input: {
  effects: readonly DeferredWorkflowImapEffect[];
  db: Kysely<ServerDatabase>;
  workflowImapActions?: ServerWorkflowImapActionPort;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}): Promise<void> {
  if (!input.workflowImapActions || input.effects.length === 0) return;

  for (const effect of input.effects) {
    if (effect.kind === 'set_seen') {
      await input.workflowImapActions.setSeen({
        workspaceId: effect.workspaceId,
        messageId: effect.messageId,
        seen: true,
      });
      continue;
    }

    if (effect.kind === 'move') {
      const moved = await input.workflowImapActions.move({
        workspaceId: effect.workspaceId,
        messageId: effect.messageId,
        targetFolderPath: effect.targetFolderPath,
      });
      if (!moved.ok) continue;
      await withWorkspaceTransaction(
        input.db,
        { workspaceId: effect.workspaceId, role: 'system' },
        async (trx) => {
          await applyWorkflowImapMoveLocalState(trx, effect.context, effect.targetFolderPath, effect.now);
        },
        { applySession: input.applyWorkspaceSession },
      );
      continue;
    }

    const deleted = await input.workflowImapActions.delete({
      workspaceId: effect.workspaceId,
      messageId: effect.messageId,
    });
    if (!deleted.ok) continue;
    await withWorkspaceTransaction(
      input.db,
      { workspaceId: effect.workspaceId, role: 'system' },
      async (trx) => {
        await softDeleteWorkflowMessage(trx, effect.context, effect.now);
      },
      { applySession: input.applyWorkspaceSession },
    );
  }
}

async function applyWorkflowImapMoveLocalState(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  targetFolderPath: string,
  now: Date,
): Promise<NodeResult | null> {
  const normalized = normalizeMailboxName(targetFolderPath);
  if (new Set(['spam', 'junk', 'bulk', 'unwanted', 'ungewollt']).has(normalized)) {
    return updateWorkflowMessage(trx, context, workflowSpamStatusPatch('spam', 'inbox', now));
  }
  if (new Set(['archive', 'archives', 'archiv', 'all mail', 'all']).has(normalized)) {
    return updateWorkflowMessage(trx, context, {
      soft_deleted: false,
      archived: true,
      is_spam: false,
      spam_status: 'clean',
      done_local: true,
      trash_prev_archived: null,
      trash_prev_is_spam: null,
      trash_prev_folder_kind: null,
      updated_at: now,
    });
  }
  if (normalized === 'inbox' || normalized === 'posteingang') {
    return updateWorkflowMessage(trx, context, {
      soft_deleted: false,
      archived: false,
      is_spam: false,
      spam_status: 'clean',
      done_local: false,
      folder_kind: 'inbox',
      trash_prev_archived: null,
      trash_prev_is_spam: null,
      trash_prev_folder_kind: null,
      updated_at: now,
    });
  }
  if (isTrashMailboxName(targetFolderPath)) {
    return softDeleteWorkflowMessage(trx, context, now);
  }
  return updateWorkflowMessage(trx, context, { updated_at: now });
}

async function scheduleWorkflowDelay(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  input: { resumeNodeId: string; executeAt: Date; now: Date },
): Promise<number> {
  const delayedContext = workflowDelayContext(context, input.resumeNodeId);
  const delayedRow = await trx
    .insertInto('workflow_delayed_jobs')
    .values({
      workspace_id: context.workspaceId,
      source_sqlite_id: serverCreatedSourceSqliteId(
        'workflow_delayed_jobs',
        context.workspaceId,
        String(context.workflowSourceSqliteId),
        String(context.messageSourceSqliteId ?? context.messageId ?? 'none'),
        input.resumeNodeId,
        input.executeAt.toISOString(),
      ),
      workflow_source_sqlite_id: context.workflowSourceSqliteId,
      message_source_sqlite_id: context.messageSourceSqliteId,
      workflow_id: context.workflowId,
      message_id: context.messageId,
      resume_node_id: input.resumeNodeId,
      execute_at: input.executeAt,
      context_json: delayedContext,
      status: 'pending',
      source_row: serverWorkerSourceRow(),
      imported_in_run_id: null,
      created_at: input.now,
      updated_at: input.now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const delayedJobId = Number(delayedRow.id);

  await trx
    .insertInto('job_queue')
    .values({
      type: 'workflow.execute',
      payload: {
        workspaceId: context.workspaceId,
        workflowId: context.workflowId,
        ...workflowJobProvenance(context),
        ...(context.messageId === null ? {} : { messageId: context.messageId }),
        delayedJobId,
        triggerName: context.trigger,
        context: delayedContext,
      },
      run_after: input.executeAt,
      max_attempts: 3,
      workspace_id: context.workspaceId,
      updated_at: input.now,
    })
    .execute();

  return delayedJobId;
}

function workflowJobProvenance(context: ServerWorkflowContext): Record<string, unknown> {
  if (context.actorUserId) {
    // Propagate the manual-admin marker onto this run's delayed continuations and
    // side-effect children so the worker keeps re-verifying owner/admin across the
    // whole chain (a demoted admin must not complete a run they queued while admin).
    return {
      actorUserId: context.actorUserId,
      ...(context.manualAdminExecute ? { [MANUAL_ADMIN_WORKFLOW_EXECUTE_MARKER_FIELD]: true } : {}),
    };
  }
  return context.trustedService ? buildTrustedServiceJobPayload({}) : {};
}

// Provenance columns for a workflow-armed scheduled send. When the run has an
// initiating user (compose-originated), attribute the send to THAT user so the
// scheduled-send ticker re-verifies their CURRENT mail.send at send time — a
// delegate who lost mail.send after the workflow was queued is then denied
// (fail-closed) instead of the send going out under the system principal. Only
// automatic/inbound runs with no actor keep trusted-service (system) provenance.
function scheduledSendProvenanceColumns(context: ServerWorkflowContext): {
  scheduled_send_actor_user_id: string | null;
  scheduled_send_trusted_service_principal: string | null;
} {
  return context.actorUserId
    ? { scheduled_send_actor_user_id: context.actorUserId, scheduled_send_trusted_service_principal: null }
    : { scheduled_send_actor_user_id: null, scheduled_send_trusted_service_principal: TRUSTED_SERVICE_JOB_MARKER_VALUE };
}

async function scheduleAiReplySuggestionJob(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  config: Record<string, unknown>,
  now: Date,
): Promise<NodeResult | null> {
  if (context.messageId === null) {
    return { status: 'error', port: 'error', message: 'Keine Nachricht im Kontext' };
  }

  const promptId = optionalPositiveIntegerConfig(config.promptId, 'promptId');
  if (!promptId.ok) return { status: 'error', port: 'error', message: promptId.message };
  const profileId = optionalPositiveIntegerConfig(config.profileId, 'profileId');
  if (!profileId.ok) return { status: 'error', port: 'error', message: profileId.message };
  const force = booleanConfig(config.force, 'force', true);
  if (!force.ok) return { status: 'error', port: 'error', message: force.message };
  const skipIfReady = booleanConfig(config.skipIfReady, 'skipIfReady', true);
  if (!skipIfReady.ok) return { status: 'error', port: 'error', message: skipIfReady.message };
  const trigger = replySuggestionTriggerConfig(config.trigger);
  if (!trigger.ok) return { status: 'error', port: 'error', message: trigger.message };

  const payload: Record<string, unknown> = {
    workspaceId: context.workspaceId,
    messageId: context.messageId,
    ...workflowJobProvenance(context),
    force: force.value,
    skipIfReady: skipIfReady.value,
    trigger: trigger.value,
  };
  if (promptId.value !== undefined) payload.promptId = promptId.value;
  if (profileId.value !== undefined) payload.profileId = profileId.value;

  const jobRow = await trx
    .insertInto('job_queue')
    .values({
      type: 'ai.reply_suggestion',
      payload,
      run_after: now,
      max_attempts: 3,
      workspace_id: context.workspaceId,
      updated_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const jobId = Number(jobRow.id);

  return {
    status: 'ok',
    port: 'default',
    message: `queued_ai_reply_suggestion:${jobId}`,
    variables: {
      'reply_suggestion.status': 'pending',
      'reply_suggestion.job_id': jobId,
    },
  };
}

async function scheduleAiClassificationJob(
  trx: WorkspaceTransaction,
  doc: WorkflowGraphDocument,
  context: ServerWorkflowContext,
  node: WorkflowGraphNode,
  config: Record<string, unknown>,
  now: Date,
): Promise<NodeResult> {
  if (context.messageId === null) {
    return { status: 'error', port: 'error', message: 'Keine Nachricht im Kontext' };
  }

  const labels = workflowAiClassificationLabels(config.labels);
  if (labels.length === 0) return { status: 'skipped', port: 'default', message: 'keine Labels' };

  const profileId = optionalPositiveIntegerConfig(config.profileId, 'profileId');
  if (!profileId.ok) return { status: 'error', port: 'error', message: profileId.message };
  const contextMode = workflowAiClassificationContextMode(config.contextMode);
  if (!contextMode.ok) return { status: 'error', port: 'error', message: contextMode.message };

  const resumeNodeId = resolveResumeNodeAfter(doc, node.id);
  if (resumeNodeId) {
    const continuationContextError = workflowContinuationContextError(context);
    if (continuationContextError) {
      return { status: 'error', port: 'error', message: continuationContextError };
    }
  }
  const payload: Record<string, unknown> = {
    workspaceId: context.workspaceId,
    messageId: context.messageId,
    ...workflowJobProvenance(context),
    labels,
    contextMode: contextMode.value,
  };
  if (profileId.value !== undefined) payload.profileId = profileId.value;
  if (resumeNodeId) {
    payload.workflowId = context.workflowId;
    payload.resumeNodeId = resumeNodeId;
    payload.continuation = {
      workflowId: context.workflowId,
      triggerName: context.trigger,
      resumeNodeId,
      eventStrings: context.strings,
      eventVariables: context.variables,
    };
  }

  const jobRow = await trx
    .insertInto('job_queue')
    .values({
      type: 'ai.classify',
      payload,
      run_after: now,
      max_attempts: 3,
      workspace_id: context.workspaceId,
      updated_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const jobId = Number(jobRow.id);

  return {
    status: 'ok',
    port: 'default',
    stop: Boolean(resumeNodeId),
    deferred: Boolean(resumeNodeId),
    message: `queued_ai_classify:${jobId}`,
    variables: {
      'ai.classification.status': 'pending',
      'ai.classification.job_id': jobId,
    },
  };
}

async function scheduleAiReviewJob(
  trx: WorkspaceTransaction,
  doc: WorkflowGraphDocument,
  context: ServerWorkflowContext,
  node: WorkflowGraphNode,
  config: Record<string, unknown>,
  now: Date,
): Promise<NodeResult> {
  const continuationContextError = workflowContinuationContextError(context);
  if (continuationContextError) {
    return { status: 'error', port: 'error', message: continuationContextError };
  }
  const promptId = optionalPositiveIntegerConfig(config.promptId, 'promptId');
  if (!promptId.ok) return { status: 'error', port: 'error', message: promptId.message };
  const profileId = optionalPositiveIntegerConfig(config.profileId, 'profileId');
  if (!profileId.ok) return { status: 'error', port: 'error', message: profileId.message };
  const blockKeyword = workflowAiBlockKeyword(config.blockKeyword);
  if (!blockKeyword.ok) return { status: 'error', port: 'error', message: blockKeyword.message };

  const resumeNodeId = resolveResumeNodeAfter(doc, node.id);
  const payload: Record<string, unknown> = {
    workspaceId: context.workspaceId,
    direction: context.direction,
    ...workflowJobProvenance(context),
    blockKeyword: blockKeyword.value,
    eventStrings: context.strings,
    eventVariables: context.variables,
  };
  if (typeof config.systemPrompt === 'string' && config.systemPrompt.trim()) {
    payload.systemPrompt = config.systemPrompt.trim();
  }
  if (typeof config.fallbackUserTemplate === 'string' && config.fallbackUserTemplate.trim()) {
    payload.fallbackUserTemplate = config.fallbackUserTemplate.trim();
  }
  if (context.messageId !== null) payload.messageId = context.messageId;
  if (promptId.value !== undefined) payload.promptId = promptId.value;
  if (profileId.value !== undefined) payload.profileId = profileId.value;
  if (resumeNodeId) {
    payload.workflowId = context.workflowId;
    payload.resumeNodeId = resumeNodeId;
    payload.continuation = {
      workflowId: context.workflowId,
      triggerName: context.trigger,
      resumeNodeId,
      eventStrings: context.strings,
      eventVariables: context.variables,
    };
  }

  const jobRow = await trx
    .insertInto('job_queue')
    .values({
      type: 'ai.review',
      payload,
      run_after: now,
      max_attempts: 3,
      workspace_id: context.workspaceId,
      updated_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const jobId = Number(jobRow.id);

  return {
    status: 'ok',
    port: 'default',
    stop: Boolean(resumeNodeId),
    deferred: Boolean(resumeNodeId),
    message: `queued_ai_review:${jobId}`,
    variables: {
      'ai.review.status': 'pending',
      'ai.review.job_id': jobId,
    },
  };
}

async function scheduleAiTransformTextJob(
  trx: WorkspaceTransaction,
  doc: WorkflowGraphDocument,
  context: ServerWorkflowContext,
  node: WorkflowGraphNode,
  config: Record<string, unknown>,
  now: Date,
): Promise<NodeResult> {
  const continuationContextError = workflowContinuationContextError(context);
  if (continuationContextError) {
    return { status: 'error', port: 'error', message: continuationContextError };
  }
  const promptId = optionalPositiveIntegerConfig(config.promptId, 'promptId');
  if (!promptId.ok) return { status: 'error', port: 'error', message: promptId.message };
  const profileId = optionalPositiveIntegerConfig(config.profileId, 'profileId');
  if (!profileId.ok) return { status: 'error', port: 'error', message: profileId.message };
  const targetVariable = workflowAiTargetVariable(config.targetVariable);
  if (!targetVariable.ok) return { status: 'error', port: 'error', message: targetVariable.message };

  const resumeNodeId = resolveResumeNodeAfter(doc, node.id);
  const payload: Record<string, unknown> = {
    workspaceId: context.workspaceId,
    targetVariable: targetVariable.value,
    ...workflowJobProvenance(context),
    eventStrings: context.strings,
    eventVariables: context.variables,
  };
  if (context.messageId !== null) payload.messageId = context.messageId;
  if (promptId.value !== undefined) payload.promptId = promptId.value;
  if (profileId.value !== undefined) payload.profileId = profileId.value;
  if (resumeNodeId) {
    payload.workflowId = context.workflowId;
    payload.resumeNodeId = resumeNodeId;
    payload.continuation = {
      workflowId: context.workflowId,
      triggerName: context.trigger,
      resumeNodeId,
      eventStrings: context.strings,
      eventVariables: context.variables,
    };
  }

  const jobRow = await trx
    .insertInto('job_queue')
    .values({
      type: 'ai.transform_text',
      payload,
      run_after: now,
      max_attempts: 3,
      workspace_id: context.workspaceId,
      updated_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const jobId = Number(jobRow.id);

  return {
    status: 'ok',
    port: 'default',
    stop: Boolean(resumeNodeId),
    deferred: Boolean(resumeNodeId),
    message: `queued_ai_transform_text:${jobId}`,
    variables: {
      'ai.transform_text.status': 'pending',
      'ai.transform_text.job_id': jobId,
      'ai.transform_text.target': targetVariable.value,
    },
  };
}

async function scheduleAiAgentJob(
  trx: WorkspaceTransaction,
  doc: WorkflowGraphDocument,
  context: ServerWorkflowContext,
  node: WorkflowGraphNode,
  config: Record<string, unknown>,
  createDraft: boolean,
  now: Date,
): Promise<NodeResult> {
  const continuationContextError = workflowContinuationContextError(context);
  if (continuationContextError) {
    return { status: 'error', port: 'error', message: continuationContextError };
  }
  const profileId = optionalPositiveIntegerConfig(config.profileId, 'profileId');
  if (!profileId.ok) return { status: 'error', port: 'error', message: profileId.message };
  const knowledgeBaseId = optionalPositiveIntegerConfig(config.knowledgeBaseId, 'knowledgeBaseId');
  if (!knowledgeBaseId.ok) return { status: 'error', port: 'error', message: knowledgeBaseId.message };
  const systemPrompt = workflowAiSystemPrompt(config.systemPrompt);
  if (!systemPrompt.ok) return { status: 'error', port: 'error', message: systemPrompt.message };

  const resumeNodeId = resolveResumeNodeAfter(doc, node.id);
  const payload: Record<string, unknown> = {
    workspaceId: context.workspaceId,
    systemPrompt: systemPrompt.value,
    ...workflowJobProvenance(context),
    createDraft,
    eventStrings: context.strings,
    eventVariables: context.variables,
  };
  if (context.messageId !== null) payload.messageId = context.messageId;
  if (profileId.value !== undefined) payload.profileId = profileId.value;
  if (knowledgeBaseId.value !== undefined) {
    payload.knowledgeBaseId = knowledgeBaseId.value;
  } else {
    // No explicit knowledge base selected → honor the "Automatisch (passend
    // zur Richtung)" contract: resolve the account/direction knowledge bases.
    payload.autoKnowledge = true;
    payload.direction = context.direction;
  }
  if (resumeNodeId) {
    payload.workflowId = context.workflowId;
    payload.resumeNodeId = resumeNodeId;
    payload.continuation = {
      workflowId: context.workflowId,
      triggerName: context.trigger,
      resumeNodeId,
      eventStrings: context.strings,
      eventVariables: context.variables,
    };
  }

  const jobRow = await trx
    .insertInto('job_queue')
    .values({
      type: 'ai.agent',
      payload,
      run_after: now,
      max_attempts: 3,
      workspace_id: context.workspaceId,
      updated_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const jobId = Number(jobRow.id);

  return {
    status: 'ok',
    port: 'default',
    stop: Boolean(resumeNodeId),
    deferred: Boolean(resumeNodeId),
    message: `queued_ai_agent:${jobId}`,
    variables: {
      'ai.agent.status': 'pending',
      'ai.agent.job_id': jobId,
    },
  };
}

async function scheduleAiPickCannedJob(
  trx: WorkspaceTransaction,
  doc: WorkflowGraphDocument,
  context: ServerWorkflowContext,
  node: WorkflowGraphNode,
  config: Record<string, unknown>,
  createDraft: boolean,
  now: Date,
): Promise<NodeResult> {
  const continuationContextError = workflowContinuationContextError(context);
  if (continuationContextError) {
    return { status: 'error', port: 'error', message: continuationContextError };
  }
  const profileId = optionalPositiveIntegerConfig(config.profileId, 'profileId');
  if (!profileId.ok) return { status: 'error', port: 'error', message: profileId.message };

  const resumeNodeId = resolveResumeNodeAfter(doc, node.id);
  const payload: Record<string, unknown> = {
    workspaceId: context.workspaceId,
    ...workflowJobProvenance(context),
    createDraft,
    eventStrings: context.strings,
    eventVariables: context.variables,
  };
  if (context.messageId !== null) payload.messageId = context.messageId;
  if (profileId.value !== undefined) payload.profileId = profileId.value;
  if (resumeNodeId) {
    payload.workflowId = context.workflowId;
    payload.resumeNodeId = resumeNodeId;
    payload.continuation = {
      workflowId: context.workflowId,
      triggerName: context.trigger,
      resumeNodeId,
      eventStrings: context.strings,
      eventVariables: context.variables,
    };
  }

  const jobRow = await trx
    .insertInto('job_queue')
    .values({
      type: 'ai.pick_canned',
      payload,
      run_after: now,
      max_attempts: 3,
      workspace_id: context.workspaceId,
      updated_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const jobId = Number(jobRow.id);

  return {
    status: 'ok',
    port: 'default',
    stop: Boolean(resumeNodeId),
    deferred: Boolean(resumeNodeId),
    message: `queued_ai_pick_canned:${jobId}`,
    variables: {
      'ai.canned.status': 'pending',
      'ai.canned.job_id': jobId,
    },
  };
}

async function createWorkflowComposeDraft(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  config: Record<string, unknown>,
): Promise<NodeResult> {
  const accountId = positiveIntegerVariable(context.variables['email.account_id']);
  if (accountId === null) {
    return { status: 'error', port: 'error', message: 'Kein Konto fuer Entwurf' };
  }
  const prefix = typeof config.bodyPrefix === 'string' ? config.bodyPrefix : '';
  const body = [
    prefix.trim(),
    '---',
    context.strings.combined_text ?? '',
  ].filter((part) => part.length > 0).join('\n\n');
  const draft = await createPostgresComposeDraftInTransaction(trx, {
    workspaceId: context.workspaceId,
    accountId,
    values: {
      accountId,
      subject: replySubject(context.strings.subject),
      bodyText: body,
    },
  });
  if (!draft.ok) {
    return { status: 'error', port: 'error', message: `Entwurf konnte nicht erstellt werden: ${draft.reason}` };
  }
  return {
    status: 'ok',
    port: 'default',
    variables: { 'draft.id': draft.message.id },
  };
}

async function scheduleWorkflowHttpRequestJob(
  trx: WorkspaceTransaction,
  doc: WorkflowGraphDocument,
  context: ServerWorkflowContext,
  node: WorkflowGraphNode,
  config: Record<string, unknown>,
  now: Date,
): Promise<NodeResult> {
  const continuationContextError = workflowContinuationContextError(context);
  if (continuationContextError) {
    return { status: 'error', port: 'error', message: continuationContextError };
  }
  const url = workflowHttpUrl(config.url);
  if (!url.ok) return { status: 'error', port: 'error', message: url.message };
  if (!url.value) return { status: 'skipped', port: 'default', message: 'leere URL' };
  const method = workflowHttpMethod(config.method);
  if (!method.ok) return { status: 'error', port: 'error', message: method.message };
  const body = workflowHttpBody(config.body);
  if (!body.ok) return { status: 'error', port: 'error', message: body.message };
  const timeoutMs = workflowHttpTimeout(config.timeoutMs);
  if (!timeoutMs.ok) return { status: 'error', port: 'error', message: timeoutMs.message };

  const resumeNodeId = resolveHttpSuccessNodeAfter(doc, node.id);
  const errorResumeNodeId = resolveHttpErrorNodeAfter(doc, node.id);
  const payload: Record<string, unknown> = {
    workspaceId: context.workspaceId,
    method: method.value,
    ...workflowJobProvenance(context),
    url: url.value,
    timeoutMs: timeoutMs.value,
    eventStrings: context.strings,
    eventVariables: context.variables,
  };
  if (method.value === 'POST') {
    payload.idempotencyKey = workflowHttpIdempotencyKey(context, node.id);
  }
  if (method.value === 'POST' && body.value !== undefined) payload.body = body.value;
  if (context.messageId !== null) payload.messageId = context.messageId;
  if (resumeNodeId || errorResumeNodeId) {
    payload.workflowId = context.workflowId;
    if (resumeNodeId) payload.resumeNodeId = resumeNodeId;
    if (errorResumeNodeId) payload.errorResumeNodeId = errorResumeNodeId;
    payload.continuation = {
      workflowId: context.workflowId,
      triggerName: context.trigger,
      ...(resumeNodeId ? { resumeNodeId } : {}),
      ...(errorResumeNodeId ? { errorResumeNodeId } : {}),
      ...(!resumeNodeId && errorResumeNodeId ? { completeOnSuccess: true } : {}),
      eventStrings: context.strings,
      eventVariables: context.variables,
    };
  }

  const jobRow = await trx
    .insertInto('job_queue')
    .values({
      type: 'workflow.http_request',
      payload,
      run_after: now,
      max_attempts: 3,
      workspace_id: context.workspaceId,
      updated_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const jobId = Number(jobRow.id);

  return {
    status: 'ok',
    port: 'default',
    stop: Boolean(resumeNodeId || errorResumeNodeId),
    deferred: Boolean(resumeNodeId || errorResumeNodeId),
    message: `queued_http_request:${jobId}`,
    variables: {
      'http.status': 'pending',
      'http.job_id': jobId,
    },
  };
}

async function scheduleWorkflowForwardCopyJob(
  trx: WorkspaceTransaction,
  doc: WorkflowGraphDocument,
  context: ServerWorkflowContext,
  node: WorkflowGraphNode,
  config: Record<string, unknown>,
  now: Date,
): Promise<NodeResult> {
  if (context.messageId === null) {
    return { status: 'error', port: 'error', message: 'Keine Nachricht im Kontext' };
  }
  const continuationContextError = workflowContinuationContextError(context);
  if (continuationContextError) {
    return { status: 'error', port: 'error', message: continuationContextError };
  }
  const to = workflowForwardCopyRecipient(config.to);
  if (!to.ok) return { status: 'error', port: 'error', message: to.message };
  if (!to.value) return { status: 'skipped', port: 'default', message: 'Empfaenger fehlt' };

  const resumeNodeId = resolveResumeNodeAfter(doc, node.id);
  const payload: Record<string, unknown> = {
    workspaceId: context.workspaceId,
    workflowId: context.workflowId,
    messageId: context.messageId,
    ...workflowJobProvenance(context),
    to: to.value,
    includeAttachments: config.includeAttachments === true,
    runOutboundReview: config.runOutboundReview === true,
    eventStrings: context.strings,
    eventVariables: context.variables,
  };
  if (resumeNodeId) {
    payload.resumeNodeId = resumeNodeId;
    payload.continuation = {
      workflowId: context.workflowId,
      triggerName: context.trigger,
      resumeNodeId,
      eventStrings: context.strings,
      eventVariables: context.variables,
    };
  }

  const jobRow = await trx
    .insertInto('job_queue')
    .values({
      type: 'workflow.forward_copy',
      payload,
      run_after: now,
      max_attempts: 5,
      workspace_id: context.workspaceId,
      updated_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const jobId = Number(jobRow.id);

  return {
    status: 'ok',
    port: 'default',
    stop: Boolean(resumeNodeId),
    deferred: Boolean(resumeNodeId),
    message: `queued_forward_copy:${jobId}`,
    variables: {
      'forward_copy.status': 'pending',
      'forward_copy.job_id': jobId,
      'forward_copy.to': to.value,
    },
  };
}

async function scheduleWorkflowDmarcIngestJob(
  trx: WorkspaceTransaction,
  doc: WorkflowGraphDocument,
  context: ServerWorkflowContext,
  node: WorkflowGraphNode,
  config: Record<string, unknown>,
  now: Date,
): Promise<NodeResult> {
  if (context.messageId === null) {
    return { status: 'error', port: 'error', message: 'Keine Nachricht im Kontext' };
  }
  const attachmentNameFilter = String(config.attachmentNameFilter ?? '').trim();

  const resumeNodeId = resolveResumeNodeAfter(doc, node.id);
  if (resumeNodeId) {
    const continuationContextError = workflowContinuationContextError(context);
    if (continuationContextError) {
      return { status: 'error', port: 'error', message: continuationContextError };
    }
  }
  const payload: Record<string, unknown> = {
    workspaceId: context.workspaceId,
    workflowId: context.workflowId,
    messageId: context.messageId,
    ...workflowJobProvenance(context),
    ...(attachmentNameFilter ? { attachmentNameFilter } : {}),
  };
  if (resumeNodeId) {
    payload.resumeNodeId = resumeNodeId;
    payload.continuation = {
      workflowId: context.workflowId,
      triggerName: context.trigger,
      resumeNodeId,
      eventStrings: context.strings,
      eventVariables: context.variables,
    };
  }

  const jobRow = await trx
    .insertInto('job_queue')
    .values({
      type: 'workflow.dmarc_ingest',
      payload,
      run_after: now,
      max_attempts: 5,
      workspace_id: context.workspaceId,
      updated_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const jobId = Number(jobRow.id);

  return {
    status: 'ok',
    port: 'default',
    stop: Boolean(resumeNodeId),
    deferred: Boolean(resumeNodeId),
    message: `queued_dmarc_ingest:${jobId}`,
    variables: {
      'dmarc.status': 'pending',
      'dmarc.job_id': jobId,
    },
  };
}

async function evaluateWorkflowSenderFilter(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  config: Record<string, unknown>,
): Promise<NodeResult> {
  const useGlobalLists = booleanConfig(config.useGlobalLists, 'useGlobalLists', true);
  if (!useGlobalLists.ok) return { status: 'error', port: 'error', message: useGlobalLists.message };
  const useBuiltinTrusted = booleanConfig(config.useBuiltinTrusted, 'useBuiltinTrusted', true);
  if (!useBuiltinTrusted.ok) return { status: 'error', port: 'error', message: useBuiltinTrusted.message };

  const lists = useGlobalLists.value
    ? await loadWorkflowSenderLists(trx, context.workspaceId)
    : { whitelist: [], blacklist: [] };
  const result = evaluateSenderFilterFromLists(context.strings.from_address ?? '', {
    whitelist: lists.whitelist,
    blacklist: lists.blacklist,
    extraWhitelist: String(config.extraWhitelist ?? ''),
    extraBlacklist: String(config.extraBlacklist ?? ''),
    useBuiltinTrusted: useBuiltinTrusted.value,
  });

  return {
    status: 'ok',
    port: result,
    variables: { 'sender.filter': result },
  };
}

async function executeWorkflowAgentTool(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  config: Record<string, unknown>,
): Promise<NodeResult> {
  const tool = String(config.tool ?? 'echo');
  if (tool === 'search_knowledge') {
    const knowledgeBaseId = optionalPositiveIntegerConfig(config.knowledgeBaseId, 'knowledgeBaseId');
    if (!knowledgeBaseId.ok) return { status: 'error', port: 'error', message: knowledgeBaseId.message };
    if (!knowledgeBaseId.value) {
      return { status: 'skipped', port: 'default', message: 'Keine Wissensbasis' };
    }
    const chunks = await searchWorkflowKnowledgeChunks(
      trx,
      context.workspaceId,
      knowledgeBaseId.value,
      context.strings.combined_text ?? '',
      3,
    );
    return {
      status: 'ok',
      port: 'default',
      variables: { 'tool.result': chunks.map((chunk) => chunk.content).join('\n---\n').slice(0, 4000) },
    };
  }
  if (tool === 'get_canned') {
    const rows = await trx
      .selectFrom('email_canned_responses')
      .select(['title'])
      .where('workspace_id', '=', context.workspaceId)
      .orderBy('sort_order', 'asc')
      .orderBy('id', 'asc')
      .limit(5)
      .execute();
    return {
      status: 'ok',
      port: 'default',
      variables: { 'tool.result': rows.map((row) => String(row.title ?? '')).filter(Boolean).join(', ') },
    };
  }
  return {
    status: 'ok',
    port: 'default',
    variables: { 'tool.result': (context.strings.combined_text ?? '').slice(0, 500) },
  };
}

type WorkflowJtlEntity = 'firmen' | 'warenlager' | 'zahlungsarten' | 'versandarten';
type WorkflowJtlTableName = 'jtl_firmen' | 'jtl_warenlager' | 'jtl_zahlungsarten' | 'jtl_versandarten';

const WORKFLOW_JTL_TABLE_BY_ENTITY: Record<WorkflowJtlEntity, WorkflowJtlTableName> = {
  firmen: 'jtl_firmen',
  warenlager: 'jtl_warenlager',
  zahlungsarten: 'jtl_zahlungsarten',
  versandarten: 'jtl_versandarten',
};

const WORKFLOW_JTL_SELECT_COLUMNS = ['source_sqlite_id', 'name'] as const;

type WorkflowJtlLookupEntityConfig =
  | { ok: true; value: WorkflowJtlEntity }
  | { ok: false; message: string };

async function executeWorkflowJtlLookup(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  config: Record<string, unknown>,
): Promise<NodeResult> {
  const entity = workflowJtlLookupEntityConfig(config.entity);
  if (!entity.ok) return { status: 'error', port: 'error', message: entity.message };
  const sourceSqliteId = optionalSafeIntegerConfig(config.sourceSqliteId, 'sourceSqliteId');
  if (!sourceSqliteId.ok) return { status: 'error', port: 'error', message: sourceSqliteId.message };
  const limit = workflowJtlLookupLimit(config.limit);
  const search = String(config.search ?? config.query ?? '').trim();
  const tableName = WORKFLOW_JTL_TABLE_BY_ENTITY[entity.value];

  let query = trx
    .selectFrom(tableName)
    .select(WORKFLOW_JTL_SELECT_COLUMNS)
    .where('workspace_id', '=', context.workspaceId)
    .orderBy('source_sqlite_id', 'asc')
    .limit(limit);

  if (sourceSqliteId.value !== undefined) query = query.where('source_sqlite_id', '=', sourceSqliteId.value);
  if (search) query = query.where('name', 'ilike', `%${search}%`);

  const rows = await query.execute();
  const items = rows.map((row) => ({
    sourceSqliteId: Number(row.source_sqlite_id),
    name: row.name === null || row.name === undefined ? null : String(row.name),
  }));

  return {
    status: 'ok',
    port: 'default',
    variables: {
      'jtl.entity': entity.value,
      'jtl.row_count': items.length,
      'jtl.data': JSON.stringify(items).slice(0, WORKFLOW_JTL_LOOKUP_RESULT_LIMIT),
    },
  };
}

async function executeWorkflowMssqlQuery(
  context: ServerWorkflowContext,
  config: Record<string, unknown>,
  mssql: Pick<MssqlSettingsPort, 'executeReadOnlyQuery'> | undefined,
): Promise<NodeResult> {
  const query = String(config.sql ?? config.query ?? '').trim();
  if (!query) return { status: 'skipped', port: 'default', message: 'SQL leer' };
  const validation = validateReadOnlyMssqlQuery(query);
  if (!validation.ok) return { status: 'error', port: 'error', message: validation.error };
  if (!mssql) return { status: 'error', port: 'error', message: 'MSSQL-Port nicht konfiguriert' };

  const result = await mssql.executeReadOnlyQuery({
    workspaceId: context.workspaceId,
    query: validation.query,
  });
  if (!result.success) {
    return { status: 'error', port: 'error', message: result.error ?? 'MSSQL-Fehler' };
  }

  const rows = result.rows ?? [];
  return {
    status: 'ok',
    port: 'default',
    variables: {
      'mssql.rows': JSON.stringify(rows).slice(0, 8_000),
      'mssql.row_count': result.rowCount ?? rows.length,
    },
  };
}

const JTL_CONTEXT_EMAIL_RE = /^[^\s@'";\\]+@[^\s@'";\\]+\.[^\s@'";\\]+$/;
const JTL_CONTEXT_ORDER_NO_RE = /^[A-Za-z0-9._\-/]{1,64}$/;

/**
 * Convenience node that fetches a JTL/Wawi order context for the message sender.
 * The operator supplies a read-only query with {{email}} / {{orderNo}} placeholders
 * (bound from the sender address / a variable, strictly validated + SQL-escaped);
 * the first result row's columns are exposed as `jtl.<column>` variables for the
 * downstream KI nodes. No customer-specific schema is hard-coded — the SQL is
 * configured per deployment.
 */
async function executeWorkflowJtlOrderContext(
  context: ServerWorkflowContext,
  config: Record<string, unknown>,
  mssql: Pick<MssqlSettingsPort, 'executeReadOnlyQuery'> | undefined,
): Promise<NodeResult> {
  const template = String(config.query ?? config.sql ?? '').trim();
  if (!template) return { status: 'skipped', port: 'default', message: 'Keine JTL-Query konfiguriert' };
  if (!mssql) return { status: 'error', port: 'error', message: 'MSSQL-Port nicht konfiguriert' };

  const email = context.message ? extractWorkflowEmailAddress(context.message.from_json) : '';
  const orderNo = String(
    context.variables['jtl.order_no'] ?? context.strings.order_no ?? config.orderNo ?? '',
  ).trim();

  const bound = bindJtlContextPlaceholders(template, email, orderNo);
  if (!bound.ok) {
    return { status: 'skipped', port: 'no_match', message: bound.reason, variables: { 'jtl.context_found': false } };
  }
  const validation = validateReadOnlyMssqlQuery(bound.query);
  if (!validation.ok) return { status: 'error', port: 'error', message: validation.error };

  const result = await mssql.executeReadOnlyQuery({ workspaceId: context.workspaceId, query: validation.query });
  if (!result.success) return { status: 'error', port: 'error', message: result.error ?? 'MSSQL-Fehler' };

  const rows = result.rows ?? [];
  const first = rows[0];
  if (!first || typeof first !== 'object') {
    return { status: 'ok', port: 'no_match', message: 'Keine JTL-Daten gefunden', variables: { 'jtl.context_found': false } };
  }

  const mapping = parseJtlContextMapping(config.mapping);
  const variables: WorkflowVariableContext = { 'jtl.context_found': true };
  for (const [column, value] of Object.entries(first as Record<string, unknown>)) {
    const key = column.toLowerCase();
    variables[mapping[key] ?? `jtl.${key}`] = jtlContextScalar(value);
  }
  return { status: 'ok', port: 'default', variables };
}

function bindJtlContextPlaceholders(
  template: string,
  email: string,
  orderNo: string,
): { ok: true; query: string } | { ok: false; reason: string } {
  let query = template;
  if (query.includes('{{email}}')) {
    if (!email || !JTL_CONTEXT_EMAIL_RE.test(email)) {
      return { ok: false, reason: 'Keine gueltige Absender-E-Mail fuer {{email}}' };
    }
    query = query.replace(/\{\{email\}\}/g, sqlStringLiteral(email));
  }
  if (query.includes('{{orderNo}}')) {
    if (!orderNo || !JTL_CONTEXT_ORDER_NO_RE.test(orderNo)) {
      return { ok: false, reason: 'Keine gueltige Bestellnummer fuer {{orderNo}}' };
    }
    query = query.replace(/\{\{orderNo\}\}/g, sqlStringLiteral(orderNo));
  }
  return { ok: true, query };
}

function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

const JTL_ACTION_KINDS = new Set(['resend_invoice', 'create_return', 'send_tracking', 'refund_status', 'custom']);

/**
 * P2-11 (base): prepares a controlled JTL action proposal from the order context
 * WITHOUT executing it. It assembles an action descriptor (kind + payload from
 * the `jtl.*` context variables) and exposes it as `jtl.action.*` variables, then
 * routes to `needs_review` (default — human approval) or `approved`. Actually
 * performing the write in JTL (resend invoice / create return) is the documented
 * next step, gated behind approval + allowlist + rate-limit.
 */
function executeWorkflowJtlPrepareAction(
  context: ServerWorkflowContext,
  config: Record<string, unknown>,
): NodeResult {
  const kind = String(config.kind ?? '').trim().toLowerCase();
  if (!kind || !JTL_ACTION_KINDS.has(kind)) {
    return { status: 'error', port: 'error', message: `Unbekannte JTL-Aktion: ${kind || '(leer)'}` };
  }
  const email = context.message ? extractWorkflowEmailAddress(context.message.from_json) : '';
  const orderNo = String(context.variables['jtl.order_no'] ?? config.orderNo ?? '').trim();
  const tracking = String(context.variables['jtl.tracking'] ?? context.variables['jtl.tracking_number'] ?? '').trim();
  const payload = {
    kind,
    email: email || null,
    orderNo: orderNo || null,
    tracking: tracking || null,
    note: typeof config.note === 'string' ? config.note.slice(0, 500) : null,
  };
  const requireApproval = config.requireApproval !== false;
  return {
    status: 'ok',
    port: requireApproval ? 'needs_review' : 'approved',
    message: `jtl_action:prepared:${kind}`,
    variables: {
      'jtl.action.kind': kind,
      'jtl.action.payload': JSON.stringify(payload),
      'jtl.action.prepared': true,
    },
  };
}

// ---------------------------------------------------------------------------
// Returns / RMA workflow nodes (Phase 3)
//
// These operate on the workspace's OWN returns table — JTL is never written.
// A run resolves "its" return via (in order): config.returnId → the
// `returns.id` variable set by a prior node → the return linked to the
// triggering email (returns.email_message_id = context.messageId). When none
// is found the nodes route to the `no_return` port instead of failing, so a
// returns workflow placed on a generic inbox simply no-ops on unrelated mail.
// ---------------------------------------------------------------------------

type WorkflowReturnRow = Selectable<ReturnsTable>;
type WorkflowReturnItemRow = Selectable<ReturnItemsTable>;

const RETURN_OUTCOME_PORTS = new Set(['refund', 'exchange', 'credit', 'keep', 'needs_review']);
const RETURN_STATUS_VALUES = new Set<ReturnStatus>([
  'pending',
  'approved',
  'received',
  'refunded',
  'exchanged',
  'credited',
  'rejected',
  'cancelled',
]);

function resolveWorkflowReturnId(
  context: ServerWorkflowContext,
  config: Record<string, unknown>,
): { ok: true; returnId: number | null } | { ok: false; message: string } {
  const configured = optionalPositiveIntegerConfig(config.returnId, 'returnId');
  if (!configured.ok) return { ok: false, message: configured.message };
  if (configured.value !== undefined) return { ok: true, returnId: configured.value };
  const fromVar = positiveIntegerVariable(context.variables['returns.id']);
  return { ok: true, returnId: fromVar };
}

async function loadWorkflowReturn(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  config: Record<string, unknown>,
): Promise<
  | { ok: true; row: WorkflowReturnRow; items: WorkflowReturnItemRow[] }
  | { ok: true; row: null }
  | { ok: false; message: string }
> {
  const resolved = resolveWorkflowReturnId(context, config);
  if (!resolved.ok) return resolved;

  let row: WorkflowReturnRow | undefined;
  if (resolved.returnId !== null) {
    row = await trx
      .selectFrom('returns')
      .selectAll()
      .where('workspace_id', '=', context.workspaceId)
      .where('id', '=', resolved.returnId)
      .executeTakeFirst();
  } else if (context.messageId !== null) {
    row = await trx
      .selectFrom('returns')
      .selectAll()
      .where('workspace_id', '=', context.workspaceId)
      .where('email_message_id', '=', context.messageId)
      .orderBy('id', 'desc')
      .executeTakeFirst();
  }
  if (!row) return { ok: true, row: null };

  const items = await trx
    .selectFrom('return_items')
    .selectAll()
    .where('workspace_id', '=', context.workspaceId)
    .where('return_id', '=', Number(row.id))
    .orderBy('id', 'asc')
    .execute();
  return { ok: true, row, items };
}

function returnCsvSet(value: unknown, fallback: readonly string[]): Set<string> {
  if (typeof value !== 'string' || !value.trim()) return new Set(fallback);
  return new Set(
    value
      .split(',')
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean),
  );
}

function normalizeReturnOutcomePort(value: unknown, fallback: string): string {
  const normalized = String(value ?? '').trim().toLowerCase();
  return RETURN_OUTCOME_PORTS.has(normalized) ? normalized : fallback;
}

function normalizeReturnStatusConfig(value: unknown): ReturnStatus | null {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  return RETURN_STATUS_VALUES.has(normalized as ReturnStatus) ? (normalized as ReturnStatus) : null;
}

/**
 * Pure decision rules for `returns.evaluate`, factored out so the policy can be
 * unit-tested without a database. Precedence (fixed for safety):
 *   1. needs_review — any item condition in `reviewConditions` (default: damaged)
 *   2. exchange     — any item reason code in `exchangeReasonCodes`
 *                     (default: size_wrong, wrong_item)
 *   3. credit       — any item reason code in `creditReasonCodes` (default: none)
 *   4. default      — `defaultOutcome` (default: refund)
 * Conditions and reason codes are matched case-insensitively.
 */
export function decideWorkflowReturnOutcomePort(input: {
  itemConditions: readonly string[];
  itemReasonCodes: readonly string[];
  config: Record<string, unknown>;
}): string {
  const reviewConditions = returnCsvSet(input.config.reviewConditions, ['damaged']);
  const exchangeReasonCodes = returnCsvSet(input.config.exchangeReasonCodes, ['size_wrong', 'wrong_item']);
  const creditReasonCodes = returnCsvSet(input.config.creditReasonCodes, []);
  const defaultOutcome = normalizeReturnOutcomePort(input.config.defaultOutcome, 'refund');

  const conditions = input.itemConditions.map((cond) => cond.toLowerCase());
  const reasonCodes = input.itemReasonCodes.map((code) => code.toLowerCase());

  if (conditions.some((cond) => reviewConditions.has(cond))) return 'needs_review';
  if (reasonCodes.some((code) => exchangeReasonCodes.has(code))) return 'exchange';
  if (reasonCodes.some((code) => creditReasonCodes.has(code))) return 'credit';
  return defaultOutcome;
}

/**
 * returns.evaluate — read-only decision node. Suggests an outcome from the
 * return's items and routes to one of refund/exchange/credit/needs_review
 * (or no_return when no return is found). Wire each port to the matching
 * follow-up node. Rule precedence is fixed for safety:
 *   1. needs_review  — any item condition in `reviewConditions` (default: damaged)
 *   2. exchange      — any item reason code in `exchangeReasonCodes`
 *                      (default: size_wrong, wrong_item)
 *   3. credit        — any item reason code in `creditReasonCodes` (default: none)
 *   4. default       — `defaultOutcome` (default: refund)
 */
export async function evaluateWorkflowReturn(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  config: Record<string, unknown>,
): Promise<NodeResult> {
  const loaded = await loadWorkflowReturn(trx, context, config);
  if (!loaded.ok) return { status: 'error', port: 'error', message: loaded.message };
  if (loaded.row === null) {
    return {
      status: 'ok',
      port: 'no_return',
      message: 'Keine Retoure fuer diesen Lauf gefunden',
      variables: { 'returns.found': false },
    };
  }
  const { row, items } = loaded;

  const reasonIds = [...new Set(items.map((it) => it.reason_id).filter((id): id is number => id !== null))];
  const reasonCodeById = new Map<number, string>();
  if (reasonIds.length > 0) {
    const reasons = await trx
      .selectFrom('return_reasons')
      .select(['id', 'code'])
      .where('workspace_id', '=', context.workspaceId)
      .where('id', 'in', reasonIds)
      .execute();
    for (const reason of reasons) reasonCodeById.set(Number(reason.id), String(reason.code).toLowerCase());
  }
  const itemReasonCodes = new Set(
    items
      .map((it) => (it.reason_id !== null ? reasonCodeById.get(it.reason_id) : undefined))
      .filter((code): code is string => Boolean(code)),
  );
  const itemConditions = new Set(
    items
      .map((it) => it.condition)
      .filter((cond): cond is ReturnItemCondition => cond !== null)
      .map((cond) => cond.toLowerCase()),
  );

  const port = decideWorkflowReturnOutcomePort({
    itemConditions: [...itemConditions],
    itemReasonCodes: [...itemReasonCodes],
    config,
  });

  return {
    status: 'ok',
    port,
    message: `returns_evaluated:${row.return_number}:${port}`,
    variables: {
      'returns.found': true,
      'returns.id': Number(row.id),
      'returns.number': String(row.return_number),
      'returns.item_count': items.length,
      'returns.status': String(row.status),
      'returns.suggested_outcome': port,
    },
  };
}

/**
 * returns.offer_exchange / returns.offer_credit — set the linked return's
 * outcome (and optionally its status via config.status). Idempotent: a return
 * already at the target outcome/status is left untouched. Writes only to the
 * workspace's own returns table.
 */
export async function applyWorkflowReturnOutcome(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  config: Record<string, unknown>,
  outcome: Extract<ReturnOutcome, 'exchange' | 'credit'>,
  now: Date,
): Promise<NodeResult> {
  const loaded = await loadWorkflowReturn(trx, context, config);
  if (!loaded.ok) return { status: 'error', port: 'error', message: loaded.message };
  if (loaded.row === null) {
    return {
      status: 'skipped',
      port: 'no_return',
      message: 'Keine Retoure fuer diesen Lauf gefunden',
      variables: { 'returns.found': false },
    };
  }
  const { row } = loaded;
  const returnId = Number(row.id);

  if (config.status !== undefined && config.status !== '' && normalizeReturnStatusConfig(config.status) === null) {
    return { status: 'error', port: 'error', message: 'status ungueltig' };
  }
  const status = normalizeReturnStatusConfig(config.status);

  if (row.outcome === outcome && (status === null || row.status === status)) {
    return {
      status: 'ok',
      port: 'default',
      message: `returns_outcome_unchanged:${row.return_number}:${outcome}`,
      variables: { 'returns.found': true, 'returns.id': returnId, 'returns.outcome': outcome },
    };
  }

  const patch: { outcome: ReturnOutcome; updated_at: Date; status?: ReturnStatus } = {
    outcome,
    updated_at: now,
  };
  if (status !== null) patch.status = status;

  await trx
    .updateTable('returns')
    .set(patch)
    .where('workspace_id', '=', context.workspaceId)
    .where('id', '=', returnId)
    .execute();

  return {
    status: 'ok',
    port: 'default',
    message: `returns_outcome:${row.return_number}:${outcome}`,
    variables: {
      'returns.found': true,
      'returns.id': returnId,
      'returns.number': String(row.return_number),
      'returns.outcome': outcome,
      ...(status !== null ? { 'returns.status': status } : {}),
    },
  };
}

function parseJtlContextMapping(value: unknown): Record<string, string> {
  const mapping: Record<string, string> = {};
  if (typeof value !== 'string' || !value.trim()) return mapping;
  for (const pair of value.split(',')) {
    const [column, target] = pair.split(':').map((part) => part.trim());
    if (column && target) mapping[column.toLowerCase()] = target;
  }
  return mapping;
}

function jtlContextScalar(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  return String(value).slice(0, 2_000);
}

function workflowJtlLookupEntityConfig(value: unknown): WorkflowJtlLookupEntityConfig {
  const normalized = String(value ?? 'firmen').trim().toLowerCase();
  if (normalized === 'firma' || normalized === 'firmen' || normalized === 'jtl_firmen') {
    return { ok: true, value: 'firmen' };
  }
  if (normalized === 'warenlager' || normalized === 'lager' || normalized === 'jtl_warenlager') {
    return { ok: true, value: 'warenlager' };
  }
  if (normalized === 'zahlungsart' || normalized === 'zahlungsarten' || normalized === 'jtl_zahlungsarten') {
    return { ok: true, value: 'zahlungsarten' };
  }
  if (normalized === 'versandart' || normalized === 'versandarten' || normalized === 'jtl_versandarten') {
    return { ok: true, value: 'versandarten' };
  }
  return { ok: false, message: 'JTL-Entity muss firmen, warenlager, zahlungsarten oder versandarten sein' };
}

function workflowJtlLookupLimit(value: unknown): number {
  if (value === undefined || value === null || value === '') return 20;
  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isSafeInteger(parsed)) return 20;
  return Math.max(1, Math.min(MAX_WORKFLOW_JTL_LOOKUP_LIMIT, parsed));
}

async function loadWorkflowSenderLists(
  trx: WorkspaceTransaction,
  workspaceId: string,
): Promise<{ whitelist: string[]; blacklist: string[] }> {
  const [whitelistRow, blacklistRow, spamListRows] = await Promise.all([
    trx
      .selectFrom('sync_info')
      .select('value')
      .where('workspace_id', '=', workspaceId)
      .where('key', '=', WORKFLOW_SENDER_WHITELIST_KEY)
      .executeTakeFirst(),
    trx
      .selectFrom('sync_info')
      .select('value')
      .where('workspace_id', '=', workspaceId)
      .where('key', '=', WORKFLOW_SENDER_BLACKLIST_KEY)
      .executeTakeFirst(),
    trx
      .selectFrom('email_spam_list_entries')
      .select(['list_type', 'pattern'])
      .where('workspace_id', '=', workspaceId)
      .where('account_id', 'is', null)
      .execute(),
  ]);

  const whitelist = [
    ...parseSenderList(whitelistRow?.value),
    ...senderPatternsFromSpamList(spamListRows, 'allow'),
  ];
  const blacklist = [
    ...parseSenderList(blacklistRow?.value),
    ...senderPatternsFromSpamList(spamListRows, 'block'),
  ];

  return { whitelist, blacklist };
}

type WorkflowKnowledgeChunkMatch = {
  id: number;
  title: string | null;
  content: string;
};

async function searchWorkflowKnowledgeChunks(
  trx: WorkspaceTransaction,
  workspaceId: string,
  knowledgeBaseId: number,
  query: string,
  limit: number,
): Promise<WorkflowKnowledgeChunkMatch[]> {
  const rows = await trx
    .selectFrom('workflow_knowledge_chunks')
    .select(['id', 'title', 'content'])
    .where('workspace_id', '=', workspaceId)
    .where('knowledge_base_id', '=', knowledgeBaseId)
    .orderBy('id', 'desc')
    .limit(200)
    .execute();
  const chunks = rows.map((row) => ({
    id: Number(row.id),
    title: row.title === null || row.title === undefined ? null : String(row.title),
    content: String(row.content ?? ''),
  }));
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 2)
    .slice(0, 12);
  if (terms.length === 0) return chunks.slice(0, limit);
  const scored = chunks
    .map((chunk) => {
      const haystack = `${chunk.title ?? ''}\n${chunk.content}`.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (haystack.includes(term)) score += 1;
      }
      return { chunk, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
  return scored.slice(0, limit).map((item) => item.chunk);
}

async function loadWorkflowSpamScoreThreshold(
  trx: WorkspaceTransaction,
  workspaceId: string,
): Promise<number> {
  const row = await trx
    .selectFrom('sync_info')
    .select('value')
    .where('workspace_id', '=', workspaceId)
    .where('key', '=', WORKFLOW_SPAM_SCORE_THRESHOLD_KEY)
    .executeTakeFirst();
  return boundedWorkflowSpamScoreThreshold(row?.value);
}

async function loadAutoReplyEnabled(trx: WorkspaceTransaction, workspaceId: string): Promise<boolean> {
  const row = await trx
    .selectFrom('sync_info')
    .select('value')
    .where('workspace_id', '=', workspaceId)
    .where('key', '=', AUTO_REPLY_ENABLED_KEY)
    .executeTakeFirst();
  const value = String(row?.value ?? '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'on';
}

async function loadAutoReplyMaxPerSenderPerDay(
  trx: WorkspaceTransaction,
  workspaceId: string,
): Promise<number> {
  const row = await trx
    .selectFrom('sync_info')
    .select('value')
    .where('workspace_id', '=', workspaceId)
    .where('key', '=', AUTO_REPLY_MAX_PER_SENDER_PER_DAY_KEY)
    .executeTakeFirst();
  const parsed = Number(row?.value ?? '');
  if (!Number.isFinite(parsed) || parsed < 1) return AUTO_REPLY_MAX_PER_SENDER_DEFAULT;
  return Math.min(50, Math.floor(parsed));
}

/**
 * P1-4 auto-reply policy gate. Decides whether a message MAY be answered
 * automatically — all guards must pass: the workspace-level auto-reply switch is
 * on, the configured confidence variable meets the threshold, and the sender is
 * not an automated/no-reply address (anti-loop). It exposes the decision on the
 * `approved`/`blocked` ports and as `auto_reply.*` variables. It intentionally
 * does NOT send yet — wiring the actual SMTP send (behind a separate live flag +
 * rate-limit) is the documented next step, so enabling guards can never cause an
 * accidental send.
 */
async function evaluateWorkflowAutoReply(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  config: Record<string, unknown>,
): Promise<NodeResult> {
  const confidenceVar = String(config.confidenceVar ?? 'ai.class_confidence').trim() || 'ai.class_confidence';
  const minConfidence = Math.max(0, Math.min(100, Number(config.minConfidence ?? 70) || 70));
  const rawConfidence = context.variables[confidenceVar];
  const confidence = typeof rawConfidence === 'number' ? rawConfidence : Number.parseFloat(String(rawConfidence ?? ''));
  const confidenceValue = Number.isFinite(confidence) ? confidence : 0;
  const sender = context.message ? extractWorkflowEmailAddress(context.message.from_json) : '';

  const block = (reason: string): NodeResult => ({
    status: 'ok',
    port: 'blocked',
    message: `auto_reply:blocked:${reason}`,
    variables: { 'auto_reply.decision': 'blocked', 'auto_reply.blocked_reason': reason, 'auto_reply.confidence': confidenceValue },
  });

  if (!context.message) return block('no_message');
  if (!(await loadAutoReplyEnabled(trx, context.workspaceId))) return block('disabled');
  if (!sender || AUTO_REPLY_NOREPLY_RE.test(sender)) return block('noreply_sender');
  // Anti-Loop wie im Desktop-Gate: automatisch erzeugte Mails (RFC 3834:
  // Auto-Submitted/X-Auto-Response-Suppress/Precedence) und Newsletter
  // (List-Header) nie automatisch beantworten. Das atomare Tageslimit wird
  // erst beim Einplanen in email.send_draft reserviert, um TOCTOU-Races zu vermeiden.
  if (isUnsafeAutoReplyTarget(context.message.raw_headers)) return block('automated_sender');
  if (confidenceValue < minConfidence) return block('low_confidence');

  return {
    status: 'ok',
    port: 'approved',
    message: 'auto_reply:approved',
    variables: { 'auto_reply.decision': 'approved', 'auto_reply.confidence': confidenceValue },
  };
}

function boundedWorkflowSpamScoreThreshold(value: unknown): number {
  const parsed = Number(value ?? 70);
  if (!Number.isFinite(parsed)) return 70;
  return Math.max(1, Math.min(100, Math.floor(parsed)));
}

function senderPatternsFromSpamList(
  rows: Array<{ list_type: string; pattern: string | null }>,
  listType: 'allow' | 'block',
): string[] {
  return rows
    .filter((row) => row.list_type === listType)
    .map((row) => String(row.pattern ?? '').trim().toLowerCase())
    .filter(Boolean);
}

async function workflowAiSpamScoreResult(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  config: Record<string, unknown>,
): Promise<NodeResult> {
  const score = numericVariable(context.variables['spam.score']);
  const mode = String(config.contextMode ?? 'stored').trim() || 'stored';
  if (score !== null) {
    return {
      status: 'ok',
      port: 'default',
      variables: {
        'ai.spam_score': score,
        'ai.spam_context': `stored:${mode}`,
      },
    };
  }
  if (!context.message) {
    return { status: 'error', port: 'error', message: 'Kein gespeicherter Spam-Score' };
  }

  const input = workflowSpamDecisionInputFromMessage(context.message);
  const preview = buildFeaturePreview(input);
  const [settings, listMatch, featureStats] = await Promise.all([
    loadWorkflowSpamEngineSettings(trx, context.workspaceId),
    selectWorkflowSpamListMatch(trx, context.workspaceId, context.message),
    loadWorkflowSpamFeatureStatsForKeys(trx, context.workspaceId, preview.featureKeys),
  ]);
  const decision = buildSpamDecision(input, { settings, listMatch, featureStats });
  const firstReason = decision.reasons[0];
  const variables: WorkflowVariableContext = {
    'ai.spam_score': decision.score,
    'ai.spam_context': `computed:${mode}`,
    'spam.score': decision.score,
    'spam.status': decision.status,
    'spam.label': decision.status,
    'spam.recommendation': decision.status,
    'spam.source': decision.source,
    'spam.decision_source': decision.source,
    'spam.model_version': decision.modelVersion,
    'spam.feature_keys': decision.featureKeys.join(','),
    'spam.score_breakdown': JSON.stringify(decision),
  };
  if (decision.listMatch) variables['spam.list_match'] = decision.listMatch.listType;
  if (firstReason?.label) variables['spam.top_reason'] = firstReason.label;
  return {
    status: 'ok',
    port: 'default',
    variables,
  };
}

function workflowSpamDecisionInputFromMessage(message: MessageRow): SpamDecisionMessageInput {
  return {
    fromJson: message.from_json,
    subject: message.subject,
    snippet: message.snippet,
    bodyText: message.body_text,
    bodyHtml: message.body_html,
    authSpf: message.auth_spf,
    authDkim: message.auth_dkim,
    authDmarc: message.auth_dmarc,
    authArc: message.auth_arc,
    attachmentsJson: message.attachments_json,
    hasAttachments: Boolean(message.has_attachments),
    rspamdScore: finiteNumber(message.rspamd_score),
    rspamdAction: message.rspamd_action,
  };
}

async function loadWorkflowSpamEngineSettings(
  trx: WorkspaceTransaction,
  workspaceId: string,
): Promise<SpamEngineSettings> {
  const keys = [
    'mail_security_rspamd_enabled',
    'mail_security_spam_engine_enabled',
    'mail_security_spam_review_threshold',
    'mail_security_spam_spam_threshold',
    'mail_security_spam_local_learning_enabled',
    'mail_security_spam_rspamd_contribution_enabled',
  ] as const;
  const rows = await trx
    .selectFrom('sync_info')
    .select(['key', 'value'])
    .where('workspace_id', '=', workspaceId)
    .where('key', 'in', [...keys])
    .execute();
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const rspamdEnabled = workflowSyncInfoFlag(values.get('mail_security_rspamd_enabled'), false);
  const review = workflowSyncInfoBoundedInt(values.get('mail_security_spam_review_threshold'), 45, 0, 100);
  const spam = Math.max(
    review,
    workflowSyncInfoBoundedInt(values.get('mail_security_spam_spam_threshold'), 75, 0, 100),
  );
  return {
    spamEngineEnabled: workflowSyncInfoFlag(values.get('mail_security_spam_engine_enabled'), true),
    spamReviewThreshold: review,
    spamSpamThreshold: spam,
    localLearningEnabled: workflowSyncInfoFlag(values.get('mail_security_spam_local_learning_enabled'), true),
    rspamdContributionEnabled: workflowSyncInfoFlag(
      values.get('mail_security_spam_rspamd_contribution_enabled'),
      rspamdEnabled,
    ),
  };
}

async function selectWorkflowSpamListMatch(
  trx: WorkspaceTransaction,
  workspaceId: string,
  message: MessageRow,
): Promise<SpamListMatch | null> {
  const senderEmail = extractWorkflowEmailAddress(message.from_json);
  const senderDomain = senderEmail ? workflowDomainOf(senderEmail) : '';
  if (!senderEmail && !senderDomain) return null;
  const rows = await trx
    .selectFrom('email_spam_list_entries')
    .select(['list_type', 'pattern_type', 'pattern', 'account_id'])
    .where('workspace_id', '=', workspaceId)
    .execute();
  let bestAllow: SpamListMatch | null = null;
  let bestBlock: SpamListMatch | null = null;
  const messageAccountId = message.account_id === null || message.account_id === undefined
    ? null
    : Number(message.account_id);
  for (const row of rows) {
    const rowAccountId = row.account_id === null || row.account_id === undefined
      ? null
      : Number(row.account_id);
    if (rowAccountId !== null && rowAccountId !== messageAccountId) continue;
    const listType = workflowSpamListType(row.list_type);
    const patternType = workflowSpamPatternType(row.pattern_type);
    const pattern = String(row.pattern ?? '').trim().toLowerCase();
    if (!listType || !patternType || !pattern) continue;
    const specificity = workflowSpamListEntrySpecificity(patternType, pattern, senderEmail, senderDomain);
    if (specificity <= 0) continue;
    const match: SpamListMatch = { listType, patternType, pattern, specificity };
    if (listType === 'allow') {
      if (!bestAllow || specificity > bestAllow.specificity) bestAllow = match;
    } else if (!bestBlock || specificity > bestBlock.specificity) {
      bestBlock = match;
    }
  }
  return bestAllow ?? bestBlock;
}

async function loadWorkflowSpamFeatureStatsForKeys(
  trx: WorkspaceTransaction,
  workspaceId: string,
  featureKeys: readonly string[],
): Promise<Map<string, SpamFeatureStatInput>> {
  const out = new Map<string, SpamFeatureStatInput>();
  const keys = [...new Set(featureKeys)];
  if (keys.length === 0) return out;
  const rows = await trx
    .selectFrom('email_spam_feature_stats')
    .select(['feature_key', 'spam_count', 'ham_count'])
    .where('workspace_id', '=', workspaceId)
    .where('feature_key', 'in', keys)
    .execute();
  for (const row of rows) {
    const featureKey = String(row.feature_key ?? '');
    if (!featureKey) continue;
    out.set(featureKey, {
      feature_key: featureKey,
      spam_count: Number(row.spam_count ?? 0),
      ham_count: Number(row.ham_count ?? 0),
    });
  }
  return out;
}

function workflowSyncInfoFlag(value: string | null | undefined, defaultOn: boolean): boolean {
  if (value == null || value === '') return defaultOn;
  const normalized = value.toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function workflowSyncInfoBoundedInt(
  value: string | null | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function workflowSpamListEntrySpecificity(
  patternType: 'email' | 'domain',
  pattern: string,
  senderEmail: string,
  domain: string,
): number {
  if (patternType === 'email') return senderEmail === pattern ? 100 : 0;
  if (domain === pattern) return 80;
  if (domain.endsWith(`.${pattern}`)) return 60;
  return 0;
}

function workflowSpamListType(value: unknown): 'allow' | 'block' | null {
  return value === 'allow' || value === 'block' ? value : null;
}

function workflowSpamPatternType(value: unknown): 'email' | 'domain' | null {
  return value === 'email' || value === 'domain' ? value : null;
}

/** Best-effort flatten of stored to_json/cc_json/bcc_json into a comma-joined
 *  address list, for the outbound-approval fingerprint (which compares against
 *  the same shape on the review side). addressesFromRecipientJson expects a
 *  JSON *string*, not a parsed object — jsonb columns typically come back as
 *  objects from kysely, so we re-stringify when needed. Passing a parsed object
 *  through caused JSON.parse to throw inside the helper, which then returned
 *  '' and broke the outbound auto-send approval marker (fingerprint mismatch). */
function addressesFromStoredRecipientJson(value: unknown): string {
  if (!value) return '';
  try {
    const asString = typeof value === 'string' ? value : JSON.stringify(value);
    return addressesFromRecipientJson(asString);
  } catch {
    return '';
  }
}

/** Pull the attachment-paths list out of draft_attachment_paths_json (a stored
 *  string[] or null). Returns [] on any parse trouble. */
function draftAttachmentPathsFromJson(value: unknown): readonly string[] {
  if (!value) return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
  } catch {
    return [];
  }
}

function extractWorkflowEmailAddress(value: unknown): string {
  const candidate = extractWorkflowEmailAddressCandidate(value);
  if (!candidate) return '';
  const match = candidate.match(/<([^>]+)>/);
  return normalizeEmailAddress(match ? match[1] : candidate);
}

function extractWorkflowEmailAddressCandidate(value: unknown): string {
  if (typeof value === 'string') {
    try {
      return extractWorkflowEmailAddressCandidate(JSON.parse(value));
    } catch {
      return value;
    }
  }
  if (!value || typeof value !== 'object') return '';
  if (Array.isArray(value)) return extractWorkflowEmailAddressCandidate(value[0]);
  const record = value as Record<string, unknown>;
  if (typeof record.address === 'string') return record.address;
  if (Array.isArray(record.value)) return extractWorkflowEmailAddressCandidate(record.value[0]);
  return '';
}

function workflowDomainOf(email: string): string {
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1) : email;
}

function numericVariable(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveIntegerVariable(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

type OptionalPositiveIntegerConfig =
  | { ok: true; value: number | undefined }
  | { ok: false; message: string };

function optionalPositiveIntegerConfig(value: unknown, field: string): OptionalPositiveIntegerConfig {
  if (value === undefined || value === null || value === '') return { ok: true, value: undefined };
  if (typeof value !== 'number' && typeof value !== 'string') {
    return { ok: false, message: `${field} ungueltig` };
  }
  const parsed = typeof value === 'number' ? value : Number(value.trim());
  if (parsed === 0) return { ok: true, value: undefined };
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return { ok: false, message: `${field} ungueltig` };
  }
  return { ok: true, value: parsed };
}

type OptionalSafeIntegerConfig =
  | { ok: true; value: number | undefined }
  | { ok: false; message: string };

function optionalSafeIntegerConfig(value: unknown, field: string): OptionalSafeIntegerConfig {
  if (value === undefined || value === null || value === '') return { ok: true, value: undefined };
  if (typeof value !== 'number' && typeof value !== 'string') {
    return { ok: false, message: `${field} ungueltig` };
  }
  const parsed = typeof value === 'number' ? value : Number(value.trim());
  if (!Number.isSafeInteger(parsed) || parsed === 0) {
    return { ok: false, message: `${field} ungueltig` };
  }
  return { ok: true, value: parsed };
}

type BooleanConfig =
  | { ok: true; value: boolean }
  | { ok: false; message: string };

function booleanConfig(value: unknown, field: string, fallback: boolean): BooleanConfig {
  if (value === undefined || value === null || value === '') return { ok: true, value: fallback };
  if (typeof value === 'boolean') return { ok: true, value };
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return { ok: true, value: true };
    if (normalized === 'false' || normalized === '0') return { ok: true, value: false };
  }
  return { ok: false, message: `${field} muss boolean sein` };
}

type ReplySuggestionTriggerConfig =
  | { ok: true; value: 'inbound' | 'open' }
  | { ok: false; message: string };

function replySuggestionTriggerConfig(value: unknown): ReplySuggestionTriggerConfig {
  if (value === undefined || value === null || value === '') return { ok: true, value: 'inbound' };
  if (value === 'inbound' || value === 'open') return { ok: true, value };
  return { ok: false, message: 'trigger muss inbound oder open sein' };
}

function workflowAiClassificationLabels(value: unknown): readonly string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  return raw
    .map((item) => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean)
    .slice(0, 20)
    .map((item) => item.slice(0, 80));
}

type AiClassificationContextModeConfig =
  | { ok: true; value: 'metadata' | 'full' }
  | { ok: false; message: string };

function workflowAiClassificationContextMode(value: unknown): AiClassificationContextModeConfig {
  if (value === undefined || value === null || value === '') return { ok: true, value: 'metadata' };
  if (value === 'metadata' || value === 'full') return { ok: true, value };
  return { ok: false, message: 'contextMode muss metadata oder full sein' };
}

type WorkflowAiTargetVariableConfig =
  | { ok: true; value: string }
  | { ok: false; message: string };

function workflowAiTargetVariable(value: unknown): WorkflowAiTargetVariableConfig {
  if (value === undefined || value === null || value === '') return { ok: true, value: 'ai.text' };
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, message: 'targetVariable muss Text sein' };
  }
  const trimmed = value.trim();
  if (trimmed.length > 120) return { ok: false, message: 'targetVariable zu lang' };
  return { ok: true, value: trimmed };
}

function workflowAiBlockKeyword(value: unknown): WorkflowAiTargetVariableConfig {
  if (value === undefined || value === null || value === '') return { ok: true, value: 'BLOCK' };
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, message: 'blockKeyword muss Text sein' };
  }
  const trimmed = value.trim();
  if (trimmed.length > 120) return { ok: false, message: 'blockKeyword zu lang' };
  return { ok: true, value: trimmed };
}

function workflowAiSystemPrompt(value: unknown): WorkflowAiTargetVariableConfig {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: 'Du bist ein CRM-Assistent. Nutze die Wissensbasis. Antworte kurz.' };
  }
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, message: 'systemPrompt muss Text sein' };
  }
  const trimmed = value.trim();
  if (trimmed.length > 4000) return { ok: false, message: 'systemPrompt zu lang' };
  return { ok: true, value: trimmed };
}

type WorkflowHttpMethodConfig =
  | { ok: true; value: 'GET' | 'POST' }
  | { ok: false; message: string };

type WorkflowForwardCopyRecipientConfig =
  | { ok: true; value: string }
  | { ok: false; message: string };

const MAX_FORWARD_COPY_RECIPIENTS = 10;

/** Parses one or more comma/semicolon-separated forward recipients, validates
 *  each, and returns them as a normalized comma-joined string. */
function workflowForwardCopyRecipient(value: unknown): WorkflowForwardCopyRecipientConfig {
  if (value === undefined || value === null) return { ok: true, value: '' };
  if (typeof value !== 'string') return { ok: false, message: 'Forward-Empfaenger muss Text sein' };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: '' };
  if (trimmed.length > 1000) return { ok: false, message: 'Forward-Empfaenger zu lang' };
  const parts = trimmed.split(/[,;]+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return { ok: true, value: '' };
  if (parts.length > MAX_FORWARD_COPY_RECIPIENTS) {
    return { ok: false, message: `Maximal ${MAX_FORWARD_COPY_RECIPIENTS} Forward-Empfaenger` };
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const angleMatch = /<([^<>]+)>\s*$/.exec(part);
    const address = emailAddressForDelivery(angleMatch?.[1] ?? part);
    if (!isSimpleWorkflowEmailAddress(address)) {
      return { ok: false, message: `Forward-Empfaenger ist ungueltig: ${part}` };
    }
    const identity = address.toLowerCase();
    if (!seen.has(identity)) {
      normalized.push(address);
      seen.add(identity);
    }
  }
  return { ok: true, value: normalized.join(',') };
}

function isSimpleWorkflowEmailAddress(value: string): boolean {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
}

function workflowHttpMethod(value: unknown): WorkflowHttpMethodConfig {
  if (value === undefined || value === null || value === '') return { ok: true, value: 'GET' };
  if (typeof value !== 'string') return { ok: false, message: 'HTTP-Methode muss GET oder POST sein' };
  const normalized = value.trim().toUpperCase();
  if (normalized === 'GET' || normalized === 'POST') return { ok: true, value: normalized };
  return { ok: false, message: 'HTTP-Methode muss GET oder POST sein' };
}

type WorkflowHttpUrlConfig =
  | { ok: true; value: string }
  | { ok: false; message: string };

function workflowHttpUrl(value: unknown): WorkflowHttpUrlConfig {
  if (value === undefined || value === null) return { ok: true, value: '' };
  if (typeof value !== 'string') return { ok: false, message: 'HTTP-URL muss Text sein' };
  const trimmed = value.trim();
  if (trimmed.length > 2048) return { ok: false, message: 'HTTP-URL zu lang' };
  return { ok: true, value: trimmed };
}

type WorkflowHttpBodyConfig =
  | { ok: true; value: string | undefined }
  | { ok: false; message: string };

function workflowHttpBody(value: unknown): WorkflowHttpBodyConfig {
  if (value === undefined || value === null || value === '') return { ok: true, value: undefined };
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  if (body.length > 128 * 1024) return { ok: false, message: 'HTTP-Body zu lang' };
  return { ok: true, value: body };
}

type WorkflowHttpTimeoutConfig =
  | { ok: true; value: number }
  | { ok: false; message: string };

function workflowHttpTimeout(value: unknown): WorkflowHttpTimeoutConfig {
  if (value === undefined || value === null || value === '') return { ok: true, value: 30_000 };
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1000 || parsed > 60_000) {
    return { ok: false, message: 'HTTP-Timeout muss zwischen 1000 und 60000 ms liegen' };
  }
  return { ok: true, value: parsed };
}

function workflowOutboundReviewSystemPrompt(): string {
  return [
    'Du bist Qualitaetspruefer fuer ausgehende Kunden-E-Mails.',
    'Antworte NUR in diesem Format:',
    'STATUS: OK',
    'oder',
    'STATUS: BLOCK',
    'REASON: Kurze deutsche Begruendung fuer den Nutzer',
    'CODE: optionaler_code',
  ].join('\n');
}

function workflowOutboundReviewUserTemplate(): string {
  return [
    'Pruefe die folgende ausgehende E-Mail vor dem Versand an Kunden.',
    '',
    'Kriterien: professioneller Ton, korrekte Anrede/Namen, Rechtschreibung, vollstaendige Inhalte,',
    'fehlende Anhaenge wenn im Text versprochen, keine Antwort auf Phishing/Betrug.',
    '',
    'Anzahl Anhaenge beim Versand: {{outbound.attachment_count}}',
    '',
    'Ausgehende E-Mail:',
    '{{combined_text}}',
  ].join('\n');
}

function replySubject(subject: string | null | undefined): string {
  const value = String(subject ?? '').trim();
  if (!value) return 'Re:';
  return /^re:/i.test(value) ? value : `Re: ${value}`;
}

function workflowDelayContext(
  context: ServerWorkflowContext,
  resumeNodeId: string,
): Record<string, unknown> {
  return {
    resumeNodeId,
    eventStrings: context.strings,
    eventVariables: context.variables,
  };
}

function boundedDelayMinutes(value: unknown): number {
  const parsed = Number(value ?? 5);
  if (!Number.isFinite(parsed)) return 5;
  return Math.max(1, Math.min(60 * 24 * 7, Math.trunc(parsed)));
}

/** Total delay cap: 7 days in milliseconds; floor: 1 second so sub-second
 *  configurations don't collapse to 0 and break scheduling. */
function boundedDelayMs(value: unknown): number {
  const parsed = Number(value ?? 60_000);
  if (!Number.isFinite(parsed)) return 60_000;
  return Math.max(1_000, Math.min(7 * 24 * 60 * 60_000, Math.trunc(parsed)));
}

function resolveResumeNodeAfter(doc: WorkflowGraphDocument, nodeId: string): string {
  const outs = outgoing(doc.edges, nodeId);
  return pickEdge(outs, 'default')?.target ?? outs[0]?.target ?? '';
}

function resolveHttpSuccessNodeAfter(doc: WorkflowGraphDocument, nodeId: string): string {
  const outs = outgoing(doc.edges, nodeId);
  const explicit = pickEdge(outs, 'default') ?? pickEdge(outs, 'yes');
  if (explicit) return explicit.target;
  const nonErrorEdges = outs.filter((edge) => !['no', 'nein', 'false', 'error']
    .includes(String(edge.label ?? '').trim().toLowerCase()));
  return nonErrorEdges.length === 1 ? nonErrorEdges[0]!.target : '';
}

function resolveHttpErrorNodeAfter(doc: WorkflowGraphDocument, nodeId: string): string {
  return pickEdge(outgoing(doc.edges, nodeId), 'no')?.target ?? '';
}

async function updateWorkflowMessage(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  patch: WorkflowMessagePatch,
): Promise<NodeResult | null> {
  if (context.messageId === null) {
    return { status: 'error', port: 'error', message: 'Keine Nachricht im Kontext' };
  }
  await trx
    .updateTable('email_messages')
    .set(patch)
    .where('workspace_id', '=', context.workspaceId)
    .where('id', '=', context.messageId)
    .execute();
  return null;
}

/**
 * Lifts an outbound hold (sets outbound_hold=false + clears the reason) on the
 * current message. Counterpart to email.hold_outbound; intended for the OK path
 * after ai.outbound_review approved a draft — without it an approved review
 * could never actually release the draft. Outbound-only.
 *
 * With config.autoSend=true it also (a) writes an approval marker into sync_info
 * so reviewOutbound.review bypasses the review on the *next* send call (avoiding
 * a re-entry loop from the scheduled-send cron) and (b) sets scheduled_send_at
 * = now so the scheduled-send job picks the draft up immediately.
 */

async function allocateWorkflowTicketCode(
  trx: WorkspaceTransaction,
  workspaceId: string,
  accountId: number | string | null,
  now: Date,
): Promise<string> {
  if (accountId == null) return generateTicketCode();
  const numericAccountId = Number(accountId);
  if (!Number.isSafeInteger(numericAccountId) || numericAccountId <= 0) return generateTicketCode();
  const account = await trx
    .selectFrom('email_accounts')
    .select(['id', 'source_sqlite_id'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', numericAccountId)
    .executeTakeFirst();
  if (!account) return generateTicketCode();
  const defaultPrefix = `ACC${numericAccountId}`.slice(0, 12);
  await trx
    .insertInto('email_account_mail_settings')
    .values({
      workspace_id: workspaceId,
      account_source_sqlite_id: Number(account.source_sqlite_id ?? numericAccountId),
      account_id: numericAccountId,
      ticket_prefix: defaultPrefix,
      ticket_next_number: 1,
      ticket_number_padding: 6,
      thread_namespace: `account-${numericAccountId}`,
      source_row: { source: 'server.workflow.ticket' },
      imported_in_run_id: null,
      created_at: now,
      updated_at: now,
    })
    .onConflict((oc) => oc.columns(['workspace_id', 'account_id']).doNothing())
    .execute();
  const settings = await trx
    .selectFrom('email_account_mail_settings')
    .select(['ticket_prefix', 'ticket_next_number', 'ticket_number_padding'])
    .where('workspace_id', '=', workspaceId)
    .where('account_id', '=', numericAccountId)
    .forUpdate()
    .executeTakeFirst();
  if (!settings) return generateTicketCode({ prefix: defaultPrefix });
  const currentNumber = Number(settings.ticket_next_number);
  const padding = Math.min(12, Math.max(1, Math.floor(Number(settings.ticket_number_padding) || 6)));
  const ticketCode = generateTicketCode({
    prefix: settings.ticket_prefix || defaultPrefix,
    sequence: String(Math.max(1, currentNumber || 1)).padStart(padding, '0'),
  });
  await trx
    .updateTable('email_account_mail_settings')
    .set({ ticket_next_number: Math.max(1, currentNumber || 1) + 1, updated_at: now })
    .where('workspace_id', '=', workspaceId)
    .where('account_id', '=', numericAccountId)
    .execute();
  return ticketCode;
}

async function releaseWorkflowOutboundHold(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  config: Record<string, unknown>,
  now: Date,
): Promise<NodeResult> {
  if (context.direction !== 'outbound') {
    return { status: 'skipped', port: 'default', message: 'Nur fuer ausgehende Nachrichten' };
  }
  if (context.messageId === null) {
    return { status: 'error', port: 'error', message: 'Keine Nachricht im Kontext' };
  }
  const autoSend = config.autoSend === true;

  if (!autoSend) {
    await trx
      .updateTable('email_messages')
      .set({ outbound_hold: false, outbound_block_reason: null, updated_at: now })
      .where('workspace_id', '=', context.workspaceId)
      .where('id', '=', context.messageId)
      .execute();
    return {
      status: 'ok',
      port: 'default',
      message: 'outbound_hold_released',
      variables: { 'email.outbound_hold': false, 'email.auto_send_scheduled': false },
    };
  }

  // autoSend path:
  // (1) review.review wrote the "AUSGANGSPRUEFUNG — VERSAND BLOCKIERT" banner
  //     into body_text/body_html when it held the draft. If we don't strip it
  //     here, the customer receives the internal banner in the sent mail.
  // (2) review.review on the scheduled-send retry will receive a subject that
  //     has been ticket-code-prefixed by prepareDraftForSend, so the marker
  //     fingerprint must be computed against the SAME prefixed subject —
  //     otherwise hash mismatches every retry and bypass is denied.
  const draftRow = await trx
    .selectFrom('email_messages')
    .select(['subject', 'body_text', 'body_html', 'to_json', 'cc_json', 'bcc_json', 'draft_attachment_paths_json', 'ticket_code', 'account_id'])
    .where('workspace_id', '=', context.workspaceId)
    .where('id', '=', context.messageId)
    .executeTakeFirst();

  const cleaned = extractDraftBodyForOutboundBlock({
    body_text: draftRow?.body_text ?? null,
    body_html: draftRow?.body_html ?? null,
  });
  const cleanedBodyText = cleaned.plain;
  const cleanedBodyHtml = cleaned.html;

  // Reconcile subject with the ticket code that prepareDraftForSend will
  // add when scheduled-send finally calls composeSender.send. The marker must
  // be valid against that final subject so the retry bypasses the review.
  const storedSubject = draftRow?.subject?.trim() || '';
  const allowedPrefixes = await listWorkspaceTicketPrefixes(trx, context.workspaceId);
  const existingTicket = draftRow?.ticket_code?.trim()
    || extractWorkspaceTicketFromSubject(draftRow?.subject ?? null, allowedPrefixes);
  const ticketCode = existingTicket || await allocateWorkflowTicketCode(trx, context.workspaceId, draftRow?.account_id ?? null, now);
  const finalSubject = ensureTicketInSubject(storedSubject || '(Ohne Betreff)', ticketCode);

  await trx
    .updateTable('email_messages')
    .set({
      outbound_hold: false,
      outbound_block_reason: null,
      scheduled_send_at: now,
      ...scheduledSendProvenanceColumns(context),
      // Persist the cleaned body so the customer does not see the internal
      // review banner, and the persisted ticket-prefixed subject so the
      // fingerprint matches at send time.
      body_text: cleanedBodyText,
      body_html: cleanedBodyHtml || null,
      subject: finalSubject,
      ticket_code: ticketCode,
      updated_at: now,
    })
    .where('workspace_id', '=', context.workspaceId)
    .where('id', '=', context.messageId)
    .execute();

  // Multi-outbound-workflow safety: if there are OTHER outbound runs against
  // this draft still queued/running, the user has multiple parallel quality
  // checks (e.g. language + compliance). Setting the bypass marker now would
  // let scheduled-send race them. Skip the marker (cron still picks up the
  // draft via scheduled_send_at and re-enters reviewOutbound.review, which
  // re-holds until the other workflows finish — they'll set their own marker
  // once they all approve).
  const otherOpenOutboundRuns = await trx
    .selectFrom('email_workflow_runs')
    .select('id')
    .where('message_id', '=', context.messageId)
    .where('direction', '=', 'outbound')
    .where('status', 'in', ['queued', 'running'])
    .where('id', '!=', context.runId)
    .limit(1)
    .execute();
  if (otherOpenOutboundRuns.length > 0) {
    return {
      status: 'ok',
      port: 'default',
      message: 'outbound_hold_released_auto_send_pending_peers',
      variables: { 'email.outbound_hold': false, 'email.auto_send_scheduled': true, 'email.pending_outbound_peers': true },
    };
  }

  const fingerprint = outboundDraftFingerprint({
    subject: finalSubject,
    bodyText: cleanedBodyText,
    bodyHtml: cleanedBodyHtml,
    to: addressesFromStoredRecipientJson(draftRow?.to_json),
    cc: addressesFromStoredRecipientJson(draftRow?.cc_json),
    bcc: addressesFromStoredRecipientJson(draftRow?.bcc_json),
    attachmentPaths: draftAttachmentPathsFromJson(draftRow?.draft_attachment_paths_json),
  });
  const key = outboundReviewApprovedKey(context.messageId);
  const markerValue = encodeOutboundApprovalMarker(now, fingerprint);
  await trx
    .insertInto('sync_info')
    .values({
      workspace_id: context.workspaceId,
      key,
      value: markerValue,
      last_updated: now,
      source_row: serverWorkerSourceRow(),
      imported_in_run_id: null,
      updated_at: now,
    })
    .onConflict((oc) => oc
      .columns(['workspace_id', 'key'])
      .doUpdateSet({ value: markerValue, last_updated: now, updated_at: now }))
    .execute();

  return {
    status: 'ok',
    port: 'default',
    message: 'outbound_hold_released_auto_send',
    variables: { 'email.outbound_hold': false, 'email.auto_send_scheduled': true },
  };
}

/**
 * Triggers the actual SMTP send of a (previously created) draft message —
 * the missing link for fully automated reply chains.
 *
 *   ai.reply_suggestion / ai.agent / email.create_draft   →   sets draft.id
 *                                                              ↓
 *                                          email.auto_reply (approved gate)
 *                                                              ↓
 *                                          email.send_draft  ← THIS
 *                                                              ↓
 *                                   (scheduled-send cron + composeSender.send)
 *
 * Config:
 *   - draftIdVariable (string, default 'draft.id'): which workflow variable to
 *     read the draft message id from.
 *   - runOutboundReview (bool, default false): when false, sets the approval
 *     marker so the send bypasses the outbound review (the workflow has just
 *     curated this draft, KI-on-KI review is the trigger workflow's choice).
 *     When true, no marker is set → composeSender.send runs reviewOutbound on
 *     the new draft and outbound workflows can hold/approve as for any mail.
 *
 * Idempotent: re-running on a draft already marked for send is a no-op.
 */
async function sendWorkflowDraft(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  config: Record<string, unknown>,
  now: Date,
): Promise<NodeResult> {
  const draftIdVar = String(config.draftIdVariable ?? 'draft.id').trim() || 'draft.id';
  const rawId = config.draftId ?? context.variables[draftIdVar];
  const draftId = Number(rawId);
  if (!Number.isFinite(draftId) || draftId <= 0) {
    return {
      status: 'error',
      port: 'error',
      message: `Keine gueltige Entwurfs-ID unter ${draftIdVar} oder config.draftId`,
    };
  }

  // Belt-and-braces safety net for ALL inbound chains: the workspace auto-
  // reply switch must be on, and the original sender must not look like a
  // no-reply / bounce / automation address. This runs regardless of
  // runOutboundReview, because runOutboundReview=true only helps when
  // outbound workflows actually exist — if none are configured, the send
  // would otherwise go out unguarded. Outbound-direction sends are not
  // affected (a manual workflow is the operator's explicit choice).
  if (context.direction === 'inbound') {
    if (!(await loadAutoReplyEnabled(trx, context.workspaceId))) {
      return { status: 'skipped', port: 'default', message: 'auto_reply_disabled' };
    }
    const sender = context.message ? extractWorkflowEmailAddress(context.message.from_json) : '';
    if (!sender || AUTO_REPLY_NOREPLY_RE.test(sender)) {
      return { status: 'skipped', port: 'default', message: 'noreply_sender_blocked' };
    }
    // Anti-Loop wie im Desktop-send_draft: auch ein Workflow OHNE
    // email.auto_reply-Gate davor darf Automaten/Newslettern nie antworten.
    if (isUnsafeAutoReplyTarget(context.message?.raw_headers)) {
      return { status: 'skipped', port: 'default', message: 'automated_sender_blocked' };
    }
  }
  const draftRow = await trx
    .selectFrom('email_messages')
    .select(['id', 'uid', 'folder_kind', 'subject', 'body_text', 'body_html', 'to_json', 'cc_json', 'bcc_json', 'draft_attachment_paths_json', 'ticket_code', 'account_id'])
    .where('workspace_id', '=', context.workspaceId)
    .where('id', '=', draftId)
    .executeTakeFirst();
  if (!draftRow) {
    return { status: 'error', port: 'error', message: `Entwurf ${draftId} nicht gefunden` };
  }
  if (draftRow.folder_kind !== 'draft' || (draftRow.uid as number) >= 0) {
    return { status: 'error', port: 'error', message: `Nachricht ${draftId} ist kein Entwurf` };
  }

  if (context.direction === 'inbound') {
    const accountId = Number(draftRow.account_id);
    const recipient = normalizeEmailAddress(firstWorkflowRecipientAddress(draftRow.to_json));
    const sourceMessageId = Number(context.messageId);
    if (!Number.isInteger(accountId) || accountId <= 0 || !isAutoReplyRecipient(recipient)) {
      return { status: 'skipped', port: 'default', message: 'auto_reply_recipient_invalid' };
    }
    if (!Number.isInteger(sourceMessageId) || sourceMessageId <= 0) {
      return { status: 'skipped', port: 'default', message: 'auto_reply_source_missing' };
    }
    const reservation = await reserveServerAutoReplySlot(trx, {
      workspaceId: context.workspaceId,
      sourceMessageId,
      draftMessageId: draftId,
      accountId,
      recipient,
      replyDay: now.toISOString().slice(0, 10),
      limit: await loadAutoReplyMaxPerSenderPerDay(trx, context.workspaceId),
      now,
    });
    if (reservation === 'duplicate') {
      return { status: 'skipped', port: 'default', message: 'auto_reply_duplicate' };
    }
    if (reservation === 'rate_limited') {
      return { status: 'skipped', port: 'default', message: 'auto_reply_rate_limited' };
    }
  }

  const runOutboundReview = config.runOutboundReview === true;

  // For runOutboundReview=false we have to reconcile the persisted body and
  // subject with what scheduled-send / composeSender.send will use at SMTP
  // time, otherwise the approval marker we stamp now won't match:
  //  - strip any "AUSGANGSPRUEFUNG"-banner left over from an earlier
  //    reviewOutbound hold (it would otherwise be sent to the customer);
  //  - bake in the ticket-code-prefixed subject that prepareDraftForSend will
  //    enforce, so the fingerprint stays valid on the retry.
  if (!runOutboundReview) {
    const cleaned = extractDraftBodyForOutboundBlock({
      body_text: draftRow.body_text ?? null,
      body_html: draftRow.body_html ?? null,
    });
    const storedSubject = draftRow.subject?.trim() || '';
    const allowedPrefixes = await listWorkspaceTicketPrefixes(trx, context.workspaceId);
    const existingTicket = draftRow.ticket_code?.trim()
      || extractWorkspaceTicketFromSubject(draftRow.subject ?? null, allowedPrefixes);
    const ticketCode = existingTicket || await allocateWorkflowTicketCode(trx, context.workspaceId, draftRow.account_id ?? null, now);
    const finalSubject = ensureTicketInSubject(storedSubject || '(Ohne Betreff)', ticketCode);

    await trx
      .updateTable('email_messages')
      .set({
        outbound_hold: false,
        outbound_block_reason: null,
        scheduled_send_at: now,
        ...scheduledSendProvenanceColumns(context),
        body_text: cleaned.plain,
        body_html: cleaned.html || null,
        subject: finalSubject,
        ticket_code: ticketCode,
        updated_at: now,
      })
      .where('workspace_id', '=', context.workspaceId)
      .where('id', '=', draftId)
      .execute();

    const fingerprint = outboundDraftFingerprint({
      subject: finalSubject,
      bodyText: cleaned.plain,
      bodyHtml: cleaned.html,
      to: addressesFromStoredRecipientJson(draftRow.to_json),
      cc: addressesFromStoredRecipientJson(draftRow.cc_json),
      bcc: addressesFromStoredRecipientJson(draftRow.bcc_json),
      attachmentPaths: draftAttachmentPathsFromJson(draftRow.draft_attachment_paths_json),
    });
    const markerValue = encodeOutboundApprovalMarker(now, fingerprint);
    await trx
      .insertInto('sync_info')
      .values({
        workspace_id: context.workspaceId,
        key: outboundReviewApprovedKey(draftId),
        value: markerValue,
        last_updated: now,
        source_row: serverWorkerSourceRow(),
        imported_in_run_id: null,
        updated_at: now,
      })
      .onConflict((oc) => oc
        .columns(['workspace_id', 'key'])
        .doUpdateSet({ value: markerValue, last_updated: now, updated_at: now }))
      .execute();
  } else {
    // runOutboundReview=true: outbound workflows guard the send via the
    // existing pipeline; just prime scheduled_send_at + clear the hold.
    await trx
      .updateTable('email_messages')
      .set({
        outbound_hold: false,
        outbound_block_reason: null,
        scheduled_send_at: now,
        ...scheduledSendProvenanceColumns(context),
        updated_at: now,
      })
      .where('workspace_id', '=', context.workspaceId)
      .where('id', '=', draftId)
      .execute();
  }

  if (context.direction === 'inbound') {
    await trx
      .insertInto('sync_info')
      .values({
        workspace_id: context.workspaceId,
        key: autoSubmittedDraftKey(draftId),
        value: '1',
        last_updated: now,
        source_row: serverWorkerSourceRow(),
        imported_in_run_id: null,
        updated_at: now,
      })
      .onConflict((oc) => oc
        .columns(['workspace_id', 'key'])
        .doUpdateSet({ value: '1', last_updated: now, updated_at: now }))
      .execute();
  }

  return {
    status: 'ok',
    port: 'default',
    message: runOutboundReview ? 'send_draft_queued_with_review' : 'send_draft_queued_auto',
    variables: {
      'send_draft.draft_id': draftId,
      'send_draft.with_review': runOutboundReview,
    },
  };
}

async function reserveServerAutoReplySlot(
  trx: WorkspaceTransaction,
  input: {
    workspaceId: string;
    sourceMessageId: number;
    draftMessageId: number;
    accountId: number;
    recipient: string;
    replyDay: string;
    limit: number;
    now: Date;
  },
): Promise<'reserved' | 'duplicate' | 'rate_limited'> {
  const reservation = await trx
    .insertInto('email_auto_reply_reservations')
    .values({
      workspace_id: input.workspaceId,
      source_message_id: input.sourceMessageId,
      draft_message_id: input.draftMessageId,
      account_id: input.accountId,
      recipient: input.recipient,
      reply_day: input.replyDay,
      created_at: input.now,
    })
    .onConflict((oc) => oc.columns(['workspace_id', 'source_message_id']).doNothing())
    .returning('source_message_id')
    .executeTakeFirst();
  if (!reservation) return 'duplicate';

  await trx
    .insertInto('email_auto_reply_daily_counters')
    .values({
      workspace_id: input.workspaceId,
      account_id: input.accountId,
      recipient: input.recipient,
      reply_day: input.replyDay,
      reply_count: 0,
      last_source_message_id: null,
      last_draft_message_id: null,
      updated_at: input.now,
    })
    .onConflict((oc) => oc
      .columns(['workspace_id', 'account_id', 'recipient', 'reply_day'])
      .doNothing())
    .execute();

  const counter = await trx
    .updateTable('email_auto_reply_daily_counters')
    .set({
      reply_count: sql<number>`reply_count + 1`,
      last_source_message_id: input.sourceMessageId,
      last_draft_message_id: input.draftMessageId,
      updated_at: input.now,
    })
    .where('workspace_id', '=', input.workspaceId)
    .where('account_id', '=', input.accountId)
    .where('recipient', '=', input.recipient)
    .where('reply_day', '=', input.replyDay)
    .where('reply_count', '<', input.limit)
    .returning('reply_count')
    .executeTakeFirst();
  if (counter) return 'reserved';

  await trx
    .deleteFrom('email_auto_reply_reservations')
    .where('workspace_id', '=', input.workspaceId)
    .where('source_message_id', '=', input.sourceMessageId)
    .execute();
  return 'rate_limited';
}

function isAutoReplyRecipient(value: string): boolean {
  return value.length <= 320 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

async function softDeleteWorkflowMessage(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  now: Date,
): Promise<NodeResult | null> {
  if (context.messageId === null) {
    return { status: 'error', port: 'error', message: 'Keine Nachricht im Kontext' };
  }
  const current = await trx
    .selectFrom('email_messages')
    .select(['id', 'archived', 'is_spam', 'folder_kind'])
    .where('workspace_id', '=', context.workspaceId)
    .where('id', '=', context.messageId)
    .executeTakeFirst();
  if (!current) return { status: 'error', port: 'error', message: 'Nachricht nicht gefunden' };

  await trx
    .updateTable('email_messages')
    .set({
      soft_deleted: true,
      done_local: true,
      trash_prev_archived: Boolean(current.archived),
      trash_prev_is_spam: Boolean(current.is_spam),
      trash_prev_folder_kind: current.folder_kind == null ? null : String(current.folder_kind),
      updated_at: now,
    })
    .where('workspace_id', '=', context.workspaceId)
    .where('id', '=', context.messageId)
    .execute();
  return null;
}

async function linkWorkflowMessageCustomer(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  now: Date,
): Promise<NodeResult> {
  if (context.messageId === null) {
    return { status: 'skipped', port: 'default' };
  }

  const message = await trx
    .selectFrom('email_messages')
    .select(['id', 'from_json', 'customer_id'])
    .where('workspace_id', '=', context.workspaceId)
    .where('id', '=', context.messageId)
    .executeTakeFirst();
  if (!message) return { status: 'error', port: 'error', message: 'Nachricht nicht gefunden' };

  if (message.customer_id !== null && message.customer_id !== undefined) {
    const customerId = Number(message.customer_id);
    return {
      status: 'ok',
      port: 'default',
      variables: { 'customer.id': customerId },
    };
  }

  const sender = firstWorkflowRecipientAddress(message.from_json);
  if (!sender) return { status: 'ok', port: 'default' };
  const normalizedSender = normalizeEmailAddress(sender);
  if (!normalizedSender) return { status: 'ok', port: 'default' };

  const customerRows = await trx
    .selectFrom('customers')
    .select(['id', 'source_sqlite_id', 'email'])
    .where('workspace_id', '=', context.workspaceId)
    .execute();
  const customer = customerRows.find((row) => normalizeEmailAddress(String(row.email ?? '')) === normalizedSender);
  if (!customer) return { status: 'ok', port: 'default' };

  const customerId = Number(customer.id);
  const customerSourceSqliteId = Number(customer.source_sqlite_id);
  await trx
    .updateTable('email_messages')
    .set({
      customer_id: customerId,
      customer_source_sqlite_id: customerSourceSqliteId,
      updated_at: now,
    })
    .where('workspace_id', '=', context.workspaceId)
    .where('id', '=', context.messageId)
    .execute();

  return {
    status: 'ok',
    port: 'default',
    variables: {
      'customer.id': customerId,
      'customer.source_sqlite_id': customerSourceSqliteId,
    },
  };
}

async function enqueueWorkflowSyncRun(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  now: Date,
): Promise<NodeResult> {
  const accountId = positiveIntegerVariable(context.variables['email.account_id']);
  if (accountId === null) return { status: 'skipped', port: 'default', message: 'Kein Konto' };

  const account = await trx
    .selectFrom('email_accounts')
    .select(['id', 'protocol'])
    .where('workspace_id', '=', context.workspaceId)
    .where('id', '=', accountId)
    .executeTakeFirst();
  if (!account) return { status: 'error', port: 'error', message: 'Konto nicht gefunden' };

  const protocol = String(account.protocol ?? 'imap').trim().toLowerCase() || 'imap';
  const jobType = protocol === 'imap'
    ? 'mail.sync.imap'
    : protocol === 'pop3'
      ? 'mail.sync.pop3'
      : null;
  if (!jobType) {
    return { status: 'error', port: 'error', message: 'Email account protocol wird nicht unterstuetzt' };
  }

  const row = await trx
    .insertInto('job_queue')
    .values({
      type: jobType,
      payload: {
        workspaceId: context.workspaceId,
        accountId,
        ...workflowJobProvenance(context),
      },
      run_after: now,
      max_attempts: 3,
      workspace_id: context.workspaceId,
      updated_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const jobId = Number(row.id);

  return {
    status: 'ok',
    port: 'default',
    message: `queued_sync:${jobId}`,
    variables: {
      'sync.queued': true,
      'sync.job_id': jobId,
      'sync.account_id': accountId,
    },
  };
}

async function enqueueWorkflowSubflow(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  node: WorkflowGraphNode,
  config: Record<string, unknown>,
  now: Date,
): Promise<NodeResult> {
  const continuationContextError = workflowContinuationContextError(context);
  if (continuationContextError) {
    return { status: 'error', port: 'error', message: continuationContextError };
  }
  const configuredWorkflowId = optionalPositiveIntegerConfig(config.workflowId, 'workflowId');
  if (!configuredWorkflowId.ok) return { status: 'error', port: 'error', message: configuredWorkflowId.message };
  const workflowId = configuredWorkflowId.value;
  if (!workflowId || workflowId === context.workflowId) {
    return { status: 'error', port: 'error', message: 'Ungueltige Subflow-ID' };
  }

  // Depth guard: the direct self-reference check above does not stop an indirect
  // cycle (A → B → A). For message-less / non-inbound subflows there is no
  // applied-marker to break the loop, so without a depth cap the pair would
  // enqueue each other forever and exhaust the job queue. Carry the depth in a
  // reserved variable that rides along in eventVariables into each child run.
  const rawDepth = context.variables[SUBFLOW_DEPTH_VARIABLE];
  const subflowDepth = typeof rawDepth === 'number'
    && Number.isInteger(rawDepth)
    && rawDepth >= 0
    ? rawDepth
    : 0;
  if (subflowDepth >= MAX_SUBFLOW_DEPTH) {
    return {
      status: 'error',
      port: 'error',
      message: `Subflow-Tiefe ${MAX_SUBFLOW_DEPTH} überschritten (mögliche Rekursion) — Subflow nicht eingereiht`,
    };
  }

  const subflow = await loadWorkflow(trx, context.workspaceId, workflowId);
  if (!subflow?.enabled) {
    return { status: 'error', port: 'error', message: 'Subflow nicht gefunden oder inaktiv' };
  }

  const payload: Record<string, unknown> = {
    workspaceId: context.workspaceId,
    workflowId,
    ...workflowJobProvenance(context),
    triggerName: normalizeWorkflowTrigger(subflow.trigger_name),
    context: {
      eventStrings: context.strings,
      eventVariables: { ...context.variables, [SUBFLOW_DEPTH_VARIABLE]: subflowDepth + 1 },
      subflowParent: {
        workflowId: context.workflowId,
        runId: context.runId,
        nodeId: node.id,
      },
    },
  };
  if (context.messageId !== null) payload.messageId = context.messageId;

  const row = await trx
    .insertInto('job_queue')
    .values({
      type: 'workflow.execute',
      payload,
      run_after: now,
      max_attempts: 3,
      workspace_id: context.workspaceId,
      updated_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const jobId = Number(row.id);

  return {
    status: 'ok',
    port: 'default',
    message: `queued_subflow:${jobId}`,
    variables: {
      'subflow.status': 'queued',
      'subflow.job_id': jobId,
      'subflow.workflow_id': workflowId,
    },
  };
}

async function createWorkflowTask(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  node: WorkflowGraphNode,
  config: Record<string, unknown>,
  now: Date,
): Promise<NodeResult> {
  const configuredCustomerId = optionalPositiveIntegerConfig(config.customerId, 'customerId');
  if (!configuredCustomerId.ok) return { status: 'error', port: 'error', message: configuredCustomerId.message };
  // Opt-in: allow a task without any linked customer (e.g. DMARC-report alerts,
  // where the report mail comes from a mailbox provider, not a CRM customer).
  // Default false preserves the historic skip-when-no-customer behaviour.
  const allowWithoutCustomer = config.allowWithoutCustomer === true;
  const customerId = configuredCustomerId.value ?? positiveIntegerVariable(context.variables['customer.id']);
  if (customerId === null && !allowWithoutCustomer) {
    return { status: 'skipped', port: 'default', message: 'Kein Kunde verknuepft' };
  }

  let customer: { id: number; sourceSqliteId: number } | null = null;
  if (customerId !== null) {
    if (!Number.isSafeInteger(customerId) || customerId <= 0) {
      return { status: 'error', port: 'error', message: 'customerId ungueltig' };
    }
    customer = await resolveWorkflowCustomerReference(trx, context.workspaceId, customerId);
    if (!customer) return { status: 'error', port: 'error', message: 'Kunde nicht gefunden' };
  }

  const title = String(config.title ?? 'E-Mail bearbeiten').trim() || 'E-Mail bearbeiten';
  const priority = String(config.priority ?? 'medium').trim() || 'medium';
  const dueDate = workflowTaskDueDate(config.daysUntilDue, now);
  if (!dueDate) return { status: 'error', port: 'error', message: 'daysUntilDue ungueltig' };
  const description = String(context.strings.snippet ?? '').trim() || null;
  // customerId 0 marks the customerless task in the idempotency key so retries
  // of the same (workflow, message, node) dedup instead of duplicating.
  const sourceSqliteId = serverCreatedWorkflowTaskSourceSqliteId(context, node.id, customer?.id ?? 0);

  const existing = await trx
    .selectFrom('tasks')
    .select('id')
    .where('workspace_id', '=', context.workspaceId)
    .where('source_sqlite_id', '=', sourceSqliteId)
    .executeTakeFirst();
  if (existing) {
    const taskId = Number(existing.id);
    return {
      status: 'ok',
      port: 'default',
      message: `task_exists:${taskId}`,
      variables: {
        'task.id': taskId,
        'task.customer_id': customer?.id ?? null,
      },
    };
  }

  const row = await trx
    .insertInto('tasks')
    .values({
      workspace_id: context.workspaceId,
      source_sqlite_id: sourceSqliteId,
      customer_source_sqlite_id: customer?.sourceSqliteId ?? null,
      customer_id: customer?.id ?? null,
      title,
      description,
      due_date: dueDate,
      priority,
      completed: false,
      calendar_event_source_sqlite_id: null,
      snoozed_until: null,
      created_date: now,
      last_modified: now,
      source_row: serverWorkerSourceRow(),
      imported_in_run_id: null,
      created_at: now,
      updated_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const taskId = Number(row.id);

  return {
    status: 'ok',
    port: 'default',
    variables: {
      'task.id': taskId,
      'task.customer_id': customer?.id ?? null,
    },
  };
}

async function createWorkflowActivityLog(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  node: WorkflowGraphNode,
  config: Record<string, unknown>,
  now: Date,
): Promise<NodeResult> {
  const customerId = positiveIntegerVariable(context.variables['customer.id']);
  if (customerId === null) {
    return { status: 'skipped', port: 'default', message: 'Kein Kunde verknuepft' };
  }
  if (!Number.isSafeInteger(customerId) || customerId <= 0) {
    return { status: 'error', port: 'error', message: 'customerId ungueltig' };
  }

  const customer = await resolveWorkflowCustomerReference(trx, context.workspaceId, customerId);
  if (!customer) return { status: 'error', port: 'error', message: 'Kunde nicht gefunden' };

  const activityType = String(config.activityType ?? 'email').trim() || 'email';
  const title = String(config.title ?? 'Workflow').trim() || 'Workflow';
  const description = String(context.strings.subject ?? '').trim() || null;
  const sourceSqliteId = serverCreatedWorkflowActivityLogSourceSqliteId(context, node.id, customer.id);

  const existing = await trx
    .selectFrom('activity_log')
    .select('id')
    .where('workspace_id', '=', context.workspaceId)
    .where('source_sqlite_id', '=', sourceSqliteId)
    .executeTakeFirst();
  if (existing) {
    const activityLogId = Number(existing.id);
    return {
      status: 'ok',
      port: 'default',
      message: `activity_log_exists:${activityLogId}`,
      variables: {
        'activity_log.id': activityLogId,
        'activity_log.customer_id': customer.id,
      },
    };
  }

  const row = await trx
    .insertInto('activity_log')
    .values({
      workspace_id: context.workspaceId,
      source_sqlite_id: sourceSqliteId,
      customer_source_sqlite_id: customer.sourceSqliteId,
      deal_source_sqlite_id: null,
      task_source_sqlite_id: null,
      customer_id: customer.id,
      deal_id: null,
      task_id: null,
      activity_type: activityType,
      title,
      description,
      metadata: {
        messageId: context.messageId,
        workflowId: context.workflowId,
      },
      source_row: serverWorkerSourceRow(),
      imported_in_run_id: null,
      created_at: now,
      updated_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const activityLogId = Number(row.id);

  return {
    status: 'ok',
    port: 'default',
    variables: {
      'activity_log.id': activityLogId,
      'activity_log.customer_id': customer.id,
    },
  };
}

async function updateWorkflowDeal(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  node: WorkflowGraphNode,
  config: Record<string, unknown>,
  now: Date,
): Promise<NodeResult> {
  const configuredDealId = optionalPositiveIntegerConfig(config.dealId, 'dealId');
  if (!configuredDealId.ok) return { status: 'error', port: 'error', message: configuredDealId.message };
  const dealId = configuredDealId.value ?? positiveIntegerVariable(context.variables['deal.id']);
  if (dealId === null) return { status: 'skipped', port: 'default', message: 'Keine Deal-ID' };
  if (!Number.isSafeInteger(dealId) || dealId <= 0) {
    return { status: 'error', port: 'error', message: 'dealId ungueltig' };
  }

  const deal = await resolveWorkflowDealReference(trx, context.workspaceId, dealId);
  if (!deal) return { status: 'error', port: 'error', message: 'Deal nicht gefunden' };

  const stage = String(config.stage ?? '').trim();
  if (stage) {
    await trx
      .updateTable('deals')
      .set({ stage, last_modified: now, updated_at: now })
      .where('workspace_id', '=', context.workspaceId)
      .where('id', '=', deal.id)
      .execute();
    await insertWorkflowDealStageActivityLog(trx, context, node, deal, stage, now);
    return {
      status: 'ok',
      port: 'default',
      variables: {
        'deal.id': deal.id,
        'deal.stage': stage,
      },
    };
  }

  const title = config.title === null || config.title === undefined ? '' : String(config.title).trim();
  if (title) {
    await trx
      .updateTable('deals')
      .set({ name: title, last_modified: now, updated_at: now })
      .where('workspace_id', '=', context.workspaceId)
      .where('id', '=', deal.id)
      .execute();
  }

  return {
    status: 'ok',
    port: 'default',
    variables: { 'deal.id': deal.id },
  };
}

async function resolveWorkflowCustomerReference(
  trx: WorkspaceTransaction,
  workspaceId: string,
  customerId: number,
): Promise<{ id: number; sourceSqliteId: number } | null> {
  const row = await trx
    .selectFrom('customers')
    .select(['id', 'source_sqlite_id'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', customerId)
    .executeTakeFirst();
  if (!row) return null;
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
  };
}

type WorkflowDealReference = {
  id: number;
  sourceSqliteId: number;
  customerId: number | null;
  customerSourceSqliteId: number | null;
  stage: string;
};

async function resolveWorkflowDealReference(
  trx: WorkspaceTransaction,
  workspaceId: string,
  dealId: number,
): Promise<WorkflowDealReference | null> {
  const row = await trx
    .selectFrom('deals')
    .select(['id', 'source_sqlite_id', 'customer_id', 'customer_source_sqlite_id', 'stage'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', dealId)
    .executeTakeFirst();
  if (!row) return null;
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
    customerId: row.customer_id === null || row.customer_id === undefined ? null : Number(row.customer_id),
    customerSourceSqliteId: row.customer_source_sqlite_id === null || row.customer_source_sqlite_id === undefined
      ? null
      : Number(row.customer_source_sqlite_id),
    stage: String(row.stage ?? ''),
  };
}

async function insertWorkflowDealStageActivityLog(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  node: WorkflowGraphNode,
  deal: WorkflowDealReference,
  newStage: string,
  now: Date,
): Promise<void> {
  const sourceSqliteId = serverCreatedWorkflowDealStageActivitySourceSqliteId(
    context,
    node.id,
    deal.id,
    deal.stage,
    newStage,
  );
  const existing = await trx
    .selectFrom('activity_log')
    .select('id')
    .where('workspace_id', '=', context.workspaceId)
    .where('source_sqlite_id', '=', sourceSqliteId)
    .executeTakeFirst();
  if (existing) return;

  await trx
    .insertInto('activity_log')
    .values({
      workspace_id: context.workspaceId,
      source_sqlite_id: sourceSqliteId,
      customer_source_sqlite_id: deal.customerSourceSqliteId,
      deal_source_sqlite_id: deal.sourceSqliteId,
      task_source_sqlite_id: null,
      customer_id: deal.customerId,
      deal_id: deal.id,
      task_id: null,
      activity_type: 'stage_change',
      title: `Deal-Phase geaendert: ${deal.stage} -> ${newStage}`,
      description: null,
      metadata: { old_stage: deal.stage, new_stage: newStage },
      source_row: serverWorkerSourceRow(),
      imported_in_run_id: null,
      created_at: now,
      updated_at: now,
    })
    .execute();
}

function workflowTaskDueDate(value: unknown, now: Date): Date | null {
  const raw = value === undefined || value === null || value === '' ? 3 : Number(value);
  if (!Number.isFinite(raw)) return null;
  const days = Math.trunc(raw);
  const due = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  return Number.isFinite(due.getTime()) ? due : null;
}

async function addWorkflowMessageTag(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  tag: string,
  now: Date,
): Promise<NodeResult | null> {
  if (context.messageId === null) {
    return { status: 'error', port: 'error', message: 'Keine Nachricht im Kontext' };
  }

  const messageSourceSqliteId = context.messageSourceSqliteId
    ?? await resolveMessageSourceSqliteId(trx, context.workspaceId, context.messageId);
  if (messageSourceSqliteId === null) {
    return { status: 'error', port: 'error', message: 'Nachricht nicht gefunden' };
  }

  const normalized = tag.trim();
  const existing = await trx
    .selectFrom('email_message_tags')
    .select('id')
    .where('workspace_id', '=', context.workspaceId)
    .where('message_source_sqlite_id', '=', messageSourceSqliteId)
    .where('tag', '=', normalized)
    .executeTakeFirst();
  if (existing) return null;

  await trx
    .insertInto('email_message_tags')
    .values({
      workspace_id: context.workspaceId,
      source_sqlite_id: serverCreatedSourceSqliteId(
        'email_message_tags',
        context.workspaceId,
        String(messageSourceSqliteId),
        normalized.toLowerCase(),
      ),
      message_source_sqlite_id: messageSourceSqliteId,
      message_id: context.messageId,
      tag: normalized,
      source_row: serverWorkerSourceRow(),
      imported_in_run_id: null,
      created_at: now,
      updated_at: now,
    })
    .execute();
  return null;
}

type WorkflowEmailCategoryReference = {
  id: number;
  sourceSqliteId: number;
  parentId: number | null;
  parentSourceSqliteId: number | null;
  name: string;
};

async function setWorkflowMessageCategoryPath(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  path: string,
  now: Date,
): Promise<NodeResult> {
  if (context.messageId === null) {
    return { status: 'error', port: 'error', message: 'Keine Nachricht im Kontext' };
  }

  const messageSourceSqliteId = context.messageSourceSqliteId
    ?? await resolveMessageSourceSqliteId(trx, context.workspaceId, context.messageId);
  if (messageSourceSqliteId === null) {
    return { status: 'error', port: 'error', message: 'Nachricht nicht gefunden' };
  }

  const parts = path.split('/').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return { status: 'skipped', port: 'default' };
  if (parts.length > MAX_EMAIL_CATEGORY_DEPTH) {
    return {
      status: 'error',
      port: 'error',
      message: `Kategoriepfad zu tief (max. ${MAX_EMAIL_CATEGORY_DEPTH} Ebenen)`,
    };
  }

  let parent: WorkflowEmailCategoryReference | null = null;
  const fullPath: string[] = [];
  for (const part of parts) {
    fullPath.push(part);
    parent = await ensureWorkflowEmailCategory(trx, context.workspaceId, parent, part, fullPath, now);
  }
  if (!parent) return { status: 'skipped', port: 'default' };

  await trx
    .deleteFrom('email_message_categories')
    .where('workspace_id', '=', context.workspaceId)
    .where('message_source_sqlite_id', '=', messageSourceSqliteId)
    .execute();

  await trx
    .insertInto('email_message_categories')
    .values({
      workspace_id: context.workspaceId,
      source_sqlite_id: serverCreatedWorkflowMessageCategorySourceSqliteId(
        context.workspaceId,
        messageSourceSqliteId,
        parent.sourceSqliteId,
      ),
      message_source_sqlite_id: messageSourceSqliteId,
      category_source_sqlite_id: parent.sourceSqliteId,
      message_id: context.messageId,
      category_id: parent.id,
      source_row: serverWorkerSourceRow(),
      imported_in_run_id: null,
      updated_at: now,
    })
    .execute();

  return {
    status: 'ok',
    port: 'default',
    variables: {
      'email.category_id': parent.id,
      'email.category_path': parts.join('/'),
    },
  };
}

/**
 * Resolves a category by its stable source_sqlite_id and assigns the message to
 * it. Rename-safe: the workflow stores the id, so renaming the category keeps it
 * pointed at the same one. Returns null when the category no longer exists, so
 * the caller can fall back to the configured path.
 */
async function setWorkflowMessageCategoryById(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  categorySourceSqliteId: number,
  now: Date,
): Promise<NodeResult | null> {
  if (context.messageId === null) {
    return { status: 'error', port: 'error', message: 'Keine Nachricht im Kontext' };
  }
  const category = await loadWorkflowCategoryBySourceSqliteId(trx, context.workspaceId, categorySourceSqliteId);
  if (!category) return null;

  const messageSourceSqliteId = context.messageSourceSqliteId
    ?? await resolveMessageSourceSqliteId(trx, context.workspaceId, context.messageId);
  if (messageSourceSqliteId === null) {
    return { status: 'error', port: 'error', message: 'Nachricht nicht gefunden' };
  }

  await trx
    .deleteFrom('email_message_categories')
    .where('workspace_id', '=', context.workspaceId)
    .where('message_source_sqlite_id', '=', messageSourceSqliteId)
    .execute();

  await trx
    .insertInto('email_message_categories')
    .values({
      workspace_id: context.workspaceId,
      source_sqlite_id: serverCreatedWorkflowMessageCategorySourceSqliteId(
        context.workspaceId,
        messageSourceSqliteId,
        category.sourceSqliteId,
      ),
      message_source_sqlite_id: messageSourceSqliteId,
      category_source_sqlite_id: category.sourceSqliteId,
      message_id: context.messageId,
      category_id: category.id,
      source_row: serverWorkerSourceRow(),
      imported_in_run_id: null,
      updated_at: now,
    })
    .execute();

  return {
    status: 'ok',
    port: 'default',
    variables: {
      'email.category_id': category.id,
      'email.category_path': category.path,
    },
  };
}

type WorkflowCategoryLookupRow = {
  id: number;
  sourceSqliteId: number;
  parentSourceSqliteId: number | null;
  name: string;
};

/** Loads a category by its stable source id and reconstructs its current full path. */
async function loadWorkflowCategoryBySourceSqliteId(
  trx: WorkspaceTransaction,
  workspaceId: string,
  categorySourceSqliteId: number,
): Promise<{ id: number; sourceSqliteId: number; path: string } | null> {
  const rows = await trx
    .selectFrom('email_categories')
    .select(['id', 'source_sqlite_id', 'parent_source_sqlite_id', 'name'])
    .where('workspace_id', '=', workspaceId)
    .execute();
  const bySource = new Map<number, WorkflowCategoryLookupRow>();
  for (const row of rows) {
    bySource.set(Number(row.source_sqlite_id), {
      id: Number(row.id),
      sourceSqliteId: Number(row.source_sqlite_id),
      parentSourceSqliteId: row.parent_source_sqlite_id === null || row.parent_source_sqlite_id === undefined
        ? null
        : Number(row.parent_source_sqlite_id),
      name: String(row.name ?? ''),
    });
  }
  const start = bySource.get(categorySourceSqliteId);
  if (!start) return null;

  const path: string[] = [];
  const seen = new Set<number>();
  let current: WorkflowCategoryLookupRow | undefined = start;
  while (current && !seen.has(current.sourceSqliteId) && path.length < MAX_EMAIL_CATEGORY_DEPTH) {
    seen.add(current.sourceSqliteId);
    path.unshift(current.name);
    current = current.parentSourceSqliteId === null ? undefined : bySource.get(current.parentSourceSqliteId);
  }

  return { id: start.id, sourceSqliteId: categorySourceSqliteId, path: path.join('/') };
}

async function ensureWorkflowEmailCategory(
  trx: WorkspaceTransaction,
  workspaceId: string,
  parent: WorkflowEmailCategoryReference | null,
  name: string,
  fullPath: readonly string[],
  now: Date,
): Promise<WorkflowEmailCategoryReference> {
  let query = trx
    .selectFrom('email_categories')
    .select(['id', 'source_sqlite_id', 'parent_id', 'parent_source_sqlite_id', 'name'])
    .where('workspace_id', '=', workspaceId)
    .where('name', '=', name);
  query = parent === null
    ? query.where('parent_id', 'is', null)
    : query.where('parent_id', '=', parent.id);

  const existing = await query.executeTakeFirst();
  if (existing) {
    return {
      id: Number(existing.id),
      sourceSqliteId: Number(existing.source_sqlite_id),
      parentId: existing.parent_id === null || existing.parent_id === undefined ? null : Number(existing.parent_id),
      parentSourceSqliteId: existing.parent_source_sqlite_id === null || existing.parent_source_sqlite_id === undefined
        ? null
        : Number(existing.parent_source_sqlite_id),
      name: String(existing.name ?? name),
    };
  }

  let childrenQuery = trx
    .selectFrom('email_categories')
    .select('sort_order')
    .where('workspace_id', '=', workspaceId);
  childrenQuery = parent === null
    ? childrenQuery.where('parent_id', 'is', null)
    : childrenQuery.where('parent_id', '=', parent.id);
  const siblings = await childrenQuery.execute();
  const maxSortOrder = siblings.reduce((max, row) => Math.max(max, Number(row.sort_order ?? -1)), -1);

  const row = await trx
    .insertInto('email_categories')
    .values({
      workspace_id: workspaceId,
      source_sqlite_id: serverCreatedWorkflowEmailCategorySourceSqliteId(workspaceId, fullPath),
      parent_source_sqlite_id: parent?.sourceSqliteId ?? null,
      parent_id: parent?.id ?? null,
      name,
      sort_order: maxSortOrder + 1,
      source_row: serverWorkerSourceRow(),
      imported_in_run_id: null,
      created_at: now,
      updated_at: now,
    })
    .returning(['id', 'source_sqlite_id'])
    .executeTakeFirstOrThrow();

  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
    parentId: parent?.id ?? null,
    parentSourceSqliteId: parent?.sourceSqliteId ?? null,
    name,
  };
}

async function setWorkflowSpamStatus(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  status: 'clean' | 'review' | 'spam',
  tag: string,
  train: boolean,
  now: Date,
): Promise<NodeResult> {
  if (context.messageId === null) {
    return { status: 'error', port: 'error', message: 'Keine Nachricht im Kontext' };
  }
  const current = await trx
    .selectFrom('email_messages')
    .select([
      'id',
      'source_sqlite_id',
      'account_source_sqlite_id',
      'account_id',
      'folder_kind',
      'is_spam',
      'spam_status',
      'from_json',
      'subject',
      'snippet',
      'body_text',
      'body_html',
      'auth_spf',
      'auth_dkim',
      'auth_dmarc',
      'auth_arc',
      'attachments_json',
      'has_attachments',
    ])
    .where('workspace_id', '=', context.workspaceId)
    .where('id', '=', context.messageId)
    .executeTakeFirst();
  if (!current) return { status: 'error', port: 'error', message: 'Nachricht nicht gefunden' };
  const previous = { ...current };

  const result = await updateWorkflowMessage(trx, context, workflowSpamStatusPatch(
    status,
    String(current.folder_kind ?? 'inbox'),
    now,
  ));
  if (result) return result;

  if (tag) {
    const tagResult = await addWorkflowMessageTag(trx, context, tag, now);
    if (tagResult) return tagResult;
  }

  if (train) {
    await trainWorkflowSpamStatus(trx, context.workspaceId, previous, status, now);
  }

  return {
    status: 'ok',
    port: 'default',
    variables: { 'email.is_spam': status === 'spam', 'spam.status': status },
  };
}

function workflowSpamLearningLabel(
  previous: string,
  next: 'clean' | 'review' | 'spam',
): 'spam' | 'ham' | null {
  if (next === 'spam' && previous !== 'spam') return 'spam';
  if (next === 'clean' && (previous === 'spam' || previous === 'review')) return 'ham';
  return null;
}

async function trainWorkflowSpamStatus(
  trx: WorkspaceTransaction,
  workspaceId: string,
  message: {
    id: unknown;
    source_sqlite_id?: unknown;
    account_source_sqlite_id?: unknown;
    account_id?: unknown;
    is_spam?: unknown;
    spam_status?: unknown;
    from_json?: unknown;
    subject?: string | null;
    snippet?: string | null;
    body_text?: string | null;
    body_html?: string | null;
    auth_spf?: string | null;
    auth_dkim?: string | null;
    auth_dmarc?: string | null;
    auth_arc?: string | null;
    attachments_json?: unknown;
    has_attachments?: unknown;
  },
  status: 'clean' | 'review' | 'spam',
  now: Date,
): Promise<void> {
  const previous = String(message.spam_status ?? (message.is_spam ? 'spam' : 'clean'));
  const label = workflowSpamLearningLabel(previous, status);
  const accountSourceSqliteId = Number(message.account_source_sqlite_id);
  if (!label || !Number.isFinite(accountSourceSqliteId)) return;

  const featureKeys = buildFeaturePreview({
    fromJson: message.from_json,
    subject: message.subject,
    snippet: message.snippet,
    bodyText: message.body_text,
    bodyHtml: message.body_html,
    authSpf: message.auth_spf,
    authDkim: message.auth_dkim,
    authDmarc: message.auth_dmarc,
    authArc: message.auth_arc,
    attachmentsJson: message.attachments_json,
    hasAttachments: message.has_attachments as boolean | number | string | null,
  }).featureKeys;
  const spamInc = label === 'spam' ? 1 : 0;
  const hamInc = label === 'ham' ? 1 : 0;

  await trx
    .insertInto('email_spam_learning_events')
    .values({
      workspace_id: workspaceId,
      source_sqlite_id: serverCreatedWorkflowSpamLearningEventSourceSqliteId(
        workspaceId,
        Number(message.source_sqlite_id ?? message.id),
        label,
        now,
      ),
      message_source_sqlite_id: Number(message.source_sqlite_id ?? message.id),
      account_source_sqlite_id: accountSourceSqliteId,
      message_id: Number(message.id),
      account_id: message.account_id === null || message.account_id === undefined ? null : Number(message.account_id),
      label,
      source: 'workflow',
      // jsonb column: stringify the array (matches postgres-mail-read-ports);
      // a raw JS array would serialize as a Postgres array literal and fail.
      feature_keys_json: featureKeys.length > 0 ? JSON.stringify([...featureKeys]) : null,
      source_row: serverWorkerSourceRow(),
      imported_in_run_id: null,
      created_at: now,
      updated_at: now,
    })
    .execute();

  for (const featureKey of featureKeys) {
    await trx
      .insertInto('email_spam_feature_stats')
      .values({
        workspace_id: workspaceId,
        feature_key: featureKey,
        spam_count: spamInc,
        ham_count: hamInc,
        source_row: serverWorkerSourceRow(),
        imported_in_run_id: null,
        updated_at: now,
      })
      .onConflict((oc) => oc.columns(['workspace_id', 'feature_key']).doUpdateSet((eb) => ({
        spam_count: eb('email_spam_feature_stats.spam_count', '+', spamInc),
        ham_count: eb('email_spam_feature_stats.ham_count', '+', hamInc),
        updated_at: now,
      })))
      .execute();
  }
}

function spamStatusConfig(value: unknown): 'clean' | 'review' | 'spam' {
  const raw = String(value ?? 'review').trim().toLowerCase();
  return raw === 'clean' || raw === 'review' || raw === 'spam' ? raw : 'review';
}

function workflowSpamStatusPatch(
  status: 'clean' | 'review' | 'spam',
  currentFolderKind: string,
  now: Date,
): WorkflowMessagePatch {
  if (status === 'spam') {
    return {
      is_spam: true,
      spam_status: 'spam',
      soft_deleted: false,
      archived: false,
      done_local: true,
      spam_decided_at: now,
      updated_at: now,
    };
  }
  if (status === 'review') {
    return {
      is_spam: false,
      spam_status: 'review',
      soft_deleted: false,
      archived: false,
      done_local: false,
      seen_local: false,
      folder_kind: 'inbox',
      spam_decided_at: now,
      updated_at: now,
    };
  }
  return {
    is_spam: false,
    spam_status: 'clean',
    soft_deleted: false,
    archived: false,
    done_local: false,
    folder_kind: currentFolderKind === 'sent' || currentFolderKind === 'draft' ? currentFolderKind : 'inbox',
    spam_decided_at: now,
    updated_at: now,
  };
}

async function resolveMessageSourceSqliteId(
  trx: WorkspaceTransaction,
  workspaceId: string,
  messageId: number,
): Promise<number | null> {
  const row = await trx
    .selectFrom('email_messages')
    .select('source_sqlite_id')
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', messageId)
    .executeTakeFirst();
  return row ? Number(row.source_sqlite_id) : null;
}

async function insertRunStep(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  node: WorkflowGraphNode,
  input: {
    status: WorkflowStepStatus;
    port: string | null;
    durationMs: number;
    message: string | null;
    now: Date;
  },
): Promise<void> {
  await trx
    .insertInto('email_workflow_run_steps')
    .values({
      workspace_id: context.workspaceId,
      source_sqlite_id: null,
      run_source_sqlite_id: context.runSourceSqliteId,
      run_id: context.runId,
      node_id: node.id,
      node_type: nodeRuntimeType(node),
      status: input.status,
      port: input.port,
      duration_ms: input.durationMs,
      message: input.message,
      detail_json: null,
      source_row: serverWorkerSourceRow(),
      imported_in_run_id: null,
      created_at: input.now,
      updated_at: input.now,
    })
    .execute();
}

function buildWorkflowContext(input: {
  workspaceId: string;
  workflowId: number;
  workflowSourceSqliteId: number;
  runId: number;
  runSourceSqliteId: number;
  messageId: number | null;
  trigger: WorkflowTriggerKind;
  direction: WorkflowDirection;
  message: MessageRow | null;
  actorUserId?: string;
  trustedService?: boolean;
  manualAdminExecute?: boolean;
  jobContext: Record<string, unknown>;
}): ServerWorkflowContext {
  const eventStrings = stringRecord(input.jobContext.eventStrings);
  const eventVariables = variableRecord(input.jobContext.eventVariables);
  const strings = eventStrings ?? (
    input.message
      ? stringsFromMessage(input.message)
      : stringsFromOutbound(input.jobContext)
  );
  const variables: WorkflowVariableContext = {
    ...(eventVariables ?? {}),
  };
  if (input.messageId !== null) variables['message.id'] = input.messageId;
  if (input.message) {
    if (input.message.account_id !== null && input.message.account_id !== undefined) {
      variables['email.account_id'] = Number(input.message.account_id);
    }
    if (input.message.customer_id !== null && input.message.customer_id !== undefined) {
      variables['customer.id'] = Number(input.message.customer_id);
    }
    if (input.message.customer_source_sqlite_id !== null && input.message.customer_source_sqlite_id !== undefined) {
      variables['customer.source_sqlite_id'] = Number(input.message.customer_source_sqlite_id);
    }
    variables['auth.spf'] = authValue(input.message.auth_spf);
    variables['auth.dkim'] = authValue(input.message.auth_dkim);
    variables['auth.dmarc'] = authValue(input.message.auth_dmarc);
    variables['auth.arc'] = authValue(input.message.auth_arc);
    Object.assign(variables, securityVariablesFromMessage(input.message));
  }
  if (input.direction === 'outbound') {
    const outbound = objectRecord(input.jobContext.outbound);
    const count = Number(outbound?.attachmentCount ?? 0);
    variables['outbound.attachment_count'] = Number.isFinite(count) ? count : 0;
  }
  return {
    workspaceId: input.workspaceId,
    workflowId: input.workflowId,
    workflowSourceSqliteId: input.workflowSourceSqliteId,
    runId: input.runId,
    runSourceSqliteId: input.runSourceSqliteId,
    messageId: input.messageId,
    messageSourceSqliteId: input.message?.source_sqlite_id === undefined
      ? null
      : Number(input.message.source_sqlite_id),
    trigger: input.trigger,
    direction: input.direction,
    message: input.message,
    strings,
    variables,
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    ...(input.trustedService ? { trustedService: true } : {}),
    ...(input.manualAdminExecute ? { manualAdminExecute: true } : {}),
    previewOutbound: input.jobContext.previewOutbound === true,
  };
}

function authValue(value: string | null | undefined): string {
  return String(value ?? 'none').trim().toLowerCase() || 'none';
}

function securityVariablesFromMessage(message: MessageRow): WorkflowVariableContext {
  const variables: WorkflowVariableContext = {};
  const rspamdScore = finiteNumber(message.rspamd_score);
  if (rspamdScore !== null) variables['rspamd.score'] = rspamdScore;
  if (message.rspamd_action) variables['rspamd.action'] = message.rspamd_action;

  const spamScore = finiteNumber(message.spam_score);
  if (spamScore !== null) variables['spam.score'] = spamScore;
  if (message.spam_status) variables['spam.status'] = message.spam_status;
  if (message.spam_score_label) {
    variables['spam.label'] = message.spam_score_label;
    variables['spam.recommendation'] = message.spam_score_label;
  }
  if (message.spam_decision_source) variables['spam.source'] = message.spam_decision_source;

  const breakdown = spamScoreBreakdown(message.spam_score_breakdown_json);
  const listMatch = objectRecord(breakdown?.listMatch);
  if (typeof listMatch?.listType === 'string' && listMatch.listType.trim()) {
    variables['spam.list_match'] = listMatch.listType.trim();
  }
  const reasons = Array.isArray(breakdown?.reasons) ? breakdown.reasons : [];
  const firstReason = objectRecord(reasons[0]);
  if (typeof firstReason?.label === 'string' && firstReason.label.trim()) {
    variables['spam.top_reason'] = firstReason.label.trim();
  }

  return variables;
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function spamScoreBreakdown(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return objectRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return objectRecord(value);
}

function authProtocolConfig(value: unknown): 'spf' | 'dkim' | 'dmarc' | 'arc' {
  const raw = String(value ?? 'dmarc').trim().toLowerCase();
  if (raw === 'spf' || raw === 'dkim' || raw === 'arc') return raw;
  return 'dmarc';
}

function stringsFromMessage(message: MessageRow): WorkflowStringContext {
  const from = addressesFromStoredJson(message.from_json);
  const to = addressesFromStoredJson(message.to_json);
  const cc = addressesFromStoredJson(message.cc_json);
  const subject = message.subject ?? '';
  const body = message.body_text ?? '';
  const snippet = message.snippet ?? '';
  const attachments = attachmentContextFromJsonValue(message.attachments_json, Boolean(message.has_attachments));
  return {
    subject,
    body_text: body,
    snippet,
    from_address: from,
    to_address: to,
    cc_address: cc,
    combined_text: [subject, body, snippet, from, to, cc].join('\n'),
    ...attachments,
  };
}

function stringsFromOutbound(context: Record<string, unknown>): WorkflowStringContext {
  const outbound = objectRecord(context.outbound);
  const subject = String(outbound?.subject ?? '');
  const bodyText = String(outbound?.bodyText ?? '');
  const bodyHtml = typeof outbound?.bodyHtml === 'string' ? outbound.bodyHtml : '';
  const htmlPlain = bodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const to = String(outbound?.to ?? '');
  const cc = String(outbound?.cc ?? '');
  const bcc = String(outbound?.bcc ?? '');
  const attachmentCount = Number(outbound?.attachmentCount ?? 0);
  const attachmentPaths = Array.isArray(outbound?.attachmentPaths) ? outbound.attachmentPaths : [];
  const attachmentNames = attachmentPaths
    .map((item) => String(item ?? '').split(/[\\/]/).pop() ?? '')
    .filter(Boolean)
    .join('\n');
  return {
    subject,
    body_text: bodyText,
    snippet: bodyText.slice(0, 500),
    from_address: '',
    to_address: to,
    cc_address: cc,
    combined_text: [subject, bodyText, htmlPlain, to, cc, bcc, attachmentNames].join('\n'),
    has_attachments: attachmentCount > 0 || attachmentNames ? 'true' : 'false',
    attachment_names: attachmentNames,
    attachment_types: '',
  };
}

function conditionFromNodeData(data: Record<string, unknown>): WorkflowCondition {
  return {
    field: String(data.field ?? 'combined_text'),
    op: String(data.op ?? 'contains'),
    value: String(data.value ?? ''),
    caseInsensitive: data.caseInsensitive !== false,
    negated: data.negated === true,
  };
}

type WorkflowCondition = {
  field: string;
  op: string;
  value: string;
  caseInsensitive: boolean;
  negated: boolean;
};

function matchCondition(condition: WorkflowCondition, context: WorkflowStringContext): boolean {
  const result = matchSingleCondition(condition, context);
  return condition.negated ? !result : result;
}

function matchSingleCondition(condition: WorkflowCondition, context: WorkflowStringContext): boolean {
  if (condition.field === 'has_attachments') {
    const has = context.has_attachments === 'true' || context.has_attachments === '1';
    if (condition.op === 'is_true') return has;
    if (condition.op === 'is_false') return !has;
    if (condition.op === 'equals') {
      const want = condition.value.toLowerCase() === 'true' || condition.value === '1';
      return has === want;
    }
    return false;
  }

  const haystack = conditionValue(condition.field, context);
  const needle = condition.value ?? '';
  const ci = condition.caseInsensitive;

  if (condition.op === 'equals') {
    if (isAddressField(condition.field)) return matchAddressListOp(condition.field, context, 'equals', needle, ci);
    return ci ? haystack.toLowerCase() === needle.toLowerCase() : haystack === needle;
  }
  if (condition.op === 'contains') {
    if (!needle.trim()) return false;
    if (isAddressField(condition.field)) return matchAddressListOp(condition.field, context, 'contains', needle, ci);
    return (ci ? haystack.toLowerCase() : haystack).includes(ci ? needle.toLowerCase() : needle);
  }
  if (condition.op === 'domain_ends_with') {
    return domainEndsWithForField(condition.field, context, needle, ci);
  }
  if (condition.op === 'regex') {
    if (isAddressField(condition.field)) return matchAddressListOp(condition.field, context, 'regex', needle, ci);
    return safeRegexTest(needle, haystack, ci);
  }
  return false;
}

function matchAddressListOp(
  field: string,
  context: WorkflowStringContext,
  op: 'contains' | 'equals' | 'regex',
  needle: string,
  ci: boolean,
): boolean {
  const parts = splitAddressList(conditionValue(field, context));
  if (parts.length === 0) return op === 'equals' ? needle === '' : false;
  for (const part of parts) {
    const haystack = ci ? part.toLowerCase() : part;
    const n = ci ? needle.toLowerCase() : needle;
    if (op === 'equals' && haystack === n) return true;
    if (op === 'contains' && haystack.includes(n)) return true;
    if (op === 'regex' && safeRegexTest(needle, part, ci)) return true;
  }
  return false;
}

function safeRegexTest(pattern: string, value: string, ci: boolean): boolean {
  if (pattern.length > MAX_REGEX_PATTERN_LEN) return false;
  try {
    if (!safeRegex(pattern)) return false;
    return new RegExp(pattern, ci ? 'i' : '').test(value);
  } catch {
    return false;
  }
}

function domainEndsWithForField(
  field: string,
  context: WorkflowStringContext,
  suffix: string,
  ci: boolean,
): boolean {
  const normalizedSuffix = ci ? suffix.toLowerCase() : suffix;
  for (const address of splitAddressList(conditionValue(field, context))) {
    const domain = domainFromAddress(address);
    const normalizedDomain = ci ? domain.toLowerCase() : domain;
    if (normalizedDomain.endsWith(normalizedSuffix)) return true;
  }
  return false;
}

function conditionValue(field: string, context: WorkflowStringContext): string {
  switch (field) {
    case 'subject':
    case 'body_text':
    case 'snippet':
    case 'from_address':
    case 'to_address':
    case 'cc_address':
    case 'combined_text':
    case 'attachment_names':
    case 'attachment_types':
      return context[field] ?? '';
    default:
      return context.combined_text ?? '';
  }
}

function splitAddressList(raw: string): string[] {
  return raw
    .split(/[,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function domainFromAddress(address: string): string {
  const at = address.lastIndexOf('@');
  return at >= 0 ? address.slice(at + 1).trim() : address.trim();
}

function isAddressField(field: string): boolean {
  return field === 'from_address' || field === 'to_address' || field === 'cc_address';
}

function nodeRuntimeType(node: WorkflowGraphNode): string {
  if (node.type === 'registry') {
    return String(node.data.nodeType ?? 'registry.unknown');
  }
  if (node.type === 'action') {
    return String(node.data.nodeType ?? node.data.actionType ?? 'action');
  }
  return node.type;
}

function inboundGateFromContext(context: ServerWorkflowContext): ServerInboundBranchGate | undefined {
  if (context.direction !== 'inbound') return undefined;
  return { conditionOk: context.variables.__inbound_condition_ok === true || context.variables.__inbound_condition_ok === 1 };
}

const INBOUND_DIRECT_ALLOWED_WORKFLOW_TYPES = new Set([
  'email.sender_filter',
  'ai.classify',
  // ai.reply_suggestion is the standard "generate draft" step for auto-reply
  // chains; without the allowance the inbound-gate would block it until a
  // condition fires explicitly. The auto_reply node still gates whether the
  // draft is actually sent.
  'ai.reply_suggestion',
  // email.auto_reply IS the gate (toggle + confidence + no-reply check). It
  // must be reachable without a prior condition, and its 'approved' port trips
  // the inbound gate so downstream nodes can run.
  'email.auto_reply',
]);

function inboundNodeRequiresConditionGate(node: WorkflowGraphNode): boolean {
  if (node.type === 'condition' || node.type === 'trigger') return false;
  if (node.type === 'action') return true;
  if (node.type !== 'registry') return false;
  const type = nodeRuntimeType(node);
  if (INBOUND_DIRECT_ALLOWED_WORKFLOW_TYPES.has(type)) return false;
  if (type.startsWith('logic.')) return false;
  const config = nodeConfig(node);
  return config.runOnEveryInbound !== true;
}

function nodeConfig(node: WorkflowGraphNode): Record<string, unknown> {
  if (node.data.config && typeof node.data.config === 'object' && !Array.isArray(node.data.config)) {
    return node.data.config as Record<string, unknown>;
  }
  return node.data;
}

/**
 * Zentraler Interpolations-Pre-Pass (Parität zur Desktop-Runtime,
 * electron/workflow/runtime.ts): Felder, die das Knoten-Schema mit
 * `interpolate: true` markiert, bekommen {{Platzhalter}} VOR der Ausführung
 * aufgelöst — auf einer Kopie, nie persistiert. Ohne den Pass würden
 * email.tag/crm.create_task/http.request die Platzhalter aus dem
 * Variablen-Picker wörtlich übernehmen.
 *
 * `ai.*`-Knoten werden bewusst ÜBERSPRUNGEN: deren Prompts interpoliert die
 * Job-Schicht (ai-classification.ts) zur Ausführungszeit mit frischeren
 * Variablen — ein Pre-Pass davor würde doppelt interpolieren und über
 * Mail-Inhalte eingeschleuste Platzhalter auflösbar machen.
 */
const serverInterpolateFieldKeysByType = new Map<string, readonly string[]>();

function serverInterpolateFieldKeysFor(type: string): readonly string[] {
  let keys = serverInterpolateFieldKeysByType.get(type);
  if (!keys) {
    if (type.startsWith('ai.')) {
      keys = [];
    } else {
      const entry = listBuiltinWorkflowNodeCatalog().find((e) => e.type === type);
      keys = (entry?.fields ?? [])
        .filter((f) => f.interpolate === true)
        .map((f) => f.key);
    }
    serverInterpolateFieldKeysByType.set(type, keys);
  }
  return keys;
}

function interpolateServerSchemaFields(
  type: string,
  config: Record<string, unknown>,
  context: ServerWorkflowContext,
): Record<string, unknown> {
  const keys = serverInterpolateFieldKeysFor(type);
  if (keys.length === 0) return config;
  let copy: Record<string, unknown> | null = null;
  for (const key of keys) {
    const value = config[key];
    if (typeof value !== 'string' || !value.includes('{{')) continue;
    if (!copy) copy = { ...config };
    copy[key] = interpolateWorkflowPlaceholders(value, {
      strings: context.strings,
      variables: context.variables,
    });
  }
  return copy ?? config;
}

function normalizeWorkflowTrigger(value: string | undefined): WorkflowTriggerKind {
  switch (value) {
    case 'inbound':
    case 'outbound':
    case 'draft_created':
    case 'schedule':
    case 'manual':
    case 'relay':
    case 'crm.deal_stage_changed':
    case 'task.due':
    case 'calendar.event_start':
    case 'webhook.incoming':
    case 'crm.customer_created':
      return value;
    default:
      return 'manual';
  }
}

function parseWorkflowGraph(value: unknown): WorkflowGraphDocument | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return parseGraphDocument(value);
  try {
    return parseGraphDocument(JSON.stringify(value));
  } catch {
    return null;
  }
}

function definitionHasRules(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return false;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const rules = (parsed as { rules?: unknown }).rules;
  return Array.isArray(rules) && rules.length > 0;
}

function addressesFromStoredJson(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return addressesFromRecipientJson(value);
  try {
    return addressesFromRecipientJson(JSON.stringify(value));
  } catch {
    return '';
  }
}

function firstWorkflowRecipientAddress(value: unknown): string {
  const parsed = typeof value === 'string' ? parseJson(value) : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return '';
  const recipients = (parsed as { value?: unknown }).value;
  if (!Array.isArray(recipients)) return '';
  const first = recipients[0];
  if (!first || typeof first !== 'object') return '';
  const address = (first as { address?: unknown }).address;
  return typeof address === 'string' ? address.trim() : '';
}

function attachmentContextFromJsonValue(
  value: unknown,
  hasAttachments: boolean,
): Pick<WorkflowStringContext, 'has_attachments' | 'attachment_names' | 'attachment_types'> {
  const names: string[] = [];
  const types: string[] = [];
  const parsed = typeof value === 'string' ? parseJson(value) : value;
  if (Array.isArray(parsed)) {
    for (const item of parsed) collectAttachmentMeta(item, names, types);
  } else if (parsed && typeof parsed === 'object') {
    const record = parsed as {
      stored?: unknown[];
      omitted?: unknown[];
    };
    for (const item of record.stored ?? []) collectAttachmentMeta(item, names, types);
    for (const item of record.omitted ?? []) collectAttachmentMeta(item, names, types);
  }
  return {
    has_attachments: hasAttachments || names.length > 0 ? 'true' : 'false',
    attachment_names: names.join('\n'),
    attachment_types: types.join('\n'),
  };
}

function collectAttachmentMeta(item: unknown, names: string[], types: string[]): void {
  if (!item || typeof item !== 'object') return;
  const record = item as {
    filename?: unknown;
    name?: unknown;
    contentType?: unknown;
    content_type?: unknown;
  };
  const name = typeof record.name === 'string'
    ? record.name
    : typeof record.filename === 'string'
      ? record.filename
      : '';
  if (name) names.push(name);
  const contentType = typeof record.contentType === 'string'
    ? record.contentType
    : typeof record.content_type === 'string'
      ? record.content_type
      : '';
  if (contentType) types.push(contentType);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function mergeJobContexts(
  delayedContext: unknown,
  jobContext: Record<string, unknown>,
): Record<string, unknown> {
  const delayed = objectRecord(delayedContext) ?? {};
  const merged: Record<string, unknown> = {
    ...delayed,
    ...jobContext,
  };
  const delayedStrings = objectRecord(delayed.eventStrings);
  const jobStrings = objectRecord(jobContext.eventStrings);
  if (delayedStrings || jobStrings) {
    merged.eventStrings = {
      ...(objectRecord(delayed.eventStrings) ?? {}),
      ...(objectRecord(jobContext.eventStrings) ?? {}),
    };
  }
  const delayedVariables = objectRecord(delayed.eventVariables);
  const jobVariables = objectRecord(jobContext.eventVariables);
  if (delayedVariables || jobVariables) {
    merged.eventVariables = {
      ...(objectRecord(delayed.eventVariables) ?? {}),
      ...(objectRecord(jobContext.eventVariables) ?? {}),
    };
  }
  return merged;
}

function stringFromContext(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stringRecord(value: unknown): WorkflowStringContext | null {
  const record = objectRecord(value);
  if (!record) return null;
  const result: WorkflowStringContext = {};
  for (const [key, item] of Object.entries(record)) {
    result[key] = String(item ?? '');
  }
  return result;
}

function variableRecord(value: unknown): WorkflowVariableContext | null {
  const record = objectRecord(value);
  if (!record) return null;
  const result: WorkflowVariableContext = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean' || item === null) {
      result[key] = item;
    }
  }
  return result;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function contextHasOutbound(value: Record<string, unknown>): boolean {
  return objectRecord(value.outbound) !== null;
}

function contextForcesWorkflowReapply(value: Record<string, unknown>): boolean {
  return value.forceWorkflowReapply === true || value.workflowBackfill === true;
}

function contextCompletesWorkflow(value: Record<string, unknown>): boolean {
  return value.workflowTerminalSuccess === true;
}

function contextSkipsSpamOrReview(value: Record<string, unknown>): boolean {
  return value.skipIfMessageSpamOrReview === true;
}

function messageIsSpamOrReview(message: MessageRow): boolean {
  const status = String(message.spam_status ?? '').toLowerCase();
  const label = String(message.spam_score_label ?? '').toLowerCase();
  return (
    message.is_spam === true
    || status === 'spam'
    || status === 'review'
    || label === 'spam'
    || label === 'review'
  );
}

function outboundMessageIdFromContext(value: Record<string, unknown>): number | null {
  const outbound = objectRecord(value.outbound);
  const raw = outbound?.messageId;
  const numeric = Number(raw);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function workflowSourceSqliteId(workflow: WorkflowRow): number {
  const id = Number(workflow.id);
  return workflow.source_sqlite_id === null ? -id : Number(workflow.source_sqlite_id);
}

function nullableSourceSqliteId(value: unknown, fallbackId: number): number {
  return value === null || value === undefined ? -fallbackId : Number(value);
}

function blockedResult(reason: string, existingLog: string[] = []): GraphRunResult {
  existingLog.push(reason);
  return {
    status: 'blocked',
    blocked: true,
    deferred: false,
    blockReason: reason,
    log: existingLog,
  };
}

function serverWorkerSourceRow() {
  return { origin: 'server_worker' };
}

function serverCreatedWorkflowTaskSourceSqliteId(
  context: ServerWorkflowContext,
  nodeId: string,
  customerId: number,
): number {
  return serverCreatedSourceSqliteId(
    'tasks',
    context.workspaceId,
    String(context.workflowSourceSqliteId),
    workflowSideEffectExecutionIdentity(context),
    nodeId,
    String(customerId),
  );
}

function serverCreatedWorkflowActivityLogSourceSqliteId(
  context: ServerWorkflowContext,
  nodeId: string,
  customerId: number,
): number {
  return serverCreatedSourceSqliteId(
    'activity_log',
    context.workspaceId,
    String(context.workflowSourceSqliteId),
    workflowSideEffectExecutionIdentity(context),
    nodeId,
    String(customerId),
  );
}

const MAX_WORKFLOW_CONTINUATION_CONTEXT_JSON_LENGTH = 128 * 1024;

function workflowContinuationContextError(context: ServerWorkflowContext): string | null {
  if (
    JSON.stringify(context.strings).length > MAX_WORKFLOW_CONTINUATION_CONTEXT_JSON_LENGTH
    || JSON.stringify(context.variables).length > MAX_WORKFLOW_CONTINUATION_CONTEXT_JSON_LENGTH
  ) {
    return `Continuation-Kontext ueberschreitet ${MAX_WORKFLOW_CONTINUATION_CONTEXT_JSON_LENGTH} JSON-Zeichen`;
  }
  return null;
}

function workflowHttpIdempotencyKey(context: ServerWorkflowContext, nodeId: string): string {
  const hash = createHash('sha256')
    .update(context.workspaceId)
    .update('\0')
    .update(String(context.workflowSourceSqliteId))
    .update('\0')
    .update(workflowSideEffectExecutionIdentity(context))
    .update('\0')
    .update(nodeId);
  // Inside logic.loop each iteration is a distinct legitimate request, so the
  // loop position joins the digest. Retries of the same queued job reuse the
  // key stored in the job payload, so retry stability is unaffected.
  const loopIndex = context.variables['loop.index'];
  const loopItem = context.variables['loop.item'];
  if (loopIndex !== undefined || loopItem !== undefined) {
    hash
      .update('\0')
      .update(`loop:${String(loopIndex ?? '')}`)
      .update('\0')
      .update(String(loopItem ?? ''));
  }
  return `simplecrm-workflow-http-${hash.digest('hex')}`;
}

function workflowSideEffectExecutionIdentity(context: ServerWorkflowContext): string {
  const messageIdentity = context.messageSourceSqliteId ?? context.messageId;
  return messageIdentity === null
    ? `run:${context.runSourceSqliteId}`
    : `message:${messageIdentity}`;
}

function serverCreatedWorkflowDealStageActivitySourceSqliteId(
  context: ServerWorkflowContext,
  nodeId: string,
  dealId: number,
  oldStage: string,
  newStage: string,
): number {
  return serverCreatedSourceSqliteId(
    'activity_log',
    context.workspaceId,
    'deal_stage_change',
    String(context.workflowSourceSqliteId),
    String(context.runSourceSqliteId),
    nodeId,
    String(dealId),
    oldStage,
    newStage,
  );
}

function serverCreatedWorkflowEmailCategorySourceSqliteId(
  workspaceId: string,
  fullPath: readonly string[],
): number {
  return serverCreatedSourceSqliteId(
    'email_categories',
    workspaceId,
    ...fullPath.map((part) => part.toLowerCase()),
  );
}

function serverCreatedWorkflowMessageCategorySourceSqliteId(
  workspaceId: string,
  messageSourceSqliteId: number,
  categorySourceSqliteId: number,
): number {
  return serverCreatedSourceSqliteId(
    'email_message_categories',
    workspaceId,
    String(messageSourceSqliteId),
    String(categorySourceSqliteId),
  );
}

function serverCreatedWorkflowSpamLearningEventSourceSqliteId(
  workspaceId: string,
  messageSourceSqliteId: number,
  label: 'spam' | 'ham',
  now: Date,
): number {
  return serverCreatedSourceSqliteId(
    'email_spam_learning_events',
    workspaceId,
    String(messageSourceSqliteId),
    label,
    now.toISOString(),
  );
}

function serverCreatedSourceSqliteId(kind: string, ...parts: string[]): number {
  const value = [kind, ...parts].join('\u001f');
  let hash = 14_695_981_039_346_656_037n;
  for (let index = 0; index < value.length; index++) {
    hash ^= BigInt(value.charCodeAt(index));
    hash *= 1_099_511_628_211n;
    hash &= 0xffff_ffff_ffff_ffffn;
  }
  return -Number(SERVER_CREATED_SOURCE_ID_OFFSET + (hash % SERVER_CREATED_SOURCE_ID_SPAN));
}
