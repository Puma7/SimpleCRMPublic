import type { JobPayload } from './types';
import type { JobHandlerRegistry } from './worker';
import { isTrustedServiceJobPayload } from './policy';
import type {
  AiClassificationContextMode,
  AiAgentJobPlan,
  AiAgentJobPort,
  AiClassificationJobPort,
  AiClassificationJobPlan,
  AiPickCannedJobPlan,
  AiPickCannedJobPort,
  AiReviewJobPlan,
  AiReviewJobPort,
  AiTransformTextJobPlan,
  AiTransformTextJobPort,
} from '../ai-classification';
import type {
  WorkflowHttpMethod,
  WorkflowHttpRequestJobPlan,
  WorkflowHttpRequestJobPort,
} from '../workflow-http-request';
import type {
  WorkflowForwardCopyJobPlan,
  WorkflowForwardCopyJobPort,
} from '../workflow-forward-copy';
import type {
  WorkflowDmarcIngestJobPlan,
  WorkflowDmarcIngestJobPort,
} from '../dmarc-ingest';

export type MailSyncProtocol = 'imap' | 'pop3';

export type MailSyncJobPlan = Readonly<{
  workspaceId: string;
  accountId: number;
  protocol: MailSyncProtocol;
  actorUserId?: string;
  /** One-shot full inbox backfill: ignore the first-sync cap and import older
   *  (already-read) messages that were skipped, without moving the sync cursor. */
  fullInbox?: boolean;
}>;

export type MailSyncJobResult = Readonly<{
  inboundMessageIds?: readonly number[];
  replySuggestionMessageIds?: readonly number[];
  automatedEvidenceMessageIds?: readonly number[];
}>;

export type ScheduledSendJobPlan = Readonly<{
  workspaceId: string;
  accountId?: number;
  draftId?: number;
  dueBefore: Date;
  limit: number;
}>;

export type AiReplySuggestionJobPlan = Readonly<{
  workspaceId: string;
  messageId: number;
  actorUserId?: string;
  profileId?: number;
  promptId?: number;
  trigger?: 'inbound' | 'open';
  force: boolean;
  skipIfReady?: boolean;
}>;

export type MailVacationAutoReplyJobPlan = Readonly<{
  workspaceId: string;
  messageId: number;
  actorUserId?: string;
}>;

export type { AiClassificationJobPlan };
export type { AiAgentJobPlan };
export type { AiReviewJobPlan };
export type { AiTransformTextJobPlan };
export type { WorkflowHttpRequestJobPlan };
export type { WorkflowForwardCopyJobPlan };
export type { WorkflowDmarcIngestJobPlan };

export type WorkflowExecutionJobPlan = Readonly<{
  workspaceId: string;
  workflowId: number;
  messageId?: number;
  runId?: number;
  delayedJobId?: number;
  triggerName?: string;
  actorUserId?: string;
  trustedService?: boolean;
  context: JobPayload;
}>;

export type WorkflowExecutionDryRunResult = Readonly<{
  success: boolean;
  dryRun: true;
  workflowId?: number;
  messageId?: number;
  status?: 'ok' | 'error' | 'blocked';
  blocked?: boolean;
  blockReason?: string | null;
  log?: readonly string[];
  error?: string;
}>;

export type MailSyncJobPort = Readonly<{
  sync(input: MailSyncJobPlan): Promise<MailSyncJobResult | void>;
}>;

export type ScheduledSendJobPort = Readonly<{
  processDue(input: ScheduledSendJobPlan): Promise<void>;
}>;

export type AiReplySuggestionJobPort = Readonly<{
  ensure(input: AiReplySuggestionJobPlan): Promise<void>;
}>;

export type MailVacationAutoReplyJobPort = Readonly<{
  autoReply(input: MailVacationAutoReplyJobPlan): Promise<void>;
}>;

export type WorkflowExecutionJobPort = Readonly<{
  execute(input: WorkflowExecutionJobPlan): Promise<void>;
  dryRun?(input: WorkflowExecutionJobPlan): Promise<WorkflowExecutionDryRunResult>;
}>;

export type WorkflowHttpRequestPort = WorkflowHttpRequestJobPort;
export type WorkflowForwardCopyPort = WorkflowForwardCopyJobPort;
export type WorkflowDmarcIngestPort = WorkflowDmarcIngestJobPort;

