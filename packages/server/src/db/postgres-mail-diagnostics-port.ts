import { readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';

import type { Kysely } from 'kysely';

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
  const messageStats = await selectMessageStats(trx, workspaceId);
  const byFolderKind = await selectFolderKindCounts(trx, workspaceId);
  const workflowStats = await selectWorkflowStats(trx, workspaceId, now);
  const syncInfoRows = await selectSyncInfoRows(trx, workspaceId);
  const accounts = await selectAccounts(trx, workspaceId);

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
    },
    workflows: {
      runsLast24h: countValue(workflowStats?.runs_last_24h),
      runsBlockedLast24h: countValue(workflowStats?.runs_blocked_last_24h),
      runsErrorLast24h: countValue(workflowStats?.runs_error_last_24h),
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
  };
}

async function selectMessageStats(
  trx: WorkspaceTransaction,
  workspaceId: string,
): Promise<MessageStatsRow | undefined> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
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
    ])
    .where('workspace_id', '=', workspaceId)
    .executeTakeFirst();
}

async function selectFolderKindCounts(
  trx: WorkspaceTransaction,
  workspaceId: string,
): Promise<Record<string, number>> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
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
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
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

async function selectSyncInfoRows(
  trx: WorkspaceTransaction,
  workspaceId: string,
): Promise<SyncInfoKeyRow[]> {
  return trx
    .selectFrom('sync_info')
    .select(['key', 'value'])
    .where('workspace_id', '=', workspaceId)
    .execute();
}

async function selectAccounts(
  trx: WorkspaceTransaction,
  workspaceId: string,
): Promise<EmailDiagnosticsReport['accounts']> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
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

function countValue(value: CountValue | undefined): number {
  const count = typeof value === 'bigint' ? Number(value) : Number(value ?? 0);
  return Number.isFinite(count) && count >= 0 ? Math.trunc(count) : 0;
}

function timestampToIsoOrNull(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
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
