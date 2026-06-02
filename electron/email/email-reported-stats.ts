import { getDb } from '../sqlite-service';
import {
  EMAIL_MESSAGES_TABLE,
  EMAIL_WORKFLOW_RUNS_TABLE,
  EMAIL_ACCOUNTS_TABLE,
} from '../database-schema';
import { accountIdsForMailScopeAll, type MailScopeSession } from './mail-scope-access';

export type EmailReportingSnapshot = {
  accounts: { id: number; display_name: string; email_address: string; protocol: string }[];
  totals: {
    messages: number;
    unread: number;
    archived: number;
    withCustomer: number;
    withAssignment: number;
    withAttachments: number;
  };
  perAccount: {
    accountId: number;
    messages: number;
    unread: number;
    archived: number;
  }[];
  workflowRuns24h: { workflow_id: number; count: number; errors: number }[];
};

export function getEmailReportingSnapshot(
  accountIdFilter: number | null,
  access?: MailScopeSession,
): EmailReportingSnapshot {
  const db = getDb();
  let accounts = db
    .prepare(
      `SELECT id, display_name, email_address, COALESCE(protocol,'imap') AS protocol FROM ${EMAIL_ACCOUNTS_TABLE} ORDER BY id`,
    )
    .all() as EmailReportingSnapshot['accounts'];

  let accClause = 'WHERE soft_deleted = 0';
  const params: number[] = [];
  if (accountIdFilter != null) {
    accClause += ' AND account_id = ?';
    params.push(accountIdFilter);
    accounts = accounts.filter((a) => a.id === accountIdFilter);
  } else if (access) {
    const allowed = accountIdsForMailScopeAll(db, access);
    if (allowed !== null) {
      if (allowed.length === 0) {
        accClause += ' AND 1=0';
        accounts = [];
      } else {
        accClause += ` AND account_id IN (${allowed.map(() => '?').join(',')})`;
        params.push(...allowed);
        accounts = accounts.filter((a) => allowed.includes(a.id));
      }
    }
  }

  const totalsRow = db
    .prepare(
      `SELECT
        COUNT(*) as messages,
        SUM(CASE WHEN seen_local = 0 AND (uid >= 0 OR pop3_uidl IS NOT NULL) THEN 1 ELSE 0 END) as unread,
        SUM(CASE WHEN archived = 1 THEN 1 ELSE 0 END) as archived,
        SUM(CASE WHEN customer_id IS NOT NULL THEN 1 ELSE 0 END) as withCustomer,
        SUM(CASE WHEN assigned_to IS NOT NULL AND assigned_to != '' THEN 1 ELSE 0 END) as withAssignment,
        SUM(CASE WHEN has_attachments = 1 THEN 1 ELSE 0 END) as withAttachments
       FROM ${EMAIL_MESSAGES_TABLE} ${accClause}`,
    )
    .get(...params) as {
    messages: number;
    unread: number;
    archived: number;
    withCustomer: number;
    withAssignment: number;
    withAttachments: number;
  };

  const perAccount = db
    .prepare(
      `SELECT account_id as accountId,
        COUNT(*) as messages,
        SUM(CASE WHEN seen_local = 0 AND (uid >= 0 OR pop3_uidl IS NOT NULL) THEN 1 ELSE 0 END) as unread,
        SUM(CASE WHEN archived = 1 THEN 1 ELSE 0 END) as archived
       FROM ${EMAIL_MESSAGES_TABLE}
       ${accClause}
       GROUP BY account_id
       ORDER BY account_id`,
    )
    .all(...params) as EmailReportingSnapshot['perAccount'];

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const workflowRuns24h = db
    .prepare(
      `SELECT workflow_id,
        COUNT(*) as count,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors
       FROM ${EMAIL_WORKFLOW_RUNS_TABLE}
       WHERE datetime(finished_at) >= datetime(?)
       GROUP BY workflow_id
       ORDER BY count DESC
       LIMIT 30`,
    )
    .all(since) as EmailReportingSnapshot['workflowRuns24h'];

  return {
    accounts,
    totals: {
      messages: Number(totalsRow.messages) || 0,
      unread: Number(totalsRow.unread) || 0,
      archived: Number(totalsRow.archived) || 0,
      withCustomer: Number(totalsRow.withCustomer) || 0,
      withAssignment: Number(totalsRow.withAssignment) || 0,
      withAttachments: Number(totalsRow.withAttachments) || 0,
    },
    perAccount,
    workflowRuns24h,
  };
}