export type MailSyncPostProcessPort = Readonly<{
  afterSync(input: MailSyncJobPlan & {
    syncStartedAt: Date;
    syncFinishedAt: Date;
    result: MailSyncJobResult | null;
  }): Promise<void>;
}>;

export type ProductionJobHandlersOptions = Readonly<{
  mailSync?: MailSyncJobPort;
  mailSyncPostProcess?: MailSyncPostProcessPort;
  scheduledSend?: ScheduledSendJobPort;
  mailVacationAutoReply?: MailVacationAutoReplyJobPort;
  aiReplySuggestion?: AiReplySuggestionJobPort;
  aiAgent?: AiAgentJobPort;
  aiPickCanned?: AiPickCannedJobPort;
  aiClassification?: AiClassificationJobPort;
  aiReview?: AiReviewJobPort;
  aiTransformText?: AiTransformTextJobPort;
  workflowExecution?: WorkflowExecutionJobPort;
  workflowHttpRequest?: WorkflowHttpRequestPort;
  workflowForwardCopy?: WorkflowForwardCopyPort;
  workflowDmarcIngest?: WorkflowDmarcIngestPort;
  now?: () => Date;
}>;

const DEFAULT_SCHEDULED_SEND_LIMIT = 50;
const MAX_SCHEDULED_SEND_LIMIT = 1000;
const MAX_CONTEXT_JSON_LENGTH = 128 * 1024;
const MAX_TRIGGER_NAME_LENGTH = 128;
const DEFAULT_WORKFLOW_HTTP_TIMEOUT_MS = 30_000;
const MAX_WORKFLOW_HTTP_TIMEOUT_MS = 60_000;
const MAX_WORKFLOW_HTTP_URL_LENGTH = 2048;
const MAX_WORKFLOW_HTTP_BODY_LENGTH = 128 * 1024;
const MAX_WORKFLOW_FORWARD_COPY_TO_LENGTH = 1000;
const MAX_DMARC_ATTACHMENT_FILTER_LENGTH = 200;

export function createProductionJobHandlers(options: ProductionJobHandlersOptions): JobHandlerRegistry {
  const now = options.now ?? (() => new Date());
  return {
    'mail.sync.imap': async (job) => {
      if (!options.mailSync) throw new Error('mail sync job port is not configured');
      await runMailSyncWithPostProcess(options, buildMailSyncJobPlan(job.payload, job.workspaceId, 'imap'), now);
    },
    'mail.sync.pop3': async (job) => {
      if (!options.mailSync) throw new Error('mail sync job port is not configured');
      await runMailSyncWithPostProcess(options, buildMailSyncJobPlan(job.payload, job.workspaceId, 'pop3'), now);
    },
    'mail.send.scheduled': async (job) => {
      if (!options.scheduledSend) throw new Error('scheduled send job port is not configured');
      await options.scheduledSend.processDue(buildScheduledSendJobPlan(job.payload, job.workspaceId, now()));
    },
    'mail.vacation.auto_reply': async (job) => {
      if (!options.mailVacationAutoReply) throw new Error('mail vacation auto-reply job port is not configured');
      await options.mailVacationAutoReply.autoReply(buildMailVacationAutoReplyJobPlan(job.payload, job.workspaceId));
    },
    'ai.reply_suggestion': async (job) => {
      if (!options.aiReplySuggestion) throw new Error('AI reply suggestion job port is not configured');
      await options.aiReplySuggestion.ensure(buildAiReplySuggestionJobPlan(job.payload, job.workspaceId));
    },
    'ai.agent': async (job) => {
      if (!options.aiAgent) throw new Error('AI agent job port is not configured');
      await options.aiAgent.runAgent(buildAiAgentJobPlan(job.payload, job.workspaceId));
    },
    'ai.pick_canned': async (job) => {
      if (!options.aiPickCanned) throw new Error('AI pick-canned job port is not configured');
      await options.aiPickCanned.pickCanned(buildAiPickCannedJobPlan(job.payload, job.workspaceId));
    },
    'ai.classify': async (job) => {
      if (!options.aiClassification) throw new Error('AI classification job port is not configured');
      await options.aiClassification.classify(buildAiClassificationJobPlan(job.payload, job.workspaceId));
    },
    'ai.review': async (job) => {
      if (!options.aiReview) throw new Error('AI review job port is not configured');
      await options.aiReview.review(buildAiReviewJobPlan(job.payload, job.workspaceId));
    },
    'ai.transform_text': async (job) => {
      if (!options.aiTransformText) throw new Error('AI transform text job port is not configured');
      await options.aiTransformText.transformText(buildAiTransformTextJobPlan(job.payload, job.workspaceId));
    },
    'workflow.execute': async (job) => {
      if (!options.workflowExecution) throw new Error('workflow execution job port is not configured');
      await options.workflowExecution.execute(buildWorkflowExecutionJobPlan(job.payload, job.workspaceId));
    },
    'workflow.http_request': async (job) => {
      if (!options.workflowHttpRequest) throw new Error('workflow HTTP request job port is not configured');
      await options.workflowHttpRequest.request(buildWorkflowHttpRequestJobPlan(job.payload, job.workspaceId));
    },
    'workflow.forward_copy': async (job) => {
      if (!options.workflowForwardCopy) throw new Error('workflow forward-copy job port is not configured');
      await options.workflowForwardCopy.forwardCopy(buildWorkflowForwardCopyJobPlan(job.payload, job.workspaceId));
    },
    'workflow.dmarc_ingest': async (job) => {
      if (!options.workflowDmarcIngest) throw new Error('workflow DMARC ingest job port is not configured');
      await options.workflowDmarcIngest.ingest(buildWorkflowDmarcIngestJobPlan(job.payload, job.workspaceId));
    },
  };
}

