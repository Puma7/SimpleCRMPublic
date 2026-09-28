import {
  AI_DECISION_EVENT_RETENTION_DAYS,
  AI_DECISION_OVERRIDE_WINDOW_DAYS,
  AI_DECISION_STATS_DAYS,
  normalizeAiDecideThreshold,
  summarizeAiDecisionEvents,
  type AiDecideAnswer,
  type AiDecisionFeedbackSignal,
  type AiDecisionOverride,
  type AiDecisionStats,
} from '@simplecrm/core';
import { sql, type Kysely, type RawBuilder } from 'kysely';

import type { ServerDatabase } from './db/schema';
import { mailScopePredicate } from './mail-access/sql-scope';
import type { MailSqlScope } from './mail-access/types';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
  type WorkspaceTransaction,
} from './db/workspace-context';

/**
 * Plan 050: Entscheidungen der KI-Entscheidung als Ereignis ohne Text
 * (Tabelle ai_decision_events, Migration 0066) und menschliche Korrekturen
 * daran (docs/design/ai-decision-accuracy.md).
 */
const DAY_MS = 86_400_000;
const PRUNE_BATCH = 5_000;
const PRUNE_MAX_BATCHES = 20;

export type AiDecisionEventInput = Readonly<{
  workspaceId: string;
  runId: number;
  nodeId: string;
  messageId: number | null;
  direction: string;
  answer: AiDecideAnswer;
  probability: number | null;
  threshold: unknown;
  model: string | null;
  feedbackSignal: AiDecisionFeedbackSignal;
  now: Date;
}>;

/**
 * Schreibt ein Ereignis zum Lauf `runId`. Fehlt der Lauf (gelöscht), wird
 * nichts geschrieben. Wirft nicht – Aufrufer protokollieren.
 */
export async function recordAiDecisionEvent(trx: WorkspaceTransaction, input: AiDecisionEventInput): Promise<boolean> {
  const run = await trx
    .selectFrom('email_workflow_runs')
    .select(['workflow_id', 'workflow_source_sqlite_id'])
    .where('workspace_id', '=', input.workspaceId)
    .where('id', '=', input.runId)
    .executeTakeFirst();
  if (!run) return false;
  const workflowId = run.workflow_id === null || run.workflow_id === undefined ? null : Number(run.workflow_id);
  const sourceId = run.workflow_source_sqlite_id ?? workflowId;
  if (sourceId === null || sourceId === undefined) return false;
  const probability = typeof input.probability === 'number' && Number.isFinite(input.probability)
    ? Math.max(0, Math.min(100, Math.round(input.probability)))
    : null;
  await trx
    .insertInto('ai_decision_events')
    .values({
      workspace_id: input.workspaceId,
      workflow_id: workflowId,
      workflow_source_id: Number(sourceId),
      node_id: input.nodeId.slice(0, 200),
      run_id: input.runId,
      message_id: input.messageId,
      direction: input.direction.slice(0, 40) || 'inbound',
      answer: input.answer,
      probability,
      threshold: normalizeAiDecideThreshold(input.threshold),
      model: input.model ? input.model.slice(0, 200) : null,
      feedback_signal: input.feedbackSignal,
      created_at: input.now,
    })
    .execute();
  return true;
}

/**
 * Verknüpft eine menschliche Korrektur mit dem neuesten offenen Ereignis dieser
 * Mail und Rückmeldungsart (höchstens 30 Tage alt). `resolve` bekommt dessen
 * Antwort und liefert die Korrektur oder null (Zustimmung). Eine zweite
 * Korrektur überschreibt die erste nicht.
 */
export async function linkAiDecisionOverride(
  trx: WorkspaceTransaction,
  input: Readonly<{
    workspaceId: string;
    messageId: number;
    signal: Exclude<AiDecisionFeedbackSignal, 'none'>;
    resolve: (answer: AiDecideAnswer) => AiDecisionOverride | null;
    now: Date;
  }>,
): Promise<AiDecisionOverride | null> {
  const since = new Date(input.now.getTime() - AI_DECISION_OVERRIDE_WINDOW_DAYS * DAY_MS);
  const event = await trx
    .selectFrom('ai_decision_events')
    .select(['id', 'answer'])
    .where('workspace_id', '=', input.workspaceId)
    .where('message_id', '=', input.messageId)
    .where('feedback_signal', '=', input.signal)
    .where('override_at', 'is', null)
    .where('created_at', '>=', since)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (!event) return null;
  const override = input.resolve(event.answer);
  if (!override) return null;
  await trx
    .updateTable('ai_decision_events')
    .set({ override_kind: override.overrideKind, truth: override.truth, override_at: input.now })
    .where('workspace_id', '=', input.workspaceId)
    .where('id', '=', Number(event.id))
    .where('override_at', 'is', null)
    .execute();
  return override;
}

