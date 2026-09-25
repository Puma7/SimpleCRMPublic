import { localDateKey, localDateKeyInDays } from '../../electron/utils/local-date';

describe('local calendar date helper', () => {
  // F-A10-13: "heute" kam aus toISOString() (UTC) statt aus dem lokalen Kalenderdatum.
  test('uses the local calendar fields, not the UTC date', () => {
    const justAfterLocalMidnight = {
      getFullYear: () => 2026,
      getMonth: () => 6,
      getDate: () => 15,
      toISOString: () => '2026-07-14T22:30:00.000Z',
    } as unknown as Date;
    expect(localDateKey(justAfterLocalMidnight)).toBe('2026-07-15');
  });

  test('adds calendar days across month ends', () => {
    expect(localDateKeyInDays(7, new Date(2026, 9, 28, 12))).toBe('2026-11-04');
    expect(localDateKeyInDays(0, new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01');
  });
});