async function runMailSyncWithPostProcess(
  options: ProductionJobHandlersOptions,
  plan: MailSyncJobPlan,
  now: () => Date,
): Promise<void> {
  if (!options.mailSync) throw new Error('mail sync job port is not configured');
  const syncStartedAt = now();
  const result = await options.mailSync.sync(plan) ?? null;
  if (!options.mailSyncPostProcess) return;
  await options.mailSyncPostProcess.afterSync({
    ...plan,
    syncStartedAt,
    syncFinishedAt: now(),
    result,
  });
}

export function buildMailSyncJobPlan(
  payload: JobPayload,
  jobWorkspaceId: string,
  protocol: MailSyncProtocol,
): MailSyncJobPlan {
  return {
    workspaceId: matchingWorkspaceId(payload, jobWorkspaceId),
    accountId: requiredPositiveInteger(payload, 'accountId'),
    protocol,
    ...optionalString(payload, 'actorUserId'),
    ...optionalBooleanProperty(payload, 'fullInbox'),
  };
}

export function buildScheduledSendJobPlan(
  payload: JobPayload,
  jobWorkspaceId: string,
  now: Date,
): ScheduledSendJobPlan {
  return {
    workspaceId: matchingWorkspaceId(payload, jobWorkspaceId),
    ...optionalPositiveInteger(payload, 'accountId'),
    ...optionalPositiveInteger(payload, 'draftId'),
    dueBefore: optionalDate(payload, 'dueBefore', now),
    limit: optionalInteger(payload, 'limit', DEFAULT_SCHEDULED_SEND_LIMIT, 1, MAX_SCHEDULED_SEND_LIMIT),
  };
}

export function buildAiReplySuggestionJobPlan(
  payload: JobPayload,
  jobWorkspaceId: string,
): AiReplySuggestionJobPlan {
  return {
    workspaceId: matchingWorkspaceId(payload, jobWorkspaceId),
    messageId: requiredPositiveInteger(payload, 'messageId'),
    ...optionalString(payload, 'actorUserId'),
    ...optionalPositiveInteger(payload, 'profileId'),
    ...optionalPositiveInteger(payload, 'promptId'),
    ...optionalReplySuggestionTrigger(payload),
    force: optionalBoolean(payload, 'force', false),
    ...optionalBooleanProperty(payload, 'skipIfReady'),
  };
}

export function buildMailVacationAutoReplyJobPlan(
  payload: JobPayload,
  jobWorkspaceId: string,
): MailVacationAutoReplyJobPlan {
  return {
    workspaceId: matchingWorkspaceId(payload, jobWorkspaceId),
    messageId: requiredPositiveInteger(payload, 'messageId'),
    ...optionalString(payload, 'actorUserId'),
  };
}

