import { WORKFLOW_CRON_MIN_INTERVAL_MINUTES } from './workflow-types';

/** Returns null if cron is valid and respects minimum interval, else German error message. */
export function validateWorkflowCronExpr(expr: string): string | null {
  const trimmed = expr.trim();
  if (!trimmed) return 'Cron-Ausdruck ist leer';
  const parts = trimmed.split(/\s+/);
  if (parts.length < 5 || parts.length > 6) {
    return 'Cron muss 5 oder 6 Felder haben (z. B. */15 * * * *)';
  }
  /** 5 fields: minute first; 6 fields (with seconds): minute is index 1. */
  const minute = parts.length === 6 ? parts[1]! : parts[0]!;
  if (minute === '*') {
    return `Minütliche Ausführung ist nicht erlaubt (Minimum: ${WORKFLOW_CRON_MIN_INTERVAL_MINUTES} Minuten)`;
  }
  if (minute.includes(',')) {
    const values = minute.split(',').map((v) => v.trim());
    if (values.length > 4) {
      return `Zu viele Minuten-Trigger (max. 4 pro Stunde, Minimum ${WORKFLOW_CRON_MIN_INTERVAL_MINUTES} Min Abstand)`;
    }
    const nums = values.map((v) => parseInt(v, 10)).filter((n) => !Number.isNaN(n));
    nums.sort((a, b) => a - b);
    for (let i = 1; i < nums.length; i++) {
      if (nums[i]! - nums[i - 1]! < WORKFLOW_CRON_MIN_INTERVAL_MINUTES) {
        return `Minuten-Liste zu dicht — mindestens ${WORKFLOW_CRON_MIN_INTERVAL_MINUTES} Minuten Abstand`;
      }
    }
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
