import { sql as kyselySql, type Kysely } from 'kysely';

import type {
  EmailReportingApiPort,
  EmailReportingSnapshot,
} from '../api/types';
import type { ServerDatabase } from './schema';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
  type WorkspaceTransaction,
} from './workspace-context';

export type PostgresEmailReportingPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}>;

type CountValue = number | string | bigint | null;

type ReportingAccountRow = {
  id: CountValue;
  displayName: string | null;
  emailAddress: string | null;
  protocol: string | null;
};

type ReportingTotalsRow = {
  messages: CountValue;
  unread: CountValue;
  archived: CountValue;
  withCustomer: CountValue;
  withAssignment: CountValue;
  withAttachments: CountValue;
};

type ReportingPerAccountRow = {
  accountId: CountValue;
  messages: CountValue;
  unread: CountValue;
  archived: CountValue;
};

type ReportingWorkflowRunRow = {
  workflowId: CountValue;
  count: CountValue;
  errors: CountValue;
};

export function createPostgresEmailReportingPort(
  options: PostgresEmailReportingPortOptions,
): EmailReportingApiPort {
  return {
    async collect(input): Promise<EmailReportingSnapshot> {
      const now = input.now ?? new Date();
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => collectReporting(trx, input.workspaceId, input.accountId, now),
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

async function collectReporting(
  trx: WorkspaceTransaction,
  workspaceId: string,
  accountId: number | undefined,
  now: Date,
): Promise<EmailReportingSnapshot> {
  const [accounts, totals, perAccount, workflowRuns24h] = await Promise.all([
    selectReportingAccounts(trx, workspaceId, accountId),
    selectReportingTotals(trx, workspaceId, accountId),
    selectReportingPerAccount(trx, workspaceId, accountId),
    selectReportingWorkflowRuns24h(trx, workspaceId, now),
  ]);

  return {
    accounts,
    totals,
    perAccount,
    workflowRuns24h,
  };
}

async function selectReportingAccounts(
  trx: WorkspaceTransaction,
  workspaceId: string,
  accountId: number | undefined,
): Promise<EmailReportingSnapshot['accounts']> {
  let query = trx
    .selectFrom('email_accounts')
    .select([
      'id',
      'display_name as displayName',
      'email_address as emailAddress',
      kyselySql<string>`coalesce(nullif(protocol, ''), 'imap')`.as('protocol'),
    ])
    .where('workspace_id', '=', workspaceId)
    .orderBy('id', 'asc');

  if (accountId !== undefined) query = query.where('id', '=', accountId);
  const rows = await query.execute() as ReportingAccountRow[];
  return rows.map((row) => ({
    id: countValue(row.id),
    displayName: row.displayName ?? '',
    emailAddress: row.emailAddress ?? '',
    protocol: normalizeProtocol(row.protocol),
  }));
}

async function selectReportingTotals(
  trx: WorkspaceTransaction,
  workspaceId: string,
  accountId: number | undefined,
): Promise<EmailReportingSnapshot['totals']> {
  let query = trx
    .selectFrom('email_messages')
    .select([
      kyselySql<CountValue>`count(*)`.as('messages'),
      kyselySql<CountValue>`
        coalesce(sum(case when seen_local = false and (uid >= 0 or pop3_uidl is not null) then 1 else 0 end), 0)
      `.as('unread'),
      kyselySql<CountValue>`
        coalesce(sum(case when archived = true then 1 else 0 end), 0)
      `.as('archived'),
      kyselySql<CountValue>`
        coalesce(sum(case when customer_id is not null then 1 else 0 end), 0)
      `.as('withCustomer'),
      kyselySql<CountValue>`
        coalesce(sum(case when assigned_to is not null and assigned_to <> '' then 1 else 0 end), 0)
      `.as('withAssignment'),
      kyselySql<CountValue>`
        coalesce(sum(case when has_attachments = true then 1 else 0 end), 0)
      `.as('withAttachments'),
    ])
    .where('workspace_id', '=', workspaceId)
    .where('soft_deleted', '=', false);

  if (accountId !== undefined) query = query.where('account_id', '=', accountId);
  const row = await query.executeTakeFirst() as ReportingTotalsRow | undefined;
  return {
    messages: countValue(row?.messages),
    unread: countValue(row?.unread),
    archived: countValue(row?.archived),
    withCustomer: countValue(row?.withCustomer),
    withAssignment: countValue(row?.withAssignment),
    withAttachments: countValue(row?.withAttachments),
  };
}

async function selectReportingPerAccount(
  trx: WorkspaceTransaction,
  workspaceId: string,
  accountId: number | undefined,
): Promise<EmailReportingSnapshot['perAccount']> {
  let query = trx
    .selectFrom('email_messages')
    .select([
      'account_id as accountId',
      kyselySql<CountValue>`count(*)`.as('messages'),
      kyselySql<CountValue>`
        coalesce(sum(case when seen_local = false and (uid >= 0 or pop3_uidl is not null) then 1 else 0 end), 0)
      `.as('unread'),
      kyselySql<CountValue>`
        coalesce(sum(case when archived = true then 1 else 0 end), 0)
      `.as('archived'),
    ])
    .where('workspace_id', '=', workspaceId)
    .where('soft_deleted', '=', false)
    .where('account_id', 'is not', null)
    .groupBy('account_id')
    .orderBy('account_id', 'asc');

  if (accountId !== undefined) query = query.where('account_id', '=', accountId);
  const rows = await query.execute() as ReportingPerAccountRow[];
  return rows.map((row) => ({
    accountId: countValue(row.accountId),
    messages: countValue(row.messages),
    unread: countValue(row.unread),
    archived: countValue(row.archived),
  }));
}

async function selectReportingWorkflowRuns24h(
  trx: WorkspaceTransaction,
  workspaceId: string,
  now: Date,
): Promise<EmailReportingSnapshot['workflowRuns24h']> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const workflowId = kyselySql<CountValue>`coalesce(workflow_source_sqlite_id, workflow_id, 0)`;
  const rows = await trx
    .selectFrom('email_workflow_runs')
    .select([
      workflowId.as('workflowId'),
      kyselySql<CountValue>`count(*)`.as('count'),
      kyselySql<CountValue>`
        coalesce(sum(case when status = 'error' then 1 else 0 end), 0)
      `.as('errors'),
    ])
    .where('workspace_id', '=', workspaceId)
    .where('finished_at', '>=', since)
    .groupBy(workflowId)
    .orderBy('count', 'desc')
    .limit(30)
    .execute() as ReportingWorkflowRunRow[];

  return rows.map((row) => ({
    workflowId: countValue(row.workflowId),
    count: countValue(row.count),
    errors: countValue(row.errors),
  }));
}

function normalizeProtocol(value: string | null): string {
  const trimmed = value?.trim();
  return trimmed || 'imap';
}

function countValue(value: CountValue | undefined): number {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