export function buildAiClassificationJobPlan(
  payload: JobPayload,
  jobWorkspaceId: string,
): AiClassificationJobPlan {
  return {
    workspaceId: matchingWorkspaceId(payload, jobWorkspaceId),
    messageId: requiredPositiveInteger(payload, 'messageId'),
    ...optionalString(payload, 'actorUserId'),
    ...optionalPositiveInteger(payload, 'profileId'),
    labels: requiredStringList(payload, 'labels', 20, 80),
    contextMode: optionalClassificationContextMode(payload, 'contextMode'),
    ...optionalClassificationContinuation(payload, optionalString(payload, 'actorUserId').actorUserId, isTrustedServiceJobPayload(payload)),
  };
}

export function buildAiAgentJobPlan(
  payload: JobPayload,
  jobWorkspaceId: string,
): AiAgentJobPlan {
  return {
    workspaceId: matchingWorkspaceId(payload, jobWorkspaceId),
    ...optionalPositiveInteger(payload, 'messageId'),
    ...optionalString(payload, 'actorUserId'),
    ...optionalPositiveInteger(payload, 'profileId'),
    systemPrompt: optionalStringValue(
      payload,
      'systemPrompt',
      'Du bist ein CRM-Assistent. Nutze die Wissensbasis. Antworte kurz.',
      4000,
    ),
    ...optionalPositiveInteger(payload, 'knowledgeBaseId'),
    ...(payload.autoKnowledge === undefined ? {} : { autoKnowledge: optionalBoolean(payload, 'autoKnowledge', false) }),
    ...optionalString(payload, 'direction'),
    createDraft: optionalBoolean(payload, 'createDraft', false),
    ...(payload.eventStrings === undefined ? {} : { eventStrings: optionalContext(payload, 'eventStrings') }),
    ...(payload.eventVariables === undefined ? {} : { eventVariables: optionalContext(payload, 'eventVariables') }),
    ...optionalClassificationContinuation(payload, optionalString(payload, 'actorUserId').actorUserId, isTrustedServiceJobPayload(payload)),
  };
}

export function buildAiPickCannedJobPlan(
  payload: JobPayload,
  jobWorkspaceId: string,
): AiPickCannedJobPlan {
  return {
    workspaceId: matchingWorkspaceId(payload, jobWorkspaceId),
    ...optionalPositiveInteger(payload, 'messageId'),
    ...optionalString(payload, 'actorUserId'),
    ...optionalPositiveInteger(payload, 'profileId'),
    createDraft: optionalBoolean(payload, 'createDraft', false),
    ...(payload.eventStrings === undefined ? {} : { eventStrings: optionalContext(payload, 'eventStrings') }),
    ...(payload.eventVariables === undefined ? {} : { eventVariables: optionalContext(payload, 'eventVariables') }),
    ...optionalClassificationContinuation(payload, optionalString(payload, 'actorUserId').actorUserId, isTrustedServiceJobPayload(payload)),
  };
}

export function buildAiReviewJobPlan(
  payload: JobPayload,
  jobWorkspaceId: string,
): AiReviewJobPlan {
  return {
    workspaceId: matchingWorkspaceId(payload, jobWorkspaceId),
    ...optionalPositiveInteger(payload, 'messageId'),
    ...optionalString(payload, 'actorUserId'),
    ...optionalPositiveInteger(payload, 'profileId'),
    ...optionalPositiveInteger(payload, 'promptId'),
    blockKeyword: optionalStringValue(payload, 'blockKeyword', 'BLOCK', 120),
    direction: optionalWorkflowDirection(payload),
    ...optionalString(payload, 'systemPrompt', 4000),
    ...optionalString(payload, 'fallbackUserTemplate', 20_000),
    ...(payload.eventStrings === undefined ? {} : { eventStrings: optionalContext(payload, 'eventStrings') }),
    ...(payload.eventVariables === undefined ? {} : { eventVariables: optionalContext(payload, 'eventVariables') }),
    ...optionalClassificationContinuation(payload, optionalString(payload, 'actorUserId').actorUserId, isTrustedServiceJobPayload(payload)),
  };
}

