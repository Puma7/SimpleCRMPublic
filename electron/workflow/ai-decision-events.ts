import { getDb } from '../sqlite-service';
import { AI_DECISION_EVENTS_TABLE } from '../database-schema';
import { normalizeAiDecideThreshold, type AiDecideAnswer } from '../../packages/core/src/workflow/ai-decide';
import {
  AI_DECISION_EVENT_RETENTION_DAYS,
  AI_DECISION_OVERRIDE_WINDOW_DAYS,
  AI_DECISION_STATS_DAYS,
  summarizeAiDecisionEvents,
  type AiDecisionFeedbackSignal,
  type AiDecisionOverride,
  type AiDecisionStats,
  type AiDecisionTruth,
} from '../../packages/core/src/workflow/ai-decision-accuracy';

/**
 * Plan 050 (Desktop): Entscheidungen der KI-Entscheidung als Ereignis ohne Text
 * und menschliche Korrekturen daran. Gegenstück zu
 * packages/server/src/ai-decision-events.ts; workflow_source_id ist hier die
 * lokale Workflow-Id. Fehler werden nur protokolliert und ändern nie das
 * Ergebnis des Knotens, den Spam-Status oder den Versand.
 */
const DAY_MS = 86_400_000;

export type AiDecisionEventInput = Readonly<{
  workflowId: number;
  nodeId: string;
  runId: number | null;
  messageId: number | null;
  direction: string;
  answer: AiDecideAnswer;
  probability: number | null;
  threshold: unknown;
  model: string | null;
  feedbackSignal: AiDecisionFeedbackSignal;
  now?: Date;
}>;

export function recordAiDecisionEvent(input: AiDecisionEventInput): void {
  const probability = typeof input.probability === 'number' && Number.isFinite(input.probability)
    ? Math.max(0, Math.min(100, Math.round(input.probability)))
    : null;
  getDb()
    .prepare(
      `INSERT INTO ${AI_DECISION_EVENTS_TABLE}
        (workflow_id, workflow_source_id, node_id, run_id, message_id, direction, answer,
         probability, threshold, model, feedback_signal, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.workflowId,
      input.workflowId,
      input.nodeId.slice(0, 200),
      input.runId,
      input.messageId,
      input.direction.slice(0, 40) || 'inbound',
      input.answer,
      probability,
      normalizeAiDecideThreshold(input.threshold),
      input.model ? input.model.slice(0, 200) : null,
      input.feedbackSignal,
      (input.now ?? new Date()).toISOString(),
    );
}

export function recordAiDecisionEventSafe(input: AiDecisionEventInput): void {
  try {
    recordAiDecisionEvent(input);
  } catch (error) {
    console.warn(`[workflow] KI-Entscheidung: Ereignis nicht gespeichert (Lauf ${input.runId ?? '–'}): ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Verknüpft eine menschliche Korrektur mit dem neuesten offenen Ereignis dieser
 * Mail und Rückmeldungsart (höchstens 30 Tage alt). Eine zweite Korrektur
 * überschreibt die erste nicht.
 */
export function linkAiDecisionOverride(input: Readonly<{
  messageId: number;
  signal: Exclude<AiDecisionFeedbackSignal, 'none'>;
  resolve: (answer: AiDecideAnswer) => AiDecisionOverride | null;
  now?: Date;
}>): AiDecisionOverride | null {
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - AI_DECISION_OVERRIDE_WINDOW_DAYS * DAY_MS).toISOString();
  const db = getDb();
  const event = db
    .prepare(
      `SELECT id, answer FROM ${AI_DECISION_EVENTS_TABLE}
       WHERE message_id = ? AND feedback_signal = ? AND override_at IS NULL AND created_at >= ?
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(input.messageId, input.signal, since) as { id: number; answer: AiDecideAnswer } | undefined;
  if (!event) return null;
  const override = input.resolve(event.answer);
  if (!override) return null;
  db.prepare(
    `UPDATE ${AI_DECISION_EVENTS_TABLE}
     SET override_kind = ?, truth = ?, override_at = ?
     WHERE id = ? AND override_at IS NULL`,
  ).run(override.overrideKind, override.truth, now.toISOString(), event.id);
  return override;
}

export function linkAiDecisionOverrideSafe(input: Parameters<typeof linkAiDecisionOverride>[0]): void {
  try {
    linkAiDecisionOverride(input);
  } catch (error) {
    console.warn(`[ai-decision] Korrektur nicht verknüpft (Mail ${input.messageId}): ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Kennzahlen eines Knotens (Standard 90 Tage); nie Einzelzeilen nach außen. */
export function loadAiDecisionStats(input: Readonly<{
  workflowId: number;
  nodeId: string;
  days?: number;
  now?: Date;
}>): AiDecisionStats {
  const now = input.now ?? new Date();
  const days = Math.max(1, Math.min(365, Math.floor(input.days ?? AI_DECISION_STATS_DAYS)));
  const since = new Date(now.getTime() - days * DAY_MS).toISOString();
  const rows = getDb()
    .prepare(
      `SELECT answer, probability, created_at, override_kind, truth, feedback_signal FROM ${AI_DECISION_EVENTS_TABLE}
       WHERE workflow_source_id = ? AND node_id = ? AND created_at >= ?`,
    )
    .all(input.workflowId, input.nodeId, since) as Array<{
    answer: AiDecideAnswer;
    probability: number | null;
    created_at: string;
    override_kind: string | null;
    truth: AiDecisionTruth | null;
    feedback_signal: string | null;
  }>;
  return summarizeAiDecisionEvents(rows.map((row) => ({
    answer: row.answer,
    probability: row.probability,
    createdAt: row.created_at,
    overrideKind: row.override_kind,
    truth: row.truth,
    feedbackSignal: row.feedback_signal,
  })), now);
}

/** Aufbewahrung: Ereignisse älter als 365 Tage löschen. */
export function pruneAiDecisionEvents(now: Date = new Date(), retentionDays = AI_DECISION_EVENT_RETENTION_DAYS): number {
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS).toISOString();
  const result = getDb()
    .prepare(`DELETE FROM ${AI_DECISION_EVENTS_TABLE} WHERE created_at < ?`)
    .run(cutoff);
  return Number(result.changes ?? 0);
}

const PRUNE_INTERVAL_MS = DAY_MS;
let lastPruneAt = 0;

/** Höchstens einmal am Tag aus dem globalen Cron. */
export function pruneAiDecisionEventsIfDue(
  logger: Pick<typeof console, 'warn' | 'debug'>,
  now: number = Date.now(),
): void {
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;
  try {
    const removed = pruneAiDecisionEvents(new Date(now));
    if (removed > 0) logger.debug(`[ai-decision] ${removed} alte Ereignisse der KI-Entscheidung gelöscht`);
  } catch (error) {
    logger.warn('[ai-decision] Aufräumen fehlgeschlagen', error);
  }
}

/** Nur für Tests: Tagesgrenze des Aufräumens zurücksetzen. */
export function resetAiDecisionPruneClockForTests(): void {
  lastPruneAt = 0;
}
