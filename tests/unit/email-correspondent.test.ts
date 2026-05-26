import {
  correspondentEmailForMessage,
  firstAddressFromJson,
} from '../../shared/email-correspondent';
import { normalizeEmailAddress } from '../../shared/email-address-normalize';

describe('correspondentEmailForMessage', () => {
  it('uses From for inbox', () => {
    expect(
      correspondentEmailForMessage({
        folder_kind: 'inbox',
        from_json: JSON.stringify({ value: [{ address: 'Alice@test.com' }] }),
        to_json: null,
      }),
    ).toBe(normalizeEmailAddress('Alice@test.com'));
  });

  it('normalizes IDN and plus-tags like customer linking', () => {
    const raw = 'test+tag@münchen.de';
    expect(
      correspondentEmailForMessage({
        folder_kind: 'inbox',
        from_json: JSON.stringify({ value: [{ address: raw }] }),
        to_json: null,
      }),
    ).toBe(normalizeEmailAddress(raw));
  });

  it('uses To for sent', () => {
    expect(
      correspondentEmailForMessage({
        folder_kind: 'sent',
        from_json: JSON.stringify({ value: [{ address: 'me@shop.com' }] }),
        to_json: JSON.stringify({ value: [{ address: 'Bob@test.com' }] }),
      }),
    ).toBe('bob@test.com');
  });
});

describe('firstAddressFromJson', () => {
  it('parses canonical json', () => {
    expect(
      firstAddressFromJson(JSON.stringify({ value: [{ address: 'x@y.z', name: 'X' }] })),
    ).toBe('x@y.z');
  });
});