/** Wie linkAiDecisionOverride, fängt aber jeden Fehler ab (Spam-/Sendepfad darf nie scheitern). */
export async function linkAiDecisionOverrideSafe(
  trx: WorkspaceTransaction,
  input: Parameters<typeof linkAiDecisionOverride>[1],
): Promise<void> {
  try {
    // Savepoint: ein Fehler hier darf die umgebende Transaktion nicht abbrechen.
    await sql`SAVEPOINT ai_decision_override`.execute(trx);
    try {
      await linkAiDecisionOverride(trx, input);
      await sql`RELEASE SAVEPOINT ai_decision_override`.execute(trx);
    } catch (error) {
      await sql`ROLLBACK TO SAVEPOINT ai_decision_override`.execute(trx);
      throw error;
    }
  } catch (error) {
    console.warn(`[ai-decision] Korrektur nicht verknüpft (Mail ${input.messageId}): ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Eingeschränkte Mail-Sicht (wie die Lauf-Liste): nur Ereignisse zu Mails, die
 * der Aufrufer sehen darf. Ereignisse ohne Mail zählen dann nicht (fail closed).
 */
function eventVisibilityPredicate(scope: MailSqlScope | undefined, workspaceId: string): RawBuilder<boolean> | undefined {
  if (!scope || scope.kind === 'all') return undefined;
  const scopePred = mailScopePredicate(scope, {
    accountId: 'ai_decision_scope_message.account_id',
    folderId: 'ai_decision_scope_message.folder_id',
    messageId: 'ai_decision_scope_message.id',
    assignedToUserId: 'ai_decision_scope_message.assigned_to_user_id',
    assignedTo: 'ai_decision_scope_message.assigned_to',
  });
  if (!scopePred) return undefined;
  return sql<boolean>`exists (
    select 1
    from email_messages as ai_decision_scope_message
    where ai_decision_scope_message.workspace_id = ${workspaceId}
      and ai_decision_scope_message.id = ${sql.ref('ai_decision_events.message_id')}
      and ${scopePred}
  )`;
}

/** Kennzahlen eines Knotens über die letzten 90 Tage (nie Einzelzeilen nach außen). */
export async function loadAiDecisionStats(
  trx: WorkspaceTransaction,
  input: Readonly<{
    workspaceId: string;
    workflowSourceId: number;
    nodeId: string;
    days?: number;
    now: Date;
    mailScope?: MailSqlScope;
  }>,
): Promise<AiDecisionStats> {
  const days = Math.max(1, Math.min(365, Math.floor(input.days ?? AI_DECISION_STATS_DAYS)));
  const since = new Date(input.now.getTime() - days * DAY_MS);
  let query = trx
    .selectFrom('ai_decision_events')
    .select(['answer', 'probability', 'created_at', 'override_kind', 'truth'])
    .where('workspace_id', '=', input.workspaceId)
    .where('workflow_source_id', '=', input.workflowSourceId)
    .where('node_id', '=', input.nodeId)
    .where('created_at', '>=', since);
  const visibility = eventVisibilityPredicate(input.mailScope, input.workspaceId);
  if (visibility) query = query.where(visibility);
  const rows = await query.execute();
  return summarizeAiDecisionEvents(rows.map((row) => ({
    answer: row.answer,
    probability: row.probability === null ? null : Number(row.probability),
    createdAt: row.created_at,
    overrideKind: row.override_kind,
    truth: row.truth,
  })), input.now);
}

/** Lesender Port der Route `GET /api/v1/workflows/by-source/:sourceId/ai-decisions`. */
export type AiDecisionStatsApiPort = Readonly<{
  get(input: {
    workspaceId: string;
    workflowSourceId: number;
    nodeId: string;
    days: number;
    /** Vom Mail-Zugriffs-Enforcer gesetzt (eingeschränkte Mail-Sicht). */
    mailScope?: MailSqlScope;
  }): Promise<AiDecisionStats>;
}>;

export function createPostgresAiDecisionStatsPort(options: Readonly<{
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
  now?: () => Date;
}>): AiDecisionStatsApiPort {
  return {
    async get(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        (trx) => loadAiDecisionStats(trx, { ...input, now: options.now?.() ?? new Date() }),
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

/** Aufbewahrung: Ereignisse eines Workspaces älter als 365 Tage löschen (in Stapeln). */
export async function pruneAiDecisionEvents(
  options: Readonly<{
    db: Kysely<ServerDatabase>;
    now?: () => Date;
    applyWorkspaceSession?: WorkspaceSessionApplier;
    retentionDays?: number;
  }>,
  workspaceId: string,
): Promise<number> {
  const now = options.now?.() ?? new Date();
  const cutoff = new Date(now.getTime() - (options.retentionDays ?? AI_DECISION_EVENT_RETENTION_DAYS) * DAY_MS);
  let removed = 0;
  for (let batch = 0; batch < PRUNE_MAX_BATCHES; batch += 1) {
    const deleted = await withWorkspaceTransaction(options.db, { workspaceId, role: 'system' }, async (trx) => {
      const ids = await trx
        .selectFrom('ai_decision_events')
        .select('id')
        .where('workspace_id', '=', workspaceId)
        .where('created_at', '<', cutoff)
        .orderBy('id', 'asc')
        .limit(PRUNE_BATCH)
        .execute();
      if (ids.length === 0) return 0;
      await trx
        .deleteFrom('ai_decision_events')
        .where('workspace_id', '=', workspaceId)
        .where('id', 'in', ids.map((row) => Number(row.id)))
        .execute();
      return ids.length;
    }, { applySession: options.applyWorkspaceSession });
    removed += deleted;
    if (deleted < PRUNE_BATCH) break;
  }
  return removed;
}
