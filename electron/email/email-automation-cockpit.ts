/**
 * Automatik-Cockpit (Plan 049, Desktop): Rohzeilen aus SQLite, Aufbereitung
 * im Core. Gleiche Semantik wie der Server-Port; KI-Kosten gibt es auf dem
 * Desktop nicht (keine Nutzungsdaten).
 */
import type Database from 'better-sqlite3';
import {
  AI_DECIDE_DRY_RUN_SUMMARY,
  AUTOMATION_COCKPIT_DECIDE_DAYS,
  automationWindowStart,
  bucketSentByKindWeekly,
  emptyAutomationCockpitSnapshot,
  summarizeAiDecideAnswers,
  type AiDecideAnswerRow,
  type AutomationCockpitSnapshot,
  type SentKindDayRow,
} from '@simplecrm/core';
import {
  EMAIL_MESSAGES_TABLE,
  EMAIL_WORKFLOW_RUNS_TABLE,
  EMAIL_WORKFLOW_RUN_STEPS_TABLE,
  EMAIL_WORKFLOWS_TABLE,
} from '../database-schema';
import { APPROVAL_PENDING_VIEW_SQL, OUTBOUND_BLOCKED_VIEW_SQL } from './automation-view-sql';

/** accountIds null = alle Konten; [] = keine. */
export type AutomationCockpitScope = { accountIds: readonly number[] | null };

function accountFilter(scope: AutomationCockpitScope, column: string): { sql: string; params: number[] } {
  if (scope.accountIds === null) return { sql: '', params: [] };
  return {
    sql: ` AND ${column} IN (${scope.accountIds.map(() => '?').join(',')})`,
    params: [...scope.accountIds],
  };
}

export function getAutomationCockpitSnapshot(
  db: Database.Database,
  scope: AutomationCockpitScope,
  now = new Date(),
): AutomationCockpitSnapshot {
  if (scope.accountIds !== null && scope.accountIds.length === 0) return emptyAutomationCockpitSnapshot(now);

  // Gesendet je Tag und Herkunft; gelöschte gesendete Mails zählen (sie wurden versendet).
  const sentFilter = accountFilter(scope, 'm.account_id');
  const sentRows = db
    .prepare(
      `SELECT date(COALESCE(m.date_received, m.created_at)) AS day, m.sent_by_kind AS kind, COUNT(*) AS count
       FROM ${EMAIL_MESSAGES_TABLE} m
       WHERE m.folder_kind = 'sent' AND m.is_spam = 0
         AND datetime(COALESCE(m.date_received, m.created_at)) >= datetime(?)${sentFilter.sql}
       GROUP BY day, kind`,
    )
    .all(automationWindowStart(now).toISOString(), ...sentFilter.params) as SentKindDayRow[];

  // Warteschlangen mit denselben Bedingungen wie die Ansichten.
  const queueFilter = accountFilter(scope, 'm.account_id');
  const queues = db
    .prepare(
      `SELECT
         SUM(CASE WHEN ${APPROVAL_PENDING_VIEW_SQL} THEN 1 ELSE 0 END) AS pendingApproval,
         SUM(CASE WHEN ${OUTBOUND_BLOCKED_VIEW_SQL} THEN 1 ELSE 0 END) AS outboundBlocked
       FROM ${EMAIL_MESSAGES_TABLE} m
       WHERE m.soft_deleted = 0${queueFilter.sql}`,
    )
    .get(...queueFilter.params) as { pendingApproval: number | null; outboundBlocked: number | null };

  // Antworten der KI-Entscheidung (Port ja|nein|unsicher|error). Ohne Testläufe
  // (dry_run, Plan 047) und ohne die „keine KI-Anfrage“-Schritte älterer Probeläufe.
  const decideSince = new Date(now.getTime() - AUTOMATION_COCKPIT_DECIDE_DAYS * 24 * 60 * 60_000).toISOString();
  const decideFilter = scope.accountIds === null
    ? { sql: '', params: [] as number[] }
    : {
      sql: ` AND r.message_id IN (SELECT id FROM ${EMAIL_MESSAGES_TABLE} WHERE account_id IN (${scope.accountIds.map(() => '?').join(',')}))`,
      params: [...scope.accountIds],
    };
  const decideRows = db
    .prepare(
      `SELECT r.workflow_id AS workflowId, w.name AS workflowName, s.port AS port, COUNT(*) AS count
       FROM ${EMAIL_WORKFLOW_RUN_STEPS_TABLE} s
       JOIN ${EMAIL_WORKFLOW_RUNS_TABLE} r ON r.id = s.run_id
       LEFT JOIN ${EMAIL_WORKFLOWS_TABLE} w ON w.id = r.workflow_id
       WHERE s.node_type = 'ai.decide'
         AND s.status IN ('ok', 'error')
         AND s.port IN ('ja', 'nein', 'unsicher', 'error')
         AND COALESCE(s.message, '') <> ?
         AND r.dry_run = 0
         AND datetime(s.created_at) >= datetime(?)${decideFilter.sql}
       GROUP BY r.workflow_id, w.name, s.port`,
    )
    .all(AI_DECIDE_DRY_RUN_SUMMARY, decideSince, ...decideFilter.params) as AiDecideAnswerRow[];

  return {
    sentByKindWeekly: bucketSentByKindWeekly(sentRows, now),
    pendingApproval: Number(queues?.pendingApproval) || 0,
    outboundBlocked: Number(queues?.outboundBlocked) || 0,
    aiDecideByWorkflow30d: summarizeAiDecideAnswers(decideRows),
    aiCost30d: null,
  };
}
