import { readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';

import { sql as kyselySql, type Kysely } from 'kysely';

import {
  findOutboundGraphTraps,
  formatOutboundGraphTraps,
  type WorkflowGraphDocument,
} from '@simplecrm/core';

import type {
  EmailDiagnosticsApiPort,
  EmailDiagnosticsReport,
} from '../api/types';
import { serverMigrations } from '../migrations';
import type { ServerDatabase } from './schema';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
  type WorkspaceTransaction,
} from './workspace-context';

export type PostgresMailDiagnosticsPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  attachmentsRoot?: string;
  dirSizeBytes?: (dir: string) => Promise<number>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}>;

type CountValue = number | string | bigint | null;

type MessageStatsRow = {
  total: CountValue;
  pending_post_process: CountValue;
  outbound_hold: CountValue;
  oldest_pending_post_process_seconds: CountValue | null;
};

type PendingPostProcessRow = {
  id: CountValue;
  account_id: CountValue | null;
  subject: string | null;
  age_seconds: CountValue;
};

type WorkflowStatsRow = {
  runs_last_24h: CountValue;
  runs_blocked_last_24h: CountValue;
  runs_error_last_24h: CountValue;
};

type FolderKindCountRow = {
  kind: string | null;
  count: CountValue;
};

type SyncInfoKeyRow = {
  key: string;
  value: string | null;
};

type AccountDiagnosticsRow = {
  id: CountValue;
  email: string | null;
  protocol: string | null;
  inboxLastSyncedAt: Date | string | null;
};

const UID_VALIDITY_NOTICE_PREFIX = 'uidvalidity_notice:';
const IMAP_AUTH_NOTICE_PREFIX = 'imap_auth_notice:';
const SCHEDULED_SEND_STATUS_PREFIX = 'scheduled_send_status:';
const SCHEDULED_SEND_FAILURES_PREFIX = 'scheduled_send_failures:';
const SCHEDULED_SEND_LAST_ERROR_PREFIX = 'scheduled_send_last_error:';
const SMTP_COMMIT_PREFIX = 'email_compose_smtp_ok:';

export function createPostgresMailDiagnosticsPort(
  options: PostgresMailDiagnosticsPortOptions,
): EmailDiagnosticsApiPort {
  return {
    async collect(input): Promise<EmailDiagnosticsReport> {
      const now = input.now ?? new Date();
      const attachmentsBytes = options.attachmentsRoot
        ? await (options.dirSizeBytes ?? dirSizeBytes)(options.attachmentsRoot)
        : 0;

      const report = await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => collectDiagnostics(trx, input.workspaceId, now),
        { applySession: options.applyWorkspaceSession },
      );

      return {
        ...report,
        sizes: {
          databaseBytes: null,
          attachmentsBytes,
        },
      };
    },
  };
}

