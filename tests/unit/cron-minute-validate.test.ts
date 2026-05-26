import {
  minuteSpacingForToken,
  validateCronMinuteField,
} from '../../shared/cron-minute-validate';
import { validateWorkflowCronExpr } from '../../shared/cron-validate';

describe('validateCronMinuteField', () => {
  it('rejects */2 and 1-59/2', () => {
    expect(validateCronMinuteField('*/2')).toMatch(/zu kurz/i);
    expect(validateCronMinuteField('1-59/2')).toMatch(/zu kurz/i);
  });

  it('accepts */15 and ranges with step >= 15', () => {
    expect(validateCronMinuteField('*/15')).toBeNull();
    expect(validateCronMinuteField('0-59/15')).toBeNull();
  });

  it('rejects dense minute ranges without step', () => {
    expect(validateCronMinuteField('0-14')).toMatch(/zu dicht|zu kurz/i);
  });

  it('minuteSpacingForToken', () => {
    expect(minuteSpacingForToken('*/15')).toBe(15);
    expect(minuteSpacingForToken('1-59/2')).toBe(2);
    expect(minuteSpacingForToken('30')).toBe(60);
  });
});

describe('validateWorkflowCronExpr integration', () => {
  it('rejects six-field dense minute via index 1', () => {
    expect(validateWorkflowCronExpr('0 1-59/2 * * * *')).toMatch(/zu kurz/i);
  });
});
