import {
  buildDerivedTrackingMetadata,
  buildStoredTrackingMetadata,
  createEmailTrackingCrypto,
  createPostgresEmailTrackingService,
  emailTrackingEventAssociatedData,
  effectiveRetryTrackingFlags,
  effectiveTrackingTokenExpiry,
  retryLinkCountMismatch,
  clampInboundEvidenceAfterSmtpAccepted,
  normalizeEmailTrackingPolicy,
  normalizeInboundEvidenceOccurredAt,
} from '../../packages/server/src/email-tracking';
import type { Kysely } from 'kysely';
import type { ServerDatabase } from '../../packages/server/src/db';
import { emailTrackingNetworkContext } from '../../packages/server/src/email-tracking-network-rules';
import type {
  EmailTrackingIpInsight,
  EmailTrackingIpIntelligencePort,
} from '../../packages/server/src/email-tracking-ip-intelligence';

function ipInsight(overrides: Partial<EmailTrackingIpInsight>): EmailTrackingIpInsight {
  return {
    ipAddress: '74.125.216.133',
    ipFamily: 'ipv4',
    scope: 'public',
    countryCode: 'US',
    continentCode: 'NA',
    asn: null,
    networkName: null,
    networkCidr: null,
    databaseBuildAt: '2026-07-15T00:00:00.000Z',
    ...overrides,
  };
}