export function buildAiTransformTextJobPlan(
  payload: JobPayload,
  jobWorkspaceId: string,
): AiTransformTextJobPlan {
  return {
    workspaceId: matchingWorkspaceId(payload, jobWorkspaceId),
    ...optionalPositiveInteger(payload, 'messageId'),
    ...optionalString(payload, 'actorUserId'),
    ...optionalPositiveInteger(payload, 'profileId'),
    ...optionalPositiveInteger(payload, 'promptId'),
    targetVariable: optionalStringValue(payload, 'targetVariable', 'ai.text', 120),
    ...(payload.eventStrings === undefined ? {} : { eventStrings: optionalContext(payload, 'eventStrings') }),
    ...(payload.eventVariables === undefined ? {} : { eventVariables: optionalContext(payload, 'eventVariables') }),
    ...optionalClassificationContinuation(payload, optionalString(payload, 'actorUserId').actorUserId, isTrustedServiceJobPayload(payload)),
  };
}

export function buildWorkflowExecutionJobPlan(
  payload: JobPayload,
  jobWorkspaceId: string,
): WorkflowExecutionJobPlan {
  return {
    workspaceId: matchingWorkspaceId(payload, jobWorkspaceId),
    workflowId: requiredPositiveInteger(payload, 'workflowId'),
    ...optionalPositiveInteger(payload, 'messageId'),
    ...optionalPositiveInteger(payload, 'runId'),
    ...optionalPositiveInteger(payload, 'delayedJobId'),
    ...optionalString(payload, 'triggerName', MAX_TRIGGER_NAME_LENGTH),
    ...optionalString(payload, 'actorUserId'),
    ...optionalTrustedService(payload),
    context: optionalContext(payload, 'context'),
  };
}

export function buildWorkflowHttpRequestJobPlan(
  payload: JobPayload,
  jobWorkspaceId: string,
): WorkflowHttpRequestJobPlan {
  const method = optionalHttpMethod(payload, 'method', 'GET');
  return {
    workspaceId: matchingWorkspaceId(payload, jobWorkspaceId),
    ...optionalPositiveInteger(payload, 'messageId'),
    ...optionalString(payload, 'actorUserId'),
    method,
    url: requiredStringValue(payload, 'url', MAX_WORKFLOW_HTTP_URL_LENGTH),
    ...(method === 'GET' ? {} : optionalBody(payload, 'body', MAX_WORKFLOW_HTTP_BODY_LENGTH)),
    ...(method === 'GET' ? {} : optionalString(payload, 'idempotencyKey', 256)),
    timeoutMs: optionalInteger(payload, 'timeoutMs', DEFAULT_WORKFLOW_HTTP_TIMEOUT_MS, 1000, MAX_WORKFLOW_HTTP_TIMEOUT_MS),
    ...(payload.eventStrings === undefined ? {} : { eventStrings: optionalContext(payload, 'eventStrings') }),
    ...(payload.eventVariables === undefined ? {} : { eventVariables: optionalContext(payload, 'eventVariables') }),
    ...optionalWorkflowHttpContinuation(payload, optionalString(payload, 'actorUserId').actorUserId, isTrustedServiceJobPayload(payload)),
  };
}

export function buildWorkflowForwardCopyJobPlan(
  payload: JobPayload,
  jobWorkspaceId: string,
): WorkflowForwardCopyJobPlan {
  return {
    workspaceId: matchingWorkspaceId(payload, jobWorkspaceId),
    workflowId: requiredPositiveInteger(payload, 'workflowId'),
    messageId: requiredPositiveInteger(payload, 'messageId'),
    ...optionalString(payload, 'actorUserId'),
    to: requiredStringValue(payload, 'to', MAX_WORKFLOW_FORWARD_COPY_TO_LENGTH),
    includeAttachments: optionalBoolean(payload, 'includeAttachments', false),
    runOutboundReview: optionalBoolean(payload, 'runOutboundReview', false),
    ...(payload.eventStrings === undefined ? {} : { eventStrings: optionalContext(payload, 'eventStrings') }),
    ...(payload.eventVariables === undefined ? {} : { eventVariables: optionalContext(payload, 'eventVariables') }),
    ...optionalClassificationContinuation(payload, optionalString(payload, 'actorUserId').actorUserId, isTrustedServiceJobPayload(payload)),
  };
}

