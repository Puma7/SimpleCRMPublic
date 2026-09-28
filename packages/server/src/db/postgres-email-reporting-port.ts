import {
  AI_DECIDE_DRY_RUN_SUMMARY,
  AUTOMATION_COCKPIT_DECIDE_DAYS,
  automationWindowStart,
  bucketSentByKindWeekly,
  summarizeAiDecideAnswers,
  type AutomationCockpitSnapshot,
} from '@simplecrm/core';
import { sql as kyselySql, type Kysely, type RawBuilder } from 'kysely';

import type {
  EmailReportingApiPort,
  EmailReportingSnapshot,
} from '../api/types';
import { mailScopePredicate } from '../mail-access/sql-scope';
import type { MailSqlScope } from '../mail-access/types';
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
  workflowName: string | null;
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
        async (trx) => collectReporting(trx, input.workspaceId, input.accountId, now, input.mailScope),
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
  mailScope: MailSqlScope | undefined,
): Promise<EmailReportingSnapshot> {
  const [accounts, totals, perAccount, workflowRuns24h, automation] = await Promise.all([
    selectReportingAccounts(trx, workspaceId, accountId, mailScope),
    selectReportingTotals(trx, workspaceId, accountId, mailScope),
    selectReportingPerAccount(trx, workspaceId, accountId, mailScope),
    selectReportingWorkflowRuns24h(trx, workspaceId, now, mailScope),
    selectAutomationCockpit(trx, workspaceId, accountId, now, mailScope),
  ]);

  return {
    accounts,
    totals,
    perAccount,
    workflowRuns24h,
    automation,
  };
}

async function selectReportingAccounts(
  trx: WorkspaceTransaction,
  workspaceId: string,
  accountId: number | undefined,
  mailScope: MailSqlScope | undefined,
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

  const accountScope = mailScopePredicate(mailScope, { accountId: 'email_accounts.id' });
  const messageScope = mailScopePredicate(mailScope, {
    accountId: 'report_message.account_id',
    folderId: 'report_message.folder_id',
    messageId: 'report_message.id',
    assignedToUserId: 'report_message.assigned_to_user_id',
    assignedTo: 'report_message.assigned_to',
  });
  if (accountScope || messageScope) {
    query = query.where(kyselySql<boolean>`(
      ${accountScope ?? kyselySql<boolean>`false`}
      or exists (
        select 1 from email_messages report_message
        where report_message.workspace_id = ${workspaceId}::uuid
          and report_message.account_id = email_accounts.id
          and ${messageScope ?? kyselySql<boolean>`false`}
      )
    )`);
  }
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
  mailScope: MailSqlScope | undefined,
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

  const scopePredicate = mailScopePredicate(mailScope, {
    accountId: 'email_messages.account_id',
    folderId: 'email_messages.folder_id',
    messageId: 'email_messages.id',
    assignedToUserId: 'email_messages.assigned_to_user_id',
    assignedTo: 'email_messages.assigned_to',
  });
  if (scopePredicate) query = query.where(scopePredicate);
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
  mailScope: MailSqlScope | undefined,
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

  const scopePredicate = mailScopePredicate(mailScope, {
    accountId: 'email_messages.account_id',
    folderId: 'email_messages.folder_id',
    messageId: 'email_messages.id',
    assignedToUserId: 'email_messages.assigned_to_user_id',
    assignedTo: 'email_messages.assigned_to',
  });
  if (scopePredicate) query = query.where(scopePredicate);
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
  mailScope: MailSqlScope | undefined,
): Promise<EmailReportingSnapshot['workflowRuns24h']> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const workflowId = kyselySql<CountValue>`coalesce(email_workflow_runs.workflow_source_sqlite_id, email_workflow_runs.workflow_id, 0)`;
  let query = trx
    .selectFrom('email_workflow_runs')
    .leftJoin('email_workflows as report_workflow', (join) => join
      .onRef('report_workflow.workspace_id', '=', 'email_workflow_runs.workspace_id')
      .onRef('report_workflow.id', '=', 'email_workflow_runs.workflow_id'))
    .select([
      workflowId.as('workflowId'),
      'report_workflow.name as workflowName',
      kyselySql<CountValue>`count(*)`.as('count'),
      kyselySql<CountValue>`
        coalesce(sum(case when email_workflow_runs.status = 'error' then 1 else 0 end), 0)
      `.as('errors'),
    ])
    .where('email_workflow_runs.workspace_id', '=', workspaceId)
    .where('email_workflow_runs.finished_at', '>=', since)
    // Testläufe (Plan 047) zählen nicht.
    .where('email_workflow_runs.dry_run', '=', false);
  const scopePredicate = mailScopePredicate(mailScope, {
    accountId: 'report_message.account_id',
    folderId: 'report_message.folder_id',
    messageId: 'report_message.id',
    assignedToUserId: 'report_message.assigned_to_user_id',
    assignedTo: 'report_message.assigned_to',
  });
  if (scopePredicate) {
    query = query.where(kyselySql<boolean>`exists (
      select 1 from email_messages report_message
      where report_message.workspace_id = ${workspaceId}::uuid
        and report_message.id = email_workflow_runs.message_id
        and ${scopePredicate}
    )`);
  }
  const rows = await query
    .groupBy([workflowId, 'report_workflow.name'])
    .orderBy('count', 'desc')
    .limit(30)
    .execute() as ReportingWorkflowRunRow[];

  return rows.map((row) => ({
    workflowId: countValue(row.workflowId),
    workflowName: row.workflowName ?? null,
    count: countValue(row.count),
    errors: countValue(row.errors),
  }));
}