describe('email tracking service security helpers', () => {
  const key = Buffer.alloc(32, 7);

  test('maps local provider intelligence narrowly without persisting detailed insight', () => {
    expect(emailTrackingNetworkContext(ipInsight({
      asn: 15169,
      networkName: 'GOOGLE',
    }))).toEqual({
      asn: 15169,
      networkName: 'GOOGLE',
      providerClass: 'hosting_or_cloud',
    });
    expect(emailTrackingNetworkContext(ipInsight({
      asn: 15169,
      networkName: 'Google Mail Image Proxy',
    })).providerClass).toBe('google_fetcher');
    expect(emailTrackingNetworkContext(ipInsight({
      asn: 209242,
      networkName: 'Proton AG Mail Proxy',
    })).providerClass).toBe('proton_proxy');
    expect(emailTrackingNetworkContext(ipInsight({
      asn: 26211,
      networkName: 'PROOFPOINT-ASN-US-EAST',
    })).providerClass).toBe('security_vendor');
  });

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

  test('the real tracking service never instruments PGP-protected outbound HTML', async () => {
    const service = createPostgresEmailTrackingService({
      db: {} as never,
      publicBaseUrl: 'https://crm.example',
      masterKey: key,
    });
    const html = '<p>Vertraulich</p>';

    await expect(service.prepareOutbound({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      messageId: 17,
      accountId: 3,
      messageIdHeader: '<pgp-17@crm.example>',
      recipientCount: 1,
      html,
      pgpProtected: true,
    })).resolves.toEqual({
      html,
      trackingMessageId: null,
      warning: 'PGP-geschuetzte Nachrichten werden nicht nachverfolgt.',
    });
  });

  test('the real revoke and public-open chain cannot reactivate revoked tracking', async () => {
    const token = 'A'.repeat(43);
    const tokenHash = createEmailTrackingCrypto(key).tokenHash(token);
    const { db, state } = trackingLifecycleDatabase(tokenHash);
    const service = createPostgresEmailTrackingService({
      db,
      publicBaseUrl: 'https://crm.example',
      masterKey: key,
      now: () => new Date('2026-07-14T12:00:00.000Z'),
    });

    await expect(service.revokeMessage({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      actorUserId: '33333333-3333-4333-8333-333333333333',
      messageId: 17,
    })).resolves.toBe(true);
    expect(state.messageRevokedAt).toEqual(new Date('2026-07-14T12:00:00.000Z'));
    expect(state.resolverRevokedAt).toEqual(new Date('2026-07-14T12:00:00.000Z'));

    await service.recordPublicOpen({
      token,
      ip: '203.0.113.9',
      userAgent: 'MailClient/1.0',
      headers: {},
    });

    expect(state.eventTypes).toEqual(['revoked']);
    await db.destroy();
  });

  test('retires stale tracking evidence when an unsent retry changes link targets', async () => {
    const crypto = createEmailTrackingCrypto(key);
    const { db, state } = trackingRetryMismatchDatabase(crypto.targetHash('https://example.test/old'));
    const service = createPostgresEmailTrackingService({
      db,
      publicBaseUrl: 'https://crm.example',
      masterKey: key,
      now: () => new Date('2026-07-14T12:00:00.000Z'),
    });

    await expect(service.prepareOutbound({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      messageId: 17,
      accountId: 3,
      messageIdHeader: '<retry-17@crm.example>',
      recipientCount: 1,
      html: '<a href="https://example.test/new">Neu</a>',
      pgpProtected: false,
    })).resolves.toMatchObject({
      trackingMessageId: null,
      warning: expect.stringContaining('Linkziele'),
    });
    expect(state.trackingMessageDeleted).toBe(true);
  });

  test('preserves committed tracking evidence when recovery HTML changes link targets', async () => {
    const crypto = createEmailTrackingCrypto(key);
    const { db, state } = trackingRetryMismatchDatabase(crypto.targetHash('https://example.test/old'));
    const service = createPostgresEmailTrackingService({
      db,
      publicBaseUrl: 'https://crm.example',
      masterKey: key,
      now: () => new Date('2026-07-14T12:00:00.000Z'),
    });

    await expect(service.prepareOutbound({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      messageId: 17,
      accountId: 3,
      messageIdHeader: '<retry-17@crm.example>',
      recipientCount: 1,
      html: '<a href="https://example.test/new">Neu</a>',
      pgpProtected: false,
      recovery: true,
    })).resolves.toMatchObject({
      trackingMessageId: null,
      warning: expect.stringContaining('Linkziele'),
    });
    expect(state.trackingMessageDeleted).toBe(false);
  });

  test('recreates a pruned click resolver when an unsent retry reuses the same link', async () => {
    const crypto = createEmailTrackingCrypto(key);
    const targetUrl = 'https://example.test/unchanged';
    const { db, state } = trackingRetryMismatchDatabase(crypto.targetHash(targetUrl));
    const service = createPostgresEmailTrackingService({
      db,
      publicBaseUrl: 'https://crm.example',
      masterKey: key,
      now: () => new Date('2026-07-14T12:00:00.000Z'),
    });

    await expect(service.prepareOutbound({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      messageId: 17,
      accountId: 3,
      messageIdHeader: '<retry-17@crm.example>',
      recipientCount: 1,
      html: `<a href="${targetUrl}">Unveraendert</a>`,
      pgpProtected: false,
    })).resolves.toMatchObject({
      trackingMessageId: '55555555-5555-4555-8555-555555555555',
      warning: null,
    });
    expect(state.resolverRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        token_kind: 'click',
        link_id: '77777777-7777-4777-8777-777777777777',
      }),
    ]));
  });

  test('looks up provider context outside transactions and persists only the V2 projection', async () => {
    const token = 'B'.repeat(43);
    const tokenHash = createEmailTrackingCrypto(key).tokenHash(token);
    const { db, state } = publicInteractionDatabase(tokenHash);
    const lookup = jest.fn(async () => {
      expect(state.transactionDepth).toBe(0);
      state.operations.push('lookup');
      return ipInsight({ asn: 15169, networkName: 'GOOGLE' });
    });
    const intelligence = readyIpIntelligence(lookup);
    const service = createPostgresEmailTrackingService({
      db,
      publicBaseUrl: 'https://crm.example',
      masterKey: key,
      emailTrackingIpIntelligence: intelligence,
      now: () => new Date('2026-07-15T12:00:03.000Z'),
    });

    await service.recordPublicOpen({
      token,
      ip: '74.125.216.133',
      userAgent: 'Mozilla/5.0 AppleWebKit/537.36',
      headers: {},
    });

    expect(lookup).toHaveBeenCalledWith('74.125.216.133');
    expect(state.policyReads).toBe(2);
    expect(state.eventRows).toEqual([
      expect.objectContaining({ event_type: 'open_automated', automated: true }),
    ]);
    expect(state.classificationRows).toEqual([{
      event_id: '41',
      classification_version: 2,
      actor_class: 'automated_unknown',
      confidence: 'low',
      reasons_json: ['immediate_infrastructure_fetch'],
      classified_at: new Date('2026-07-15T12:00:03.000Z'),
    }]);
    expect(state.operations).toEqual([
      'policy_read_initial',
      'capacity_precheck',
      'lookup',
      'policy_lock',
      'message_lock',
      'policy_read_final',
      'accepted_read',
      'capacity_authoritative',
      'dedupe_read',
      'event_insert',
      'classification_insert',
    ]);
    expect(state.eventInsertHeldPolicyLock).toBe(true);
    expect(JSON.stringify([state.eventRows, state.classificationRows])).not.toMatch(/GOOGLE|15169|countryCode|networkCidr/);
  });

  test('deduplicates same-IP fetches for less than ten seconds across bucket boundaries', async () => {
    const token = 'F'.repeat(43);
    const tokenHash = createEmailTrackingCrypto(key).tokenHash(token);
    const { db, state } = publicInteractionDatabase(tokenHash);
    let current = new Date('2026-07-15T12:00:09.000Z');
    const service = createPostgresEmailTrackingService({
      db,
      publicBaseUrl: 'https://crm.example',
      masterKey: key,
      now: () => current,
    });
    const request = {
      token,
      ip: '8.8.8.8',
      userAgent: 'Mozilla/5.0 AppleWebKit/537.36',
      headers: {},
    };

    await service.recordPublicOpen(request);
    current = new Date('2026-07-15T12:00:18.000Z');
    await service.recordPublicOpen(request);
    expect(state.eventRows).toHaveLength(1);

    current = new Date('2026-07-15T12:00:19.000Z');
    await service.recordPublicOpen(request);
    expect(state.eventRows).toHaveLength(2);
    expect(state.classificationRows).toHaveLength(2);
  });

  test('policy-gates lookup and discards context when the write-time policy opted out', async () => {
    const token = 'C'.repeat(43);
    const tokenHash = createEmailTrackingCrypto(key).tokenHash(token);
    const disabled = publicInteractionDatabase(tokenHash, { initialPolicyEnabled: false });
    const disabledLookup = jest.fn(async () => ipInsight({ asn: 15169, networkName: 'GOOGLE' }));
    const disabledService = createPostgresEmailTrackingService({
      db: disabled.db,
      publicBaseUrl: 'https://crm.example',
      masterKey: key,
      emailTrackingIpIntelligence: readyIpIntelligence(disabledLookup),
      now: () => new Date('2026-07-15T12:00:03.000Z'),
    });

    await disabledService.recordPublicOpen({
      token,
      ip: '74.125.216.133',
      userAgent: 'Mozilla/5.0 AppleWebKit/537.36',
      headers: {},
    });
    expect(disabledLookup).not.toHaveBeenCalled();

    const snapshotDisabled = publicInteractionDatabase(tokenHash, {
      trackedCollectDerivedMetadata: false,
    });
    const snapshotLookup = jest.fn(async () => ipInsight({ asn: 15169, networkName: 'GOOGLE' }));
    const snapshotService = createPostgresEmailTrackingService({
      db: snapshotDisabled.db,
      publicBaseUrl: 'https://crm.example',
      masterKey: key,
      emailTrackingIpIntelligence: readyIpIntelligence(snapshotLookup),
      now: () => new Date('2026-07-15T12:00:03.000Z'),
    });
    await snapshotService.recordPublicOpen({
      token,
      ip: '74.125.216.133',
      userAgent: 'Mozilla/5.0 AppleWebKit/537.36',
      headers: {},
    });
    expect(snapshotLookup).not.toHaveBeenCalled();

    const changed = publicInteractionDatabase(tokenHash, { recheckPolicyEnabled: false });
    const changedLookup = jest.fn(async () => ipInsight({ asn: 15169, networkName: 'GOOGLE' }));
    const changedService = createPostgresEmailTrackingService({
      db: changed.db,
      publicBaseUrl: 'https://crm.example',
      masterKey: key,
      emailTrackingIpIntelligence: readyIpIntelligence(changedLookup),
      now: () => new Date('2026-07-15T12:00:03.000Z'),
    });

    await changedService.recordPublicOpen({
      token,
      ip: '74.125.216.133',
      userAgent: 'Mozilla/5.0 AppleWebKit/537.36',
      headers: {},
    });
    expect(changedLookup).toHaveBeenCalledTimes(1);
    expect(changed.state.classificationRows).toEqual([
      expect.objectContaining({
        actor_class: 'unknown',
        reasons_json: ['immediate_unattributed_fetch'],
      }),
    ]);
  });

  test('keeps public tracking fail-open on lookup failure and projects only newly inserted events', async () => {
    const token = 'D'.repeat(43);
    const tokenHash = createEmailTrackingCrypto(key).tokenHash(token);
    const failed = publicInteractionDatabase(tokenHash);
    const failedService = createPostgresEmailTrackingService({
      db: failed.db,
      publicBaseUrl: 'https://crm.example',
      masterKey: key,
      emailTrackingIpIntelligence: readyIpIntelligence(jest.fn(async () => {
        throw new Error('MMDB unavailable');
      })),
      now: () => new Date('2026-07-15T12:00:03.000Z'),
    });

    await expect(failedService.recordPublicOpen({
      token,
      ip: '74.125.216.133',
      userAgent: 'Mozilla/5.0 AppleWebKit/537.36',
      headers: {},
    })).resolves.toBeUndefined();
    expect(failed.state.eventRows).toHaveLength(1);
    expect(failed.state.classificationRows).toEqual([
      expect.objectContaining({ actor_class: 'unknown' }),
    ]);

    const duplicate = publicInteractionDatabase(tokenHash, { duplicateEvent: true });
    const duplicateService = createPostgresEmailTrackingService({
      db: duplicate.db,
      publicBaseUrl: 'https://crm.example',
      masterKey: key,
      emailTrackingIpIntelligence: readyIpIntelligence(jest.fn(async () => (
        ipInsight({ asn: 15169, networkName: 'GOOGLE' })
      ))),
      now: () => new Date('2026-07-15T12:00:03.000Z'),
    });
    await duplicateService.recordPublicOpen({
      token,
      ip: '74.125.216.133',
      userAgent: 'Mozilla/5.0 AppleWebKit/537.36',
      headers: {},
    });
    expect(duplicate.state.eventRows).toEqual([]);
    expect(duplicate.state.classificationRows).toEqual([]);
  });

  test('prechecks the public-event capacity at the realistic 9,999 and 10,000 boundaries', async () => {
    const token = 'E'.repeat(43);
    const tokenHash = createEmailTrackingCrypto(key).tokenHash(token);
    const belowCap = publicInteractionDatabase(tokenHash, { publicEventCount: 9_999 });
    const belowCapLookup = jest.fn(async () => ipInsight({ asn: 15169, networkName: 'GOOGLE' }));
    const belowCapService = createPostgresEmailTrackingService({
      db: belowCap.db,
      publicBaseUrl: 'https://crm.example',
      masterKey: key,
      emailTrackingIpIntelligence: readyIpIntelligence(belowCapLookup),
      now: () => new Date('2026-07-15T12:00:03.000Z'),
    });

    await belowCapService.recordPublicOpen({
      token,
      ip: '74.125.216.133',
      userAgent: 'Mozilla/5.0 AppleWebKit/537.36',
      headers: {},
    });
    expect(belowCapLookup).toHaveBeenCalledTimes(1);
    expect(belowCap.state.eventRows).toHaveLength(1);
    expect(belowCap.state.classificationRows).toHaveLength(1);

    const atCap = publicInteractionDatabase(tokenHash, { publicEventCount: 10_000 });
    const atCapLookup = jest.fn(async () => ipInsight({ asn: 15169, networkName: 'GOOGLE' }));
    const atCapService = createPostgresEmailTrackingService({
      db: atCap.db,
      publicBaseUrl: 'https://crm.example',
      masterKey: key,
      emailTrackingIpIntelligence: readyIpIntelligence(atCapLookup),
      now: () => new Date('2026-07-15T12:00:03.000Z'),
    });

    await atCapService.recordPublicOpen({
      token,
      ip: '74.125.216.133',
      userAgent: 'Mozilla/5.0 AppleWebKit/537.36',
      headers: {},
    });
    expect(atCapLookup).not.toHaveBeenCalled();
    expect(atCap.state.eventRows).toEqual([]);
    expect(atCap.state.classificationRows).toEqual([]);
    expect(atCap.state.operations).toEqual(['policy_read_initial', 'capacity_precheck']);
  });

  test('reclassifies retained evidence in bounded admin pages without mutating raw events', async () => {
    const workspaceId = '11111111-1111-4111-8111-111111111111';
    const actorUserId = '33333333-3333-4333-8333-333333333333';
    const trackingMessageId = '55555555-5555-4555-8555-555555555555';
    const crypto = createEmailTrackingCrypto(key);
    const acceptedAt = new Date('2026-07-15T12:00:00.000Z');
    const events = Array.from({ length: 501 }, (_, offset) => historicalEvent({
      id: offset + 1,
      type: 'queued',
      occurredAt: new Date(acceptedAt.getTime() + offset * 1_000),
    }));
    events[0] = historicalEvent({ id: 1, type: 'sending', occurredAt: acceptedAt });
    events[1] = historicalEvent({ id: 2, type: 'open_automated', occurredAt: acceptedAt });
    events[2] = historicalEvent({ id: 3, type: 'open_probable', occurredAt: acceptedAt });
    events[3] = historicalEvent({ id: 4, type: 'click', occurredAt: acceptedAt });
    events[4] = historicalEvent({
      id: 5,
      type: 'open_probable',
      occurredAt: new Date(acceptedAt.getTime() + 3_000),
      raw: sealHistoricalRaw(crypto, workspaceId, trackingMessageId, 5, {
        ip: '74.125.216.133',
        userAgent: 'Mozilla/5.0 AppleWebKit/537.36',
      }),
    });
    events[5] = historicalEvent({
      id: 6,
      type: 'open_probable',
      occurredAt: new Date(acceptedAt.getTime() + 60 * 60_000),
      raw: sealHistoricalRaw(crypto, workspaceId, trackingMessageId, 6, {
        ip: '8.8.8.8',
        userAgent: 'Mozilla/5.0 AppleWebKit/537.36',
      }),
    });
    events[6] = historicalEvent({
      id: 7,
      type: 'click_automated',
      occurredAt: new Date(acceptedAt.getTime() + 4_000),
      raw: {
        ciphertext: Buffer.from('unreadable'),
        nonce: Buffer.alloc(12),
        authTag: Buffer.alloc(16),
      },
    });
    const { db, state } = historicalReclassificationDatabase({
      workspaceId,
      trackingMessageId,
      events,
      acceptedAt,
    });
    const rawSnapshot = historicalRawSnapshot(state.events);
    const lookup = jest.fn(async (ipAddress: string) => {
      expect(state.transactionDepth).toBe(0);
      return ipAddress === '74.125.216.133'
        ? ipInsight({ ipAddress, asn: 15169, networkName: 'GOOGLE' })
        : ipInsight({ ipAddress, asn: null, networkName: null });
    });
    const audit = { record: jest.fn(async () => undefined) };
    const service = createPostgresEmailTrackingService({
      db,
      publicBaseUrl: 'https://crm.example',
      masterKey: key,
      emailTrackingIpIntelligence: readyIpIntelligence(lookup),
      audit,
      now: () => new Date('2026-07-16T09:00:00.000Z'),
    });

    const first = await service.reclassifyMessage({ workspaceId, actorUserId, messageId: 17 });
    const second = await service.reclassifyMessage({ workspaceId, actorUserId, messageId: 17 });

    expect(first).toEqual({ classified: 501, unavailableRaw: 2 });
    expect(second).toEqual(first);
    expect(state.readPageSizes).toEqual([500, 1, 500, 1]);
    expect(state.upsertPageSizes).toEqual([500, 1, 500, 1]);
    expect(state.maxRowsInTransaction).toBe(1_000);
    expect(state.eventReloadPageSizes).toEqual([500, 1, 500, 1]);
    expect(state.eventReloadsHeldPolicyLock).toEqual([true, true, true, true]);
    expect(state.classificationUpsertsHeldPolicyLock).toEqual([true, true, true, true]);
    expect(state.classifications).toHaveLength(501);
    expect(state.classifications.find((row) => row.event_id === '1')).toMatchObject({
      classification_version: 2,
      actor_class: 'system',
    });
    expect(state.classifications.find((row) => row.event_id === '2')).toMatchObject({
      actor_class: 'automated_unknown',
    });
    expect(state.classifications.find((row) => row.event_id === '3')).toMatchObject({
      actor_class: 'unknown',
    });
    expect(state.classifications.find((row) => row.event_id === '5')).toMatchObject({
      actor_class: 'automated_unknown',
      reasons_json: ['immediate_infrastructure_fetch'],
    });
    expect(state.classifications.find((row) => row.event_id === '6')).toMatchObject({
      actor_class: 'probable_human',
    });
    expect(state.classifications.find((row) => row.event_id === '7')).toMatchObject({
      actor_class: 'automated_unknown',
    });
    expect(lookup).toHaveBeenCalledTimes(4);
    expect(historicalRawSnapshot(state.events)).toEqual(rawSnapshot);
    expect(state.eventMutationAttempts).toEqual([]);
    expect(state.sessionContexts).toHaveLength(10);
    expect(state.sessionContexts).toEqual(state.sessionContexts.map(() => [
      workspaceId,
      actorUserId,
      'admin',
      'off',
    ]));
    expect(audit.record).toHaveBeenCalledTimes(2);
    expect(audit.record).toHaveBeenLastCalledWith({
      workspaceId,
      actorUserId,
      action: 'email_tracking.reclassified',
      entityType: 'email_message',
      entityId: '17',
      metadata: { classified: 501, unavailableRaw: 2, classificationVersion: 2 },
    });
    expect(JSON.stringify(audit.record.mock.calls)).not.toMatch(/74\.125|8\.8\.8\.8|Mozilla|Geo|ASN|network/i);

    await expect(service.reclassifyMessage({
      workspaceId: '22222222-2222-4222-8222-222222222222',
      actorUserId,
      messageId: 17,
    })).rejects.toThrow('E-Mail-Nachricht nicht gefunden');
    expect(audit.record).toHaveBeenCalledTimes(2);
  });

  test('treats ciphertext beyond logical raw retention as unavailable before decryption', async () => {
    const workspaceId = '11111111-1111-4111-8111-111111111111';
    const trackingMessageId = '55555555-5555-4555-8555-555555555555';
    const crypto = createEmailTrackingCrypto(key);
    const event = historicalEvent({
      id: 1,
      type: 'open_probable',
      occurredAt: new Date('2026-07-01T12:00:00.000Z'),
      createdAt: new Date('2026-07-01T12:00:00.000Z'),
      raw: sealHistoricalRaw(crypto, workspaceId, trackingMessageId, 1, {
        ip: '74.125.216.133',
        userAgent: 'Mozilla/5.0 AppleWebKit/537.36',
      }),
    });
    const { db, state } = historicalReclassificationDatabase({
      workspaceId,
      trackingMessageId,
      events: [event],
      acceptedAt: new Date('2026-07-01T11:59:00.000Z'),
      rawMetadataRetentionDays: 7,
    });
    const lookup = jest.fn(async () => ipInsight({ asn: 15169, networkName: 'GOOGLE' }));
    const service = createPostgresEmailTrackingService({
      db,
      publicBaseUrl: 'https://crm.example',
      masterKey: key,
      emailTrackingIpIntelligence: readyIpIntelligence(lookup),
      now: () => new Date('2026-07-16T09:00:00.000Z'),
    });

    await expect(service.reclassifyMessage({
      workspaceId,
      actorUserId: '33333333-3333-4333-8333-333333333333',
      messageId: 17,
    })).resolves.toEqual({ classified: 1, unavailableRaw: 1 });

    expect(lookup).not.toHaveBeenCalled();
    expect(state.classifications).toHaveLength(1);
    expect(state.classifications[0]).toMatchObject({
      event_id: '1',
      actor_class: 'unknown',
      reasons_json: ['raw_request_data_unavailable'],
    });
  });

  test('revalidates and locks events before upsert when prune or delete wins the page race', async () => {
    const workspaceId = '11111111-1111-4111-8111-111111111111';
    const trackingMessageId = '55555555-5555-4555-8555-555555555555';
    const crypto = createEmailTrackingCrypto(key);
    const occurredAt = new Date('2026-07-15T12:00:00.000Z');
    const events = [1, 2].map((id) => historicalEvent({
      id,
      type: 'open_probable',
      occurredAt: new Date(occurredAt.getTime() + id * 60_000),
      raw: sealHistoricalRaw(crypto, workspaceId, trackingMessageId, id, {
        ip: `74.125.216.${132 + id}`,
        userAgent: 'Mozilla/5.0 AppleWebKit/537.36',
      }),
    }));
    const { db, state } = historicalReclassificationDatabase({
      workspaceId,
      trackingMessageId,
      events,
      acceptedAt: occurredAt,
    });
    const lookup = jest.fn(async () => {
      if (lookup.mock.calls.length === 2) {
        const retained = state.events.find((event) => String(event.id) === '1')!;
        retained.raw_metadata_ciphertext = null;
        retained.raw_metadata_nonce = null;
        retained.raw_metadata_auth_tag = null;
        state.events.splice(state.events.findIndex((event) => String(event.id) === '2'), 1);
      }
      return ipInsight({ asn: 15169, networkName: 'GOOGLE' });
    });
    const service = createPostgresEmailTrackingService({
      db,
      publicBaseUrl: 'https://crm.example',
      masterKey: key,
      emailTrackingIpIntelligence: readyIpIntelligence(lookup),
      now: () => new Date('2026-07-16T09:00:00.000Z'),
    });

    await expect(service.reclassifyMessage({
      workspaceId,
      actorUserId: '33333333-3333-4333-8333-333333333333',
      messageId: 17,
    })).resolves.toEqual({ classified: 1, unavailableRaw: 1 });

    expect(state.eventReloadsHeldPolicyLock).toEqual([true]);
    expect(state.classifications).toHaveLength(1);
    expect(state.classifications[0]).toMatchObject({
      event_id: '1',
      actor_class: 'unknown',
      reasons_json: ['raw_request_data_unavailable'],
    });
  });

  test('preserves adjacent bigserial event ids through reclassification, summary, and timeline', async () => {
    const workspaceId = '11111111-1111-4111-8111-111111111111';
    const trackingMessageId = '55555555-5555-4555-8555-555555555555';
    const firstId = 9_007_199_254_740_992n;
    const events = Array.from({ length: 501 }, (_, offset) => historicalEvent({
      id: (firstId + BigInt(offset)).toString(),
      type: 'open_probable',
      occurredAt: new Date(Date.parse('2026-07-15T10:00:00.000Z') + offset * 1_000),
    }));
    const reclassification = historicalReclassificationDatabase({
      workspaceId,
      trackingMessageId,
      events,
      acceptedAt: new Date('2026-07-15T09:00:00.000Z'),
    });
    const reclassifyService = createPostgresEmailTrackingService({
      db: reclassification.db,
      publicBaseUrl: 'https://crm.example',
      masterKey: key,
      now: () => new Date('2026-07-16T09:00:00.000Z'),
    });

    await expect(reclassifyService.reclassifyMessage({
      workspaceId,
      actorUserId: '33333333-3333-4333-8333-333333333333',
      messageId: 17,
    })).resolves.toEqual({ classified: 501, unavailableRaw: 501 });
    expect(reclassification.state.readAfterEventIds).toEqual([
      '0',
      (firstId + 499n).toString(),
    ]);
    expect(reclassification.state.classifications.map((row) => row.event_id)).toEqual(
      events.map((event) => event.id),
    );

    const timelineDatabase = trackingTimelineDatabase({
      workspaceId,
      trackingMessageId,
      events,
      classifications: [
        historicalClassification(events[0]!.id, 2, 'probable_human'),
        historicalClassification(events[1]!.id, 2, 'security_scanner'),
      ],
    });
    const timelineService = createPostgresEmailTrackingService({
      db: timelineDatabase.db,
      publicBaseUrl: 'https://crm.example',
      masterKey: key,
    });

    const timeline = await timelineService.getTimeline({ workspaceId, messageId: 17 });

    expect(timeline?.summary).toMatchObject({
      openCount: 501,
      automatedPixelFetchCount: 1,
      unknownPixelFetchCount: 499,
      probableHumanPixelFetchCount: 1,
    });
    expect(timelineDatabase.state.summaryAfterEventIds).toEqual([
      '0',
      (firstId + 499n).toString(),
    ]);
    expect(timeline?.events.map((event) => event.id)).toEqual(events.map((event) => event.id));
    expect(timeline?.events[0]?.classification?.actorClass).toBe('probable_human');
    expect(timeline?.events[1]?.classification?.actorClass).toBe('security_scanner');
  });

  test('uses the highest classification projection for timeline and V2 session summary', async () => {
    const workspaceId = '11111111-1111-4111-8111-111111111111';
    const trackingMessageId = '55555555-5555-4555-8555-555555555555';
    const events = [
      historicalEvent({ id: 1, type: 'smtp_accepted', occurredAt: new Date('2026-07-15T10:00:00.000Z') }),
      historicalEvent({ id: 2, type: 'open_probable', occurredAt: new Date('2026-07-15T11:00:00.000Z') }),
      historicalEvent({ id: 3, type: 'open_probable', occurredAt: new Date('2026-07-15T11:10:00.000Z') }),
      historicalEvent({ id: 4, type: 'open_probable', occurredAt: new Date('2026-07-15T12:00:00.000Z') }),
      historicalEvent({ id: 5, type: 'open_automated', occurredAt: new Date('2026-07-15T12:05:00.000Z') }),
      historicalEvent({ id: 6, type: 'open_probable', occurredAt: new Date('2026-07-15T11:40:00.000Z') }),
    ];
    const { db, state } = trackingTimelineDatabase({
      workspaceId,
      trackingMessageId,
      events,
      classifications: [
        historicalClassification(2, 1, 'unknown'),
        historicalClassification(2, 2, 'probable_human'),
        historicalClassification(3, 2, 'probable_human'),
        historicalClassification(6, 2, 'probable_human'),
      ],
    });
    const service = createPostgresEmailTrackingService({
      db,
      publicBaseUrl: 'https://crm.example',
      masterKey: key,
    });

    const timeline = await service.getTimeline({ workspaceId, messageId: 17 });

    expect(timeline?.events.find((event) => event.id === 2)?.classification).toEqual({
      version: 2,
      actorClass: 'probable_human',
      confidence: 'medium',
      reasons: ['historical_test'],
    });
    expect(timeline?.events.find((event) => event.id === 4)?.classification ?? null).toBeNull();
    expect(timeline?.summary).toMatchObject({
      pixelFetchCount: 5,
      automatedPixelFetchCount: 0,
      unknownPixelFetchCount: 2,
      probableHumanPixelFetchCount: 3,
      probableHumanOpenSessionCount: 2,
      firstProbableHumanOpenAt: '2026-07-15T11:00:00.000Z',
      lastProbableHumanOpenAt: '2026-07-15T11:40:00.000Z',
      openCount: 5,
      automatedOpenCount: 1,
      probableOpenCount: 4,
    });
    expect(state.summaryPageLimits).toEqual([500]);
    expect(state.timelineLimits).toEqual([1_001]);
    expect(state.usedHighestClassificationJoin).toBe(false);
    expect(state.unboundedClassificationLookups).toBe(0);
    expect(state.classificationLookupEventIdBatches).toHaveLength(2);
  });

  test('bounds classification lookup per page and preserves summaries across page boundaries', async () => {
    const workspaceId = '11111111-1111-4111-8111-111111111111';
    const trackingMessageId = '55555555-5555-4555-8555-555555555555';
    const events = Array.from({ length: 1_001 }, (_, offset) => {
      const id = offset + 1;
      return historicalEvent({
        id,
        type: 'expired',
        occurredAt: id <= 499
          ? new Date(Date.parse('2026-07-15T10:00:00.000Z') + id * 1_000)
          : new Date(Date.parse('2026-07-15T13:00:00.000Z') + id * 1_000),
      });
    });
    events[0] = historicalEvent({ id: 1, type: 'smtp_accepted', occurredAt: new Date('2026-07-15T10:00:00.000Z') });
    events[499] = historicalEvent({ id: 500, type: 'open_probable', occurredAt: new Date('2026-07-15T11:00:00.000Z') });
    events[500] = historicalEvent({ id: 501, type: 'open_probable', occurredAt: new Date('2026-07-15T11:29:59.000Z') });
    events[501] = historicalEvent({ id: 502, type: 'open_probable', occurredAt: new Date('2026-07-15T11:59:59.000Z') });
    events[502] = historicalEvent({ id: 503, type: 'open_automated', occurredAt: new Date('2026-07-15T12:05:00.000Z') });
    events[503] = historicalEvent({ id: 504, type: 'click', occurredAt: new Date('2026-07-15T12:10:00.000Z') });
    events[504] = historicalEvent({ id: 505, type: 'click_automated', occurredAt: new Date('2026-07-15T12:11:00.000Z') });
    events[505] = historicalEvent({ id: 506, type: 'dsn_delivered', occurredAt: new Date('2026-07-15T12:12:00.000Z') });
    events[506] = historicalEvent({ id: 507, type: 'replied', occurredAt: new Date('2026-07-15T12:13:00.000Z') });
    const unrelatedClassifications = Array.from({ length: 2_000 }, (_, offset) => (
      historicalClassification(100_000 + offset, 2, 'security_scanner')
    ));
    const { db, state } = trackingTimelineDatabase({
      workspaceId,
      trackingMessageId,
      events,
      classifications: [
        historicalClassification(500, 2, 'probable_human'),
        historicalClassification(501, 2, 'probable_human'),
        historicalClassification(502, 2, 'probable_human'),
        ...unrelatedClassifications,
      ],
    });
    const service = createPostgresEmailTrackingService({
      db,
      publicBaseUrl: 'https://crm.example',
      masterKey: key,
    });

    const timeline = await service.getTimeline({ workspaceId, messageId: 17 });

    expect(timeline?.summary).toEqual({
      transport: 'smtp_accepted',
      delivery: 'dsn_delivered',
      engagement: 'human_reply',
      confidence: 'medium',
      pixelFetchCount: 4,
      openCount: 4,
      clickCount: 2,
      automatedOpenCount: 1,
      probableOpenCount: 3,
      automatedClickCount: 1,
      probableClickCount: 1,
      automatedPixelFetchCount: 0,
      unknownPixelFetchCount: 1,
      probableHumanPixelFetchCount: 3,
      probableHumanOpenSessionCount: 2,
      firstPixelFetchedAt: '2026-07-15T11:00:00.000Z',
      lastPixelFetchedAt: '2026-07-15T12:05:00.000Z',
      firstProbableHumanOpenAt: '2026-07-15T11:00:00.000Z',
      lastProbableHumanOpenAt: '2026-07-15T11:59:59.000Z',
      firstOpenedAt: '2026-07-15T11:00:00.000Z',
      lastOpenedAt: '2026-07-15T12:05:00.000Z',
      firstClickedAt: '2026-07-15T12:10:00.000Z',
      lastClickedAt: '2026-07-15T12:11:00.000Z',
      repliedAt: '2026-07-15T12:13:00.000Z',
    });
    expect(state.summaryPageLimits).toEqual([500, 500, 500]);
    expect(state.unboundedClassificationLookups).toBe(0);
    expect(state.classificationLookupEventIdBatches.length).toBeGreaterThan(0);
    expect(state.classificationLookupEventIdBatches.every((ids) => ids.length <= 500)).toBe(true);
    expect(state.classificationLookupEventIdBatches.flat()).not.toContain('100000');
  });
});