async function collectDiagnostics(
  trx: WorkspaceTransaction,
  workspaceId: string,
  now: Date,
): Promise<Omit<EmailDiagnosticsReport, 'sizes'>> {
  const schemaGeneration = serverMigrations.length;
  const latestMigration = serverMigrations[schemaGeneration - 1];
  const messageStats = await selectMessageStats(trx, workspaceId, now);
  const pendingPostProcessSamples = await selectPendingPostProcessSamples(trx, workspaceId, now);
  const byFolderKind = await selectFolderKindCounts(trx, workspaceId);
  const workflowStats = await selectWorkflowStats(trx, workspaceId, now);
  const trappingOutbound = await selectTrappingOutboundWorkflows(trx, workspaceId);
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const since30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const aiUsage24h = await selectAiUsageTotals(trx, workspaceId, since24h);
  const aiUsage30d = await selectAiUsageTotals(trx, workspaceId, since30d);
  const aiUsageByNodeType24h = await selectAiUsageByNodeType(trx, workspaceId, since24h);
  const syncInfoRows = await selectSyncInfoRows(trx, workspaceId);
  const accounts = await selectAccounts(trx, workspaceId);
  const legacyJobQueue = await selectLegacyJobQueueStats(trx, workspaceId, now);
  const graphileJobQueue = await selectGraphileJobQueueStats(trx, workspaceId, now);
  const jobQueue = mergeJobQueueDiagnostics(graphileJobQueue, legacyJobQueue);
  const mfaLocks = await selectMfaLocks(trx, now);

  return {
    collectedAt: now.toISOString(),
    schemaGeneration,
    schemaGenerationLabel: latestMigration
      ? `${latestMigration.id} ${latestMigration.description}`
      : 'server schema',
    messages: {
      total: countValue(messageStats?.total),
      pendingPostProcess: countValue(messageStats?.pending_post_process),
      outboundHold: countValue(messageStats?.outbound_hold),
      byFolderKind,
      oldestPendingPostProcessSeconds: messageStats?.oldest_pending_post_process_seconds == null
        ? null
        : countValue(messageStats.oldest_pending_post_process_seconds),
      pendingPostProcessSamples: pendingPostProcessSamples.map((row) => ({
        id: countValue(row.id),
        accountId: row.account_id == null ? null : countValue(row.account_id),
        subject: row.subject,
        ageSeconds: countValue(row.age_seconds),
      })),
      failedScheduledSends: scheduledSendFailuresFromSyncInfo(syncInfoRows),
    },
    workflows: {
      runsLast24h: countValue(workflowStats?.runs_last_24h),
      runsBlockedLast24h: countValue(workflowStats?.runs_blocked_last_24h),
      runsErrorLast24h: countValue(workflowStats?.runs_error_last_24h),
      trappingOutbound,
    },
    aiUsage: {
      events24h: countValue(aiUsage24h?.events),
      tokens24h: countValue(aiUsage24h?.tokens),
      costMicroUsd24h: countValue(aiUsage24h?.cost),
      avgLatencyMs24h: countValue(aiUsage24h?.avg_latency),
      events30d: countValue(aiUsage30d?.events),
      tokens30d: countValue(aiUsage30d?.tokens),
      costMicroUsd30d: countValue(aiUsage30d?.cost),
      byNodeType24h: aiUsageByNodeType24h,
    },
    notices: {
      imapAuth: countImapAuthNotices(syncInfoRows),
      uidValidity: countUidValidityNotices(syncInfoRows),
    },
    syncInfo: syncInfoBreakdown(syncInfoRows),
    background: {
      cronScheduled: false,
      cronTickInFlight: false,
      syncInFlightAccountIds: [],
      idleImapAccountIds: [],
    },
    accounts,
    operations: {
      inboundLagSeconds: inboundLagSeconds(accounts, now),
      postProcessRetrying: jobQueue.postProcessRetrying,
      smtpCommitRecoveries: syncInfoRows.filter((row) => row.key.startsWith(SMTP_COMMIT_PREFIX)).length,
      mfaLocks,
    },
    jobQueue: {
      ready: jobQueue.ready,
      locked: jobQueue.locked,
      deadLetter: jobQueue.deadLetter,
      workflowDeadLetter: jobQueue.workflowDeadLetter,
      lagSeconds: jobQueue.lagSeconds,
      oldestLockedSeconds: jobQueue.oldestLockedSeconds,
      samples: jobQueue.samples,
    },
  };
}

async function selectMessageStats(
  trx: WorkspaceTransaction,
  workspaceId: string,
  now: Date,
): Promise<MessageStatsRow | undefined> {
  return trx
    .selectFrom('email_messages')
    .select([
      kyselySql<CountValue>`count(*)`.as('total'),
      kyselySql<CountValue>`
        coalesce(sum(case when post_process_done = false then 1 else 0 end), 0)
      `.as('pending_post_process'),
      kyselySql<CountValue>`
        coalesce(sum(case when outbound_hold = true then 1 else 0 end), 0)
      `.as('outbound_hold'),
      kyselySql<CountValue | null>`
        case when count(*) filter (where post_process_done = false) = 0 then null
        else greatest(0, extract(epoch from (
          ${now} - min(updated_at) filter (where post_process_done = false)
        ))::integer) end
      `.as('oldest_pending_post_process_seconds'),
    ])
    .where('workspace_id', '=', workspaceId)
    .executeTakeFirst();
}

async function selectPendingPostProcessSamples(
  trx: WorkspaceTransaction,
  workspaceId: string,
  now: Date,
): Promise<PendingPostProcessRow[]> {
  return trx
    .selectFrom('email_messages')
    .select([
      'id',
      'account_id',
      'subject',
      kyselySql<CountValue>`
        greatest(0, extract(epoch from (${now} - updated_at))::integer)
      `.as('age_seconds'),
    ])
    .where('workspace_id', '=', workspaceId)
    .where('post_process_done', '=', false)
    .orderBy('updated_at', 'asc')
    .limit(8)
    .execute() as Promise<PendingPostProcessRow[]>;
}