export function buildWorkflowDmarcIngestJobPlan(
  payload: JobPayload,
  jobWorkspaceId: string,
): WorkflowDmarcIngestJobPlan {
  return {
    workspaceId: matchingWorkspaceId(payload, jobWorkspaceId),
    workflowId: requiredPositiveInteger(payload, 'workflowId'),
    messageId: requiredPositiveInteger(payload, 'messageId'),
    ...optionalString(payload, 'actorUserId'),
    ...optionalString(payload, 'attachmentNameFilter', MAX_DMARC_ATTACHMENT_FILTER_LENGTH),
    ...optionalClassificationContinuation(payload, optionalString(payload, 'actorUserId').actorUserId, isTrustedServiceJobPayload(payload)),
  };
}

function matchingWorkspaceId(payload: JobPayload, jobWorkspaceId: string): string {
  const workspaceId = requiredString(payload, 'workspaceId');
  if (workspaceId !== jobWorkspaceId) {
    throw new Error('workspaceId must match the queued job workspace');
  }
  return workspaceId;
}

function requiredStringValue(payload: JobPayload, key: string, maxLength: number): string {
  const value = requiredString(payload, key);
  if (value.length > maxLength) {
    throw new Error(`${key} must not exceed ${maxLength} characters`);
  }
  return value;
}

function requiredString(payload: JobPayload, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

function optionalString(
  payload: JobPayload,
  key: string,
  maxLength = 300,
): Record<string, string> {
  const value = payload[key];
  if (value === undefined || value === null || value === '') return {};
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} must be a non-empty string`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new Error(`${key} must not exceed ${maxLength} characters`);
  }
  return { [key]: trimmed };
}

function optionalStringValue(
  payload: JobPayload,
  key: string,
  fallback: string,
  maxLength: number,
): string {
  const value = payload[key];
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} must be a non-empty string`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new Error(`${key} must not exceed ${maxLength} characters`);
  }
  return trimmed;
}