function trackingRetryMismatchDatabase(existingTargetHash: string): {
  db: Kysely<ServerDatabase>;
  state: { trackingMessageDeleted: boolean; resolverRows: Array<Record<string, unknown>> };
} {
  const state = {
    trackingMessageDeleted: false,
    resolverRows: [] as Array<Record<string, unknown>>,
  };
  const workspaceId = '11111111-1111-4111-8111-111111111111';
  const trackingMessageId = '55555555-5555-4555-8555-555555555555';
  const fixtures: Record<string, unknown> = {
    email_tracking_policies: {
      enabled: true,
      track_opens: true,
      track_links: true,
      collect_derived_metadata: true,
      collect_raw_metadata: false,
      raw_metadata_retention_days: 7,
      event_retention_days: 365,
      token_ttl_days: 730,
      legal_basis: 'legitimate_interest',
      privacy_notice_url: 'https://example.test/privacy',
      compliance_acknowledged_at: new Date('2026-01-01T00:00:00.000Z'),
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
    },
    email_messages: { id: 17, account_id: 3 },
    email_tracking_messages: {
      id: trackingMessageId,
      workspace_id: workspaceId,
      message_id: 17,
      recipient_count: 1,
      track_opens: true,
      track_links: true,
      collect_derived_metadata: true,
      collect_raw_metadata: false,
      token_expires_at: new Date('2027-07-14T12:00:00.000Z'),
      revoked_at: null,
    },
    email_tracking_links: [{
      id: '77777777-7777-4777-8777-777777777777',
      ordinal: 0,
      target_url_hash: existingTargetHash,
    }],
  };
  const db = {
    transaction() {
      return { execute: async <T>(operation: (trx: unknown) => Promise<T>) => operation(db) };
    },
    getExecutor() {
      return { executeQuery: async () => ({ rows: [] }) };
    },
    selectFrom(table: string) {
      return new TrackingRetrySelect(fixtures[table]);
    },
    updateTable() {
      return new TrackingRetryMutation();
    },
    insertInto(table: string) {
      return new TrackingRetryInsert(table, state.resolverRows);
    },
    deleteFrom(table: string) {
      return new TrackingRetryMutation(() => {
        if (table === 'email_tracking_messages') state.trackingMessageDeleted = true;
      });
    },
  } as unknown as Kysely<ServerDatabase>;
  return { db, state };
}