async function selectFolderKindCounts(
  trx: WorkspaceTransaction,
  workspaceId: string,
): Promise<Record<string, number>> {
  const folderKind = kyselySql<string>`coalesce(nullif(folder_kind, ''), 'inbox')`;
  const rows = await trx
    .selectFrom('email_messages')
    .select([
      folderKind.as('kind'),
      kyselySql<CountValue>`count(*)`.as('count'),
    ])
    .where('workspace_id', '=', workspaceId)
    .groupBy(folderKind)
    .execute() as FolderKindCountRow[];

  const counts: Record<string, number> = {};
  for (const row of rows) {
    const kind = typeof row.kind === 'string' && row.kind.trim() ? row.kind.trim() : 'inbox';
    counts[kind] = countValue(row.count);
  }
  return counts;
}

async function selectWorkflowStats(
  trx: WorkspaceTransaction,
  workspaceId: string,
  now: Date,
): Promise<WorkflowStatsRow | undefined> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return trx
    .selectFrom('email_workflow_runs')
    .select([
      kyselySql<CountValue>`count(*)`.as('runs_last_24h'),
      kyselySql<CountValue>`
        coalesce(sum(case when status = 'blocked' then 1 else 0 end), 0)
      `.as('runs_blocked_last_24h'),
      kyselySql<CountValue>`
        coalesce(sum(case when status = 'error' then 1 else 0 end), 0)
      `.as('runs_error_last_24h'),
    ])
    .where('workspace_id', '=', workspaceId)
    .where('started_at', '>=', since)
    .executeTakeFirst();
}

type OutboundWorkflowRow = {
  id: number | string | bigint;
  name: string | null;
  graph_json: unknown;
  execution_mode: string | null;
};

/**
 * Detect enabled outbound workflows that would trap mail. Read-only: mirrors
 * the create/update guard (outboundWorkflowGuardError) so the same conditions
 * that BLOCK a new workflow also SURFACE an already-enabled one. Compiled mode
 * and a missing graph always trap; otherwise the graph is walked for dead
 * ends / dangling ports / loops.
 */
async function selectTrappingOutboundWorkflows(
  trx: WorkspaceTransaction,
  workspaceId: string,
): Promise<Array<{ id: number; name: string; reason: string }>> {
  const rows = (await trx
    .selectFrom('email_workflows')
    .select(['id', 'name', 'graph_json', 'execution_mode'])
    .where('workspace_id', '=', workspaceId)
    .where('trigger_name', '=', 'outbound')
    .where('enabled', '=', true)
    .orderBy('id', 'asc')
    .execute()) as OutboundWorkflowRow[];

  const trapping: Array<{ id: number; name: string; reason: string }> = [];
  for (const row of rows) {
    const id = Number(row.id);
    const name = row.name ?? `#${id}`;
    if ((row.execution_mode ?? 'graph') === 'compiled') {
      trapping.push({ id, name, reason: 'compiled-Modus wird serverseitig nicht ausgeführt — jede Mail bleibt blockiert.' });
      continue;
    }
    if (!row.graph_json || typeof row.graph_json !== 'object') {
      trapping.push({ id, name, reason: 'Kein Graph hinterlegt — jede Mail bleibt blockiert.' });
      continue;
    }
    const issues = findOutboundGraphTraps(row.graph_json as WorkflowGraphDocument, {
      effectiveTrigger: 'outbound',
    });
    if (issues.length > 0) {
      trapping.push({ id, name, reason: formatOutboundGraphTraps(issues) });
    }
  }
  return trapping;
}

type AiUsageStatsRow = {
  events: CountValue;
  tokens: CountValue;
  cost: CountValue;
  avg_latency: CountValue;
};

async function selectAiUsageTotals(
  trx: WorkspaceTransaction,
  workspaceId: string,
  since: Date,
): Promise<AiUsageStatsRow | undefined> {
  return trx
    .selectFrom('ai_usage_events')
    .select([
      kyselySql<CountValue>`count(*)`.as('events'),
      kyselySql<CountValue>`coalesce(sum(total_tokens), 0)`.as('tokens'),
      kyselySql<CountValue>`coalesce(sum(est_cost_micro_usd), 0)`.as('cost'),
      kyselySql<CountValue>`coalesce(round(avg(latency_ms)), 0)`.as('avg_latency'),
    ])
    .where('workspace_id', '=', workspaceId)
    .where('created_at', '>=', since)
    .executeTakeFirst();
}