type CockpitSentRow = { day: string | null; kind: string | null; count: CountValue };
type CockpitQueueRow = { pendingApproval: CountValue; outboundBlocked: CountValue };
type CockpitDecideRow = { workflowId: CountValue; workflowName: string | null; port: string | null; count: CountValue };
type CockpitCostRow = { events: CountValue; cost: CountValue };

/**
 * Automatik-Cockpit (Plan 049): Herkunft gesendeter Mails je Woche,
 * Warteschlangen (gleiche Bedingungen wie die Ansichten approval_pending und
 * outbound_blocked), Antworten der KI-Entscheidung je Workflow und – nur mit
 * voller Mail-Sicht – die KI-Kosten. Jede Abfrage mit workspace_id,
 * Konto-Filter und Mail-Sicht wie selectReportingTotals.
 */
async function selectAutomationCockpit(
  trx: WorkspaceTransaction,
  workspaceId: string,
  accountId: number | undefined,
  now: Date,
  mailScope: MailSqlScope | undefined,
): Promise<AutomationCockpitSnapshot> {
  const messageScope = mailScopePredicate(mailScope, {
    accountId: 'email_messages.account_id',
    folderId: 'email_messages.folder_id',
    messageId: 'email_messages.id',
    assignedToUserId: 'email_messages.assigned_to_user_id',
    assignedTo: 'email_messages.assigned_to',
  });
  const windowStart = automationWindowStart(now);
  const sentAt = kyselySql`coalesce(email_messages.date_received, email_messages.created_at)`;

  let sentQuery = trx
    .selectFrom('email_messages')
    .select([
      kyselySql<string>`to_char((${sentAt} at time zone 'UTC')::date, 'YYYY-MM-DD')`.as('day'),
      'email_messages.sent_by_kind as kind',
      kyselySql<CountValue>`count(*)`.as('count'),
    ])
    .where('email_messages.workspace_id', '=', workspaceId)
    .where('email_messages.folder_kind', '=', 'sent')
    .where('email_messages.is_spam', '=', false)
    .where(kyselySql<boolean>`${sentAt} >= ${windowStart}`);
  if (messageScope) sentQuery = sentQuery.where(messageScope);
  if (accountId !== undefined) sentQuery = sentQuery.where('email_messages.account_id', '=', accountId);

  let queueQuery = trx
    .selectFrom('email_messages')
    .select([
      kyselySql<CountValue>`coalesce(sum(case when uid < 0 and folder_kind = 'draft' and approval_state = 'pending' and scheduled_send_at is null then 1 else 0 end), 0)`.as('pendingApproval'),
      kyselySql<CountValue>`coalesce(sum(case when uid < 0 and folder_kind = 'draft' and outbound_hold = true then 1 else 0 end), 0)`.as('outboundBlocked'),
    ])
    .where('email_messages.workspace_id', '=', workspaceId)
    .where('email_messages.soft_deleted', '=', false)
    .where(kyselySql<boolean>`(email_messages.snoozed_until is null or email_messages.snoozed_until <= now())`);
  if (messageScope) queueQuery = queueQuery.where(messageScope);
  if (accountId !== undefined) queueQuery = queueQuery.where('email_messages.account_id', '=', accountId);

  const decideSince = new Date(now.getTime() - AUTOMATION_COCKPIT_DECIDE_DAYS * 24 * 60 * 60_000);
  const decideWorkflowId = kyselySql<CountValue>`coalesce(cockpit_run.workflow_source_sqlite_id, cockpit_run.workflow_id, 0)`;
  let decideQuery = trx
    .selectFrom('email_workflow_run_steps as cockpit_step')
    .innerJoin('email_workflow_runs as cockpit_run', (join) => join
      .onRef('cockpit_run.workspace_id', '=', 'cockpit_step.workspace_id')
      .onRef('cockpit_run.id', '=', 'cockpit_step.run_id'))
    .leftJoin('email_workflows as cockpit_workflow', (join) => join
      .onRef('cockpit_workflow.workspace_id', '=', 'cockpit_run.workspace_id')
      .onRef('cockpit_workflow.id', '=', 'cockpit_run.workflow_id'))
    .select([
      decideWorkflowId.as('workflowId'),
      'cockpit_workflow.name as workflowName',
      'cockpit_step.port as port',
      kyselySql<CountValue>`count(*)`.as('count'),
    ])
    .where('cockpit_step.workspace_id', '=', workspaceId)
    .where('cockpit_step.node_type', '=', 'ai.decide')
    .where('cockpit_step.status', 'in', ['ok', 'error'])
    .where('cockpit_step.port', 'in', ['ja', 'nein', 'unsicher', 'error'])
    .where(kyselySql<boolean>`coalesce(cockpit_step.message, '') <> ${AI_DECIDE_DRY_RUN_SUMMARY}`)
    .where('cockpit_step.created_at', '>=', decideSince)
    // Testläufe (Plan 047) zählen nicht – auch nicht mit „KI wirklich fragen“.
    .where('cockpit_run.dry_run', '=', false);
  const runMessageScope = mailScopePredicate(mailScope, {
    accountId: 'report_message.account_id',
    folderId: 'report_message.folder_id',
    messageId: 'report_message.id',
    assignedToUserId: 'report_message.assigned_to_user_id',
    assignedTo: 'report_message.assigned_to',
  });
  if (runMessageScope || accountId !== undefined) {
    const accountCondition: RawBuilder<boolean> = accountId === undefined
      ? kyselySql<boolean>`true`
      : kyselySql<boolean>`report_message.account_id = ${accountId}`;
    decideQuery = decideQuery.where(kyselySql<boolean>`exists (
      select 1 from email_messages report_message
      where report_message.workspace_id = ${workspaceId}::uuid
        and report_message.id = cockpit_run.message_id
        and ${runMessageScope ?? kyselySql<boolean>`true`}
        and ${accountCondition}
    )`);
  }

  // KI-Kosten nur mit voller Mail-Sicht: die Nutzungsdaten kennen keine Mail-Rechte.
  const costQuery = messageScope
    ? Promise.resolve(undefined)
    : trx
      .selectFrom('ai_usage_events')
      .select([
        kyselySql<CountValue>`count(*)`.as('events'),
        kyselySql<CountValue>`coalesce(sum(est_cost_micro_usd), 0)`.as('cost'),
      ])
      .where('workspace_id', '=', workspaceId)
      .where('created_at', '>=', decideSince)
      .executeTakeFirst() as Promise<CockpitCostRow | undefined>;

  const [sentRows, queueRow, decideRows, costRow] = await Promise.all([
    sentQuery.groupBy([kyselySql`1`, kyselySql`2`]).execute() as Promise<CockpitSentRow[]>,
    queueQuery.executeTakeFirst() as Promise<CockpitQueueRow | undefined>,
    decideQuery.groupBy([kyselySql`1`, kyselySql`2`, kyselySql`3`]).execute() as Promise<CockpitDecideRow[]>,
    costQuery,
  ]);

  return {
    sentByKindWeekly: bucketSentByKindWeekly(
      sentRows.map((row) => ({ day: row.day ?? '', kind: row.kind ?? null, count: countValue(row.count) })),
      now,
    ),
    pendingApproval: countValue(queueRow?.pendingApproval),
    outboundBlocked: countValue(queueRow?.outboundBlocked),
    aiDecideByWorkflow30d: summarizeAiDecideAnswers(decideRows.map((row) => ({
      workflowId: countValue(row.workflowId),
      workflowName: row.workflowName ?? null,
      port: row.port ?? '',
      count: countValue(row.count),
    }))),
    aiCost30d: messageScope
      ? null
      : { costMicroUsd: countValue(costRow?.cost), events: countValue(costRow?.events) },
  };
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
