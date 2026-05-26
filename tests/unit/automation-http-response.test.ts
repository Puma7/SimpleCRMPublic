import {
  coercePositiveInt,
  parseQueryPositiveInt,
  parsePositiveInt,
} from '../../electron/automation/http-response';

describe('automation http-response helpers', () => {
  test('coercePositiveInt accepts number and numeric string', () => {
    expect(coercePositiveInt(5)).toBe(5);
    expect(coercePositiveInt('12')).toBe(12);
    expect(coercePositiveInt(0)).toBeNull();
    expect(coercePositiveInt('abc')).toBeNull();
    expect(coercePositiveInt(null)).toBeNull();
  });

  test('parseQueryPositiveInt distinguishes missing vs invalid', () => {
    const q = new URLSearchParams('customerId=3');
    expect(parseQueryPositiveInt(q, 'customerId')).toEqual({ value: 3, invalid: false });
    expect(parseQueryPositiveInt(new URLSearchParams(), 'customerId')).toEqual({ invalid: false });
    expect(parseQueryPositiveInt(new URLSearchParams('customerId=x'), 'customerId')).toEqual({
      invalid: true,
    });
  });

  test('parsePositiveInt rejects non-positive', () => {
    expect(parsePositiveInt('0')).toBeNull();
    expect(parsePositiveInt('-1')).toBeNull();
  });
});
