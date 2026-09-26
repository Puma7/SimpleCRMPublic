import cron from 'node-cron';

import { cronMatches, parseCronExpression, validateWorkflowScheduleCron } from '../../packages/core/src/workflow';

/**
 * TA-P4: Derselbe Ausdruck soll in beiden Editionen zu denselben Zeiten
 * laufen (Export/Import). Der Desktop plant mit node-cron, der Server mit
 * packages/core/src/workflow/cron-schedule.ts — dieser Test vergleicht beide
 * Matcher ueber ein Jahr (inklusive 29.02.2028). Ausgenommen sind nur die
 * beiden Umstelltage: dort zaehlt der Server doppelte Uhrzeiten bewusst nur
 * einmal.
 */
type NodeCronTask = {
  timeMatcher: { match(date: Date): boolean };
  destroy(): void;
};

const EXPRESSIONS = [
  '0 6 1 * 1',
  '0 12 */2 * 1',
  '15,45 */3 1-7 * SUN',
  '*/15 8-17 * * MON-FRI',
  '0 9 * JAN,JUL *',
  '0 6 * * 7',
  '0 0 29 2 *',
  '30 2 * * *',
  '0 23 31 * *',
];
const HOURS = [0, 2, 6, 9, 12, 17, 23];
const MINUTES = [0, 15, 30, 45];
// Umstelltage 2028 in Europe/Berlin (letzter Sonntag im Maerz und im Oktober).
const TRANSITION_DAYS = new Set(['2028-03-26', '2028-10-29']);

describe('cron parity with node-cron (desktop)', () => {
  for (const timeZone of ['Europe/Berlin', 'UTC']) {
    test(`same matches as node-cron in ${timeZone}`, () => {
      const mismatches: string[] = [];
      for (const expression of EXPRESSIONS) {
        expect(validateWorkflowScheduleCron(expression)).toBeNull();
        const parsed = parseCronExpression(expression);
        if (!parsed.ok) throw new Error(parsed.error);
        const task = (cron as unknown as {
          createTask(expression: string, fn: () => void, options: { timezone: string }): NodeCronTask;
        }).createTask(expression, () => undefined, { timezone: timeZone });
        try {
          for (let day = Date.UTC(2027, 11, 1); day < Date.UTC(2028, 11, 1); day += 24 * 60 * 60_000) {
            if (TRANSITION_DAYS.has(new Date(day).toISOString().slice(0, 10))) continue;
            for (const hour of HOURS) {
              for (const minute of MINUTES) {
                const instant = new Date(day + (hour * 60 + minute) * 60_000);
                const desktop = task.timeMatcher.match(instant);
                const server = cronMatches(parsed.cron, instant, timeZone);
                if (desktop !== server) {
                  mismatches.push(`${expression} @ ${instant.toISOString()}: desktop=${desktop} server=${server}`);
                }
              }
            }
          }
        } finally {
          task.destroy();
        }
      }
      expect(mismatches.slice(0, 10)).toEqual([]);
    });
  }
});
