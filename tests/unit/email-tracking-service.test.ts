import {
  buildDerivedTrackingMetadata,
  buildStoredTrackingMetadata,
  createEmailTrackingCrypto,
  createPostgresEmailTrackingService,
  effectiveRetryTrackingFlags,
  effectiveTrackingTokenExpiry,
  retryLinkCountMismatch,
  clampInboundEvidenceAfterSmtpAccepted,
  normalizeEmailTrackingPolicy,
  normalizeInboundEvidenceOccurredAt,
} from '../../packages/server/src/email-tracking';

describe('email tracking service security helpers', () => {
  const key = Buffer.alloc(32, 7);

  test('derives stable purpose-bound opaque tokens and one-way lookup hashes', () => {
    const crypto = createEmailTrackingCrypto(key);
    const first = crypto.token('open', '11111111-1111-4111-8111-111111111111');

    expect(first).toHaveLength(43);
    expect(first).toBe(crypto.token('open', '11111111-1111-4111-8111-111111111111'));
    expect(first).not.toBe(crypto.token('click', '11111111-1111-4111-8111-111111111111'));
    expect(crypto.tokenHash(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(crypto.tokenHash(first)).not.toContain(first);
  });

  test('binds stored link target hashes to the configured tracking key', () => {
    const first = createEmailTrackingCrypto(key);
    const second = createEmailTrackingCrypto(Buffer.alloc(32, 8));
    const target = 'https://customer.example/invoice/17';

    expect(first.targetHash(target)).toMatch(/^[a-f0-9]{64}$/);
    expect(first.targetHash(target)).toBe(first.targetHash(target));
    expect(first.targetHash(target)).not.toBe(second.targetHash(target));
  });

  test('encrypts target/raw metadata with authenticated context and rejects tampering', () => {
    const crypto = createEmailTrackingCrypto(key);
    const sealed = crypto.sealJson(
      { ip: '203.0.113.9', userAgent: 'MailClient/1.0' },
      'workspace-1:tracking-1:event-1',
    );

    expect(sealed.ciphertext.toString('utf8')).not.toContain('203.0.113.9');
    expect(crypto.openJson(sealed, 'workspace-1:tracking-1:event-1')).toEqual({
      ip: '203.0.113.9',
      userAgent: 'MailClient/1.0',
    });
    const tampered = { ...sealed, ciphertext: Buffer.from(sealed.ciphertext) };
    tampered.ciphertext[0] ^= 1;
    expect(() => crypto.openJson(tampered, 'workspace-1:tracking-1:event-1')).toThrow();
    expect(() => crypto.openJson(sealed, 'workspace-1:other:event-1')).toThrow();
  });

  test('fails closed when enabling without compliance evidence or encryption key', () => {
    expect(() => normalizeEmailTrackingPolicy({
      current: null,
      values: { enabled: true, trackOpens: true },
      now: new Date('2026-07-13T10:00:00.000Z'),
      encryptionAvailable: false,
    })).toThrow('Verschluesselung');

    expect(() => normalizeEmailTrackingPolicy({
      current: null,
      values: { enabled: true, trackOpens: true },
      now: new Date('2026-07-13T10:00:00.000Z'),
      encryptionAvailable: true,
    })).toThrow('Rechtsgrundlage');
  });

  test('requires HTTPS privacy notice and derived metadata before raw collection', () => {
    expect(() => normalizeEmailTrackingPolicy({
      current: null,
      values: {
        enabled: true,
        trackOpens: true,
        legalBasis: 'legitimate_interest',
        privacyNoticeUrl: 'http://crm.example/privacy',
        complianceAcknowledged: true,
      },
      now: new Date('2026-07-13T10:00:00.000Z'),
      encryptionAvailable: true,
    })).toThrow('HTTPS');

    expect(() => normalizeEmailTrackingPolicy({
      current: null,
      values: { collectRawMetadata: true, collectDerivedMetadata: false },
      now: new Date('2026-07-13T10:00:00.000Z'),
      encryptionAvailable: true,
    })).toThrow('abgeleitete Metadaten');

    expect(() => normalizeEmailTrackingPolicy({
      current: null,
      values: { privacyNoticeUrl: `https://crm.example/${'x'.repeat(2_100)}` },
      now: new Date('2026-07-13T10:00:00.000Z'),
      encryptionAvailable: true,
    })).toThrow('zu lang');
  });

  test('requires a fresh compliance acknowledgement after material policy changes', () => {
    const current = normalizeEmailTrackingPolicy({
      current: null,
      values: {
        enabled: true,
        trackOpens: true,
        legalBasis: 'legitimate_interest',
        privacyNoticeUrl: 'https://crm.example/privacy',
        complianceAcknowledged: true,
      },
      now: new Date('2026-07-13T10:00:00.000Z'),
      encryptionAvailable: true,
    });

    expect(() => normalizeEmailTrackingPolicy({
      current,
      values: { collectDerivedMetadata: true, collectRawMetadata: true },
      now: new Date('2026-07-14T10:00:00.000Z'),
      encryptionAvailable: true,
    })).toThrow('Datenschutz-Bestaetigung');

    expect(normalizeEmailTrackingPolicy({
      current,
      values: {
        collectDerivedMetadata: true,
        collectRawMetadata: true,
        complianceAcknowledged: true,
      },
      now: new Date('2026-07-14T10:00:00.000Z'),
      encryptionAvailable: true,
    }).complianceAcknowledgedAt).toBe('2026-07-14T10:00:00.000Z');
  });

  test('never resurrects tracking signals that were removed from a prepared retry', () => {
    expect(effectiveRetryTrackingFlags({
      trackOpens: true,
      trackLinks: false,
      collectDerivedMetadata: true,
      collectRawMetadata: false,
    }, {
      trackOpens: true,
      trackLinks: true,
      collectDerivedMetadata: true,
      collectRawMetadata: true,
    })).toEqual({
      trackOpens: true,
      trackLinks: false,
      collectDerivedMetadata: true,
      collectRawMetadata: false,
    });
  });

  test('ignores stored click links when click tracking was intentionally disabled', () => {
    expect(retryLinkCountMismatch({
      created: false,
      trackLinks: false,
      trackedLinkCount: 0,
      existingLinkCount: 2,
    })).toBe(false);
    expect(retryLinkCountMismatch({
      created: false,
      trackLinks: true,
      trackedLinkCount: 1,
      existingLinkCount: 2,
    })).toBe(true);
  });

  test('derives bounded non-identifying client metadata without copying raw IP or UA', () => {
    const metadata = buildDerivedTrackingMetadata({
      ip: '2001:db8::1',
      userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140 ${'x'.repeat(2_000)}`,
      classificationReasons: ['prefetch_header'],
    });

    expect(metadata).toMatchObject({
      ipFamily: 'ipv6',
      operatingSystem: 'Windows',
      client: 'Chrome',
      device: 'desktop',
      classificationReasons: ['prefetch_header'],
    });
    expect(JSON.stringify(metadata)).not.toContain('2001:db8::1');
    expect(JSON.stringify(metadata)).not.toContain('Mozilla/5.0');
  });

  test('stores no derived request metadata after the workspace opted out', () => {
    expect(buildStoredTrackingMetadata({
      collectDerivedMetadata: false,
      ip: '203.0.113.9',
      userAgent: 'Proofpoint URL Defense Scanner',
      classificationReasons: ['known_security_or_mail_proxy'],
    })).toEqual({});
  });

  test('refreshes token lifetime only for a retry that has not reached SMTP commit', () => {
    const previousExpiry = new Date('2026-07-14T12:00:00.000Z');
    const retriedAt = new Date('2026-07-20T12:00:00.000Z');

    expect(effectiveTrackingTokenExpiry({
      existingExpiry: previousExpiry,
      now: retriedAt,
      tokenTtlDays: 30,
      recovery: false,
    })).toEqual(new Date('2026-08-19T12:00:00.000Z'));
    expect(effectiveTrackingTokenExpiry({
      existingExpiry: previousExpiry,
      now: retriedAt,
      tokenTtlDays: 30,
      recovery: true,
    })).toBe(previousExpiry);
  });

  test('clamps forged future evidence dates to the server observation time', () => {
    const observedAt = new Date('2026-07-13T10:00:00.000Z');
    const plausible = new Date('2026-07-13T10:04:59.000Z');

    expect(normalizeInboundEvidenceOccurredAt(plausible, observedAt)).toBe(plausible);
    expect(normalizeInboundEvidenceOccurredAt(
      new Date('2099-01-01T00:00:00.000Z'),
      observedAt,
    )).toBe(observedAt);
    expect(normalizeInboundEvidenceOccurredAt(new Date('invalid'), observedAt)).toBe(observedAt);
  });

  test('does not let inbound evidence predate SMTP acceptance', () => {
    const observedAt = new Date('2026-07-13T10:05:00.000Z');
    const acceptedAt = new Date('2026-07-13T10:00:00.000Z');
    const plausible = new Date('2026-07-13T10:01:00.000Z');

    expect(clampInboundEvidenceAfterSmtpAccepted(plausible, acceptedAt, observedAt)).toBe(plausible);
    expect(clampInboundEvidenceAfterSmtpAccepted(
      new Date('2001-01-01T00:00:00.000Z'),
      acceptedAt,
      observedAt,
    )).toBe(observedAt);
  });

  test('skips oversized HTML before database work and rejects credentials in the public URL', async () => {
    expect(() => createPostgresEmailTrackingService({
      db: {} as never,
      publicBaseUrl: 'https://user:secret@crm.example',
      masterKey: key,
    })).toThrow('Zugangsdaten');

    const service = createPostgresEmailTrackingService({
      db: {} as never,
      publicBaseUrl: 'https://crm.example',
      masterKey: key,
    });
    await expect(service.prepareOutbound({
      workspaceId: 'workspace-1',
      messageId: 1,
      accountId: 1,
      messageIdHeader: '<mail-1@crm.example>',
      recipientCount: 1,
      html: 'x'.repeat(5 * 1024 * 1024 + 1),
      pgpProtected: false,
    })).resolves.toMatchObject({
      trackingMessageId: null,
      warning: expect.stringContaining('Groesse'),
    });
  });
});