class TrackingRetrySelect {
  constructor(private readonly fixture: unknown) {}

  select() { return this; }
  selectAll() { return this; }
  where() { return this; }
  orderBy() { return this; }
  async executeTakeFirst() { return Array.isArray(this.fixture) ? this.fixture[0] : this.fixture; }
  async execute() { return Array.isArray(this.fixture) ? this.fixture : this.fixture ? [this.fixture] : []; }
}

class TrackingRetryMutation {
  constructor(private readonly onExecute?: () => void) {}

  set() { return this; }
  where() { return this; }
  async execute() { this.onExecute?.(); }
}

class TrackingRetryInsert {
  private row: Record<string, unknown> = {};

  constructor(
    private readonly table: string,
    private readonly resolverRows: Array<Record<string, unknown>>,
  ) {}

  values(row: Record<string, unknown>) {
    this.row = row;
    return this;
  }

  onConflict(callback: (builder: unknown) => unknown) {
    const doNothing = () => ({});
    callback({ columns: () => ({ doNothing }), column: () => ({ doNothing }) });
    return this;
  }

  async execute() {
    if (this.table === 'email_tracking_token_resolver') {
      this.resolverRows.push(this.row);
      return;
    }
    if (this.table === 'email_tracking_events') return;
    throw new Error(`Unexpected tracking retry insert table: ${this.table}`);
  }
}

