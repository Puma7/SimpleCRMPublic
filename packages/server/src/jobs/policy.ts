import type { MailPermission } from '@simplecrm/core';
import type { MailResourceResolution } from '../mail-access/policy-manifest';
import type { JobPayload } from './types';

export const JOB_DEFAULT_MAX_ATTEMPTS = 5;
export const JOB_RETRY_BASE_DELAY_SECONDS = 30;
export const JOB_RETRY_MAX_DELAY_SECONDS = 60 * 60;
export const JOB_STALE_LOCK_SECONDS = 5 * 60;
export const JOB_AI_DEFAULT_CONCURRENCY = 5;
export const JOB_AI_MAX_CONCURRENCY = 100;
export const TRUSTED_SERVICE_JOB_MARKER_FIELD = '__simplecrmTrustedServicePrincipal';
export const TRUSTED_SERVICE_JOB_MARKER_VALUE = 'simplecrm:trusted-service:v1';
// Stamped server-side on a mail.spam.score job enqueued by the admin-only
// post-process/retry route. The base policy only rechecks mail.triage, so the
// worker re-verifies current owner/admin status for marked jobs (a demoted admin
// must not complete the retry's system-role security check / status writes /
// inbound-workflow enqueue). Never set from request bodies, so not forgeable.
export const POST_PROCESS_RETRY_JOB_MARKER_FIELD = '__simplecrmPostProcessRetry';
// Stamped server-side by the manual live-execute route (workflow-routes.ts) — the
// only workflow.execute producer that required owner/admin at enqueue for a
// side-effecting graph — and propagated onto that run's delayed continuations and
// side-effect child jobs. The worker re-verifies current owner/admin for marked
// jobs so a demoted admin cannot complete a run they queued while admin. Unmarked
// producers (compose outbound-review, inbound/automatic) were never admin-gated, so
// they are exempt from the admin recheck but still pass per-message ACL. Never set
// from a request body (job producers copy only known fields), so not forgeable.
export const MANUAL_ADMIN_WORKFLOW_EXECUTE_MARKER_FIELD = '__simplecrmManualAdminWorkflowExecute';

export const SERVER_JOB_TYPES = [
  'mail.sync.imap',
  'mail.sync.pop3',
  'mail.spam.score',
  'mail.vacation.auto_reply',
  'mail.send.scheduled',
  'ai.reply_suggestion',
  'ai.agent',
  'ai.pick_canned',
  'ai.classify',
  'ai.review',
  'ai.draft_reply',
  'ai.review_draft',
  'ai.transform_text',
  'workflow.execute',
  'workflow.http_request',
  'workflow.forward_copy',
  'workflow.dmarc_ingest',
  'webhook.fire',
  'lock.cleanup',
  'audit.retention',
  'mail.sync.schedule',
] as const;

export type ServerJobType = typeof SERVER_JOB_TYPES[number];

export type ServerJobActorMode = 'initiating_user' | 'initiating_user_or_service' | 'service';

export type ServerJobPolicyEntry =
  | Readonly<{
    type: ServerJobType;
    kind: 'mail';
    actorMode: ServerJobActorMode;
    permission: MailPermission;
    resource: MailResourceResolution;
  }>
  | Readonly<{
    type: ServerJobType;
    kind: 'non_mail';
    actorMode: ServerJobActorMode;
    classification: 'non_mail' | 'system_maintenance';
  }>;

const jobValue = <Field extends string>(field: Field) => ({ source: 'job' as const, field });
const accountJobResource = { kind: 'account' as const, accountId: jobValue('accountId') };
const messageJobResource = (field = 'messageId') => ({
  kind: 'message_lookup' as const,
  messageId: jobValue(field),
});
const optionalMessageJobResource = (whenAbsent: 'non_mail' | 'mail_scope' = 'non_mail') => ({
  kind: 'optional_message_lookup' as const,
  messageId: jobValue('messageId'),
  whenAbsent,
});

