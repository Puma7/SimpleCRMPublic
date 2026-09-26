import { validateCronMinuteField } from './cron-minute-validate';
import { validateWorkflowScheduleCron } from '../packages/core/src/workflow/cron-schedule';

/**
 * Desktop (node-cron): 5 oder 6 Felder, geprueft wird das Minutenfeld.
 * Returns null if cron is valid and respects minimum interval, else German error message.
 */
export function validateWorkflowCronExpr(expr: string): string | null {
  const trimmed = expr.trim();
  if (!trimmed) return 'Cron-Ausdruck ist leer';
  const parts = trimmed.split(/\s+/);
  if (parts.length < 5 || parts.length > 6) {
    return 'Cron muss 5 oder 6 Felder haben (z. B. */15 * * * *)';
  }
  /** 5 fields: minute first; 6 fields (with seconds): minute is index 1. */
  const minute = parts.length === 6 ? parts[1]! : parts[0]!;
  return validateCronMinuteField(minute);
}

/**
 * Server-Edition: dieselbe Pruefung, die der Server beim Speichern anwendet
 * (genau 5 Felder, vollstaendig geparst, Mindestabstand, mindestens ein
 * moeglicher Termin). Der Editor meldet damit im Server-Modus exakt das, was
 * sonst erst die Route mit 400 ablehnen wuerde.
 */
export function validateServerWorkflowCronExpr(expr: string): string | null {
  return validateWorkflowScheduleCron(expr);
}