function trackingLifecycleDatabase(tokenHash: string): {
  db: Kysely<ServerDatabase>;
  state: {
    messageRevokedAt: Date | null;
    resolverRevokedAt: Date | null;
    eventTypes: string[];
  };
} {
  const trackingMessageId = '55555555-5555-4555-8555-555555555555';
  const state = {
    messageRevokedAt: null as Date | null,
    resolverRevokedAt: null as Date | null,
    eventTypes: [] as string[],
  };
  const workspaceId = '11111111-1111-4111-8111-111111111111';
  const db = {
    transaction() {
      return { execute: async <T>(operation: (trx: unknown) => Promise<T>) => operation(db) };
    },
    getExecutor() {
      return { executeQuery: async () => ({ rows: [] }) };
    },
    selectFrom(table: string) {
      return new TrackingLifecycleSelect(table, {
        workspaceId,
        trackingMessageId,
        tokenHash,
        state,
      });
    },
    updateTable(table: string) {
      return new TrackingLifecycleUpdate(table, state);
    },
    insertInto(table: string) {
      return new TrackingLifecycleInsert(table, state);
    },
    async destroy() {},
  } as unknown as Kysely<ServerDatabase>;
  return {
    db,
    state,
  };
}

type TrackingLifecycleState = {
  messageRevokedAt: Date | null;
  resolverRevokedAt: Date | null;
  eventTypes: string[];
};

class TrackingLifecycleSelect {
  private readonly filters = new Map<string, unknown>();

  constructor(
    private readonly table: string,
    private readonly fixture: {
      workspaceId: string;
      trackingMessageId: string;
      tokenHash: string;
      state: TrackingLifecycleState;
    },
  ) {}

  select() { return this; }

  where(column: string, operator: string, value: unknown) {
    if (operator !== '=') throw new Error(`Unexpected tracking lifecycle select operator: ${operator}`);
    this.filters.set(column, value);
    return this;
  }

  async executeTakeFirst() {
    if (this.table === 'email_tracking_messages') {
      return this.filters.get('workspace_id') === this.fixture.workspaceId
        && this.filters.get('message_id') === 17
        ? { id: this.fixture.trackingMessageId }
        : undefined;
    }
    if (this.table === 'email_tracking_token_resolver') {
      return this.filters.get('token_hash') === this.fixture.tokenHash
        ? {
            workspace_id: this.fixture.workspaceId,
            tracking_message_id: this.fixture.trackingMessageId,
            link_id: null,
            token_kind: 'open',
            expires_at: new Date('2027-07-14T12:00:00.000Z'),
            revoked_at: this.fixture.state.resolverRevokedAt,
          }
        : undefined;
    }
    throw new Error(`Unexpected tracking lifecycle select table: ${this.table}`);
  }
}

class TrackingLifecycleUpdate {
  private patch: Record<string, unknown> = {};

  constructor(private readonly table: string, private readonly state: TrackingLifecycleState) {}

  set(patch: Record<string, unknown>) {
    this.patch = patch;
    return this;
  }

  where() { return this; }

  async execute() {
    if (this.table === 'email_tracking_messages') {
      this.state.messageRevokedAt = this.patch.revoked_at as Date;
      return;
    }
    if (this.table === 'email_tracking_token_resolver') {
      this.state.resolverRevokedAt = this.patch.revoked_at as Date;
      return;
    }
    throw new Error(`Unexpected tracking lifecycle update table: ${this.table}`);
  }
}

class TrackingLifecycleInsert {
  private row: Record<string, unknown> = {};

  constructor(private readonly table: string, private readonly state: TrackingLifecycleState) {}

  values(row: Record<string, unknown>) {
    this.row = row;
    return this;
  }

  onConflict(callback: (builder: unknown) => unknown) {
    const doNothing = () => ({});
    callback({ columns: () => ({ doNothing }), column: () => ({ doNothing }) });
    return this;
  }

  async execute() {
    if (this.table !== 'email_tracking_events') {
      throw new Error(`Unexpected tracking lifecycle insert table: ${this.table}`);
    }
    this.state.eventTypes.push(String(this.row.event_type));
  }
}

function readyIpIntelligence(
  lookup: EmailTrackingIpIntelligencePort['lookup'],
): EmailTrackingIpIntelligencePort {
  return {
    lookup,
    status: () => ({
      state: 'ready',
      countryDatabaseBuildAt: '2026-07-15T00:00:00.000Z',
      asnDatabaseBuildAt: '2026-07-15T00:00:00.000Z',
    }),
  };
}

type PublicInteractionTestState = {
  transactionDepth: number;
  policyReads: number;
  policyLockHeld: boolean;
  eventInsertHeldPolicyLock: boolean;
  operations: string[];
  eventRows: Array<Record<string, unknown>>;
  classificationRows: Array<Record<string, unknown>>;
};