function requiredPositiveInteger(payload: JobPayload, key: string): number {
  const value = payload[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return value;
}

function optionalPositiveInteger(payload: JobPayload, key: string): Record<string, number> {
  const value = payload[key];
  if (value === undefined || value === null || value === '') return {};
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return { [key]: value };
}

function optionalInteger(
  payload: JobPayload,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = payload[key];
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function optionalBoolean(payload: JobPayload, key: string, fallback: boolean): boolean {
  const value = payload[key];
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'boolean') throw new Error(`${key} must be a boolean`);
  return value;
}

function optionalBooleanProperty(payload: JobPayload, key: string): Record<string, boolean> {
  const value = payload[key];
  if (value === undefined || value === null || value === '') return {};
  if (typeof value !== 'boolean') throw new Error(`${key} must be a boolean`);
  return { [key]: value };
}

function optionalHttpMethod(
  payload: JobPayload,
  key: string,
  fallback: WorkflowHttpMethod,
): WorkflowHttpMethod {
  const value = payload[key];
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') throw new Error(`${key} must be GET or POST`);
  const normalized = value.trim().toUpperCase();
  if (normalized === 'GET' || normalized === 'POST') return normalized;
  throw new Error(`${key} must be GET or POST`);
}

function optionalBody(
  payload: JobPayload,
  key: string,
  maxLength: number,
): Record<string, string> {
  const value = payload[key];
  if (value === undefined || value === null) return {};
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  if (body.length > maxLength) {
    throw new Error(`${key} must not exceed ${maxLength} characters`);
  }
  return body ? { [key]: body } : {};
}

function optionalReplySuggestionTrigger(payload: JobPayload): Record<string, 'inbound' | 'open'> {
  const value = payload.trigger;
  if (value === undefined || value === null || value === '') return {};
  if (value !== 'inbound' && value !== 'open') {
    throw new Error('trigger must be inbound or open');
  }
  return { trigger: value };
}

function optionalClassificationContextMode(
  payload: JobPayload,
  key: string,
): AiClassificationContextMode {
  const value = payload[key];
  if (value === undefined || value === null || value === '') return 'metadata';
  if (value === 'metadata' || value === 'full') return value;
  throw new Error(`${key} must be metadata or full`);
}

function optionalWorkflowDirection(payload: JobPayload): 'inbound' | 'outbound' {
  const value = payload.direction;
  if (value === undefined || value === null || value === '') return 'inbound';
  if (value === 'inbound' || value === 'outbound') return value;
  throw new Error('direction must be inbound or outbound');
}

function requiredStringList(
  payload: JobPayload,
  key: string,
  maxItems: number,
  maxItemLength: number,
): readonly string[] {
  const value = payload[key];
  const items = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const labels = items
    .map((item) => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean);
  if (labels.length === 0) throw new Error(`${key} must contain at least one label`);
  if (labels.length > maxItems) throw new Error(`${key} must contain at most ${maxItems} labels`);
  for (const label of labels) {
    if (label.length > maxItemLength) {
      throw new Error(`${key} entries must not exceed ${maxItemLength} characters`);
    }
  }
  return labels;
}

function optionalClassificationContinuation(
  payload: JobPayload,
  actorUserId?: string,
  trustedService = false,
): Pick<AiClassificationJobPlan, 'continuation'> {
  const value = payload.continuation;
  if (value === undefined || value === null) return {};
  if (!isPlainRecord(value)) throw new Error('continuation must be an object');
  return {
    continuation: {
      workflowId: requiredPositiveInteger(value as JobPayload, 'workflowId'),
      ...optionalString(value as JobPayload, 'triggerName', MAX_TRIGGER_NAME_LENGTH),
      ...(actorUserId ? { actorUserId } : optionalString(value as JobPayload, 'actorUserId')),
      ...(trustedService && !actorUserId ? { trustedService: true } : {}),
      resumeNodeId: requiredString(value as JobPayload, 'resumeNodeId'),
      ...(value.eventStrings === undefined ? {} : { eventStrings: optionalContext(value as JobPayload, 'eventStrings') }),
      ...(value.eventVariables === undefined ? {} : { eventVariables: optionalContext(value as JobPayload, 'eventVariables') }),
    },
  };
}

function optionalWorkflowHttpContinuation(
  payload: JobPayload,
  actorUserId?: string,
  trustedService = false,
): Pick<WorkflowHttpRequestJobPlan, 'continuation'> {
  const value = payload.continuation;
  if (value === undefined || value === null) return {};
  if (!isPlainRecord(value)) throw new Error('continuation must be an object');
  const continuationPayload = value as JobPayload;
  const resumeNodeId = optionalString(continuationPayload, 'resumeNodeId');
  const errorResumeNodeId = optionalString(continuationPayload, 'errorResumeNodeId');
  if (!resumeNodeId.resumeNodeId && !errorResumeNodeId.errorResumeNodeId) {
    throw new Error('continuation must define resumeNodeId or errorResumeNodeId');
  }
  return {
    continuation: {
      workflowId: requiredPositiveInteger(continuationPayload, 'workflowId'),
      ...optionalString(continuationPayload, 'triggerName', MAX_TRIGGER_NAME_LENGTH),
      ...(actorUserId ? { actorUserId } : optionalString(continuationPayload, 'actorUserId')),
      ...(trustedService && !actorUserId ? { trustedService: true } : {}),
      ...resumeNodeId,
      ...errorResumeNodeId,
      ...optionalBooleanProperty(continuationPayload, 'completeOnSuccess'),
      ...(value.eventStrings === undefined ? {} : { eventStrings: optionalContext(continuationPayload, 'eventStrings') }),
      ...(value.eventVariables === undefined ? {} : { eventVariables: optionalContext(continuationPayload, 'eventVariables') }),
    },
  };
}

function optionalTrustedService(payload: JobPayload): { trustedService?: true } {
  return isTrustedServiceJobPayload(payload) ? { trustedService: true } : {};
}

function optionalDate(payload: JobPayload, key: string, fallback: Date): Date {
  const value = payload[key];
  if (value === undefined || value === null || value === '') return fallback;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== 'string') throw new Error(`${key} must be an ISO timestamp`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${key} must be an ISO timestamp`);
  return date;
}

function optionalContext(payload: JobPayload, key: string): JobPayload {
  const value = payload[key];
  if (value === undefined || value === null) return {};
  if (!isPlainRecord(value)) throw new Error(`${key} must be an object`);
  const json = JSON.stringify(value);
  if (json.length > MAX_CONTEXT_JSON_LENGTH) {
    throw new Error(`${key} must not exceed ${MAX_CONTEXT_JSON_LENGTH} JSON characters`);
  }
  return value as JobPayload;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
