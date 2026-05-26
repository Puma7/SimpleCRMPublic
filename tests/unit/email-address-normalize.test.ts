import { normalizeEmailAddress } from '../../shared/email-address-normalize';

describe('normalizeEmailAddress', () => {
  test('strips plus tags', () => {
    expect(normalizeEmailAddress('User+tag@Example.COM')).toBe('user@example.com');
  });

  test('normalizes IDN domain to punycode', () => {
    const norm = normalizeEmailAddress('a@müller.de');
    expect(norm).toBe('a@xn--mller-kva.de');
    expect(normalizeEmailAddress('a@xn--mller-kva.de')).toBe('a@xn--mller-kva.de');
  });
});
