export const JOB_DEFAULT_MAX_ATTEMPTS = 5;
export const JOB_RETRY_BASE_DELAY_SECONDS = 30;
export const JOB_RETRY_MAX_DELAY_SECONDS = 60 * 60;
export const JOB_STALE_LOCK_SECONDS = 5 * 60;
export const JOB_AI_DEFAULT_CONCURRENCY = 5;
export const JOB_AI_MAX_CONCURRENCY = 100;

export const SERVER_JOB_TYPES = [
  'mail.sync.imap',
  'mail.sync.pop3',
  'mail.spam.score',
  'mail.vacation.auto_reply',
  'mail.send.scheduled',
  'ai.reply_suggestion',
  'ai.agent',
  'ai.classify',
  'ai.review',
  'ai.transform_text',
  'workflow.execute',
  'workflow.http_request',
  'workflow.forward_copy',
  'workflow.dmarc_ingest',
  'webhook.fire',
  'lock.cleanup',
  'audit.retention',
] as const;

export type ServerJobType = typeof SERVER_JOB_TYPES[number];

export type JobSqlCommand = Readonly<{
  sql: string;
  params: readonly unknown[];
}>;

export function assertValidJobType(type: string): string {
  const trimmed = type.trim();
  if (!/^[a-z][a-z0-9_.:-]{1,127}$/.test(trimmed)) {
    throw new Error('job type must be 2-128 chars and contain only lowercase letters, numbers, dot, colon, underscore, or dash');
  }
  return trimmed;
}

export function isServerJobType(type: string): type is ServerJobType {
  return (SERVER_JOB_TYPES as readonly string[]).includes(type);
}

export function assertServerJobType(type: string): ServerJobType {
  const validType = assertValidJobType(type);
  if (!isServerJobType(validType)) {
    throw new Error(`unsupported server job type: ${validType}`);
  }
  return validType;
}

export function normalizeMaxAttempts(value: number | undefined): number {
  if (value === undefined) return JOB_DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error('maxAttempts must be an integer between 1 and 100');
  }
  return value;
}

export function calculateJobRetryDelaySeconds(nextAttempt: number): number {
  if (!Number.isInteger(nextAttempt) || nextAttempt < 1) {
    throw new Error('nextAttempt must be a positive integer');
  }
  const delay = JOB_RETRY_BASE_DELAY_SECONDS * (2 ** (nextAttempt - 1));
  return Math.min(delay, JOB_RETRY_MAX_DELAY_SECONDS);
}

export function calculateMailSyncPoolSize(accountCount: number): number {
  if (!Number.isInteger(accountCount) || accountCount < 0) {
    throw new Error('accountCount must be a non-negative integer');
  }
  return Math.min(50, accountCount * 2);
}

export function normalizeAiJobConcurrency(value: number | undefined): number {
  if (value === undefined) return JOB_AI_DEFAULT_CONCURRENCY;
  if (!Number.isInteger(value) || value < 1 || value > JOB_AI_MAX_CONCURRENCY) {
    throw new Error(`AI job concurrency must be an integer between 1 and ${JOB_AI_MAX_CONCURRENCY}`);
  }
  return value;
}

/**
 * Shared key for the per-account sync advisory lock. Every path that fetches +
 * threads mail for an account MUST lock on this same key so concurrent syncs
 * (e.g. a Graphile-queued sync and a workflow-triggered legacy-queue sync for
 * the same account) serialize instead of both minting a thread for one
 * conversation. Used by both accountSyncAdvisoryLockCommand (job runner) and the
 * mail-sync message transaction.
 */
export function accountSyncAdvisoryLockKey(accountId: number | string): string {
  const normalized = String(accountId).trim();
  if (!normalized) {
    throw new Error('accountId is required for account sync advisory lock');
  }
  return `account-${normalized}`;
}

export function accountSyncAdvisoryLockCommand(accountId: number | string): JobSqlCommand {
  return {
    sql: 'SELECT pg_advisory_xact_lock(hashtext($1));',
    params: [accountSyncAdvisoryLockKey(accountId)],
  };
}

export function nextRunAfterForFailure(input: {
  attempts: number;
  now: Date;
}): Date {
  return new Date(input.now.getTime() + calculateJobRetryDelaySeconds(input.attempts) * 1000);
}