async function selectAiUsageByNodeType(
  trx: WorkspaceTransaction,
  workspaceId: string,
  since: Date,
): Promise<Record<string, number>> {
  const rows = await trx
    .selectFrom('ai_usage_events')
    .select(['node_type', kyselySql<CountValue>`count(*)`.as('cnt')])
    .where('workspace_id', '=', workspaceId)
    .where('created_at', '>=', since)
    .groupBy('node_type')
    .execute();
  const counts: Record<string, number> = {};
  for (const row of rows) counts[String(row.node_type)] = countValue(row.cnt);
  return counts;
}

async function selectSyncInfoRows(
  trx: WorkspaceTransaction,
  workspaceId: string,
): Promise<SyncInfoKeyRow[]> {
  return trx
    .selectFrom('sync_info')
    .select([
      'key',
      kyselySql<string | null>`case
        when key like ${`${UID_VALIDITY_NOTICE_PREFIX}%`}
          or key like ${`${IMAP_AUTH_NOTICE_PREFIX}%`}
          or key like ${`${SCHEDULED_SEND_STATUS_PREFIX}%`}
          or key like ${`${SCHEDULED_SEND_FAILURES_PREFIX}%`}
          or key like ${`${SCHEDULED_SEND_LAST_ERROR_PREFIX}%`}
        then left(value, 65536)
        else null
      end`.as('value'),
    ])
    .where('workspace_id', '=', workspaceId)
    .execute();
}

async function selectAccounts(
  trx: WorkspaceTransaction,
  workspaceId: string,
): Promise<EmailDiagnosticsReport['accounts']> {
  const rows = await trx
    .selectFrom('email_accounts as a')
    .leftJoin('email_folders as f', (join) => join
      .onRef('f.workspace_id', '=', 'a.workspace_id')
      .onRef('f.account_id', '=', 'a.id')
      .on('f.path', '=', 'INBOX'))
    .select([
      'a.id as id',
      'a.email_address as email',
      'a.protocol as protocol',
      kyselySql<Date | string | null>`max(f.last_synced_at)`.as('inboxLastSyncedAt'),
    ])
    .where('a.workspace_id', '=', workspaceId)
    .groupBy(['a.id', 'a.email_address', 'a.protocol'])
    .orderBy('a.id', 'asc')
    .execute() as AccountDiagnosticsRow[];

  return rows.map((row) => ({
    id: countValue(row.id),
    email: row.email ?? '',
    protocol: row.protocol || 'imap',
    inboxLastSyncedAt: timestampToIsoOrNull(row.inboxLastSyncedAt),
  }));
}

function syncInfoBreakdown(rows: readonly SyncInfoKeyRow[]): EmailDiagnosticsReport['syncInfo'] {
  const prefixes: Record<string, number> = {};
  for (const row of rows) {
    const key = row.key;
    const prefix = key.includes(':') ? `${key.split(':')[0]}:` : key;
    prefixes[prefix] = (prefixes[prefix] ?? 0) + 1;
  }
  return {
    totalKeys: rows.length,
    prefixes,
  };
}

function countImapAuthNotices(rows: readonly SyncInfoKeyRow[]): number {
  let count = 0;
  for (const row of rows) {
    if (!row.key.startsWith(IMAP_AUTH_NOTICE_PREFIX)) continue;
    const accountIdFromKey = Number(row.key.slice(IMAP_AUTH_NOTICE_PREFIX.length));
    if (parseImapAuthNotice(row.value, accountIdFromKey)) count += 1;
  }
  return count;
}

function parseImapAuthNotice(raw: string | null | undefined, accountIdFromKey: number): boolean {
  if (!raw?.trim()) return false;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const accountId = positiveIntOrFallback(parsed.accountId, accountIdFromKey);
    return Boolean(accountId && typeof parsed.message === 'string' && parsed.message.trim());
  } catch {
    return Number.isSafeInteger(accountIdFromKey) && accountIdFromKey > 0;
  }
}

function countUidValidityNotices(rows: readonly SyncInfoKeyRow[]): number {
  let count = 0;
  for (const row of rows) {
    if (!row.key.startsWith(UID_VALIDITY_NOTICE_PREFIX)) continue;
    const accountIdFromKey = Number(row.key.slice(UID_VALIDITY_NOTICE_PREFIX.length));
    count += parseUidValidityNoticeCount(row.value, accountIdFromKey);
  }
  return count;
}

