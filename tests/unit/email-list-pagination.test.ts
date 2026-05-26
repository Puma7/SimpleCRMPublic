import {
  clampEmailListLimit,
  EMAIL_LIST_DEFAULT_LIMIT,
  EMAIL_LIST_MAX_LIMIT,
} from '../../shared/email-list-pagination';

describe('email-list-pagination', () => {
  test('defaults and clamps', () => {
    expect(clampEmailListLimit(undefined)).toBe(EMAIL_LIST_DEFAULT_LIMIT);
    expect(clampEmailListLimit(10_000)).toBe(EMAIL_LIST_MAX_LIMIT);
    expect(clampEmailListLimit(50)).toBe(50);
    expect(clampEmailListLimit(0)).toBe(1);
  });
});