function publicInteractionDatabase(
  tokenHash: string,
  options: Readonly<{
    initialPolicyEnabled?: boolean;
    recheckPolicyEnabled?: boolean;
    trackedCollectDerivedMetadata?: boolean;
    publicEventCount?: number;
    duplicateEvent?: boolean;
  }> = {},
): { db: Kysely<ServerDatabase>; state: PublicInteractionTestState } {
  const state: PublicInteractionTestState = {
    transactionDepth: 0,
    policyReads: 0,
    policyLockHeld: false,
    eventInsertHeldPolicyLock: false,
    operations: [],
    eventRows: [],
    classificationRows: [],
  };
  const fixture = {
    workspaceId: '11111111-1111-4111-8111-111111111111',
    trackingMessageId: '55555555-5555-4555-8555-555555555555',
    tokenHash,
    initialPolicyEnabled: options.initialPolicyEnabled ?? true,
    recheckPolicyEnabled: options.recheckPolicyEnabled ?? true,
    trackedCollectDerivedMetadata: options.trackedCollectDerivedMetadata ?? true,
    publicEventCount: options.publicEventCount ?? 0,
    duplicateEvent: options.duplicateEvent ?? false,
  };
  const db = {
    transaction() {
      return {
        execute: async <T>(operation: (trx: unknown) => Promise<T>) => {
          state.transactionDepth += 1;
          try {
            return await operation(db);
          } finally {
            state.transactionDepth -= 1;
            state.policyLockHeld = false;
          }
        },
      };
    },
    getExecutor() {
      return {
        executeQuery: async (query: { sql?: string }) => {
          const statement = query.sql ?? '';
          if (statement.includes('pg_advisory_xact_lock') && statement.includes('hashtextextended')) {
            state.operations.push('policy_lock');
            state.policyLockHeld = true;
          } else if (statement.includes('pg_advisory_xact_lock') && statement.includes('hashtext')) {
            state.operations.push('message_lock');
          }
          return { rows: [] };
        },
      };
    },
    selectFrom(table: string) {
      return new PublicInteractionSelect(table, state, fixture);
    },
    insertInto(table: string) {
      return new PublicInteractionInsert(table, state, fixture.duplicateEvent);
    },
  } as unknown as Kysely<ServerDatabase>;
  return { db, state };
}

class PublicInteractionSelect {
  private selected: string | readonly string[] | undefined;
  private readonly filters: Array<readonly [string, string, unknown]> = [];

  constructor(
    private readonly table: string,
    private readonly state: PublicInteractionTestState,
    private readonly fixture: Readonly<{
      workspaceId: string;
      trackingMessageId: string;
      tokenHash: string;
      initialPolicyEnabled: boolean;
      recheckPolicyEnabled: boolean;
      trackedCollectDerivedMetadata: boolean;
      publicEventCount: number;
    }>,
  ) {}

  select(selection: string | readonly string[]) {
    this.selected = selection;
    return this;
  }

  where(column: string, operator: string, value: unknown) {
    this.filters.push([column, operator, value]);
    return this;
  }
  orderBy() { return this; }
  offset() { return this; }
  limit() { return this; }

  async executeTakeFirst() {
    if (this.table === 'email_tracking_token_resolver') {
      return {
        workspace_id: this.fixture.workspaceId,
        tracking_message_id: this.fixture.trackingMessageId,
        link_id: null,
        token_kind: 'open',
        expires_at: new Date('2027-07-15T12:00:00.000Z'),
        revoked_at: null,
      };
    }
    if (this.table === 'email_tracking_messages') {
      return {
        message_id: 17,
        revoked_at: null,
        token_expires_at: new Date('2027-07-15T12:00:00.000Z'),
        collect_derived_metadata: this.fixture.trackedCollectDerivedMetadata,
        collect_raw_metadata: false,
      };
    }
    if (this.table === 'email_tracking_policies') {
      this.state.policyReads += 1;
      this.state.operations.push(this.state.policyReads === 1 ? 'policy_read_initial' : 'policy_read_final');
      const enabled = this.state.policyReads === 1
        ? this.fixture.initialPolicyEnabled
        : this.fixture.recheckPolicyEnabled;
      return {
        ip_insights_enabled: enabled,
        collect_derived_metadata: enabled,
      };
    }
    if (this.table === 'email_tracking_events') {
      const selected = Array.isArray(this.selected) ? this.selected : [this.selected];
      if (selected.includes('occurred_at')) {
        const eventType = this.filters.find(([column]) => column === 'event_type')?.[2];
        if (eventType === 'smtp_accepted') {
          this.state.operations.push('accepted_read');
          return { occurred_at: new Date('2026-07-15T12:00:00.000Z') };
        }
        const dedupeKeys = this.filters.find(([column, operator]) => (
          column === 'dedupe_key' && operator === 'in'
        ))?.[2] as readonly string[] | undefined;
        const cutoff = this.filters.find(([column, operator]) => (
          column === 'occurred_at' && operator === '>='
        ))?.[2] as Date | undefined;
        this.state.operations.push('dedupe_read');
        return [...this.state.eventRows].reverse().find((row) => (
          dedupeKeys?.includes(String(row.dedupe_key))
          && row.occurred_at instanceof Date
          && (!cutoff || row.occurred_at.getTime() >= cutoff.getTime())
        ));
      }
      this.state.operations.push(this.state.policyReads === 1 ? 'capacity_precheck' : 'capacity_authoritative');
      return this.fixture.publicEventCount >= 10_000 ? { id: 10_000 } : undefined;
    }
    throw new Error(`Unexpected public interaction select table: ${this.table}`);
  }
}

class PublicInteractionInsert {
  private row: Record<string, unknown> = {};

  constructor(
    private readonly table: string,
    private readonly state: PublicInteractionTestState,
    private readonly duplicateEvent: boolean,
  ) {}

  values(row: Record<string, unknown>) {
    this.row = row;
    return this;
  }

  onConflict(callback: (builder: unknown) => unknown) {
    callback({ columns: () => ({ doNothing: () => ({}) }) });
    return this;
  }

  returning() { return this; }

  async executeTakeFirst() {
    if (this.table !== 'email_tracking_events') {
      throw new Error(`Unexpected returning insert table: ${this.table}`);
    }
    if (this.duplicateEvent) return undefined;
    this.state.operations.push('event_insert');
    this.state.eventInsertHeldPolicyLock = this.state.policyLockHeld;
    this.state.eventRows.push(this.row);
    return { id: 41 };
  }

  async execute() {
    if (this.table !== 'email_tracking_event_classifications') {
      throw new Error(`Unexpected public interaction insert table: ${this.table}`);
    }
    this.state.operations.push('classification_insert');
    this.state.classificationRows.push(this.row);
  }
}

type HistoricalEventRow = {
  id: number | string;
  event_type: string;
  source: string;
  confidence: string;
  automated: boolean;
  occurred_at: Date;
  metadata_json: Record<string, unknown>;
  raw_metadata_ciphertext: Buffer | null;
  raw_metadata_nonce: Buffer | null;
  raw_metadata_auth_tag: Buffer | null;
  dedupe_key: string;
  created_at: Date;
};

type HistoricalRawEnvelope = {
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
};

function historicalEvent(input: {
  id: number | string;
  type: string;
  occurredAt: Date;
  createdAt?: Date;
  raw?: HistoricalRawEnvelope;
}): HistoricalEventRow {
  const automated = input.type.endsWith('_automated')
    || ['queued', 'sending', 'smtp_accepted', 'smtp_failed', 'delayed', 'bounced'].includes(input.type);
  return {
    id: input.id,
    event_type: input.type,
    source: 'historical_fixture',
    confidence: input.type === 'queued' || input.type === 'sending' ? 'none'
      : input.type === 'smtp_accepted' ? 'low' : 'medium',
    automated,
    occurred_at: input.occurredAt,
    metadata_json: {},
    raw_metadata_ciphertext: input.raw?.ciphertext ?? null,
    raw_metadata_nonce: input.raw?.nonce ?? null,
    raw_metadata_auth_tag: input.raw?.authTag ?? null,
    dedupe_key: `historical-${input.id}`,
    created_at: input.createdAt ?? input.occurredAt,
  };
}

function sealHistoricalRaw(
  crypto: ReturnType<typeof createEmailTrackingCrypto>,
  workspaceId: string,
  trackingMessageId: string,
  eventId: number | string,
  raw: { ip: string | null; userAgent: string | null },
): HistoricalRawEnvelope {
  const dedupeKey = `historical-${eventId}`;
  return crypto.sealJson(
    raw,
    emailTrackingEventAssociatedData(workspaceId, trackingMessageId, dedupeKey),
  );
}

function historicalRawSnapshot(events: readonly HistoricalEventRow[]) {
  return events.map((event) => ({
    id: event.id,
    ciphertext: event.raw_metadata_ciphertext?.toString('hex') ?? null,
    nonce: event.raw_metadata_nonce?.toString('hex') ?? null,
    authTag: event.raw_metadata_auth_tag?.toString('hex') ?? null,
    dedupeKey: event.dedupe_key,
  }));
}