function parseUidValidityNoticeCount(raw: string | null | undefined, accountIdFromKey: number): number {
  if (!raw?.trim()) return 0;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 0;
  }
  if (!Array.isArray(parsed)) return 0;
  return parsed.filter((item) => isUidValidityNotice(item, accountIdFromKey)).length;
}

function isUidValidityNotice(item: unknown, accountIdFromKey: number): boolean {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  const record = item as Record<string, unknown>;
  const accountId = positiveIntOrFallback(record.accountId, accountIdFromKey);
  return Boolean(
    accountId
    && typeof record.id === 'string'
    && record.id.trim()
    && typeof record.folderPath === 'string'
    && record.folderPath.trim()
  );
}

function positiveIntOrFallback(value: unknown, fallback: number): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  if (Number.isSafeInteger(fallback) && fallback > 0) return fallback;
  return null;
}

export function scheduledSendFailuresFromSyncInfo(
  rows: readonly SyncInfoKeyRow[],
): NonNullable<EmailDiagnosticsReport['messages']['failedScheduledSends']> {
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const failures: NonNullable<EmailDiagnosticsReport['messages']['failedScheduledSends']> = [];
  for (const row of rows) {
    if (!row.key.startsWith(SCHEDULED_SEND_STATUS_PREFIX) || row.value !== 'failed') continue;
    const messageId = Number(row.key.slice(SCHEDULED_SEND_STATUS_PREFIX.length));
    if (!Number.isSafeInteger(messageId) || messageId <= 0) continue;
    failures.push({
      messageId,
      failureCount: countValue(values.get(`${SCHEDULED_SEND_FAILURES_PREFIX}${messageId}`) ?? 0),
      lastError: values.get(`${SCHEDULED_SEND_LAST_ERROR_PREFIX}${messageId}`)?.slice(0, 500) ?? null,
    });
  }
  return failures.sort((left, right) => left.messageId - right.messageId).slice(0, 20);
}

export function inboundLagSeconds(
  accounts: EmailDiagnosticsReport['accounts'],
  now: Date,
): number | null {
  let oldestLag: number | null = null;
  for (const account of accounts) {
    if (!account.inboxLastSyncedAt) continue;
    const timestamp = Date.parse(account.inboxLastSyncedAt);
    if (!Number.isFinite(timestamp)) continue;
    const lag = Math.max(0, Math.trunc((now.getTime() - timestamp) / 1000));
    oldestLag = oldestLag === null ? lag : Math.max(oldestLag, lag);
  }
  return oldestLag;
}

function countValue(value: CountValue | undefined): number {
  const count = typeof value === 'bigint' ? Number(value) : Number(value ?? 0);
  return Number.isFinite(count) && count >= 0 ? Math.trunc(count) : 0;
}

