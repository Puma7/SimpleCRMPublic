import {
  parseCronExpression,
  validateWorkflowScheduleCron,
} from '../packages/core/src/workflow/cron-schedule';

export type DesktopCronNormalizeResult = { ok: true; expr: string } | { ok: false; error: string };

/**
 * Plan 045: Die Desktop-Edition nutzt dieselbe Zeitplan-Logik wie der Server
 * (5 Felder). Früher gespeicherte Desktop-Ausdrücke bleiben gültig, soweit
 * sie sich verlustfrei übersetzen lassen: ein festes Sekundenfeld (0–59) fällt
 * weg, ein einzelnes „?“ im Tag oder Wochentag wird zu „*“ (wie bisher).
 * Alles andere (variable Sekunden, L, W, #) liefert eine deutsche Meldung.
 */
export function normalizeDesktopWorkflowCronExpr(expr: string): DesktopCronNormalizeResult {
  const trimmed = typeof expr === 'string' ? expr.trim() : '';
  let parts = trimmed ? trimmed.split(/\s+/) : [];
  if (parts.length === 6) {
    const seconds = parts[0]!;
    if (!/^\d{1,2}$/.test(seconds) || Number(seconds) > 59) {
      return { ok: false, error: 'Sekunden-Feld wird nur als feste Zahl unterstützt (z. B. 0 0 6 * * *)' };
    }
    parts = parts.slice(1);
  }
  if (parts.length === 5) {
    if (parts[2] === '?') parts[2] = '*';
    if (parts[4] === '?') parts[4] = '*';
  }
  const normalized = parts.join(' ');
  const parsed = parseCronExpression(normalized);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return { ok: true, expr: normalized };
}

/**
 * Desktop-Editor: übersetzen (siehe normalizeDesktopWorkflowCronExpr), dann
 * dieselbe Prüfung wie der Server (Mindestabstand, mindestens ein Termin).
 * Returns null if cron is valid, else German error message.
 */
export function validateWorkflowCronExpr(expr: string): string | null {
  const normalized = normalizeDesktopWorkflowCronExpr(expr);
  if (!normalized.ok) return normalized.error;
  return validateWorkflowScheduleCron(normalized.expr);
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