export const SERVER_JOB_POLICIES: readonly ServerJobPolicyEntry[] = Object.freeze([
  // Abholen ist eine LESE-Aktion, kein Verwaltungsvorgang.
  //
  // Frueher stand hier mail.account.manage — dieselbe Berechtigung wie Konto
  // loeschen, SMTP-Zugangsdaten aendern und OAuth neu verbinden. Von den fuenf
  // Profilen enthaelt sie nur 'manager'. Wer im Postfach arbeiten soll, konnte
  // also keine neuen Nachrichten holen; und weil es im Serverbetrieb keinen
  // periodischen Sync gibt (eingereiht wird nur ueber die Route und einen
  // Workflow-Knoten), warteten alle anderen strukturell auf einen Admin.
  //
  // mail.metadata.read ist die passende Schranke: wer das Postfach sehen darf,
  // darf es auch aktualisieren. Mehr Last als ein Lesevorgang entsteht dadurch
  // nicht — Graphile serialisiert je Konto ueber den Queue-Namen
  // 'account-<id>', und parallele Anfragen fallen ueber den jobKey zu einem
  // einzigen wartenden Lauf zusammen.
  {
    type: 'mail.sync.imap',
    kind: 'mail',
    actorMode: 'initiating_user_or_service',
    permission: 'mail.metadata.read',
    resource: accountJobResource,
  },
  {
    type: 'mail.sync.pop3',
    kind: 'mail',
    actorMode: 'initiating_user_or_service',
    permission: 'mail.metadata.read',
    resource: accountJobResource,
  },
  {
    type: 'mail.spam.score',
    kind: 'mail',
    actorMode: 'initiating_user_or_service',
    permission: 'mail.triage',
    resource: messageJobResource(),
  },
  {
    type: 'mail.vacation.auto_reply',
    kind: 'mail',
    actorMode: 'initiating_user_or_service',
    permission: 'mail.send',
    resource: messageJobResource(),
  },
  {
    type: 'mail.send.scheduled',
    kind: 'mail',
    actorMode: 'initiating_user_or_service',
    permission: 'mail.send',
    resource: {
      kind: 'message_or_account_lookup',
      messageId: jobValue('draftId'),
      accountId: jobValue('accountId'),
      whenAbsent: 'mail_scope',
    },
  },
  {
    // Mirrors the HTTP reply-suggestion/ensure route: queuing generation is a
    // draft-creation operation, not a plain content read.
    type: 'ai.reply_suggestion',
    kind: 'mail',
    actorMode: 'initiating_user_or_service',
    permission: 'mail.draft.create',
    resource: messageJobResource(),
  },
  {
    type: 'ai.agent',
    kind: 'mail',
    actorMode: 'initiating_user_or_service',
    permission: 'mail.content.read',
    resource: optionalMessageJobResource(),
  },
  {
    type: 'ai.pick_canned',
    kind: 'mail',
    actorMode: 'initiating_user_or_service',
    permission: 'mail.content.read',
    resource: optionalMessageJobResource(),
  },
  {
    // Classification persists a tag on the message (addClassificationTag), the
    // same mutation the tag routes protect with mail.triage — not a plain read.
    type: 'ai.classify',
    kind: 'mail',
    actorMode: 'initiating_user_or_service',
    permission: 'mail.triage',
    resource: messageJobResource(),
  },
  {
    type: 'ai.review',
    kind: 'mail',
    actorMode: 'initiating_user_or_service',
    permission: 'mail.content.read',
    resource: optionalMessageJobResource(),
  },
  {
    type: 'ai.draft_reply',
    kind: 'mail',
    actorMode: 'initiating_user_or_service',
    permission: 'mail.draft.create',
    resource: messageJobResource(),
  },
  {
    type: 'ai.review_draft',
    kind: 'mail',
    actorMode: 'initiating_user_or_service',
    permission: 'mail.content.read',
    resource: optionalMessageJobResource(),
  },
  {
    type: 'ai.transform_text',
    kind: 'mail',
    actorMode: 'initiating_user_or_service',
    permission: 'mail.content.read',
    resource: optionalMessageJobResource(),
  },
  {
    type: 'workflow.execute',
    kind: 'mail',
    actorMode: 'initiating_user_or_service',
    permission: 'mail.content.read',
    resource: {
      kind: 'workflow_execute_message_lookup',
      messageId: jobValue('messageId'),
      delayedJobId: jobValue('delayedJobId'),
    },
  },
  {
    type: 'workflow.http_request',
    kind: 'mail',
    actorMode: 'initiating_user_or_service',
    permission: 'mail.metadata.read',
    resource: optionalMessageJobResource(),
  },
  {
    type: 'workflow.forward_copy',
    kind: 'mail',
    actorMode: 'initiating_user_or_service',
    permission: 'mail.export',
    resource: messageJobResource(),
  },
  {
    type: 'workflow.dmarc_ingest',
    kind: 'mail',
    actorMode: 'initiating_user_or_service',
    permission: 'mail.attachment.read',
    resource: messageJobResource(),
  },
  {
    type: 'webhook.fire',
    kind: 'non_mail',
    actorMode: 'service',
    classification: 'non_mail',
  },
  {
    type: 'lock.cleanup',
    kind: 'mail',
    actorMode: 'service',
    permission: 'mail.draft.edit',
    resource: { kind: 'mail_scope' },
  },
  {
    type: 'audit.retention',
    kind: 'non_mail',
    actorMode: 'service',
    classification: 'system_maintenance',
  },
  // Der Taktgeber des periodischen Syncs. Er liest nur, welche Konten faellig
  // sind, und reiht deren Sync-Jobs ein — die tragen ihre eigene Policy
  // (mail.metadata.read) und werden dort geprueft. Deshalb 'non_mail':
  // hier gibt es keine Nachricht und kein Konto, auf das sich eine
  // Mail-Berechtigung beziehen liesse, und ein erfundener Bezug waere eine
  // Pruefung, die nichts prueft.
  {
    type: 'mail.sync.schedule',
    kind: 'non_mail',
    actorMode: 'service',
    classification: 'system_maintenance',
  },
]);

