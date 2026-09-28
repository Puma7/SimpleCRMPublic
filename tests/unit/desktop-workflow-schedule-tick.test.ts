import {
  createDesktopScheduleTicker,
  DESKTOP_SCHEDULE_LOOKBACK_MINUTES,
} from '../../electron/workflow/desktop-schedule-tick';
import { normalizeDesktopWorkflowCronExpr, validateWorkflowCronExpr } from '../../shared/cron-validate';

/**
 * Plan 045: Desktop-Zeitpläne laufen über die Zeitplan-Logik des Servers
 * (packages/core/src/workflow/cron-schedule.ts).
 */
describe('normalizeDesktopWorkflowCronExpr', () => {
  test('festes Sekundenfeld und „?“ werden übersetzt', () => {
    expect(normalizeDesktopWorkflowCronExpr('0 0 6 * * *')).toEqual({ ok: true, expr: '0 6 * * *' });
    expect(normalizeDesktopWorkflowCronExpr(' 15 0 6 * * 1 ')).toEqual({ ok: true, expr: '0 6 * * 1' });
    expect(normalizeDesktopWorkflowCronExpr('0 6 ? * MON')).toEqual({ ok: true, expr: '0 6 * * MON' });
    expect(normalizeDesktopWorkflowCronExpr('0 6 1 * ?')).toEqual({ ok: true, expr: '0 6 1 * *' });
    expect(normalizeDesktopWorkflowCronExpr('*/15 * * * *')).toEqual({ ok: true, expr: '*/15 * * * *' });
  });

  test('variable Sekunden, L, W und # werden abgelehnt', () => {
    expect(normalizeDesktopWorkflowCronExpr('*/10 0 6 * * *')).toEqual({
      ok: false,
      error: 'Sekunden-Feld wird nur als feste Zahl unterstützt (z. B. 0 0 6 * * *)',
    });
    expect(normalizeDesktopWorkflowCronExpr('60 0 6 * * *')).toMatchObject({ ok: false });
    for (const expr of ['0 6 L * *', '0 6 * * 1#2', '0 6 15W * *', '']) {
      expect(normalizeDesktopWorkflowCronExpr(expr)).toMatchObject({ ok: false });
    }
  });

  test('der Editor prüft wie der Server (Mindestabstand) nach der Übersetzung', () => {
    expect(validateWorkflowCronExpr('0 0 6 * * *')).toBeNull();
    expect(validateWorkflowCronExpr('0 6 ? * MON')).toBeNull();
    expect(validateWorkflowCronExpr('*/5 * * * *')).toMatch(/Intervall zu kurz/);
    expect(validateWorkflowCronExpr('0 6 L * *')).toEqual(expect.any(String));
  });
});