function timestampToIsoOrNull(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

type JobQueueStatsRow = {
  ready: CountValue;
  locked: CountValue;
  dead_letter: CountValue;
  workflow_dead_letter: CountValue;
  post_process_retrying: CountValue;
  lag_seconds: CountValue;
  oldest_locked_seconds: CountValue | null;
};

type JobQueueSampleRow = {
  id: CountValue;
  type: string;
  attempts: CountValue;
  max_attempts: CountValue;
  locked_by: string | null;
  locked_seconds: CountValue | null;
  last_error: string | null;
};

export type JobQueueDiagnostics = Readonly<{
  ready: number;
  locked: number;
  deadLetter: number;
  workflowDeadLetter: number;
  postProcessRetrying: number;
  lagSeconds: number;
  oldestLockedSeconds: number | null;
  samples: Array<{
    id: number;
    type: string;
    attempts: number;
    maxAttempts: number;
    lockedBy: string | null;
    lockedSeconds: number | null;
    lastError: string | null;
    engine: 'graphile' | 'legacy';
    terminal: boolean;
  }>;
}>;

async function selectLegacyJobQueueStats(
  trx: WorkspaceTransaction,
  workspaceId: string,
  now: Date,
): Promise<JobQueueDiagnostics> {
  const stats = await trx
    .selectFrom('job_queue')
    .select([
      kyselySql<CountValue>`
        count(*) filter (
          where locked_at is null and run_after <= ${now} and attempts < max_attempts
        )
      `.as('ready'),
      kyselySql<CountValue>`
        count(*) filter (where locked_at is not null)
      `.as('locked'),
      kyselySql<CountValue>`
        count(*) filter (where attempts >= max_attempts)
      `.as('dead_letter'),
      kyselySql<CountValue>`
        count(*) filter (where attempts >= max_attempts and type like 'workflow.%')
      `.as('workflow_dead_letter'),
      kyselySql<CountValue>`
        count(*) filter (
          where type = 'mail.spam.score' and attempts > 0 and attempts < max_attempts
        )
      `.as('post_process_retrying'),
      kyselySql<CountValue>`
        coalesce(extract(epoch from max(${now} - run_after) filter (
          where locked_at is null and run_after <= ${now} and attempts < max_attempts
        ))::integer, 0)
      `.as('lag_seconds'),
      kyselySql<CountValue | null>`
        max(extract(epoch from (${now} - locked_at))::integer)
      `.as('oldest_locked_seconds'),
    ])
    .where('workspace_id', '=', workspaceId)
    .executeTakeFirst() as JobQueueStatsRow | undefined;

  const samples = await trx
    .selectFrom('job_queue')
    .select([
      'id',
      'type',
      'attempts',
      'max_attempts',
      'locked_by',
      'last_error',
      kyselySql<CountValue | null>`
        case when locked_at is null then null
        else extract(epoch from (${now} - locked_at))::integer end
      `.as('locked_seconds'),
    ])
    .where('workspace_id', '=', workspaceId)
    .where((eb) => eb.or([
      eb('locked_at', 'is not', null),
      eb.and([
        eb('run_after', '<=', now),
        eb('attempts', '<', eb.ref('max_attempts')),
      ]),
      eb('attempts', '>=', eb.ref('max_attempts')),
    ]))
    .orderBy('locked_at', 'desc')
    .orderBy('run_after', 'asc')
    .limit(8)
    .execute() as JobQueueSampleRow[];

  return {
    ready: countValue(stats?.ready),
    locked: countValue(stats?.locked),
    deadLetter: countValue(stats?.dead_letter),
    workflowDeadLetter: countValue(stats?.workflow_dead_letter),
    postProcessRetrying: countValue(stats?.post_process_retrying),
    lagSeconds: countValue(stats?.lag_seconds),
    oldestLockedSeconds: stats?.oldest_locked_seconds == null
      ? null
      : countValue(stats.oldest_locked_seconds),
    samples: samples.map((row) => ({
      id: countValue(row.id),
      type: row.type,
      attempts: countValue(row.attempts),
      maxAttempts: countValue(row.max_attempts),
      lockedBy: row.locked_by,
      lockedSeconds: row.locked_seconds == null ? null : countValue(row.locked_seconds),
      lastError: row.last_error?.slice(0, 240) ?? null,
      engine: 'legacy' as const,
      terminal: countValue(row.attempts) >= countValue(row.max_attempts),
    })),
  };
}

async function selectGraphileJobQueueStats(
  trx: WorkspaceTransaction,
  workspaceId: string,
  now: Date,
): Promise<JobQueueDiagnostics> {
  const relation = await kyselySql<{ relation: string | null }>`
    select to_regclass('graphile_worker._private_jobs')::text as relation
  `.execute(trx);
  if (!relation.rows[0]?.relation) return emptyJobQueueDiagnostics();

  const statsResult = await kyselySql<JobQueueStatsRow>`
    with workspace_jobs as (
      select jobs.*, tasks.identifier as type
      from graphile_worker._private_jobs jobs
      inner join graphile_worker._private_tasks tasks on tasks.id = jobs.task_id
      where jobs.payload->>'workspaceId' = ${workspaceId}
    )
    select
      count(*) filter (
        where locked_at is null and run_at <= ${now} and attempts < max_attempts
      ) as ready,
      count(*) filter (where locked_at is not null) as locked,
      count(*) filter (where attempts >= max_attempts) as dead_letter,
      count(*) filter (where attempts >= max_attempts and type like 'workflow.%') as workflow_dead_letter,
      count(*) filter (
        where type = 'mail.spam.score' and attempts > 0 and attempts < max_attempts
      ) as post_process_retrying,
      coalesce(extract(epoch from max(${now} - run_at) filter (
        where locked_at is null and run_at <= ${now} and attempts < max_attempts
      ))::integer, 0) as lag_seconds,
      max(extract(epoch from (${now} - locked_at))::integer) as oldest_locked_seconds
    from workspace_jobs
  `.execute(trx);
  const stats = statsResult.rows[0];

  const sampleResult = await kyselySql<JobQueueSampleRow>`
    select
      jobs.id,
      tasks.identifier as type,
      jobs.attempts,
      jobs.max_attempts,
      jobs.locked_by::text as locked_by,
      jobs.last_error,
      case when jobs.locked_at is null then null
        else extract(epoch from (${now} - jobs.locked_at))::integer end as locked_seconds
    from graphile_worker._private_jobs jobs
    inner join graphile_worker._private_tasks tasks on tasks.id = jobs.task_id
    where jobs.payload->>'workspaceId' = ${workspaceId}
      and (
        jobs.locked_at is not null
        or (jobs.run_at <= ${now} and jobs.attempts < jobs.max_attempts)
        or jobs.attempts >= jobs.max_attempts
      )
    order by (jobs.attempts >= jobs.max_attempts) desc, jobs.locked_at desc nulls last, jobs.run_at asc
    limit 8
  `.execute(trx);

  return {
    ready: countValue(stats?.ready),
    locked: countValue(stats?.locked),
    deadLetter: countValue(stats?.dead_letter),
    workflowDeadLetter: countValue(stats?.workflow_dead_letter),
    postProcessRetrying: countValue(stats?.post_process_retrying),
    lagSeconds: countValue(stats?.lag_seconds),
    oldestLockedSeconds: stats?.oldest_locked_seconds == null
      ? null
      : countValue(stats.oldest_locked_seconds),
    samples: sampleResult.rows.map((row) => ({
      id: countValue(row.id),
      type: row.type,
      attempts: countValue(row.attempts),
      maxAttempts: countValue(row.max_attempts),
      lockedBy: row.locked_by,
      lockedSeconds: row.locked_seconds == null ? null : countValue(row.locked_seconds),
      lastError: row.last_error?.slice(0, 240) ?? null,
      engine: 'graphile' as const,
      terminal: countValue(row.attempts) >= countValue(row.max_attempts),
    })),
  };
}

async function selectMfaLocks(trx: WorkspaceTransaction, now: Date): Promise<number> {
  const row = await trx
    .selectFrom('auth_challenge_tokens')
    .select(kyselySql<CountValue>`count(*)`.as('count'))
    .where('purpose', '=', 'mfa')
    .where('attempt_count', '>=', 5)
    .where('consumed_at', 'is', null)
    .where('expires_at', '>', now)
    .executeTakeFirst();
  return countValue(row?.count);
}

function emptyJobQueueDiagnostics(): JobQueueDiagnostics {
  return {
    ready: 0,
    locked: 0,
    deadLetter: 0,
    workflowDeadLetter: 0,
    postProcessRetrying: 0,
    lagSeconds: 0,
    oldestLockedSeconds: null,
    samples: [],
  };
}

export function mergeJobQueueDiagnostics(
  left: JobQueueDiagnostics,
  right: JobQueueDiagnostics,
): JobQueueDiagnostics {
  const lockedAges = [left.oldestLockedSeconds, right.oldestLockedSeconds]
    .filter((value): value is number => value !== null);
  return {
    ready: left.ready + right.ready,
    locked: left.locked + right.locked,
    deadLetter: left.deadLetter + right.deadLetter,
    workflowDeadLetter: left.workflowDeadLetter + right.workflowDeadLetter,
    postProcessRetrying: left.postProcessRetrying + right.postProcessRetrying,
    lagSeconds: Math.max(left.lagSeconds, right.lagSeconds),
    oldestLockedSeconds: lockedAges.length > 0 ? Math.max(...lockedAges) : null,
    samples: [...left.samples, ...right.samples]
      .sort((a, b) => Number(b.terminal) - Number(a.terminal))
      .slice(0, 8),
  };
}

async function dirSizeBytes(dir: string): Promise<number> {
  let total = 0;
  const walk = async (current: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (cause) {
      if (isNotFound(cause)) return;
      throw cause;
    }

    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        total += (await stat(path)).size;
      } catch (cause) {
        if (!isNotFound(cause)) throw cause;
      }
    }
  };

  try {
    await walk(dir);
  } catch {
    return 0;
  }
  return total;
}

function isNotFound(cause: unknown): boolean {
  return Boolean(
    cause
    && typeof cause === 'object'
    && (cause as { code?: unknown }).code === 'ENOENT'
  );
}
