/**
 * Automatik-Cockpit (Plan 049): wie viel die Teilautomatisierung leistet.
 * Reine Hilfsfunktionen ohne I/O; beide Editionen liefern die Rohzeilen
 * (Tage × Herkunft, Antworten der KI-Entscheidung je Workflow) und bauen den
 * Schnappschuss hier zusammen.
 */

/** Wochen der Tabelle „gesendet von“ (inkl. der laufenden Woche). */
export const AUTOMATION_COCKPIT_WEEKS = 8;
/** Zeitraum der KI-Entscheidungen und der KI-Kosten. */
export const AUTOMATION_COCKPIT_DECIDE_DAYS = 30;
/** Höchstzahl der Workflows in der Tabelle „KI-Entscheidungen“. */
export const AUTOMATION_COCKPIT_MAX_WORKFLOWS = 30;

/** day = YYYY-MM-DD (UTC). */
export type SentKindDayRow = { day: string; kind: string | null; count: number };
export type SentKindWeek = {
  /** Montag der Woche, YYYY-MM-DD (UTC). */
  weekStart: string;
  human: number;
  aiAuto: number;
  aiApproved: number;
  workflow: number;
  relay: number;
  unknown: number;
};
export type AiDecideAnswerRow = { workflowId: number; workflowName: string | null; port: string; count: number };
export type AiDecideWorkflowSummary = {
  workflowId: number;
  workflowName: string | null;
  ja: number;
  nein: number;
  unsicher: number;
  error: number;
  total: number;
};
export type AutomationCockpitSnapshot = {
  sentByKindWeekly: SentKindWeek[];
  pendingApproval: number;
  outboundBlocked: number;
  aiDecideByWorkflow30d: AiDecideWorkflowSummary[];
  /** null: Desktop (keine Nutzungsdaten) oder eingeschränkte Mail-Sicht. */
  aiCost30d: { costMicroUsd: number; events: number } | null;
};

const DAY_MS = 24 * 60 * 60_000;
const WEEK_MS = 7 * DAY_MS;

function mondayUtc(date: Date): number {
  const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  // getUTCDay: 0 = Sonntag … 6 = Samstag; Montag ist Wochenanfang.
  const offset = (date.getUTCDay() + 6) % 7;
  return day - offset * DAY_MS;
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function positiveCount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Montag 00:00 UTC der ältesten Woche des Fensters. */
export function automationWindowStart(now: Date, weeks = AUTOMATION_COCKPIT_WEEKS): Date {
  return new Date(mondayUtc(now) - (Math.max(1, weeks) - 1) * WEEK_MS);
}

export function emptySentKindWeek(weekStart: string): SentKindWeek {
  return { weekStart, human: 0, aiAuto: 0, aiApproved: 0, workflow: 0, relay: 0, unknown: 0 };
}

const KIND_FIELD: Record<string, keyof Omit<SentKindWeek, 'weekStart'>> = {
  human: 'human',
  ai_auto: 'aiAuto',
  ai_approved: 'aiApproved',
  workflow: 'workflow',
  relay: 'relay',
};

/** Genau `weeks` Einträge, alt → neu, mit Nullen; Zeilen außerhalb zählen nicht. */
export function bucketSentByKindWeekly(
  rows: readonly SentKindDayRow[],
  now: Date,
  weeks = AUTOMATION_COCKPIT_WEEKS,
): SentKindWeek[] {
  const size = Math.max(1, weeks);
  const start = automationWindowStart(now, size).getTime();
  const result = Array.from({ length: size }, (_, index) => emptySentKindWeek(isoDay(start + index * WEEK_MS)));
  for (const row of rows) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(row.day ?? ''));
    if (!match) continue;
    const day = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    const index = Math.floor((mondayUtc(day) - start) / WEEK_MS);
    if (index < 0 || index >= size) continue;
    const field = (row.kind !== null && KIND_FIELD[row.kind]) || 'unknown';
    result[index]![field] += positiveCount(row.count);
  }
  return result;
}

/**
 * Anteil automatisch versendeter Mails: (KI automatisch + KI freigegeben +
 * Automatik) / (dieselben + Mensch). Relay und unbekannte Herkunft zählen
 * nicht; null ohne zählbare Mail.
 */
export function automatedShare(week: SentKindWeek): number | null {
  const automated = week.aiAuto + week.aiApproved + week.workflow;
  const total = automated + week.human;
  return total > 0 ? automated / total : null;
}

const DECIDE_PORTS = ['ja', 'nein', 'unsicher', 'error'] as const;

/** Antworten je Workflow; unbekannte Ports zählen nicht; nach Summe absteigend. */
export function summarizeAiDecideAnswers(
  rows: readonly AiDecideAnswerRow[],
  limit = AUTOMATION_COCKPIT_MAX_WORKFLOWS,
): AiDecideWorkflowSummary[] {
  const byWorkflow = new Map<number, AiDecideWorkflowSummary>();
  for (const row of rows) {
    const port = row.port as typeof DECIDE_PORTS[number];
    if (!DECIDE_PORTS.includes(port)) continue;
    const count = positiveCount(row.count);
    if (count === 0) continue;
    const summary = byWorkflow.get(row.workflowId)
      ?? { workflowId: row.workflowId, workflowName: null, ja: 0, nein: 0, unsicher: 0, error: 0, total: 0 };
    if (summary.workflowName === null && row.workflowName) summary.workflowName = row.workflowName;
    summary[port] += count;
    summary.total += count;
    byWorkflow.set(row.workflowId, summary);
  }
  return [...byWorkflow.values()]
    .sort((a, b) => b.total - a.total || a.workflowId - b.workflowId)
    .slice(0, Math.max(0, limit));
}

export function emptyAutomationCockpitSnapshot(now: Date): AutomationCockpitSnapshot {
  return {
    sentByKindWeekly: bucketSentByKindWeekly([], now),
    pendingApproval: 0,
    outboundBlocked: 0,
    aiDecideByWorkflow30d: [],
    aiCost30d: null,
  };
}