describe('createDesktopScheduleTicker', () => {
  const log = { warn: jest.fn(), debug: jest.fn() };
  let now: Date;
  let workflows: Array<{ id: number; cron_expr: string | null }>;
  let fired: Array<{ id: number; at: string }>;
  let inFlight: Set<number>;

  function ticker() {
    return createDesktopScheduleTicker({
      listWorkflows: () => workflows,
      fire: async (id) => {
        fired.push({ id, at: now.toISOString() });
        if (inFlight.has(id)) await new Promise<void>(() => undefined);
      },
      now: () => now,
      timeZone: () => 'Europe/Berlin',
      log,
    });
  }

  /** Minutenweise bis `until` ticken (wie der Takt einmal je Minute); dazwischen enden Läufe. */
  async function runUntil(t: ReturnType<typeof ticker>, until: string) {
    const end = new Date(until).getTime();
    while (now.getTime() < end) {
      now = new Date(now.getTime() + 60_000);
      t.tick();
      for (let hop = 0; hop < 10; hop += 1) await Promise.resolve();
    }
  }

  beforeEach(() => {
    log.warn.mockClear();
    workflows = [{ id: 1, cron_expr: '0 6 * * *' }];
    fired = [];
    inFlight = new Set();
  });

  test('06:00 einmal, 06:01 nicht erneut; Start um 06:00:20 feuert nicht nachträglich', async () => {
    now = new Date('2028-05-10T03:55:00Z'); // 05:55 Berlin
    const t = ticker();
    t.reload();
    await runUntil(t, '2028-05-10T04:02:00Z');
    expect(fired).toEqual([{ id: 1, at: '2028-05-10T04:00:00.000Z' }]);

    fired = [];
    now = new Date('2028-05-11T04:00:20Z');
    const late = ticker();
    late.reload();
    late.tick();
    await runUntil(late, '2028-05-11T04:05:00Z');
    expect(fired).toEqual([]);
  });

  test('Neuladen behält den Stand unveränderter Workflows und stellt geänderte neu', async () => {
    now = new Date('2028-05-10T03:59:00Z');
    const t = ticker();
    t.reload();
    now = new Date('2028-05-10T04:00:03Z'); // Speichern um 06:00:03, noch vor dem Takt
    t.reload();
    t.tick();
    expect(fired).toEqual([{ id: 1, at: '2028-05-10T04:00:03.000Z' }]);

    workflows = [{ id: 1, cron_expr: '30 6 * * *' }];
    now = new Date('2028-05-10T04:30:00Z');
    t.reload(); // 06:30 zählt beim Neustellen als erledigt
    t.tick();
    expect(fired).toHaveLength(1);
    await runUntil(t, '2028-05-11T04:31:00Z');
    expect(fired.map((f) => f.at)).toEqual(['2028-05-10T04:00:03.000Z', '2028-05-11T04:30:00.000Z']);
  });

  test('läuft der Workflow noch, wird der Termin übersprungen', async () => {
    workflows = [{ id: 1, cron_expr: '*/15 * * * *' }];
    inFlight.add(1);
    now = new Date('2028-05-10T03:59:00Z');
    const t = ticker();
    t.reload();
    await runUntil(t, '2028-05-10T04:31:00Z');
    expect(fired.map((f) => f.at)).toEqual(['2028-05-10T04:00:00.000Z']);
  });

  test('eine Pause von 30 Minuten wird nicht nachgeholt', () => {
    now = new Date('2028-05-10T03:40:00Z');
    const t = ticker();
    t.reload();
    now = new Date('2028-05-10T04:10:00Z');
    t.tick();
    expect(fired).toEqual([]);
    expect(DESKTOP_SCHEDULE_LOOKBACK_MINUTES).toBeLessThan(10);
  });

  test('Takt-Verzögerung innerhalb des Rückblicks feuert trotzdem', () => {
    now = new Date('2028-05-10T03:59:00Z');
    const t = ticker();
    t.reload();
    now = new Date('2028-05-10T04:01:30Z');
    t.tick();
    expect(fired).toEqual([{ id: 1, at: '2028-05-10T04:01:30.000Z' }]);
  });

  test('Sommerzeit: 02:30 fällt im März aus und läuft im Oktober genau einmal', async () => {
    workflows = [{ id: 1, cron_expr: '30 2 * * *' }, { id: 2, cron_expr: '0 6 * * *' }];
    now = new Date('2028-03-24T12:00:00Z');
    const t = ticker();
    t.reload();
    await runUntil(t, '2028-03-27T12:00:00Z');
    const march = fired;
    expect(march.filter((f) => f.id === 1).map((f) => f.at)).toEqual([
      '2028-03-25T01:30:00.000Z',
      '2028-03-27T00:30:00.000Z',
    ]);
    expect(march.filter((f) => f.id === 2)).toHaveLength(3);

    fired = [];
    now = new Date('2028-10-27T12:00:00Z');
    const autumn = ticker();
    autumn.reload();
    await runUntil(autumn, '2028-10-30T12:00:00Z');
    expect(fired.filter((f) => f.id === 1).map((f) => f.at)).toEqual([
      '2028-10-28T00:30:00.000Z',
      '2028-10-29T00:30:00.000Z',
      '2028-10-30T01:30:00.000Z',
    ]);
    expect(fired.filter((f) => f.id === 2)).toHaveLength(3);
  });

  test('Sekundenfeld und „?“ laufen zur übersetzten Zeit; Ungültiges wird einmal gemeldet', async () => {
    workflows = [
      { id: 1, cron_expr: '0 0 6 * * *' },
      { id: 2, cron_expr: '0 6 ? * *' },
      { id: 3, cron_expr: '0 6 L * *' },
      { id: 4, cron_expr: '' },
    ];
    now = new Date('2028-05-10T03:59:00Z');
    const t = ticker();
    t.reload();
    t.reload();
    await runUntil(t, '2028-05-10T04:01:00Z');
    expect(fired.map((f) => f.id)).toEqual([1, 2]);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(String(log.warn.mock.calls[0]![0])).toContain('Workflow 3');
  });

  test('start() taktet zur nächsten vollen Minute, stop() beendet alles', async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2028-05-10T03:59:30Z'));
      const fire = jest.fn(async () => undefined);
      const t = createDesktopScheduleTicker({
        listWorkflows: () => [{ id: 7, cron_expr: '0 6 * * *' }],
        fire,
        timeZone: () => 'Europe/Berlin',
        log,
      });
      t.reload();
      t.start();
      await jest.advanceTimersByTimeAsync(29_000);
      expect(fire).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(2_000); // 06:00:01
      expect(fire).toHaveBeenCalledWith(7);
      await jest.advanceTimersByTimeAsync(24 * 60 * 60_000);
      expect(fire).toHaveBeenCalledTimes(2);
      t.stop();
      await jest.advanceTimersByTimeAsync(24 * 60 * 60_000);
      expect(fire).toHaveBeenCalledTimes(2);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
