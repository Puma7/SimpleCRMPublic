import {
  extractEmailAddressesFromRecipientField,
  recipientFieldFromJson,
  recipientJsonFromField,
} from '../../shared/email-recipient-parse';
import {
  addressJson,
  addressesFromRecipientJson,
  normalizeAddressJson,
} from '../../packages/core/src/email';

describe('email recipient mapping', () => {
  it('recipientJsonFromField parses display names', () => {
    const json = recipientJsonFromField('Shop <shop@example.com>, b@example.com');
    expect(json).not.toBeNull();
    const parsed = JSON.parse(json!) as { value: { address: string }[] };
    expect(parsed.value.map((v) => v.address)).toEqual(['shop@example.com', 'b@example.com']);
  });

  it('addressJson normalizes mailparser-like objects', () => {
    const json = addressJson({
      value: [{ address: 'a@b.de', name: 'A' }],
    });
    expect(addressesFromRecipientJson(json)).toBe('a@b.de');
  });

  it('normalizeAddressJson returns null for empty input', () => {
    expect(normalizeAddressJson(null)).toBeNull();
  });

  it('extractEmailAddresses rejects invalid tokens', () => {
    expect(extractEmailAddressesFromRecipientField('not-an-email')).toEqual([]);
  });

  it('extractEmailAddresses can preserve plus-addressed delivery mailboxes', () => {
    expect(
      extractEmailAddressesFromRecipientField('Audit <audit+invoices@example.com>', {
        preservePlusAddressing: true,
      }),
    ).toEqual(['audit+invoices@example.com']);
  });

  it('recipientFieldFromJson round-trips compose fields', () => {
    const json = recipientJsonFromField('Shop <shop@example.com>, b@example.com');
    expect(recipientFieldFromJson(json)).toBe('shop@example.com, b@example.com');
  });
});
