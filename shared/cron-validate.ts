import { WORKFLOW_CRON_MIN_INTERVAL_MINUTES } from './workflow-types';

/** Returns null if cron is valid and respects minimum interval, else German error message. */
export function validateWorkflowCronExpr(expr: string): string | null {
  const trimmed = expr.trim();
  if (!trimmed) return 'Cron-Ausdruck ist leer';
  const parts = trimmed.split(/\s+/);
  if (parts.length < 5 || parts.length > 6) {
    return 'Cron muss 5 oder 6 Felder haben (z. B. */15 * * * *)';
  }
  const minute = parts[0]!;
  if (minute === '*') {
    return `Minütliche Ausführung ist nicht erlaubt (Minimum: ${WORKFLOW_CRON_MIN_INTERVAL_MINUTES} Minuten)`;
  }
  const starEvery = minute.match(/^\*\/(\d+)$/);
  if (starEvery) {
    const n = parseInt(starEvery[1]!, 10);
    if (n < WORKFLOW_CRON_MIN_INTERVAL_MINUTES) {
      return `Intervall zu kurz — mindestens alle ${WORKFLOW_CRON_MIN_INTERVAL_MINUTES} Minuten (z. B. */${WORKFLOW_CRON_MIN_INTERVAL_MINUTES} * * * *)`;
    }
  }
  return null;
}
