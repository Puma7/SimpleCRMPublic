import { validateServerWorkflowCronExpr, validateWorkflowCronExpr } from '../../shared/cron-validate';

describe('validateWorkflowCronExpr', () => {
  it('accepts */15 five-field cron', () => {
    expect(validateWorkflowCronExpr('*/15 * * * *')).toBeNull();
  });

  it('rejects comma minute lists that fire too often', () => {
    expect(validateWorkflowCronExpr('1,2,3,4,5,6,7,8,9,10 * * * *')).toMatch(/Zu viele/);
  });

  it('uses minute field index 1 for six-field cron', () => {
    expect(validateWorkflowCronExpr('0 */5 * * * *')).toMatch(/zu kurz/i);
    expect(validateWorkflowCronExpr('0 */15 * * * *')).toBeNull();
  });
});

// TA-P4: Im Server-Modus prueft der Editor mit derselben Funktion wie die
// Server-Route (packages/core/src/workflow/cron-schedule.ts).
describe('validateServerWorkflowCronExpr', () => {
  it('accepts five-field expressions with the minimum interval', () => {
    expect(validateServerWorkflowCronExpr('*/15 * * * *')).toBeNull();
    expect(validateServerWorkflowCronExpr('0 6 * * MON-FRI')).toBeNull();
  });

  it('rejects seconds, dense schedules and impossible dates like the server', () => {
    expect(validateServerWorkflowCronExpr('0 */15 * * * *')).toMatch(/Sekunden-Feld/);
    expect(validateServerWorkflowCronExpr('*/5 * * * *')).toMatch(/zu kurz/);
    expect(validateServerWorkflowCronExpr('0 6 31 2 *')).toMatch(/trifft nie zu/);
    expect(validateServerWorkflowCronExpr('0 25 * * *')).toMatch(/Feld Stunde/);
  });
});