export function createServerJobPolicyIndex(
  entries: readonly ServerJobPolicyEntry[],
): ReadonlyMap<ServerJobType, ServerJobPolicyEntry> {
  const index = new Map<ServerJobType, ServerJobPolicyEntry>();
  for (const entry of entries) {
    if (index.has(entry.type)) throw new Error(`duplicate server job policy: ${entry.type}`);
    index.set(entry.type, entry);
  }
  return index;
}

const SERVER_JOB_POLICY_INDEX = createServerJobPolicyIndex(SERVER_JOB_POLICIES);

export function assertServerJobPolicy(type: string): ServerJobPolicyEntry {
  const serverJobType = assertServerJobType(type);
  const policy = SERVER_JOB_POLICY_INDEX.get(serverJobType);
  if (!policy) throw new Error(`unclassified server job type: ${serverJobType}`);
  return policy;
}

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

/**
 * Trust boundary: only server-side producer code may call this before writing to
 * the PostgreSQL-backed queue. HTTP/API request bodies are never spread into a
 * trusted payload; public producers must carry actorUserId instead. Workers
 * still re-authorize against current DB/RLS-backed mailbox ACL before handling.
 */
export function buildTrustedServiceJobPayload(payload: JobPayload): JobPayload {
  const {
    actorKind: _actorKind,
    actorUserId: _actorUserId,
    principal: _principal,
    [TRUSTED_SERVICE_JOB_MARKER_FIELD]: _marker,
    ...trustedPayload
  } = payload;
  return {
    ...trustedPayload,
    [TRUSTED_SERVICE_JOB_MARKER_FIELD]: TRUSTED_SERVICE_JOB_MARKER_VALUE,
  };
}

export function isTrustedServiceJobPayload(payload: JobPayload): boolean {
  return payload[TRUSTED_SERVICE_JOB_MARKER_FIELD] === TRUSTED_SERVICE_JOB_MARKER_VALUE;
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

/** Voreinstellung der Obergrenze gleichzeitiger Mail-Syncs je Worker-Prozess. */
export const JOB_MAIL_SYNC_DEFAULT_MAX_CONCURRENCY = 50;
/**
 * Harte Grenze. Jeder gleichzeitige Sync ist eine IMAP-Verbindung und eine
 * Datenbankverbindung; oberhalb davon ist nicht der Worker das Problem, sondern
 * der Mailserver und der Verbindungspool.
 */
export const JOB_MAIL_SYNC_MAX_CONCURRENCY = 500;

/**
 * Wie viele Mail-Syncs ein Worker-Prozess gleichzeitig faehrt.
 *
 * Die Obergrenze ist konfigurierbar, weil sie bei vielen Konten der begrenzende
 * Faktor wird: bei 10.000 Konten und rund fuenf Sekunden je Konto dauert eine
 * volle Runde mit 50 gleichzeitigen Laeufen etwa 17 Minuten pro Prozess.
 * Waagerecht skaliert wird ueber mehrere Worker — die Serialisierung je Konto
 * haelt prozessuebergreifend, weil sie in der Datenbank sitzt (Graphile-Queue
 * `account-<id>` plus die Advisory-Sperre). Wer stattdessen einen Prozess
 * groesser fahren will, hebt diesen Wert.
 */
export function calculateMailSyncPoolSize(
  accountCount: number,
  maxConcurrency: number = JOB_MAIL_SYNC_DEFAULT_MAX_CONCURRENCY,
): number {
  if (!Number.isInteger(accountCount) || accountCount < 0) {
    throw new Error('accountCount must be a non-negative integer');
  }
  if (
    !Number.isInteger(maxConcurrency)
    || maxConcurrency < 1
    || maxConcurrency > JOB_MAIL_SYNC_MAX_CONCURRENCY
  ) {
    throw new Error(
      `mail sync concurrency must be an integer between 1 and ${JOB_MAIL_SYNC_MAX_CONCURRENCY}`,
    );
  }
  return Math.min(maxConcurrency, accountCount * 2);
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