type HistoricalReclassificationState = {
  transactionDepth: number;
  currentRowsInTransaction: number;
  maxRowsInTransaction: number;
  policyLockHeld: boolean;
  classificationUpsertsHeldPolicyLock: boolean[];
  readPageSizes: number[];
  readAfterEventIds: string[];
  upsertPageSizes: number[];
  classifications: Array<Record<string, unknown>>;
  events: HistoricalEventRow[];
  eventMutationAttempts: string[];
  eventReloadPageSizes: number[];
  eventReloadsHeldPolicyLock: boolean[];
  sessionContexts: unknown[][];
};

function historicalReclassificationDatabase(input: {
  workspaceId: string;
  trackingMessageId: string;
  events: readonly HistoricalEventRow[];
  acceptedAt: Date;
  collectDerivedMetadata?: boolean;
  insightsEnabled?: boolean;
  rawMetadataRetentionDays?: number;
}): { db: Kysely<ServerDatabase>; state: HistoricalReclassificationState } {
  const state: HistoricalReclassificationState = {
    transactionDepth: 0,
    currentRowsInTransaction: 0,
    maxRowsInTransaction: 0,
    policyLockHeld: false,
    classificationUpsertsHeldPolicyLock: [],
    readPageSizes: [],
    readAfterEventIds: [],
    upsertPageSizes: [],
    classifications: [],
    events: input.events.map((event) => ({ ...event })),
    eventMutationAttempts: [],
    eventReloadPageSizes: [],
    eventReloadsHeldPolicyLock: [],
    sessionContexts: [],
  };
  const fixture = {
    ...input,
    events: state.events,
    collectDerivedMetadata: input.collectDerivedMetadata ?? true,
    insightsEnabled: input.insightsEnabled ?? true,
    rawMetadataRetentionDays: input.rawMetadataRetentionDays ?? 7,
  };
  const db = {
    transaction() {
      return {
        execute: async <T>(operation: (trx: unknown) => Promise<T>) => {
          state.transactionDepth += 1;
          state.currentRowsInTransaction = 0;
          try {
            return await operation(db);
          } finally {
            state.transactionDepth -= 1;
            state.currentRowsInTransaction = 0;
            state.policyLockHeld = false;
          }
        },
      };
    },
    getExecutor() {
      return {
        executeQuery: async (query: { sql?: string; parameters?: readonly unknown[] }) => {
          const statement = query.sql ?? '';
          if (statement.includes("set_config('app.workspace_id'")) {
            state.sessionContexts.push([...(query.parameters ?? [])]);
          }
          if (statement.includes('pg_advisory_xact_lock') && statement.includes('hashtextextended')) {
            state.policyLockHeld = true;
          }
          return { rows: [] };
        },
      };
    },
    selectFrom(table: string) {
      return new HistoricalReclassificationSelect(table, state, fixture);
    },
    insertInto(table: string) {
      return new HistoricalReclassificationInsert(table, state);
    },
    updateTable(table: string) {
      state.eventMutationAttempts.push(`update:${table}`);
      throw new Error(`Unexpected historical update: ${table}`);
    },
    deleteFrom(table: string) {
      state.eventMutationAttempts.push(`delete:${table}`);
      throw new Error(`Unexpected historical delete: ${table}`);
    },
  } as unknown as Kysely<ServerDatabase>;
  return { db, state };
}

class HistoricalReclassificationSelect {
  private readonly filters: Array<readonly [string, string, unknown]> = [];
  private selected: string | readonly string[] | undefined;
  private rowLimit = Number.MAX_SAFE_INTEGER;
  private forUpdateRequested = false;

  constructor(
    private readonly table: string,
    private readonly state: HistoricalReclassificationState,
    private readonly fixture: Readonly<{
      workspaceId: string;
      trackingMessageId: string;
      events: readonly HistoricalEventRow[];
      acceptedAt: Date;
      collectDerivedMetadata: boolean;
      insightsEnabled: boolean;
      rawMetadataRetentionDays: number;
    }>,
  ) {}

  select(selection: string | readonly string[]) {
    this.selected = selection;
    return this;
  }

  where(column: string, operator: string, value: unknown) {
    this.filters.push([column, operator, value]);
    return this;
  }

  orderBy() { return this; }

  forUpdate() {
    this.forUpdateRequested = true;
    return this;
  }

  limit(value: number) {
    this.rowLimit = value;
    return this;
  }

  async executeTakeFirst() {
    const workspaceId = this.filterValue('workspace_id', '=');
    if (this.table === 'email_messages') {
      return workspaceId === this.fixture.workspaceId && this.filterValue('id', '=') === 17
        ? { id: 17 }
        : undefined;
    }
    if (this.table === 'email_tracking_messages') {
      const messageId = this.filterValue('message_id', '=');
      const trackingId = this.filterValue('id', '=');
      return workspaceId === this.fixture.workspaceId
        && (messageId === 17 || trackingId === this.fixture.trackingMessageId)
        ? {
            id: this.fixture.trackingMessageId,
            message_id: 17,
            collect_derived_metadata: this.fixture.collectDerivedMetadata,
          }
        : undefined;
    }
    if (this.table === 'email_tracking_policies') {
      return workspaceId === this.fixture.workspaceId
        ? {
            ip_insights_enabled: this.fixture.insightsEnabled,
            collect_derived_metadata: this.fixture.insightsEnabled,
            raw_metadata_retention_days: this.fixture.rawMetadataRetentionDays,
          }
        : undefined;
    }
    if (this.table === 'email_tracking_events') {
      const selected = Array.isArray(this.selected) ? this.selected : [this.selected];
      if (selected.includes('occurred_at') && this.filterValue('event_type', '=') === 'smtp_accepted') {
        return { occurred_at: this.fixture.acceptedAt };
      }
    }
    throw new Error(`Unexpected historical executeTakeFirst table: ${this.table}`);
  }

  async execute() {
    if (this.table !== 'email_tracking_events') {
      throw new Error(`Unexpected historical execute table: ${this.table}`);
    }
    const requestedIds = this.filterValue('id', 'in');
    if (Array.isArray(requestedIds)) {
      if (!this.forUpdateRequested) throw new Error('Historical event reload must lock rows');
      this.state.eventReloadsHeldPolicyLock.push(this.state.policyLockHeld);
      const rows = this.fixture.events
        .filter((event) => requestedIds.some((id) => String(id) === String(event.id)))
        .map((event) => ({ ...event }));
      this.state.eventReloadPageSizes.push(rows.length);
      this.recordRows(rows.length);
      return rows;
    }
    const afterId = String(this.filterValue('id', '>') ?? '0');
    this.state.readAfterEventIds.push(afterId);
    const rows = this.fixture.events
      .filter((event) => BigInt(event.id) > BigInt(afterId))
      .slice(0, this.rowLimit)
      .map((event) => ({ ...event }));
    if (this.rowLimit > 500) throw new Error(`Historical page exceeded 500 rows: ${this.rowLimit}`);
    this.state.readPageSizes.push(rows.length);
    this.recordRows(rows.length);
    return rows;
  }

  private filterValue(column: string, operator: string): unknown {
    return this.filters.find((filter) => filter[0] === column && filter[1] === operator)?.[2];
  }

  private recordRows(count: number) {
    this.state.currentRowsInTransaction += count;
    this.state.maxRowsInTransaction = Math.max(
      this.state.maxRowsInTransaction,
      this.state.currentRowsInTransaction,
    );
  }
}

class HistoricalReclassificationInsert {
  private rows: Array<Record<string, unknown>> = [];

  constructor(
    private readonly table: string,
    private readonly state: HistoricalReclassificationState,
  ) {}

  values(rows: Record<string, unknown> | readonly Record<string, unknown>[]) {
    this.rows = Array.isArray(rows) ? [...rows] : [rows];
    return this;
  }

  onConflict(callback: (builder: unknown) => unknown) {
    callback({
      columns: (columns: readonly string[]) => ({
        doUpdateSet: () => {
          if (columns.join(',') !== 'event_id,classification_version') {
            throw new Error(`Unexpected historical conflict columns: ${columns.join(',')}`);
          }
          return {};
        },
      }),
    });
    return this;
  }

  async execute() {
    if (this.table !== 'email_tracking_event_classifications') {
      this.state.eventMutationAttempts.push(`insert:${this.table}`);
      throw new Error(`Unexpected historical insert: ${this.table}`);
    }
    if (this.rows.length > 500) throw new Error(`Historical upsert exceeded 500 rows: ${this.rows.length}`);
    if (this.rows.some((row) => !this.state.events.some((event) => (
      String(event.id) === String(row.event_id)
    )))) {
      throw new Error('Simulated email_tracking_event_classifications event_id foreign-key violation');
    }
    this.state.upsertPageSizes.push(this.rows.length);
    this.state.classificationUpsertsHeldPolicyLock.push(this.state.policyLockHeld);
    this.state.currentRowsInTransaction += this.rows.length;
    this.state.maxRowsInTransaction = Math.max(
      this.state.maxRowsInTransaction,
      this.state.currentRowsInTransaction,
    );
    for (const row of this.rows) {
      const existing = this.state.classifications.findIndex((candidate) => (
        String(candidate.event_id) === String(row.event_id)
        && candidate.classification_version === row.classification_version
      ));
      if (existing >= 0) this.state.classifications[existing] = row;
      else this.state.classifications.push(row);
    }
  }
}

