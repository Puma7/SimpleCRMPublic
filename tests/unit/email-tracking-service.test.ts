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
      event_id: 41,
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
      'event_insert',
      'classification_insert',
    ]);
    expect(state.eventInsertHeldPolicyLock).toBe(true);
    expect(JSON.stringify([state.eventRows, state.classificationRows])).not.toMatch(/GOOGLE|15169|countryCode|networkCidr/);
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

  where() { return this; }
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
        this.state.operations.push('accepted_read');
        return { occurred_at: new Date('2026-07-15T12:00:00.000Z') };
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
