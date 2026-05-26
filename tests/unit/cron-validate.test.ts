import { validateWorkflowCronExpr } from '../../shared/cron-validate';

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
