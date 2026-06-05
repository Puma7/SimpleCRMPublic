import { buildFeaturePreview, extractSpamFeatureKeys, normalizeSenderEmail } from '../../packages/core/src/email';

describe('core email spam feature extraction', () => {
  test('normalizes sender addresses and extracts auth/content features', () => {
    const features = extractSpamFeatureKeys({
      fromJson: JSON.stringify({ value: [{ address: 'Offer@Example.COM' }] }),
      authDmarc: 'fail',
      subject: 'Urgent bitcoin password',
      bodyText: 'Bitte sofort https://bad.example klicken',
    });

    expect(normalizeSenderEmail('Sender Name <UPPER@Example.COM>')).toBe('upper@example.com');
    expect(features).toEqual(expect.arrayContaining([
      'sender:email:offer@example.com',
      'sender:domain:example.com',
      'auth:dmarc:fail',
      'content:has_url',
      'content:suspicious_terms',
    ]));
  });

  test('extracts attachment features from imported attachment metadata shapes', () => {
    expect(buildFeaturePreview({
      fromJson: JSON.stringify({ value: [{ address: 'sender@example.com' }] }),
      attachmentsJson: JSON.stringify({
        stored: [{ name: 'invoice.exe', contentType: 'application/x-msdownload' }],
        omitted: [{ name: 'large.zip' }],
      }),
      hasAttachments: false,
    }).featureKeys).toEqual(expect.arrayContaining([
      'attachment:any',
      'attachment:ext:exe',
      'attachment:ext:zip',
      'attachment:mime:application_x-msdownload',
      'attachment:risky_type',
    ]));
  });
});
