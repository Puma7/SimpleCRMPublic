import { analyzeSenderTrust } from '../../shared/email-sender-trust';

describe('analyzeSenderTrust', () => {
  it('accepts matching name and address', () => {
    const r = analyzeSenderTrust(
      JSON.stringify({
        value: [{ name: 'Support', address: 'support@example.com' }],
      }),
    );
    expect(r.level).toBe('ok');
  });

  it('flags domain in display name that does not match From', () => {
    const r = analyzeSenderTrust(
      JSON.stringify({
        value: [{ name: 'Sparkasse Online sparkasse.de', address: 'scam@gmail.com' }],
      }),
    );
    expect(r.level).toBe('suspicious');
    expect(r.reason).toMatch(/sparkasse\.de/i);
  });

  it('flags email address embedded in display name', () => {
    const r = analyzeSenderTrust(
      JSON.stringify({
        value: [{ name: 'PayPal <paypal@secure.com>', address: 'evil@other.net' }],
      }),
    );
    expect(r.level).toBe('suspicious');
  });
});
