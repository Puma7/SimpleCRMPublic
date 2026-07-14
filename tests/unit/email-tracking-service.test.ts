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
});

function trackingRetryMismatchDatabase(existingTargetHash: string): {
  db: Kysely<ServerDatabase>;
  state: { trackingMessageDeleted: boolean };
} {
  const state = { trackingMessageDeleted: false };
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
