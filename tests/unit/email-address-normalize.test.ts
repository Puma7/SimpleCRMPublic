import {
  emailAddressForDelivery,
  normalizeEmailAddress,
} from '../../shared/email-address-normalize';

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

describe('emailAddressForDelivery', () => {
  test('preserves the local part and plus tag while normalizing the domain', () => {
    expect(emailAddressForDelivery(' User+Billing@Example.COM ')).toBe('User+Billing@example.com');
  });

  test('normalizes IDN domains without rewriting the delivery local part', () => {
    expect(emailAddressForDelivery('Case.Tag@müller.de')).toBe('Case.Tag@xn--mller-kva.de');
  });
});
