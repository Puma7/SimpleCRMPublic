/**
 * Plan 045: Zeitplan-Workflows der Desktop-Edition über die Zeitplan-Logik des
 * Servers (packages/core/src/workflow/cron-schedule.ts).
 * Gleiche Regeln in beiden Editionen: eine übersprungene Uhrzeit (Umstellung
 * auf Sommerzeit) fällt aus, eine doppelte (Winterzeit) zählt einmal.
 *
 * Wie bisher gibt es keine Nachholung: der Stand je Workflow liegt nur im
 * Speicher; nach dem Start oder Neuladen zählt die laufende Minute als erledigt.
 */
import {
  latestCronSlotAtOrBefore,
  parseCronExpression,
  type ParsedCronExpression,
} from '../../packages/core/src/workflow/cron-schedule';
import { normalizeDesktopWorkflowCronExpr } from '../../shared/cron-validate';

/** Toleranz für einen verspäteten Takt (Last, kurzer Schlaf) – keine Nachholung. */
export const DESKTOP_SCHEDULE_LOOKBACK_MINUTES = 2;

const TICK_MS = 60_000;
const TICK_OFFSET_MS = 1_000;

export type DesktopScheduleTickerDeps = {
  listWorkflows: () => ReadonlyArray<{ id: number; cron_expr: string | null }>;
  fire: (workflowId: number) => Promise<void>;
  now?: () => Date;
  /** Standard: Zeitzone des Rechners (wie bisher). */
  timeZone?: () => string;
  log: Pick<typeof console, 'warn' | 'debug'>;
};

export type DesktopScheduleTicker = {
  reload(): void;
  tick(): void;
  stop(): void;
  start(): void;
};

type ScheduleState = {
  expr: string;
  cron: ParsedCronExpression;
  lastSlotMs: number | null;
};

function machineTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function createDesktopScheduleTicker(deps: DesktopScheduleTickerDeps): DesktopScheduleTicker {
  const now = deps.now ?? (() => new Date());
  const timeZone = deps.timeZone ?? machineTimeZone;
  const states = new Map<number, ScheduleState>();
  const inFlight = new Set<number>();
  const warned = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  function reload(): void {
    const at = now();
    const zone = timeZone();
    const seen = new Set<number>();
    for (const workflow of deps.listWorkflows()) {
      const raw = (workflow.cron_expr ?? '').trim();
      if (!raw) continue;
      const normalized = normalizeDesktopWorkflowCronExpr(raw);
      if (!normalized.ok) {
        const key = `${workflow.id}:${raw}`;
        if (!warned.has(key)) {
          warned.add(key);
          deps.log.warn(`[email] Zeitplan von Workflow ${workflow.id} wird nicht ausgeführt („${raw}“): ${normalized.error}`);
        }
        continue;
      }
      seen.add(workflow.id);
      const existing = states.get(workflow.id);
      if (existing && existing.expr === normalized.expr) continue;
      const parsed = parseCronExpression(normalized.expr);
      if (!parsed.ok) continue;
      // Wie ein frisch angelegter Zeitplan: die laufende Minute zählt als erledigt.
      const armed = latestCronSlotAtOrBefore(parsed.cron, new Date(Math.floor(at.getTime() / TICK_MS) * TICK_MS), zone, 0);
      states.set(workflow.id, { expr: normalized.expr, cron: parsed.cron, lastSlotMs: armed ? armed.getTime() : null });
    }
    for (const id of [...states.keys()]) {
      if (!seen.has(id)) states.delete(id);
    }
  }

  function tick(): void {
    const at = now();
    const zone = timeZone();
    for (const [id, state] of states) {
      const slot = latestCronSlotAtOrBefore(state.cron, at, zone, DESKTOP_SCHEDULE_LOOKBACK_MINUTES);
      if (!slot) continue;
      const slotMs = slot.getTime();
      if (state.lastSlotMs !== null && slotMs <= state.lastSlotMs) continue;
      // Der Termin gilt als erledigt, auch wenn der Workflow noch läuft (wie bisher).
      state.lastSlotMs = slotMs;
      if (inFlight.has(id)) continue;
      inFlight.add(id);
      void deps.fire(id)
        .catch((error: unknown) => deps.log.warn(`[email] workflow cron ${id}`, error))
        .finally(() => {
          inFlight.delete(id);
        });
    }
  }

  function scheduleNext(): void {
    const at = now().getTime();
    const delay = TICK_MS - (at % TICK_MS) + TICK_OFFSET_MS;
    timer = setTimeout(() => {
      timer = null;
      try {
        tick();
      } finally {
        scheduleNext();
      }
    }, delay);
  }

  function start(): void {
    if (timer) return;
    scheduleNext();
  }

  function stop(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    states.clear();
    inFlight.clear();
  }

  return { reload, tick, stop, start };
}