function historicalClassification(
  eventId: number | string,
  version: number,
  actorClass: string,
): Record<string, unknown> {
  return {
    event_id: eventId,
    classification_version: version,
    actor_class: actorClass,
    confidence: 'medium',
    reasons_json: ['historical_test'],
    classified_at: new Date('2026-07-16T09:00:00.000Z'),
  };
}

type TrackingTimelineState = {
  summaryPageLimits: number[];
  summaryAfterEventIds: string[];
  timelineLimits: number[];
  usedHighestClassificationJoin: boolean;
  unboundedClassificationLookups: number;
  classificationLookupEventIdBatches: string[][];
};

function trackingTimelineDatabase(input: {
  workspaceId: string;
  trackingMessageId: string;
  events: readonly HistoricalEventRow[];
  classifications: readonly Record<string, unknown>[];
}): { db: Kysely<ServerDatabase>; state: TrackingTimelineState } {
  const state: TrackingTimelineState = {
    summaryPageLimits: [],
    summaryAfterEventIds: [],
    timelineLimits: [],
    usedHighestClassificationJoin: false,
    unboundedClassificationLookups: 0,
    classificationLookupEventIdBatches: [],
  };
  const db = {
    transaction() {
      return { execute: async <T>(operation: (trx: unknown) => Promise<T>) => operation(db) };
    },
    getExecutor() {
      return {
        executeQuery: async (query: { sql?: string }) => {
          if ((query.sql ?? '').includes("set_config('app.workspace_id'")) return { rows: [] };
          return {
            rows: [{
              latest_transport_type: 'smtp_accepted',
              confidence_rank: 2,
              engagement_rank: 2,
              has_dsn_delivery: false,
              has_external_reach: true,
              open_count: 5,
              click_count: 0,
              automated_open_count: 1,
              probable_open_count: 4,
              automated_click_count: 0,
              probable_click_count: 0,
              first_opened_at: new Date('2026-07-15T11:00:00.000Z'),
              last_opened_at: new Date('2026-07-15T12:05:00.000Z'),
              first_clicked_at: null,
              last_clicked_at: null,
              replied_at: null,
            }],
          };
        },
      };
    },
    selectFrom(table: string) {
      return new TrackingTimelineSelect(table, state, input);
    },
  } as unknown as Kysely<ServerDatabase>;
  return { db, state };
}

class TrackingTimelineSelect {
  private readonly filters: Array<readonly [string, string, unknown]> = [];
  private readonly orders: Array<readonly [string, string | undefined]> = [];
  private rowLimit = Number.MAX_SAFE_INTEGER;
  private joinedClassifications = false;
  private classificationVersionDescending = false;
  private summaryCursor: { occurredAt: Date; eventId: string } | null = null;

  constructor(
    private readonly table: string,
    private readonly state: TrackingTimelineState,
    private readonly fixture: Readonly<{
      workspaceId: string;
      trackingMessageId: string;
      events: readonly HistoricalEventRow[];
      classifications: readonly Record<string, unknown>[];
    }>,
  ) {}

  select() { return this; }
  distinctOn() { return this; }

  where(
    column: string | ((builder: unknown) => unknown),
    operator?: string,
    value?: unknown,
  ) {
    if (typeof column === 'function') {
      let occurredAt: Date | null = null;
      let eventId: string | null = null;
      const expression = ((name: string, comparison: string, candidate: unknown) => {
        if (name.endsWith('occurred_at') && comparison === '>') occurredAt = candidate as Date;
        if (name.endsWith('id') && comparison === '>') eventId = String(candidate);
        return { name, comparison, candidate };
      }) as unknown as {
        (name: string, comparison: string, candidate: unknown): unknown;
        or: (items: readonly unknown[]) => unknown;
        and: (items: readonly unknown[]) => unknown;
      };
      expression.or = (items) => items;
      expression.and = (items) => items;
      column(expression);
      if (occurredAt && eventId) this.summaryCursor = { occurredAt, eventId };
      return this;
    }
    this.filters.push([column, operator!, value]);
    return this;
  }

  orderBy(column: string, direction?: string) {
    this.orders.push([column, direction]);
    if (this.table === 'email_tracking_event_classifications'
      && column.includes('classification_version')
      && direction === 'desc') {
      this.classificationVersionDescending = true;
    }
    return this;
  }

  limit(value: number) {
    this.rowLimit = value;
    return this;
  }

  as() {
    if (this.table === 'email_tracking_event_classifications'
      && !Array.isArray(this.filterValue('event_id', 'in'))) {
      this.state.unboundedClassificationLookups += 1;
    }
    return {
      historicalClassificationSubquery: true,
      classificationVersionDescending: this.classificationVersionDescending,
    };
  }

  leftJoin(joined: unknown) {
    const marker = joined as {
      historicalClassificationSubquery?: boolean;
      classificationVersionDescending?: boolean;
    };
    this.joinedClassifications = marker.historicalClassificationSubquery === true;
    this.state.usedHighestClassificationJoin ||= this.joinedClassifications
      && marker.classificationVersionDescending === true;
    return this;
  }

  async executeTakeFirst() {
    if (this.table === 'email_messages') return { id: 17 };
    if (this.table === 'email_tracking_messages') {
      return { id: this.fixture.trackingMessageId, recipient_count: 1 };
    }
    throw new Error(`Unexpected timeline executeTakeFirst table: ${this.table}`);
  }

  async execute() {
    if (this.table === 'email_tracking_event_classifications') {
      const eventIds = this.filterValue('event_id', 'in');
      if (!Array.isArray(eventIds)) {
        this.state.unboundedClassificationLookups += 1;
        return [];
      }
      const canonicalIds = eventIds.map((id) => String(id));
      this.state.classificationLookupEventIdBatches.push(canonicalIds);
      const rows = this.fixture.classifications
        .filter((candidate) => canonicalIds.includes(String(candidate.event_id)))
        .sort((left, right) => (
          compareHistoricalIds(
            left.event_id as number | string,
            right.event_id as number | string,
          ) || Number(right.classification_version) - Number(left.classification_version)
        ));
      return rows.filter((row, index) => (
        index === 0 || String(rows[index - 1]!.event_id) !== String(row.event_id)
      ));
    }
    if (!this.table.startsWith('email_tracking_events')) {
      throw new Error(`Unexpected timeline execute table: ${this.table}`);
    }
    const afterId = String(
      this.filters.find(([column, operator]) => column.endsWith('id') && operator === '>')?.[2] ?? '0',
    );
    const descending = this.orders.some(([, direction]) => direction === 'desc');
    const rows = this.fixture.events
      .filter((event) => {
        if (!this.summaryCursor) return BigInt(event.id) > BigInt(afterId);
        const timeDifference = event.occurred_at.getTime() - this.summaryCursor.occurredAt.getTime();
        return timeDifference > 0
          || (timeDifference === 0 && BigInt(event.id) > BigInt(this.summaryCursor.eventId));
      })
      .sort((left, right) => descending
        ? right.occurred_at.getTime() - left.occurred_at.getTime()
          || compareHistoricalIds(right.id, left.id)
        : left.occurred_at.getTime() - right.occurred_at.getTime()
          || compareHistoricalIds(left.id, right.id))
      .slice(0, this.rowLimit)
      .map((event) => this.joinedClassifications ? this.withHighestClassification(event) : event);
    if (this.rowLimit === 500) {
      this.state.summaryPageLimits.push(this.rowLimit);
      this.state.summaryAfterEventIds.push(this.summaryCursor?.eventId ?? afterId);
    }
    if (this.rowLimit === 1_001) this.state.timelineLimits.push(this.rowLimit);
    return rows;
  }

  private withHighestClassification(event: HistoricalEventRow) {
    const classification = this.fixture.classifications
      .filter((candidate) => String(candidate.event_id) === String(event.id))
      .sort((left, right) => Number(right.classification_version) - Number(left.classification_version))[0];
    return {
      ...event,
      classification_version: classification?.classification_version ?? null,
      actor_class: classification?.actor_class ?? null,
      classification_confidence: classification?.confidence ?? null,
      reasons_json: classification?.reasons_json ?? null,
      classified_at: classification?.classified_at ?? null,
    };
  }

  private filterValue(column: string, operator: string): unknown {
    return this.filters.find((filter) => filter[0] === column && filter[1] === operator)?.[2];
  }
}

function compareHistoricalIds(left: number | string, right: number | string): number {
  const leftId = BigInt(left);
  const rightId = BigInt(right);
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}
