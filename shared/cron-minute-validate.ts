import { WORKFLOW_CRON_MIN_INTERVAL_MINUTES } from './workflow-types';

/** Minimum spacing implied by a single minute-field token (1–60). */
export function minuteSpacingForToken(token: string): number {
  const t = token.trim();
  if (!t) return 1;
  const starEvery = t.match(/^\*\/(\d+)$/);
  if (starEvery) {
    const n = parseInt(starEvery[1]!, 10);
    return Number.isNaN(n) || n < 1 ? 1 : n;
  }
  const range = t.match(/^(\d+)-(\d+)(?:\/(\d+))?$/);
  if (range) {
    const step = range[3] ? parseInt(range[3], 10) : 1;
    return Number.isNaN(step) || step < 1 ? 1 : step;
  }
  if (/^\d+$/.test(t)) return 60;
  return 1;
}

/** All minute-of-hour values implied by one cron minute token (0–59). */
export function expandCronMinutesFromToken(token: string): number[] {
  const t = token.trim();
  const starEvery = t.match(/^\*\/(\d+)$/);
  if (starEvery) {
    const n = parseInt(starEvery[1]!, 10);
    if (Number.isNaN(n) || n < 1) return [];
    const out: number[] = [];
    for (let m = 0; m < 60; m += n) out.push(m);
    return out;
  }
  const range = t.match(/^(\d+)-(\d+)(?:\/(\d+))?$/);
  if (range) {
    const start = parseInt(range[1]!, 10);
    const end = parseInt(range[2]!, 10);
    const step = range[3] ? parseInt(range[3], 10) : 1;
    if (Number.isNaN(start) || Number.isNaN(end) || Number.isNaN(step) || step < 1) return [];
    const out: number[] = [];
    for (let m = start; m <= end; m += step) out.push(m);
    return out;
  }
  if (/^\d+$/.test(t)) {
    const m = parseInt(t, 10);
    return Number.isNaN(m) || m < 0 || m > 59 ? [] : [m];
  }
  return [];
}

function validateCombinedMinuteSpacing(minutes: number[], minInterval: number): string | null {
  const sorted = [...new Set(minutes)].sort((a, b) => a - b);
  if (sorted.length <= 1) return null;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]! - sorted[i - 1]! < minInterval) {
      return `Minuten-Kombination zu dicht — mindestens ${minInterval} Minuten Abstand`;
    }
  }
  const wrapGap = sorted[0]! + 60 - sorted[sorted.length - 1]!;
  if (wrapGap < minInterval) {
    return `Minuten-Kombination zu dicht — mindestens ${minInterval} Minuten Abstand`;
  }
  return null;
}

/** Validate the minute field of a cron expression (5- or 6-field). */
export function validateCronMinuteField(minute: string): string | null {
  const minInterval = WORKFLOW_CRON_MIN_INTERVAL_MINUTES;
  if (minute === '*') {
    return `Minütliche Ausführung ist nicht erlaubt (Minimum: ${minInterval} Minuten)`;
  }

  const tokens = minute.split(',').map((p) => p.trim()).filter(Boolean);
  if (tokens.length === 0) {
    return 'Minutenfeld ist leer';
  }

  if (tokens.length > 4) {
    return `Zu viele Minuten-Trigger (max. 4 pro Stunde, Minimum ${minInterval} Min Abstand)`;
  }

  for (const token of tokens) {
    const spacing = minuteSpacingForToken(token);
    if (spacing < minInterval) {
      return `Intervall zu kurz („${token}“) — mindestens alle ${minInterval} Minuten`;
    }
    const rangeOnly = token.match(/^(\d+)-(\d+)$/);
    if (rangeOnly) {
      const start = parseInt(rangeOnly[1]!, 10);
      const end = parseInt(rangeOnly[2]!, 10);
      if (!Number.isNaN(start) && !Number.isNaN(end) && end > start) {
        const span = end - start + 1;
        if (span > 1 && span < minInterval) {
          return `Minuten-Bereich „${token}“ zu dicht — mindestens ${minInterval} Minuten Abstand`;
        }
      }
    }
  }

  const explicitMinutes: number[] = [];
  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      explicitMinutes.push(parseInt(token, 10));
    }
  }
  if (explicitMinutes.length > 1) {
    explicitMinutes.sort((a, b) => a - b);
    for (let i = 1; i < explicitMinutes.length; i++) {
      if (explicitMinutes[i]! - explicitMinutes[i - 1]! < minInterval) {
        return `Minuten-Liste zu dicht — mindestens ${minInterval} Minuten Abstand`;
      }
    }
    const wrapGap = explicitMinutes[0]! + 60 - explicitMinutes[explicitMinutes.length - 1]!;
    if (wrapGap < minInterval) {
      return `Minuten-Liste zu dicht — mindestens ${minInterval} Minuten Abstand`;
    }
  }

  const combinedMinutes: number[] = [];
  for (const token of tokens) {
    combinedMinutes.push(...expandCronMinutesFromToken(token));
  }
  const combinedErr = validateCombinedMinuteSpacing(combinedMinutes, minInterval);
  if (combinedErr) return combinedErr;

  return null;
}
