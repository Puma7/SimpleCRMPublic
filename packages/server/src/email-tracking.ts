import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { isIP } from 'node:net';
import { sql, type Kysely } from 'kysely';

import {
  buildEmailEvidenceSummary,
  classifyEmailTrackingRequest,
  instrumentEmailHtml,
  type EmailEvidenceClassification,
  type EmailEvidenceConfidence,
  type EmailEvidenceEvent,
  type EmailEvidenceSummary,
  type EmailEvidenceEventType,
  type EmailTrackingNetworkContext,
} from '@simplecrm/core';

import type {
  AuditApiPort,
  EmailTrackingApiPort,
  EmailTrackingEventRecord,
  EmailTrackingIpInsightRecord,
  EmailTrackingPublicRequest,
  EmailTrackingPolicyMutationInput,
  EmailTrackingPolicyRecord,
  EmailTrackingTimelineRecord,
  ServerEventPort,
} from './api/types';
import type { ServerDatabase } from './db/schema';
import { withWorkspaceTransaction, type WorkspaceTransaction } from './db/workspace-context';
import type { EmailTrackingIpIntelligencePort } from './email-tracking-ip-intelligence';
import { emailTrackingNetworkContext } from './email-tracking-network-rules';

const TRACKING_TOKEN_CONTEXT = 'simplecrm/email-tracking/token/v1';
const TRACKING_ENCRYPTION_CONTEXT = 'simplecrm/email-tracking/encryption/v1';
const TRACKING_LINK_HASH_CONTEXT = 'simplecrm/email-tracking/link-hash/v1';
const AES_GCM_NONCE_BYTES = 12;
const MAX_SEALED_JSON_BYTES = 64 * 1024;
const MAX_PUBLIC_EVENTS_PER_TRACKING_MESSAGE = 10_000;
const MAX_TRACKED_HTML_BYTES = 5 * 1024 * 1024;
const MAX_PRIVACY_NOTICE_URL_LENGTH = 2_048;
const EMAIL_TRACKING_RECLASSIFICATION_PAGE_SIZE = 500;
const EMAIL_TRACKING_SUMMARY_PAGE_SIZE = 500;

export type SealedTrackingJson = Readonly<{
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
}>;

export type NormalizedEmailTrackingPolicy = Omit<
  EmailTrackingPolicyRecord,
  'publicBaseUrl' | 'updatedAt'
>;

export class EmailTrackingPolicyValidationError extends Error {
  override readonly name = 'EmailTrackingPolicyValidationError';
}

export class EmailTrackingMessageNotFoundError extends Error {
  override readonly name = 'EmailTrackingMessageNotFoundError';

  constructor() {
    super('E-Mail-Nachricht nicht gefunden');
  }
}

export class EmailTrackingIpInsightNotFoundError extends Error {
  override readonly name = 'EmailTrackingIpInsightNotFoundError';

  constructor() {
    super('Tracking-Ereignis nicht gefunden');
  }
}

export class EmailTrackingIpInsightForbiddenError extends Error {
  override readonly name = 'EmailTrackingIpInsightForbiddenError';

  constructor() {
    super('IP-Insights sind fuer diesen Workspace nicht aktiviert');
  }
}

export class EmailTrackingIpInsightRawDataUnavailableError extends Error {
  override readonly name = 'EmailTrackingIpInsightRawDataUnavailableError';

  constructor() {
    super('Rohdaten fuer den IP-Insight sind nicht mehr verfuegbar');
  }
}

export class EmailTrackingIpInsightUnavailableError extends Error {
  override readonly name = 'EmailTrackingIpInsightUnavailableError';

  constructor() {
    super('Lokale IP-Insight-Datenbank ist nicht verfuegbar');
  }
}

type TrackingAttemptFlags = Readonly<{
  trackOpens: boolean;
  trackLinks: boolean;
  collectDerivedMetadata: boolean;
  collectRawMetadata: boolean;
}>;

export function effectiveRetryTrackingFlags(
  stored: TrackingAttemptFlags,
  current: TrackingAttemptFlags,
): TrackingAttemptFlags {
  return {
    trackOpens: stored.trackOpens && current.trackOpens,
    trackLinks: stored.trackLinks && current.trackLinks,
    collectDerivedMetadata: stored.collectDerivedMetadata && current.collectDerivedMetadata,
    collectRawMetadata: stored.collectRawMetadata && current.collectRawMetadata,
  };
}

export function retryLinkCountMismatch(input: {
  created: boolean;
  trackLinks: boolean;
  trackedLinkCount: number;
  existingLinkCount: number;
}): boolean {
  return !input.created
    && input.trackLinks
    && input.trackedLinkCount !== input.existingLinkCount;
}

export function createEmailTrackingCrypto(masterKey: Buffer) {
  if (masterKey.length !== 32) throw new Error('E-Mail-Tracking-Schluessel muss 32 Bytes lang sein');
  const tokenKey = createHmac('sha256', masterKey).update(TRACKING_TOKEN_CONTEXT, 'utf8').digest();
  const encryptionKey = createHmac('sha256', masterKey).update(TRACKING_ENCRYPTION_CONTEXT, 'utf8').digest();
  const linkHashKey = createHmac('sha256', masterKey).update(TRACKING_LINK_HASH_CONTEXT, 'utf8').digest();

  return {
    token(purpose: 'open' | 'click', id: string): string {
      if (!id.trim()) throw new Error('Tracking-ID fehlt');
      return createHmac('sha256', tokenKey)
        .update(`${purpose}:${id}`, 'utf8')
        .digest('base64url');
    },
    tokenHash(token: string): string {
      return createHash('sha256').update(token, 'utf8').digest('hex');
    },
    dedupeHash(value: string): string {
      return createHmac('sha256', tokenKey).update(value, 'utf8').digest('hex');
    },
    targetHash(value: string): string {
      return createHmac('sha256', linkHashKey).update(value, 'utf8').digest('hex');
    },
    sealJson(value: unknown, associatedData: string): SealedTrackingJson {
      const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
      if (plaintext.byteLength > MAX_SEALED_JSON_BYTES) {
        throw new Error('Tracking-Metadaten sind zu gross');
      }
      const nonce = randomBytes(AES_GCM_NONCE_BYTES);
      const cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce);
      cipher.setAAD(associatedDataBuffer(associatedData));
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return { ciphertext, nonce, authTag: cipher.getAuthTag() };
    },
    openJson(envelope: SealedTrackingJson, associatedData: string): unknown {
      if (envelope.nonce.byteLength !== AES_GCM_NONCE_BYTES) {
        throw new Error('Tracking-Nonce ist ungueltig');
      }
      const decipher = createDecipheriv('aes-256-gcm', encryptionKey, envelope.nonce);
      decipher.setAAD(associatedDataBuffer(associatedData));
      decipher.setAuthTag(envelope.authTag);
      const plaintext = Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]);
      return JSON.parse(plaintext.toString('utf8')) as unknown;
    },
  };
}

export function normalizeEmailTrackingPolicy(input: {
  current: NormalizedEmailTrackingPolicy | null;
  values: EmailTrackingPolicyMutationInput;
  now: Date;
  encryptionAvailable: boolean;
}): NormalizedEmailTrackingPolicy {
  const current = input.current ?? {
    enabled: false,
    trackOpens: false,
    trackLinks: false,
    collectDerivedMetadata: false,
    collectRawMetadata: false,
    ipInsightsEnabled: false,
    rawMetadataRetentionDays: 7,
    eventRetentionDays: 365,
    tokenTtlDays: 730,
    legalBasis: null,
    privacyNoticeUrl: null,
    complianceAcknowledgedAt: null,
  };
  const next: NormalizedEmailTrackingPolicy = {
    ...current,
    ...(input.values.enabled === undefined ? {} : { enabled: input.values.enabled }),
    ...(input.values.trackOpens === undefined ? {} : { trackOpens: input.values.trackOpens }),
    ...(input.values.trackLinks === undefined ? {} : { trackLinks: input.values.trackLinks }),
    ...(input.values.collectDerivedMetadata === undefined ? {} : { collectDerivedMetadata: input.values.collectDerivedMetadata }),
    ...(input.values.collectRawMetadata === undefined ? {} : { collectRawMetadata: input.values.collectRawMetadata }),
    ...(input.values.ipInsightsEnabled === undefined ? {} : { ipInsightsEnabled: input.values.ipInsightsEnabled }),
    ...(input.values.rawMetadataRetentionDays === undefined ? {} : { rawMetadataRetentionDays: input.values.rawMetadataRetentionDays }),
    ...(input.values.eventRetentionDays === undefined ? {} : { eventRetentionDays: input.values.eventRetentionDays }),
    ...(input.values.tokenTtlDays === undefined ? {} : { tokenTtlDays: input.values.tokenTtlDays }),
    ...(input.values.legalBasis === undefined ? {} : { legalBasis: input.values.legalBasis }),
    ...(input.values.privacyNoticeUrl === undefined
      ? {}
      : { privacyNoticeUrl: input.values.privacyNoticeUrl?.trim() || null }),
    ...(input.values.complianceAcknowledged === undefined
      ? {}
      : { complianceAcknowledgedAt: input.values.complianceAcknowledged ? input.now.toISOString() : null }),
  };

  const materialPolicyChanged = next.enabled !== current.enabled
    || next.trackOpens !== current.trackOpens
    || next.trackLinks !== current.trackLinks
    || next.collectDerivedMetadata !== current.collectDerivedMetadata
    || next.collectRawMetadata !== current.collectRawMetadata
    || next.ipInsightsEnabled !== current.ipInsightsEnabled
    || next.rawMetadataRetentionDays !== current.rawMetadataRetentionDays
    || next.eventRetentionDays !== current.eventRetentionDays
    || next.tokenTtlDays !== current.tokenTtlDays
    || next.legalBasis !== current.legalBasis
    || next.privacyNoticeUrl !== current.privacyNoticeUrl;
  if (materialPolicyChanged && input.values.complianceAcknowledged === undefined) {
    next.complianceAcknowledgedAt = null;
  }

  assertIntegerRange(next.rawMetadataRetentionDays, 1, 30, 'Raw-Metadaten-Aufbewahrung');
  assertIntegerRange(next.eventRetentionDays, 30, 3650, 'Ereignis-Aufbewahrung');
  assertIntegerRange(next.tokenTtlDays, 1, 3650, 'Token-Laufzeit');
  if (next.collectRawMetadata && !next.collectDerivedMetadata) {
    throw new EmailTrackingPolicyValidationError('Raw-Metadaten erfordern abgeleitete Metadaten');
  }
  if (next.ipInsightsEnabled && (!next.collectDerivedMetadata || !next.collectRawMetadata)) {
    throw new EmailTrackingPolicyValidationError('IP-Insights erfordern abgeleitete und Rohmetadaten');
  }
  if (next.privacyNoticeUrl) {
    if (next.privacyNoticeUrl.length > MAX_PRIVACY_NOTICE_URL_LENGTH) {
      throw new EmailTrackingPolicyValidationError('Datenschutzhinweis-URL ist zu lang');
    }
    let privacyUrl: URL;
    try {
      privacyUrl = new URL(next.privacyNoticeUrl);
    } catch {
      throw new EmailTrackingPolicyValidationError('Datenschutzhinweis-URL ist ungueltig');
    }
    if (privacyUrl.protocol !== 'https:') {
      throw new EmailTrackingPolicyValidationError('Datenschutzhinweis-URL muss HTTPS verwenden');
    }
  }
  if (next.enabled) {
    if (!input.encryptionAvailable) {
      throw new EmailTrackingPolicyValidationError('Verschluesselung fuer E-Mail-Tracking ist nicht konfiguriert');
    }
    if (!next.trackOpens && !next.trackLinks) {
      throw new EmailTrackingPolicyValidationError('Mindestens Oeffnungs- oder Link-Tracking muss aktiviert sein');
    }
    if (!next.legalBasis) throw new EmailTrackingPolicyValidationError('Rechtsgrundlage fuer E-Mail-Tracking fehlt');
    if (!next.privacyNoticeUrl) throw new EmailTrackingPolicyValidationError('Datenschutzhinweis fuer E-Mail-Tracking fehlt');
    if (!next.complianceAcknowledgedAt) {
      throw new EmailTrackingPolicyValidationError('Datenschutz-Bestaetigung fuer E-Mail-Tracking fehlt');
    }
  }
  return next;
}

export function buildDerivedTrackingMetadata(input: {
  ip: string | null;
  userAgent: string | null;
  classificationReasons: readonly string[];
}): Readonly<Record<string, unknown>> {
  const userAgent = (input.userAgent ?? '').slice(0, 2_048);
  const ipVersion = input.ip ? isIP(input.ip) : 0;
  return {
    ipFamily: ipVersion === 4 ? 'ipv4' : ipVersion === 6 ? 'ipv6' : 'unknown',
    client: detectClient(userAgent),
    operatingSystem: detectOperatingSystem(userAgent),
    device: /(?:mobile|android|iphone|ipad)/i.test(userAgent) ? 'mobile' : 'desktop',
    classificationReasons: input.classificationReasons.slice(0, 10).map((reason) => reason.slice(0, 80)),
  };
}

export function buildStoredTrackingMetadata(input: {
  collectDerivedMetadata: boolean;
  ip?: string | null;
  userAgent?: string | null;
  classificationReasons: readonly string[];
}): Record<string, unknown> {
  if (!input.collectDerivedMetadata) return {};
  return buildDerivedTrackingMetadata({
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    classificationReasons: input.classificationReasons,
  });
}

export function effectiveTrackingTokenExpiry(input: {
  existingExpiry: Date | null;
  now: Date;
  tokenTtlDays: number;
  recovery: boolean;
}): Date {
  if (input.existingExpiry && input.recovery) return input.existingExpiry;
  return addDays(input.now, input.tokenTtlDays);
}

function associatedDataBuffer(value: string): Buffer {
  if (!value.trim() || value.length > 1_024) throw new Error('Tracking-Kontext ist ungueltig');
  return Buffer.from(value, 'utf8');
}

function assertIntegerRange(value: number, min: number, max: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new EmailTrackingPolicyValidationError(`${label} muss zwischen ${min} und ${max} liegen`);
  }
}

function detectClient(userAgent: string): string {
  if (/proofpoint/i.test(userAgent)) return 'Proofpoint';
  if (/mimecast/i.test(userAgent)) return 'Mimecast';
  if (/outlook|microsoft office/i.test(userAgent)) return 'Outlook';
  if (/edg\//i.test(userAgent)) return 'Edge';
  if (/chrome\//i.test(userAgent)) return 'Chrome';
  if (/firefox\//i.test(userAgent)) return 'Firefox';
  if (/applewebkit|safari\//i.test(userAgent)) return 'Apple WebKit';
  return 'Unbekannt';
}

function detectOperatingSystem(userAgent: string): string {
  if (/windows/i.test(userAgent)) return 'Windows';
  if (/android/i.test(userAgent)) return 'Android';
  if (/(?:iphone|ipad|ios)/i.test(userAgent)) return 'iOS';
  if (/(?:macintosh|mac os x)/i.test(userAgent)) return 'macOS';
  if (/linux/i.test(userAgent)) return 'Linux';
  return 'Unbekannt';
}

export type EmailTrackingPrepareResult = Readonly<{
  html: string | null;
  trackingMessageId: string | null;
  warning: string | null;
}>;

export type EmailTrackingService = EmailTrackingApiPort & Readonly<{
  getIpInsight(input: {
    workspaceId: string;
    actorUserId: string;
    messageId: number;
    eventId: string;
  }): Promise<EmailTrackingIpInsightRecord>;
  reclassifyMessage(input: {
    workspaceId: string;
    actorUserId: string;
    messageId: number;
  }): Promise<{ classified: number; unavailableRaw: number }>;
  prepareOutbound(input: {
    workspaceId: string;
    messageId: number;
    accountId: number;
    messageIdHeader: string;
    recipientCount: number;
    html: string | null;
    pgpProtected: boolean;
    recovery?: boolean;
  }): Promise<EmailTrackingPrepareResult>;
  recordSending(input: {
    workspaceId: string;
    messageId: number;
    trackingMessageId: string | null;
  }): Promise<void>;
  recordSmtpAccepted(input: {
    workspaceId: string;
    messageId: number;
    trackingMessageId: string | null;
    smtpCode?: number;
    acceptedRecipientCount: number;
    rejectedRecipientCount: number;
  }): Promise<void>;
  recordSmtpFailed(input: {
    workspaceId: string;
    messageId: number;
    trackingMessageId: string | null;
    stage?: string;
    smtpCode?: number;
  }): Promise<void>;
  recordInboundEvidence(input: {
    workspaceId: string;
    messageIdHeader: string;
    messageIdHeaders?: readonly string[];
    evidenceMessageId?: string | null;
    type: 'replied' | 'bounced' | 'delayed' | 'dsn_delivered' | 'mdn_displayed';
    source: string;
    confidence: 'medium' | 'high' | 'verified';
    occurredAt?: Date;
    metadata?: Readonly<Record<string, unknown>>;
  }): Promise<boolean>;
  pruneWorkspace(input: { workspaceId: string }): Promise<{
    rawMetadataCleared: number;
    trackingMessagesDeleted: number;
    expiredTokensDeleted: number;
  }>;
}>;

export type PostgresEmailTrackingServiceOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  publicBaseUrl: string;
  masterKey?: Buffer;
  emailTrackingCrypto?: TrackingCrypto;
  now?: () => Date;
  audit?: AuditApiPort;
  events?: ServerEventPort;
  emailTrackingIpIntelligence?: EmailTrackingIpIntelligencePort;
}>;

export function createPostgresEmailTrackingService(
  options: PostgresEmailTrackingServiceOptions,
): EmailTrackingService {
  const now = options.now ?? (() => new Date());
  const publicBaseUrl = normalizeTrackingBaseUrl(options.publicBaseUrl);
  const crypto = options.emailTrackingCrypto ?? (options.masterKey ? createEmailTrackingCrypto(options.masterKey) : null);

  const service: EmailTrackingService = {
    async getPolicy(input) {
      const row = await loadPolicyRow(options.db, input.workspaceId);
      return policyRecord(row ? mapPolicyRow(row) : defaultTrackingPolicy(), publicBaseUrl, row?.updated_at ?? null);
    },

    async setPolicy(input) {
      const changedAt = now();
      const result = await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, userId: input.actorUserId, role: 'admin' },
        async (trx) => {
          await lockTrackingPolicy(trx, input.workspaceId);
          const currentRow = await loadPolicyRowInTransaction(trx, input.workspaceId);
          const current = currentRow ? mapPolicyRow(currentRow) : null;
          const next = normalizeEmailTrackingPolicy({
            current,
            values: input.values,
            now: changedAt,
            encryptionAvailable: Boolean(crypto),
          });
          const row = await trx
            .insertInto('email_tracking_policies')
            .values(policyInsertValues(input.workspaceId, input.actorUserId, next, changedAt))
            .onConflict((oc) => oc.column('workspace_id').doUpdateSet({
              ...policyUpdateValues(input.actorUserId, next, changedAt),
            }))
            .returningAll()
            .executeTakeFirstOrThrow();

          if (current?.enabled && !next.enabled) {
            await revokeWorkspaceTracking(trx, input.workspaceId, changedAt);
          } else if (current?.trackOpens && !next.trackOpens) {
            await revokeWorkspaceTokenKind(trx, input.workspaceId, 'open', changedAt);
          }
          if (current?.trackLinks && !next.trackLinks) {
            await revokeWorkspaceTokenKind(trx, input.workspaceId, 'click', changedAt);
          }
          if (current?.collectDerivedMetadata && !next.collectDerivedMetadata) {
            await trx
              .updateTable('email_tracking_messages')
              .set({
                collect_derived_metadata: false,
                collect_raw_metadata: false,
                updated_at: changedAt,
              })
              .where('workspace_id', '=', input.workspaceId)
              .execute();
          } else if (current?.collectRawMetadata && !next.collectRawMetadata) {
            await trx
              .updateTable('email_tracking_messages')
              .set({ collect_raw_metadata: false, updated_at: changedAt })
              .where('workspace_id', '=', input.workspaceId)
              .execute();
          }
          if (current && next.tokenTtlDays < current.tokenTtlDays) {
            await trx
              .updateTable('email_tracking_messages')
              .set({
                token_expires_at: sql`LEAST(token_expires_at, created_at + ${next.tokenTtlDays} * INTERVAL '1 day')`,
                updated_at: changedAt,
              })
              .where('workspace_id', '=', input.workspaceId)
              .execute();
            await trx
              .updateTable('email_tracking_token_resolver')
              .set({ expires_at: sql`LEAST(expires_at, created_at + ${next.tokenTtlDays} * INTERVAL '1 day')` })
              .where('workspace_id', '=', input.workspaceId)
              .execute();
          }
          return row;
        },
      );
      await options.audit?.record({
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        action: 'email_tracking.policy_updated',
        entityType: 'email_tracking_policy',
        entityId: input.workspaceId,
        metadata: {
          enabled: result.enabled,
          trackOpens: result.track_opens,
          trackLinks: result.track_links,
          collectDerivedMetadata: result.collect_derived_metadata,
          collectRawMetadata: result.collect_raw_metadata,
        },
      });
      return policyRecord(mapPolicyRow(result), publicBaseUrl, result.updated_at);
    },

    async prepareOutbound(input) {
      if (!crypto || !input.html?.trim()) {
        return { html: input.html, trackingMessageId: null, warning: null };
      }
      if (input.pgpProtected) {
        return {
          html: input.html,
          trackingMessageId: null,
          warning: 'PGP-geschuetzte Nachrichten werden nicht nachverfolgt.',
        };
      }
      if (!Number.isSafeInteger(input.recipientCount) || input.recipientCount < 1 || input.recipientCount > 1_000) {
        return { html: input.html, trackingMessageId: null, warning: 'Ungueltige Empfaengeranzahl fuer Tracking.' };
      }
      if (Buffer.byteLength(input.html, 'utf8') > MAX_TRACKED_HTML_BYTES) {
        return {
          html: input.html,
          trackingMessageId: null,
          warning: 'E-Mail wurde wegen ihrer Groesse ohne Nachverfolgung versendet.',
        };
      }
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          await lockTrackingPolicy(trx, input.workspaceId);
          const policyRow = await loadPolicyRowInTransaction(trx, input.workspaceId);
          const policy = policyRow ? mapPolicyRow(policyRow) : defaultTrackingPolicy();
          if (!input.recovery && (!policy.enabled || (!policy.trackOpens && !policy.trackLinks))) {
            return { html: input.html, trackingMessageId: null, warning: null };
          }
          return prepareTrackedHtmlInTransaction({
            trx,
            input,
            policy,
            crypto,
            publicBaseUrl,
            now: now(),
          });
        },
      );
    },

    async recordSending(input) {
      if (!input.trackingMessageId) return;
      const occurredAt = now();
      await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        (trx) => insertTrackingEvent(trx, {
          workspaceId: input.workspaceId,
          trackingMessageId: input.trackingMessageId!,
          messageId: input.messageId,
          type: 'sending',
          source: 'smtp',
          confidence: 'none',
          automated: true,
          occurredAt,
          metadata: {},
          dedupeKey: `sending:${input.trackingMessageId}:${occurredAt.toISOString()}`,
        }),
      );
      await publishTrackingChanged(options.events, input.workspaceId, input.messageId, 'sending', occurredAt);
    },

    async recordSmtpAccepted(input) {
      if (!input.trackingMessageId) return;
      const occurredAt = now();
      await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        (trx) => insertTrackingEvent(trx, {
          workspaceId: input.workspaceId,
          trackingMessageId: input.trackingMessageId!,
          messageId: input.messageId,
          type: 'smtp_accepted',
          source: 'smtp',
          confidence: 'low',
          automated: true,
          occurredAt,
          metadata: {
            ...(input.smtpCode === undefined ? {} : { smtpCode: input.smtpCode }),
            acceptedRecipientCount: input.acceptedRecipientCount,
            rejectedRecipientCount: input.rejectedRecipientCount,
          },
          dedupeKey: `smtp_accepted:${input.trackingMessageId}`,
        }),
      );
      await publishTrackingChanged(options.events, input.workspaceId, input.messageId, 'smtp_accepted', occurredAt);
    },

    async recordSmtpFailed(input) {
      if (!input.trackingMessageId) return;
      const occurredAt = now();
      const stage = sanitizeMetadataLabel(input.stage ?? 'unknown');
      await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        (trx) => insertTrackingEvent(trx, {
          workspaceId: input.workspaceId,
          trackingMessageId: input.trackingMessageId!,
          messageId: input.messageId,
          type: 'smtp_failed',
          source: 'smtp',
          confidence: 'low',
          automated: true,
          occurredAt,
          metadata: {
            stage,
            ...(input.smtpCode === undefined ? {} : { smtpCode: input.smtpCode }),
          },
          dedupeKey: `smtp_failed:${input.trackingMessageId}:${stage}:${minuteBucket(occurredAt)}`,
        }),
      );
      await publishTrackingChanged(options.events, input.workspaceId, input.messageId, 'smtp_failed', occurredAt);
    },

    async recordPublicOpen(input) {
      if (!crypto) return;
      const resolver = await resolvePublicToken(options.db, crypto, input.token, 'open', now());
      if (!resolver) return;
      await recordPublicInteraction({
        db: options.db,
        crypto,
        resolver,
        request: input,
        interaction: 'open',
        now: now(),
        ipIntelligence: options.emailTrackingIpIntelligence,
      });
      await publishTrackingChanged(
        options.events,
        resolver.workspaceId,
        resolver.messageId,
        'open',
        now(),
      );
    },

    async resolvePublicClick(input) {
      if (!crypto) return null;
      const resolver = await resolvePublicToken(options.db, crypto, input.token, 'click', now());
      if (!resolver?.linkId) return null;
      const link = await withWorkspaceTransaction(
        options.db,
        { workspaceId: resolver.workspaceId, role: 'system' },
        (trx) => trx
          .selectFrom('email_tracking_links')
          .select(['id', 'target_ciphertext', 'target_nonce', 'target_auth_tag'])
          .where('workspace_id', '=', resolver.workspaceId)
          .where('id', '=', resolver.linkId!)
          .where('tracking_message_id', '=', resolver.trackingMessageId)
          .executeTakeFirst(),
      );
      if (!link) return null;
      let targetUrl: string;
      try {
        const value = crypto.openJson({
          ciphertext: link.target_ciphertext,
          nonce: link.target_nonce,
          authTag: link.target_auth_tag,
        }, emailTrackingLinkAssociatedData(resolver.workspaceId, resolver.trackingMessageId, link.id));
        if (!value || typeof value !== 'object' || typeof (value as { url?: unknown }).url !== 'string') return null;
        targetUrl = (value as { url: string }).url;
      } catch {
        return null;
      }
      void recordPublicInteraction({
        db: options.db,
        crypto,
        resolver,
        request: input,
        interaction: 'click',
        now: now(),
        ipIntelligence: options.emailTrackingIpIntelligence,
      }).then(() => publishTrackingChanged(
        options.events,
        resolver.workspaceId,
        resolver.messageId,
        'click',
        now(),
      )).catch((error) => {
        console.warn(`[email-tracking] click evidence could not be recorded for message ${resolver.messageId}: ${error instanceof Error ? error.message : String(error)}`);
      });
      return { targetUrl };
    },

    async getTimeline(input) {
      return loadTrackingTimeline(
        options.db,
        crypto,
        input.workspaceId,
        input.messageId,
        input.includeSensitive === true,
      );
    },

    async getIpInsight(input) {
      let insight: EmailTrackingIpInsightRecord;
      try {
        insight = await loadTrackingIpInsight({
          db: options.db,
          crypto,
          ipIntelligence: options.emailTrackingIpIntelligence,
          now,
          ...input,
        });
      } catch (caught) {
        await recordTrackingIpInsightAudit(
          options.audit,
          input,
          'email_tracking.ip_insight_denied',
          trackingIpInsightAuditOutcome(caught),
        );
        throw caught;
      }
      await recordTrackingIpInsightAudit(options.audit, input, 'email_tracking.ip_insight_accessed', 'success');
      return insight;
    },

    async reclassifyMessage(input) {
      const result = await reclassifyTrackingMessage({
        db: options.db,
        crypto,
        ipIntelligence: options.emailTrackingIpIntelligence,
        now: now(),
        ...input,
      });
      await options.audit?.record({
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        action: 'email_tracking.reclassified',
        entityType: 'email_message',
        entityId: String(input.messageId),
        metadata: {
          classified: result.classified,
          unavailableRaw: result.unavailableRaw,
          classificationVersion: 2,
        },
      });
      return result;
    },

    async revokeMessage(input) {
      const occurredAt = now();
      const revoked = await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, userId: input.actorUserId, role: 'admin' },
        async (trx) => {
          const tracking = await trx
            .selectFrom('email_tracking_messages')
            .select('id')
            .where('workspace_id', '=', input.workspaceId)
            .where('message_id', '=', input.messageId)
            .executeTakeFirst();
          if (!tracking) return false;
          await trx
            .updateTable('email_tracking_messages')
            .set({ revoked_at: occurredAt, updated_at: occurredAt })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', tracking.id)
            .execute();
          await trx
            .updateTable('email_tracking_token_resolver')
            .set({ revoked_at: occurredAt })
            .where('workspace_id', '=', input.workspaceId)
            .where('tracking_message_id', '=', tracking.id)
            .execute();
          await insertTrackingEvent(trx, {
            workspaceId: input.workspaceId,
            trackingMessageId: tracking.id,
            messageId: input.messageId,
            type: 'revoked',
            source: 'manual',
            confidence: 'verified',
            automated: false,
            occurredAt,
            metadata: {},
            dedupeKey: `revoked:${tracking.id}`,
          });
          return true;
        },
      );
      if (revoked) {
        await options.audit?.record({
          workspaceId: input.workspaceId,
          actorUserId: input.actorUserId,
          action: 'email_tracking.revoked',
          entityType: 'email_message',
          entityId: String(input.messageId),
        });
        await publishTrackingChanged(options.events, input.workspaceId, input.messageId, 'revoked', occurredAt);
      }
      return revoked;
    },

    async eraseMessage(input) {
      const erased = await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, userId: input.actorUserId, role: 'admin' },
        async (trx) => {
          const row = await trx
            .deleteFrom('email_tracking_messages')
            .where('workspace_id', '=', input.workspaceId)
            .where('message_id', '=', input.messageId)
            .returning('id')
            .executeTakeFirst();
          return Boolean(row);
        },
      );
      if (erased) {
        await options.audit?.record({
          workspaceId: input.workspaceId,
          actorUserId: input.actorUserId,
          action: 'email_tracking.erased',
          entityType: 'email_message',
          entityId: String(input.messageId),
        });
      }
      return erased;
    },

    async recordInboundEvidence(input) {
      const messageIdHeaders = [...new Set([
        input.messageIdHeader,
        ...(input.messageIdHeaders ?? []),
      ].map(normalizeMessageIdHeader).filter((value): value is string => Boolean(value)))].slice(0, 50);
      if (messageIdHeaders.length === 0) return false;
      const observedAt = now();
      const occurredAt = normalizeInboundEvidenceOccurredAt(input.occurredAt, observedAt);
      const evidenceMessageId = input.evidenceMessageId
        ? normalizeMessageIdHeader(input.evidenceMessageId)
        : null;
      const result = await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const tracking = await trx
            .selectFrom('email_tracking_messages')
            .select(['id', 'message_id'])
            .where('workspace_id', '=', input.workspaceId)
            .where('message_id_header', 'in', messageIdHeaders)
            .orderBy('created_at', 'desc')
            .executeTakeFirst();
          if (!tracking) return null;
          const smtpAccepted = await trx
            .selectFrom('email_tracking_events')
            .select('occurred_at')
            .where('workspace_id', '=', input.workspaceId)
            .where('tracking_message_id', '=', tracking.id)
            .where('event_type', '=', 'smtp_accepted')
            .orderBy('occurred_at', 'desc')
            .executeTakeFirst();
          const effectiveOccurredAt = clampInboundEvidenceAfterSmtpAccepted(
            occurredAt,
            smtpAccepted ? toDate(smtpAccepted.occurred_at) : null,
            observedAt,
          );
          await insertTrackingEvent(trx, {
            workspaceId: input.workspaceId,
            trackingMessageId: tracking.id,
            messageId: Number(tracking.message_id),
            type: input.type,
            source: sanitizeMetadataLabel(input.source),
            confidence: input.confidence,
            automated: input.type !== 'replied',
            occurredAt: effectiveOccurredAt,
            metadata: sanitizeMetadataObject(input.metadata ?? {}),
            dedupeKey: evidenceMessageId && crypto
              ? crypto.dedupeHash(`inbound:${input.type}:${tracking.id}:${evidenceMessageId}`)
              : `${input.type}:${tracking.id}:${minuteBucket(effectiveOccurredAt)}`,
          });
          return { messageId: Number(tracking.message_id), occurredAt: effectiveOccurredAt };
        },
      );
      if (!result) return false;
      await publishTrackingChanged(options.events, input.workspaceId, result.messageId, input.type, result.occurredAt);
      return true;
    },

    async pruneWorkspace(input) {
      return pruneTrackingWorkspace(options.db, input.workspaceId, now());
    },
  };

  return service;
}

const TRACKING_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const TRACKING_RETENTION_INITIAL_DELAY_MS = 60 * 1000;

export function startEmailTrackingRetentionTicker(input: {
  db: Kysely<ServerDatabase>;
  service: Pick<EmailTrackingService, 'pruneWorkspace'>;
  intervalMs?: number;
  initialDelayMs?: number;
}): { stop(): void } {
  const intervalMs = positiveTickerDelay(input.intervalMs, TRACKING_RETENTION_INTERVAL_MS);
  const initialDelayMs = positiveTickerDelay(input.initialDelayMs, TRACKING_RETENTION_INITIAL_DELAY_MS);
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = (delayMs: number) => {
    timer = setTimeout(() => void tick(), delayMs);
    timer.unref?.();
  };
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const workspaceIds = await listTrackingWorkspaceIds(input.db);
      for (const workspaceId of workspaceIds) {
        if (stopped) return;
        await input.service.pruneWorkspace({ workspaceId }).catch((error) => {
          console.warn(`[email-tracking] retention failed for workspace ${workspaceId}: ${errorMessage(error)}`);
        });
      }
    } catch (error) {
      console.warn(`[email-tracking] retention scan failed: ${errorMessage(error)}`);
    } finally {
      running = false;
      if (!stopped) schedule(intervalMs);
    }
  };

  schedule(initialDelayMs);
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

async function listTrackingWorkspaceIds(db: Kysely<ServerDatabase>): Promise<string[]> {
  const rows = await withWorkspaceTransaction(
    db,
    { workspaceId: randomUUID(), role: 'system', crossWorkspaceAccess: true },
    (trx) => trx
      .selectFrom('email_tracking_policies')
      .select('workspace_id')
      .orderBy('workspace_id', 'asc')
      .execute(),
  );
  return [...new Set(rows.map((row) => row.workspace_id))];
}

function positiveTickerDelay(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 10
    ? Math.trunc(value)
    : fallback;
}

type TrackingCrypto = ReturnType<typeof createEmailTrackingCrypto>;

async function loadTrackingIpInsight(input: Readonly<{
  db: Kysely<ServerDatabase>;
  crypto: TrackingCrypto | null;
  ipIntelligence?: EmailTrackingIpIntelligencePort;
  now: () => Date;
  workspaceId: string;
  actorUserId: string;
  messageId: number;
  eventId: string;
}>): Promise<EmailTrackingIpInsightRecord> {
  const context = { workspaceId: input.workspaceId, userId: input.actorUserId, role: 'admin' as const };
  const authorized = await withWorkspaceTransaction(
    input.db,
    context,
    (trx) => loadTrackingIpInsightTarget(trx, input),
  );
  const raw = openHistoricalRequestRaw(
    input.crypto,
    authorized.event,
    input.workspaceId,
    authorized.trackingMessageId,
  );
  if (!raw?.ip) throw new EmailTrackingIpInsightRawDataUnavailableError();
  if (!input.ipIntelligence) throw new EmailTrackingIpInsightUnavailableError();

  let insight: EmailTrackingIpInsightRecord;
  try {
    insight = await input.ipIntelligence.lookup(raw.ip);
  } catch {
    throw new EmailTrackingIpInsightUnavailableError();
  }
  if (insight.scope === 'public' && input.ipIntelligence.status().state !== 'ready') {
    throw new EmailTrackingIpInsightUnavailableError();
  }

  const rechecked = await withWorkspaceTransaction(
    input.db,
    context,
    (trx) => loadTrackingIpInsightTarget(trx, input),
  );
  if (!sameTrackingIpInsightTarget(authorized, rechecked)) {
    throw new EmailTrackingIpInsightRawDataUnavailableError();
  }
  return insight;
}

type TrackingIpInsightTarget = Readonly<{
  trackingMessageId: string;
  event: Readonly<{
    id: string;
    event_type: string;
    confidence: string;
    occurred_at: Date | string;
    raw_metadata_ciphertext: Buffer;
    raw_metadata_nonce: Buffer;
    raw_metadata_auth_tag: Buffer;
    dedupe_key: string;
    created_at: Date | string;
  }>;
}>;

async function loadTrackingIpInsightTarget(
  trx: WorkspaceTransaction,
  input: Readonly<{
    workspaceId: string;
    messageId: number;
    eventId: string;
    now: () => Date;
  }>,
): Promise<TrackingIpInsightTarget> {
  const message = await trx
    .selectFrom('email_messages')
    .select('id')
    .where('workspace_id', '=', input.workspaceId)
    .where('id', '=', input.messageId)
    .executeTakeFirst();
  if (!message) throw new EmailTrackingIpInsightNotFoundError();

  const tracking = await trx
    .selectFrom('email_tracking_messages')
    .select(['id', 'collect_derived_metadata', 'collect_raw_metadata'])
    .where('workspace_id', '=', input.workspaceId)
    .where('message_id', '=', input.messageId)
    .executeTakeFirst();
  if (!tracking) throw new EmailTrackingIpInsightNotFoundError();

  const event = await trx
    .selectFrom('email_tracking_events')
    .select([
      'id', 'event_type', 'confidence', 'occurred_at',
      'raw_metadata_ciphertext', 'raw_metadata_nonce', 'raw_metadata_auth_tag', 'dedupe_key', 'created_at',
    ])
    .where('workspace_id', '=', input.workspaceId)
    .where('tracking_message_id', '=', tracking.id)
    .where('message_id', '=', input.messageId)
    .where('id', '=', input.eventId)
    .executeTakeFirst();
  if (!event) throw new EmailTrackingIpInsightNotFoundError();

  const policy = await trx
    .selectFrom('email_tracking_policies')
    .select([
      'ip_insights_enabled', 'collect_derived_metadata', 'collect_raw_metadata',
      'raw_metadata_retention_days',
    ])
    .where('workspace_id', '=', input.workspaceId)
    .executeTakeFirst();
  if (!policy
    || !policy.ip_insights_enabled
    || !policy.collect_derived_metadata
    || !policy.collect_raw_metadata) {
    throw new EmailTrackingIpInsightForbiddenError();
  }

  const rawCutoff = addDays(input.now(), -Number(policy.raw_metadata_retention_days));
  if (!tracking.collect_derived_metadata
    || !tracking.collect_raw_metadata
    || toDate(event.created_at).getTime() < rawCutoff.getTime()
    || !event.raw_metadata_ciphertext
    || !event.raw_metadata_nonce
    || !event.raw_metadata_auth_tag) {
    throw new EmailTrackingIpInsightRawDataUnavailableError();
  }
  return {
    trackingMessageId: tracking.id,
    event: {
      ...event,
      id: canonicalTrackingEventId(event.id),
      raw_metadata_ciphertext: event.raw_metadata_ciphertext,
      raw_metadata_nonce: event.raw_metadata_nonce,
      raw_metadata_auth_tag: event.raw_metadata_auth_tag,
    },
  };
}

function sameTrackingIpInsightTarget(
  initial: TrackingIpInsightTarget,
  current: TrackingIpInsightTarget,
): boolean {
  return initial.trackingMessageId === current.trackingMessageId
    && initial.event.id === current.event.id
    && initial.event.dedupe_key === current.event.dedupe_key
    && toDate(initial.event.created_at).getTime() === toDate(current.event.created_at).getTime()
    && initial.event.raw_metadata_ciphertext.equals(current.event.raw_metadata_ciphertext)
    && initial.event.raw_metadata_nonce.equals(current.event.raw_metadata_nonce)
    && initial.event.raw_metadata_auth_tag.equals(current.event.raw_metadata_auth_tag);
}

async function recordTrackingIpInsightAudit(
  audit: AuditApiPort | undefined,
  input: Readonly<{ workspaceId: string; actorUserId: string; eventId: string }>,
  action: 'email_tracking.ip_insight_accessed' | 'email_tracking.ip_insight_denied',
  outcome: 'success' | 'not_found' | 'forbidden' | 'raw_data_unavailable' | 'unavailable' | 'internal_error',
): Promise<void> {
  await audit?.record({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    action,
    entityType: 'email_tracking_event',
    entityId: input.eventId,
    metadata: { outcome },
  });
}

function trackingIpInsightAuditOutcome(
  error: unknown,
): 'not_found' | 'forbidden' | 'raw_data_unavailable' | 'unavailable' | 'internal_error' {
  if (error instanceof EmailTrackingIpInsightNotFoundError) return 'not_found';
  if (error instanceof EmailTrackingIpInsightForbiddenError) return 'forbidden';
  if (error instanceof EmailTrackingIpInsightRawDataUnavailableError) return 'raw_data_unavailable';
  if (error instanceof EmailTrackingIpInsightUnavailableError) return 'unavailable';
  return 'internal_error';
}

type PolicyRowLike = {
  enabled: boolean;
  track_opens: boolean;
  track_links: boolean;
  collect_derived_metadata: boolean;
  collect_raw_metadata: boolean;
  ip_insights_enabled: boolean;
  raw_metadata_retention_days: number;
  event_retention_days: number;
  token_ttl_days: number;
  legal_basis: 'consent' | 'legitimate_interest' | 'contract' | 'other' | null;
  privacy_notice_url: string | null;
  compliance_acknowledged_at: Date | string | null;
  updated_at: Date | string;
};

async function loadPolicyRow(db: Kysely<ServerDatabase>, workspaceId: string): Promise<PolicyRowLike | undefined> {
  return withWorkspaceTransaction(
    db,
    { workspaceId, role: 'system' },
    (trx) => loadPolicyRowInTransaction(trx, workspaceId),
  );
}

function loadPolicyRowInTransaction(
  trx: WorkspaceTransaction,
  workspaceId: string,
): Promise<PolicyRowLike | undefined> {
  return trx
    .selectFrom('email_tracking_policies')
    .select([
      'enabled', 'track_opens', 'track_links', 'collect_derived_metadata', 'collect_raw_metadata', 'ip_insights_enabled',
      'raw_metadata_retention_days', 'event_retention_days', 'token_ttl_days', 'legal_basis',
      'privacy_notice_url', 'compliance_acknowledged_at', 'updated_at',
    ])
    .where('workspace_id', '=', workspaceId)
    .executeTakeFirst();
}

async function lockTrackingPolicy(trx: WorkspaceTransaction, workspaceId: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`email_tracking_policy:${workspaceId}`}, 0))`.execute(trx);
}

function mapPolicyRow(row: PolicyRowLike): NormalizedEmailTrackingPolicy {
  return {
    enabled: Boolean(row.enabled),
    trackOpens: Boolean(row.track_opens),
    trackLinks: Boolean(row.track_links),
    collectDerivedMetadata: Boolean(row.collect_derived_metadata),
    collectRawMetadata: Boolean(row.collect_raw_metadata),
    ipInsightsEnabled: Boolean(row.ip_insights_enabled),
    rawMetadataRetentionDays: Number(row.raw_metadata_retention_days),
    eventRetentionDays: Number(row.event_retention_days),
    tokenTtlDays: Number(row.token_ttl_days),
    legalBasis: row.legal_basis,
    privacyNoticeUrl: row.privacy_notice_url,
    complianceAcknowledgedAt: timestampToIso(row.compliance_acknowledged_at),
  };
}

function defaultTrackingPolicy(): NormalizedEmailTrackingPolicy {
  return {
    enabled: false,
    trackOpens: false,
    trackLinks: false,
    collectDerivedMetadata: false,
    collectRawMetadata: false,
    ipInsightsEnabled: false,
    rawMetadataRetentionDays: 7,
    eventRetentionDays: 365,
    tokenTtlDays: 730,
    legalBasis: null,
    privacyNoticeUrl: null,
    complianceAcknowledgedAt: null,
  };
}

function policyRecord(
  policy: NormalizedEmailTrackingPolicy,
  publicBaseUrl: string,
  updatedAt: Date | string | null,
): EmailTrackingPolicyRecord {
  return { ...policy, publicBaseUrl, updatedAt: timestampToIso(updatedAt) };
}

function policyInsertValues(
  workspaceId: string,
  actorUserId: string,
  policy: NormalizedEmailTrackingPolicy,
  now: Date,
) {
  return {
    workspace_id: workspaceId,
    ...policyUpdateValues(actorUserId, policy, now),
    created_at: now,
  };
}

function policyUpdateValues(actorUserId: string, policy: NormalizedEmailTrackingPolicy, now: Date) {
  return {
    enabled: policy.enabled,
    track_opens: policy.trackOpens,
    track_links: policy.trackLinks,
    collect_derived_metadata: policy.collectDerivedMetadata,
    collect_raw_metadata: policy.collectRawMetadata,
    ip_insights_enabled: policy.ipInsightsEnabled,
    raw_metadata_retention_days: policy.rawMetadataRetentionDays,
    event_retention_days: policy.eventRetentionDays,
    token_ttl_days: policy.tokenTtlDays,
    legal_basis: policy.legalBasis,
    privacy_notice_url: policy.privacyNoticeUrl,
    compliance_acknowledged_at: policy.complianceAcknowledgedAt,
    updated_by_user_id: actorUserId,
    updated_at: now,
  };
}

async function prepareTrackedHtmlInTransaction(input: {
  trx: WorkspaceTransaction;
  input: {
    workspaceId: string;
    messageId: number;
    accountId: number;
    messageIdHeader: string;
    recipientCount: number;
    html: string | null;
    recovery?: boolean;
  };
  policy: NormalizedEmailTrackingPolicy;
  crypto: TrackingCrypto;
  publicBaseUrl: string;
  now: Date;
}): Promise<EmailTrackingPrepareResult> {
  const message = await input.trx
    .selectFrom('email_messages')
    .select(['id', 'account_id'])
    .where('workspace_id', '=', input.input.workspaceId)
    .where('id', '=', input.input.messageId)
    .executeTakeFirst();
  if (!message || Number(message.account_id) !== input.input.accountId) {
    return { html: input.input.html, trackingMessageId: null, warning: 'Tracking-Nachricht konnte nicht zugeordnet werden.' };
  }

  const existing = await input.trx
    .selectFrom('email_tracking_messages')
    .selectAll()
    .where('workspace_id', '=', input.input.workspaceId)
    .where('message_id', '=', input.input.messageId)
    .executeTakeFirst();
  if (input.input.recovery && !existing) {
    return { html: input.input.html, trackingMessageId: null, warning: null };
  }
  if (!input.input.recovery && existing?.revoked_at) {
    return { html: input.input.html, trackingMessageId: null, warning: 'Tracking fuer diesen Versand ist widerrufen.' };
  }

  const created = !existing;
  const trackingId = existing?.id ?? randomUUID();
  const expiresAt = effectiveTrackingTokenExpiry({
    existingExpiry: existing?.token_expires_at ? toDate(existing.token_expires_at) : null,
    now: input.now,
    tokenTtlDays: input.policy.tokenTtlDays,
    recovery: input.input.recovery === true,
  });
  const existingFlags = existing ? {
      trackOpens: Boolean(existing.track_opens),
      trackLinks: Boolean(existing.track_links),
      collectDerivedMetadata: Boolean(existing.collect_derived_metadata),
      collectRawMetadata: Boolean(existing.collect_raw_metadata),
    } : null;
  const flags = existingFlags
    ? input.input.recovery ? existingFlags : effectiveRetryTrackingFlags(existingFlags, input.policy)
    : input.policy;
  if (!flags.trackOpens && !flags.trackLinks) {
    return {
      html: input.input.html,
      trackingMessageId: null,
      warning: 'Die fuer diesen Versand vorbereiteten Tracking-Signale sind nicht mehr aktiv.',
    };
  }

  if (created) {
    await input.trx
      .insertInto('email_tracking_messages')
      .values({
        id: trackingId,
        workspace_id: input.input.workspaceId,
        message_id: input.input.messageId,
        account_id: input.input.accountId,
        message_id_header: normalizeMessageIdHeader(input.input.messageIdHeader),
        recipient_count: input.input.recipientCount,
        track_opens: flags.trackOpens,
        track_links: flags.trackLinks,
        collect_derived_metadata: flags.collectDerivedMetadata,
        collect_raw_metadata: flags.collectRawMetadata,
        token_expires_at: expiresAt,
        revoked_at: null,
        policy_snapshot: {
          legalBasis: input.policy.legalBasis,
          privacyNoticeUrl: input.policy.privacyNoticeUrl,
          complianceAcknowledgedAt: input.policy.complianceAcknowledgedAt,
          eventRetentionDays: input.policy.eventRetentionDays,
          rawMetadataRetentionDays: input.policy.rawMetadataRetentionDays,
        },
        created_at: input.now,
        updated_at: input.now,
      })
      .execute();
  } else if (!input.input.recovery) {
    await input.trx
      .updateTable('email_tracking_messages')
      .set({
        recipient_count: input.input.recipientCount,
        token_expires_at: expiresAt,
        updated_at: input.now,
      })
      .where('workspace_id', '=', input.input.workspaceId)
      .where('id', '=', trackingId)
      .execute();
    await input.trx
      .updateTable('email_tracking_token_resolver')
      .set({ expires_at: expiresAt })
      .where('workspace_id', '=', input.input.workspaceId)
      .where('tracking_message_id', '=', trackingId)
      .execute();
    await input.trx
      .updateTable('email_tracking_events')
      .set({ metadata_json: { recipientCount: input.input.recipientCount } })
      .where('workspace_id', '=', input.input.workspaceId)
      .where('tracking_message_id', '=', trackingId)
      .where('event_type', '=', 'queued')
      .execute();
  }

  const existingLinks = await input.trx
    .selectFrom('email_tracking_links')
    .select(['id', 'ordinal', 'target_url_hash'])
    .where('workspace_id', '=', input.input.workspaceId)
    .where('tracking_message_id', '=', trackingId)
    .orderBy('ordinal', 'asc')
    .execute();
  const pendingLinks: Array<{ id: string; ordinal: number; targetUrl: string; targetUrlHash: string }> = [];
  let mismatch = false;
  const result = instrumentEmailHtml({
    html: input.input.html ?? '',
    openPixelUrl: flags.trackOpens
      ? trackingUrl(input.publicBaseUrl, `/t/o/${input.crypto.token('open', trackingId)}.gif`)
      : null,
    trackingBaseUrl: input.publicBaseUrl,
    createClickUrl: flags.trackLinks
      ? ({ ordinal, targetUrl }) => {
        const targetUrlHash = input.crypto.targetHash(targetUrl);
        const existingLink = existingLinks.find((link) => Number(link.ordinal) === ordinal);
        if (existingLink) {
          if (existingLink.target_url_hash !== targetUrlHash) mismatch = true;
          return trackingUrl(input.publicBaseUrl, `/t/c/${input.crypto.token('click', existingLink.id)}`);
        }
        if (!created) {
          mismatch = true;
          return targetUrl;
        }
        const id = randomUUID();
        pendingLinks.push({ id, ordinal, targetUrl, targetUrlHash });
        return trackingUrl(input.publicBaseUrl, `/t/c/${input.crypto.token('click', id)}`);
      }
      : undefined,
  });
  if (retryLinkCountMismatch({
    created,
    trackLinks: flags.trackLinks,
    trackedLinkCount: result.trackedLinks.length,
    existingLinkCount: existingLinks.length,
  })) mismatch = true;
  if (mismatch) {
    if (!created && !input.input.recovery) {
      await input.trx
        .deleteFrom('email_tracking_messages')
        .where('workspace_id', '=', input.input.workspaceId)
        .where('id', '=', trackingId)
        .execute();
    }
    return {
      html: input.input.html,
      trackingMessageId: null,
      warning: 'Tracking wurde ausgelassen, weil sich Linkziele nach einem frueheren Versandversuch geaendert haben.',
    };
  }

  if (!created && !input.input.recovery && flags.trackLinks) {
    for (const link of existingLinks) {
      const token = input.crypto.token('click', link.id);
      await insertTokenResolver(input.trx, {
        tokenHash: input.crypto.tokenHash(token),
        workspaceId: input.input.workspaceId,
        trackingMessageId: trackingId,
        linkId: link.id,
        kind: 'click',
        expiresAt,
        createdAt: input.now,
      });
    }
  }

  for (const link of pendingLinks) {
    const token = input.crypto.token('click', link.id);
    const sealed = input.crypto.sealJson(
      { url: link.targetUrl },
      emailTrackingLinkAssociatedData(input.input.workspaceId, trackingId, link.id),
    );
    await input.trx
      .insertInto('email_tracking_links')
      .values({
        id: link.id,
        workspace_id: input.input.workspaceId,
        tracking_message_id: trackingId,
        ordinal: link.ordinal,
        token_hash: input.crypto.tokenHash(token),
        target_ciphertext: sealed.ciphertext,
        target_nonce: sealed.nonce,
        target_auth_tag: sealed.authTag,
        target_url_hash: link.targetUrlHash,
        created_at: input.now,
      })
      .execute();
    await insertTokenResolver(input.trx, {
      tokenHash: input.crypto.tokenHash(token),
      workspaceId: input.input.workspaceId,
      trackingMessageId: trackingId,
      linkId: link.id,
      kind: 'click',
      expiresAt,
      createdAt: input.now,
    });
  }
  if (flags.trackOpens) {
    const token = input.crypto.token('open', trackingId);
    await insertTokenResolver(input.trx, {
      tokenHash: input.crypto.tokenHash(token),
      workspaceId: input.input.workspaceId,
      trackingMessageId: trackingId,
      linkId: null,
      kind: 'open',
      expiresAt,
      createdAt: input.now,
    });
  }
  await insertTrackingEvent(input.trx, {
    workspaceId: input.input.workspaceId,
    trackingMessageId: trackingId,
    messageId: input.input.messageId,
    type: 'queued',
    source: 'compose',
    confidence: 'none',
    automated: true,
    occurredAt: input.now,
    metadata: { recipientCount: input.input.recipientCount },
    dedupeKey: `queued:${trackingId}`,
  });
  return {
    html: result.html,
    trackingMessageId: trackingId,
    warning: input.input.recipientCount > 1
      ? 'Tracking-Ereignisse werden bei mehreren Empfaengern nur zusammengefasst angezeigt.'
      : null,
  };
}

async function insertTokenResolver(trx: WorkspaceTransaction, input: {
  tokenHash: string;
  workspaceId: string;
  trackingMessageId: string;
  linkId: string | null;
  kind: 'open' | 'click';
  expiresAt: Date;
  createdAt: Date;
}): Promise<void> {
  await trx
    .insertInto('email_tracking_token_resolver')
    .values({
      token_hash: input.tokenHash,
      workspace_id: input.workspaceId,
      tracking_message_id: input.trackingMessageId,
      link_id: input.linkId,
      token_kind: input.kind,
      expires_at: input.expiresAt,
      revoked_at: null,
      created_at: input.createdAt,
    })
    .onConflict((oc) => oc.column('token_hash').doNothing())
    .execute();
}

type InsertEventInput = {
  workspaceId: string;
  trackingMessageId: string;
  messageId: number;
  linkId?: string | null;
  type: EmailEvidenceEventType;
  source: string;
  confidence: EmailEvidenceConfidence;
  automated: boolean;
  occurredAt: Date;
  metadata: Readonly<Record<string, unknown>>;
  raw?: SealedTrackingJson | null;
  dedupeKey: string;
};

async function insertTrackingEvent(
  trx: WorkspaceTransaction,
  input: InsertEventInput,
  classification?: EmailEvidenceClassification,
): Promise<void> {
  const insert = trx
    .insertInto('email_tracking_events')
    .values({
      workspace_id: input.workspaceId,
      tracking_message_id: input.trackingMessageId,
      message_id: input.messageId,
      link_id: input.linkId ?? null,
      event_type: input.type,
      source: sanitizeMetadataLabel(input.source),
      confidence: input.confidence,
      automated: input.automated,
      occurred_at: input.occurredAt,
      metadata_json: sanitizeMetadataObject(input.metadata),
      raw_metadata_ciphertext: input.raw?.ciphertext ?? null,
      raw_metadata_nonce: input.raw?.nonce ?? null,
      raw_metadata_auth_tag: input.raw?.authTag ?? null,
      dedupe_key: input.dedupeKey,
      created_at: input.occurredAt,
    })
    .onConflict((oc) => oc.columns(['workspace_id', 'dedupe_key']).doNothing());
  if (!classification) {
    await insert.execute();
    return;
  }
  const event = await insert.returning('id').executeTakeFirst();
  if (!event) return;
  await trx
    .insertInto('email_tracking_event_classifications')
    .values({
      event_id: canonicalTrackingEventId(event.id),
      classification_version: classification.version,
      actor_class: classification.actorClass,
      confidence: classification.confidence,
      reasons_json: classification.reasons.slice(0, 10).map((reason) => sanitizeMetadataLabel(reason)),
      classified_at: input.occurredAt,
    })
    .execute();
}

type PublicResolver = {
  workspaceId: string;
  trackingMessageId: string;
  messageId: number;
  linkId: string | null;
  collectDerivedMetadata: boolean;
  collectRawMetadata: boolean;
};

async function resolvePublicToken(
  db: Kysely<ServerDatabase>,
  crypto: TrackingCrypto,
  token: string,
  kind: 'open' | 'click',
  now: Date,
): Promise<PublicResolver | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const tokenHash = crypto.tokenHash(token);
  const resolver = await db.transaction().execute(async (trx) => {
    await sql`SELECT set_config('app.email_tracking_token_hash', ${tokenHash}, true)`.execute(trx);
    return trx
      .selectFrom('email_tracking_token_resolver')
      .select(['workspace_id', 'tracking_message_id', 'link_id', 'token_kind', 'expires_at', 'revoked_at'])
      .where('token_hash', '=', tokenHash)
      .executeTakeFirst();
  });
  if (
    !resolver
    || resolver.token_kind !== kind
    || resolver.revoked_at
    || toDate(resolver.expires_at).getTime() <= now.getTime()
  ) return null;
  return withWorkspaceTransaction(
    db,
    { workspaceId: resolver.workspace_id, role: 'system' },
    async (trx) => {
      const tracking = await trx
        .selectFrom('email_tracking_messages')
        .select(['message_id', 'revoked_at', 'token_expires_at', 'collect_derived_metadata', 'collect_raw_metadata'])
        .where('workspace_id', '=', resolver.workspace_id)
        .where('id', '=', resolver.tracking_message_id)
        .executeTakeFirst();
      if (!tracking || tracking.revoked_at || toDate(tracking.token_expires_at).getTime() <= now.getTime()) return null;
      return {
        workspaceId: resolver.workspace_id,
        trackingMessageId: resolver.tracking_message_id,
        messageId: Number(tracking.message_id),
        linkId: resolver.link_id,
        collectDerivedMetadata: Boolean(tracking.collect_derived_metadata),
        collectRawMetadata: Boolean(tracking.collect_raw_metadata),
      };
    },
  );
}

async function recordPublicInteraction(input: {
  db: Kysely<ServerDatabase>;
  crypto: TrackingCrypto;
  resolver: PublicResolver;
  request: EmailTrackingPublicRequest;
  interaction: 'open' | 'click';
  now: Date;
  ipIntelligence?: EmailTrackingIpIntelligencePort;
}): Promise<void> {
  const precheck = await preparePublicInteraction({
    db: input.db,
    workspaceId: input.resolver.workspaceId,
    trackingMessageId: input.resolver.trackingMessageId,
    collectDerivedMetadata: input.resolver.collectDerivedMetadata,
    requestIp: input.request.ip,
    ipIntelligence: input.ipIntelligence,
  });
  if (precheck.atCapacity) return;
  await withWorkspaceTransaction(
    input.db,
    { workspaceId: input.resolver.workspaceId, role: 'system' },
    async (trx) => {
      await lockTrackingPolicy(trx, input.resolver.workspaceId);
      await sql`SELECT pg_advisory_xact_lock(hashtext(${input.resolver.trackingMessageId}))`.execute(trx);
      const policy = await trx
        .selectFrom('email_tracking_policies')
        .select(['ip_insights_enabled', 'collect_derived_metadata'])
        .where('workspace_id', '=', input.resolver.workspaceId)
        .executeTakeFirst();
      const allowedNetworkContext = input.resolver.collectDerivedMetadata
        && policy?.ip_insights_enabled
        && policy.collect_derived_metadata
        ? precheck.networkContext
        : null;
      const accepted = await trx
        .selectFrom('email_tracking_events')
        .select('occurred_at')
        .where('workspace_id', '=', input.resolver.workspaceId)
        .where('tracking_message_id', '=', input.resolver.trackingMessageId)
        .where('event_type', '=', 'smtp_accepted')
        .orderBy('occurred_at', 'desc')
        .executeTakeFirst();
      const atCapacity = await publicInteractionAtCapacity(
        trx,
        input.resolver.workspaceId,
        input.resolver.trackingMessageId,
      );
      if (atCapacity) return;
      const secondsSinceSmtpAccepted = accepted
        ? Math.max(0, (input.now.getTime() - toDate(accepted.occurred_at).getTime()) / 1_000)
        : null;
      const classification = classifyEmailTrackingRequest({
        userAgent: input.request.userAgent,
        requestIp: input.request.ip,
        secondsSinceSmtpAccepted,
        requestHeaders: input.request.headers,
        interaction: input.interaction,
        networkContext: allowedNetworkContext,
      });
      const dedupeBucket = Math.floor(input.now.getTime() / 10_000);
      const dedupeKeyForBucket = (bucket: number) => input.crypto.dedupeHash([
        classification.eventType,
        input.resolver.trackingMessageId,
        input.resolver.linkId ?? '',
        input.request.ip ?? '',
        bucket,
      ].join(':'));
      const dedupeKey = dedupeKeyForBucket(dedupeBucket);
      const dedupeCutoff = new Date(input.now.getTime() - 10_000);
      const recentDuplicate = await trx
        .selectFrom('email_tracking_events')
        .select('occurred_at')
        .where('workspace_id', '=', input.resolver.workspaceId)
        .where('tracking_message_id', '=', input.resolver.trackingMessageId)
        .where('dedupe_key', 'in', [dedupeKey, dedupeKeyForBucket(dedupeBucket - 1)])
        .where('occurred_at', '>=', dedupeCutoff)
        .orderBy('occurred_at', 'desc')
        .executeTakeFirst();
      if (
        recentDuplicate
        && input.now.getTime() - toDate(recentDuplicate.occurred_at).getTime() < 10_000
      ) return;
      const metadata = buildStoredTrackingMetadata({
        collectDerivedMetadata: input.resolver.collectDerivedMetadata,
        ip: input.request.ip,
        userAgent: input.request.userAgent,
        classificationReasons: classification.reasons,
      });
      const raw = input.resolver.collectRawMetadata
        ? input.crypto.sealJson({
          ip: input.request.ip?.slice(0, 64) ?? null,
          userAgent: input.request.userAgent?.slice(0, 2_048) ?? null,
        }, emailTrackingEventAssociatedData(input.resolver.workspaceId, input.resolver.trackingMessageId, dedupeKey))
        : null;
      await insertTrackingEvent(trx, {
        workspaceId: input.resolver.workspaceId,
        trackingMessageId: input.resolver.trackingMessageId,
        messageId: input.resolver.messageId,
        linkId: input.resolver.linkId,
        type: classification.eventType,
        source: 'public_tracking_endpoint',
        confidence: classification.confidence,
        automated: classification.automated,
        occurredAt: input.now,
        metadata,
        raw,
        dedupeKey,
      }, classification);
    },
  );
}

async function preparePublicInteraction(input: Readonly<{
  db: Kysely<ServerDatabase>;
  workspaceId: string;
  trackingMessageId: string;
  collectDerivedMetadata: boolean;
  requestIp?: string | null;
  ipIntelligence?: EmailTrackingIpIntelligencePort;
}>): Promise<Readonly<{
  atCapacity: boolean;
  networkContext: EmailTrackingNetworkContext | null;
}>> {
  const requestIp = input.requestIp?.trim();
  const precheck = await withWorkspaceTransaction(
    input.db,
    { workspaceId: input.workspaceId, role: 'system' },
    async (trx) => {
      const policy = await trx
        .selectFrom('email_tracking_policies')
        .select(['ip_insights_enabled', 'collect_derived_metadata'])
        .where('workspace_id', '=', input.workspaceId)
        .executeTakeFirst();
      const atCapacity = await publicInteractionAtCapacity(
        trx,
        input.workspaceId,
        input.trackingMessageId,
      );
      return {
        atCapacity,
        insightsEnabled: Boolean(
          input.collectDerivedMetadata
          && policy?.ip_insights_enabled
          && policy.collect_derived_metadata,
        ),
      };
    },
  );
  if (precheck.atCapacity) return { atCapacity: true, networkContext: null };
  if (!precheck.insightsEnabled || !requestIp || !input.ipIntelligence) {
    return { atCapacity: false, networkContext: null };
  }
  try {
    const insight = await input.ipIntelligence.lookup(requestIp);
    if (input.ipIntelligence.status().state !== 'ready') {
      return { atCapacity: false, networkContext: null };
    }
    return { atCapacity: false, networkContext: emailTrackingNetworkContext(insight) };
  } catch {
    return { atCapacity: false, networkContext: null };
  }
}

async function publicInteractionAtCapacity(
  trx: WorkspaceTransaction,
  workspaceId: string,
  trackingMessageId: string,
): Promise<boolean> {
  const atCapacity = await trx
    .selectFrom('email_tracking_events')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('tracking_message_id', '=', trackingMessageId)
    .where('event_type', 'in', ['open_automated', 'open_probable', 'click_automated', 'click'])
    .orderBy('id', 'asc')
    .offset(MAX_PUBLIC_EVENTS_PER_TRACKING_MESSAGE - 1)
    .limit(1)
    .executeTakeFirst();
  return Boolean(atCapacity);
}

type HistoricalTrackingEventRow = Readonly<{
  id: string;
  event_type: string;
  confidence: string;
  occurred_at: Date | string;
  raw_metadata_ciphertext: Buffer | null;
  raw_metadata_nonce: Buffer | null;
  raw_metadata_auth_tag: Buffer | null;
  dedupe_key: string;
  created_at: Date | string;
}>;

type PreparedHistoricalClassification = Readonly<{
  eventId: string;
  base: EmailEvidenceClassification;
  withNetworkContext: EmailEvidenceClassification | null;
  unavailableRaw: boolean;
  rawEnvelope: Readonly<{
    ciphertext: Buffer;
    nonce: Buffer;
    authTag: Buffer;
    dedupeKey: string;
  }> | null;
}>;

async function reclassifyTrackingMessage(input: Readonly<{
  db: Kysely<ServerDatabase>;
  crypto: TrackingCrypto | null;
  ipIntelligence?: EmailTrackingIpIntelligencePort;
  now: Date;
  workspaceId: string;
  actorUserId: string;
  messageId: number;
}>): Promise<{ classified: number; unavailableRaw: number }> {
  const context = {
    workspaceId: input.workspaceId,
    userId: input.actorUserId,
    role: 'admin' as const,
  };
  const target = await withWorkspaceTransaction(input.db, context, async (trx) => {
    const message = await trx
      .selectFrom('email_messages')
      .select('id')
      .where('workspace_id', '=', input.workspaceId)
      .where('id', '=', input.messageId)
      .executeTakeFirst();
    if (!message) throw new EmailTrackingMessageNotFoundError();
    const tracking = await trx
      .selectFrom('email_tracking_messages')
      .select(['id', 'collect_derived_metadata'])
      .where('workspace_id', '=', input.workspaceId)
      .where('message_id', '=', input.messageId)
      .executeTakeFirst();
    if (!tracking) return null;
    const accepted = await trx
      .selectFrom('email_tracking_events')
      .select('occurred_at')
      .where('workspace_id', '=', input.workspaceId)
      .where('tracking_message_id', '=', tracking.id)
      .where('event_type', '=', 'smtp_accepted')
      .orderBy('occurred_at', 'desc')
      .executeTakeFirst();
    return {
      trackingMessageId: tracking.id,
      smtpAcceptedAt: accepted ? toDate(accepted.occurred_at) : null,
    };
  });
  if (!target) return { classified: 0, unavailableRaw: 0 };

  let afterEventId = '0';
  let classified = 0;
  let unavailableRaw = 0;
  while (true) {
    const page = await withWorkspaceTransaction(input.db, context, async (trx) => {
      const tracking = await trx
        .selectFrom('email_tracking_messages')
        .select('collect_derived_metadata')
        .where('workspace_id', '=', input.workspaceId)
        .where('id', '=', target.trackingMessageId)
        .executeTakeFirst();
      const policy = await trx
        .selectFrom('email_tracking_policies')
        .select(['ip_insights_enabled', 'collect_derived_metadata', 'raw_metadata_retention_days'])
        .where('workspace_id', '=', input.workspaceId)
        .executeTakeFirst();
      const rows = await trx
        .selectFrom('email_tracking_events')
        .select([
          'id', 'event_type', 'confidence', 'occurred_at',
          'raw_metadata_ciphertext', 'raw_metadata_nonce', 'raw_metadata_auth_tag', 'dedupe_key',
          'created_at',
        ])
        .where('workspace_id', '=', input.workspaceId)
        .where('tracking_message_id', '=', target.trackingMessageId)
        .where('id', '>', afterEventId)
        .orderBy('id', 'asc')
        .limit(EMAIL_TRACKING_RECLASSIFICATION_PAGE_SIZE)
        .execute();
      return {
        rows,
        allowNetworkContext: Boolean(
          tracking?.collect_derived_metadata
          && policy?.collect_derived_metadata
          && policy.ip_insights_enabled,
        ),
        rawCutoff: addDays(input.now, -(Number(policy?.raw_metadata_retention_days ?? 7))),
      };
    });
    if (page.rows.length === 0) break;

    const prepared = await classifyHistoricalTrackingPage({
      rows: page.rows.map((row) => logicallyRetainedHistoricalRow(
        { ...row, id: canonicalTrackingEventId(row.id) },
        page.rawCutoff,
      )),
      workspaceId: input.workspaceId,
      trackingMessageId: target.trackingMessageId,
      smtpAcceptedAt: target.smtpAcceptedAt,
      allowNetworkContext: page.allowNetworkContext,
      crypto: input.crypto,
      ipIntelligence: input.ipIntelligence,
    });
    const upserted = await withWorkspaceTransaction(input.db, context, async (trx) => {
      await lockTrackingPolicy(trx, input.workspaceId);
      const tracking = await trx
        .selectFrom('email_tracking_messages')
        .select('collect_derived_metadata')
        .where('workspace_id', '=', input.workspaceId)
        .where('id', '=', target.trackingMessageId)
        .executeTakeFirst();
      const policy = await trx
        .selectFrom('email_tracking_policies')
        .select(['ip_insights_enabled', 'collect_derived_metadata', 'raw_metadata_retention_days'])
        .where('workspace_id', '=', input.workspaceId)
        .executeTakeFirst();
      const allowNetworkContext = Boolean(
        tracking?.collect_derived_metadata
        && policy?.collect_derived_metadata
        && policy.ip_insights_enabled,
      );
      const rawCutoff = addDays(input.now, -(Number(policy?.raw_metadata_retention_days ?? 7)));
      const lockedEvents = await trx
        .selectFrom('email_tracking_events')
        .select([
          'id', 'event_type', 'confidence', 'occurred_at',
          'raw_metadata_ciphertext', 'raw_metadata_nonce', 'raw_metadata_auth_tag', 'dedupe_key',
          'created_at',
        ])
        .where('workspace_id', '=', input.workspaceId)
        .where('tracking_message_id', '=', target.trackingMessageId)
        .where('id', 'in', prepared.map((item) => item.eventId))
        .orderBy('id', 'asc')
        .forUpdate()
        .execute();
      const preparedByEventId = new Map(prepared.map((item) => [item.eventId, item]));
      const finalized = lockedEvents.flatMap((event) => {
        const eventId = canonicalTrackingEventId(event.id);
        const item = preparedByEventId.get(eventId);
        if (!item) return [];
        const normalizedEvent = { ...event, id: eventId };
        const fallback = item.rawEnvelope && !historicalRawEnvelopeMatches(
          item.rawEnvelope,
          normalizedEvent,
          rawCutoff,
        )
          ? historicalRawUnavailableClassification(normalizedEvent)
          : null;
        const classification = fallback?.base ?? (allowNetworkContext
          ? item.withNetworkContext ?? item.base
          : item.base);
        return [{ item, classification, unavailableRaw: fallback?.unavailableRaw ?? item.unavailableRaw }];
      });
      const rows = finalized.map(({ item, classification }) => {
        return {
          event_id: item.eventId,
          classification_version: classification.version,
          actor_class: classification.actorClass,
          confidence: classification.confidence,
          reasons_json: classification.reasons
            .slice(0, 10)
            .map((reason) => sanitizeMetadataLabel(reason)),
          classified_at: input.now,
        };
      });
      if (rows.length > 0) {
        await trx
          .insertInto('email_tracking_event_classifications')
          .values(rows)
          .onConflict((oc) => oc
            .columns(['event_id', 'classification_version'])
            .doUpdateSet((eb) => ({
              actor_class: eb.ref('excluded.actor_class'),
              confidence: eb.ref('excluded.confidence'),
              reasons_json: eb.ref('excluded.reasons_json'),
              classified_at: eb.ref('excluded.classified_at'),
            })))
          .execute();
      }
      return {
        classified: rows.length,
        unavailableRaw: finalized.filter((item) => item.unavailableRaw).length,
      };
    });

    classified += upserted.classified;
    unavailableRaw += upserted.unavailableRaw;
    afterEventId = prepared[prepared.length - 1]!.eventId;
    if (page.rows.length < EMAIL_TRACKING_RECLASSIFICATION_PAGE_SIZE) break;
  }
  return { classified, unavailableRaw };
}

async function classifyHistoricalTrackingPage(input: Readonly<{
  rows: readonly HistoricalTrackingEventRow[];
  workspaceId: string;
  trackingMessageId: string;
  smtpAcceptedAt: Date | null;
  allowNetworkContext: boolean;
  crypto: TrackingCrypto | null;
  ipIntelligence?: EmailTrackingIpIntelligencePort;
}>): Promise<PreparedHistoricalClassification[]> {
  const prepared: PreparedHistoricalClassification[] = [];
  for (const row of input.rows) {
    prepared.push(await classifyHistoricalTrackingEvent({ ...input, row }));
  }
  return prepared;
}

async function classifyHistoricalTrackingEvent(input: Readonly<{
  row: HistoricalTrackingEventRow;
  workspaceId: string;
  trackingMessageId: string;
  smtpAcceptedAt: Date | null;
  allowNetworkContext: boolean;
  crypto: TrackingCrypto | null;
  ipIntelligence?: EmailTrackingIpIntelligencePort;
}>): Promise<PreparedHistoricalClassification> {
  const interaction = historicalInteraction(input.row.event_type);
  if (!interaction) {
    return historicalRawUnavailableClassification(input.row);
  }

  const raw = openHistoricalRequestRaw(
    input.crypto,
    input.row,
    input.workspaceId,
    input.trackingMessageId,
  );
  if (!raw) {
    return historicalRawUnavailableClassification(input.row);
  }

  const secondsSinceSmtpAccepted = input.smtpAcceptedAt
    ? Math.max(0, (toDate(input.row.occurred_at).getTime() - input.smtpAcceptedAt.getTime()) / 1_000)
    : null;
  const request = {
    userAgent: raw.userAgent,
    requestIp: raw.ip,
    secondsSinceSmtpAccepted,
    requestHeaders: {},
    interaction,
  } as const;
  const base = classifyEmailTrackingRequest(request);
  const networkContext = input.allowNetworkContext
    ? await historicalNetworkContext(raw.ip, input.ipIntelligence)
    : null;
  return {
    eventId: input.row.id,
    base,
    withNetworkContext: networkContext
      ? classifyEmailTrackingRequest({ ...request, networkContext })
      : null,
    unavailableRaw: false,
    rawEnvelope: {
      ciphertext: input.row.raw_metadata_ciphertext!,
      nonce: input.row.raw_metadata_nonce!,
      authTag: input.row.raw_metadata_auth_tag!,
      dedupeKey: input.row.dedupe_key,
    },
  };
}

function historicalRawUnavailableClassification(
  row: HistoricalTrackingEventRow,
): PreparedHistoricalClassification {
  const interaction = historicalInteraction(row.event_type);
  if (!interaction) {
    return {
      eventId: row.id,
      base: {
        version: 2,
        actorClass: 'system',
        confidence: normalizedEvidenceConfidence(row.confidence),
        reasons: ['system_generated_evidence'],
      },
      withNetworkContext: null,
      unavailableRaw: false,
      rawEnvelope: null,
    };
  }
  const legacyAutomated = row.event_type === 'open_automated'
    || row.event_type === 'click_automated';
  return {
    eventId: row.id,
    base: {
      version: 2,
      actorClass: legacyAutomated ? 'automated_unknown' : 'unknown',
      confidence: 'low',
      reasons: ['raw_request_data_unavailable'],
    },
    withNetworkContext: null,
    unavailableRaw: !legacyAutomated,
    rawEnvelope: null,
  };
}

function logicallyRetainedHistoricalRow(
  row: HistoricalTrackingEventRow,
  rawCutoff: Date,
): HistoricalTrackingEventRow {
  if (toDate(row.created_at).getTime() >= rawCutoff.getTime()) return row;
  return {
    ...row,
    raw_metadata_ciphertext: null,
    raw_metadata_nonce: null,
    raw_metadata_auth_tag: null,
  };
}

function historicalRawEnvelopeMatches(
  expected: NonNullable<PreparedHistoricalClassification['rawEnvelope']>,
  row: HistoricalTrackingEventRow,
  rawCutoff: Date,
): boolean {
  return toDate(row.created_at).getTime() >= rawCutoff.getTime()
    && row.dedupe_key === expected.dedupeKey
    && row.raw_metadata_ciphertext?.equals(expected.ciphertext) === true
    && row.raw_metadata_nonce?.equals(expected.nonce) === true
    && row.raw_metadata_auth_tag?.equals(expected.authTag) === true;
}

function historicalInteraction(value: string): 'open' | 'click' | null {
  if (value === 'open_automated' || value === 'open_probable') return 'open';
  if (value === 'click_automated' || value === 'click') return 'click';
  return null;
}

function openHistoricalRequestRaw(
  crypto: TrackingCrypto | null,
  row: HistoricalTrackingEventRow,
  workspaceId: string,
  trackingMessageId: string,
): { ip: string | null; userAgent: string | null } | null {
  if (
    !crypto
    || !row.raw_metadata_ciphertext
    || !row.raw_metadata_nonce
    || !row.raw_metadata_auth_tag
  ) return null;
  try {
    const value = crypto.openJson({
      ciphertext: row.raw_metadata_ciphertext,
      nonce: row.raw_metadata_nonce,
      authTag: row.raw_metadata_auth_tag,
    }, emailTrackingEventAssociatedData(workspaceId, trackingMessageId, row.dedupe_key));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const source = value as { ip?: unknown; userAgent?: unknown };
    const ip = typeof source.ip === 'string' && source.ip.trim() ? source.ip.slice(0, 64) : null;
    const userAgent = typeof source.userAgent === 'string' && source.userAgent.trim()
      ? source.userAgent.slice(0, 2_048)
      : null;
    return ip || userAgent ? { ip, userAgent } : null;
  } catch {
    return null;
  }
}

async function historicalNetworkContext(
  requestIp: string | null,
  ipIntelligence: EmailTrackingIpIntelligencePort | undefined,
): Promise<EmailTrackingNetworkContext | null> {
  const ip = requestIp?.trim();
  if (!ip || !ipIntelligence) return null;
  try {
    const insight = await ipIntelligence.lookup(ip);
    return ipIntelligence.status().state === 'ready'
      ? emailTrackingNetworkContext(insight)
      : null;
  } catch {
    return null;
  }
}

function normalizedEvidenceConfidence(value: string): EmailEvidenceConfidence {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'verified'
    ? value
    : 'none';
}

function canonicalTrackingEventId(value: string | number | bigint): string {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error('Unsafe email tracking event id');
    }
    return String(value);
  }
  const canonical = String(value);
  if (!/^\d+$/.test(canonical)) throw new Error('Invalid email tracking event id');
  return BigInt(canonical).toString();
}

function publicTrackingEventId(value: string | number | bigint): number | string {
  const canonical = canonicalTrackingEventId(value);
  const numeric = Number(canonical);
  return Number.isSafeInteger(numeric) ? numeric : canonical;
}

type TrackingEventProjectionRow = Readonly<{
  id: string | number;
  event_type: string;
  source: string;
  confidence: string;
  automated: boolean;
  occurred_at: Date | string;
  metadata_json?: unknown;
  raw_metadata_ciphertext?: Buffer | null;
  raw_metadata_nonce?: Buffer | null;
  raw_metadata_auth_tag?: Buffer | null;
  dedupe_key?: string;
  classification_version: number | string | null;
  actor_class: string | null;
  classification_confidence: string | null;
  reasons_json: unknown;
}>;

type TrackingEventRow = Omit<
  TrackingEventProjectionRow,
  'classification_version' | 'actor_class' | 'classification_confidence' | 'reasons_json'
>;

function selectTrackingEventFields() {
  return [
    'event.id as id',
    'event.event_type as event_type',
    'event.source as source',
    'event.confidence as confidence',
    'event.automated as automated',
    'event.occurred_at as occurred_at',
  ] as const;
}

async function trackingEventsWithHighestClassification(
  trx: WorkspaceTransaction,
  rows: readonly TrackingEventRow[],
): Promise<TrackingEventProjectionRow[]> {
  const classifications = new Map<string, Readonly<{
    classificationVersion: number | string;
    actorClass: string;
    confidence: string;
    reasons: unknown;
  }>>();
  for (let offset = 0; offset < rows.length; offset += EMAIL_TRACKING_SUMMARY_PAGE_SIZE) {
    const eventIds = rows
      .slice(offset, offset + EMAIL_TRACKING_SUMMARY_PAGE_SIZE)
      .map((row) => canonicalTrackingEventId(row.id));
    if (eventIds.length === 0) continue;
    const page = await trx
      .selectFrom('email_tracking_event_classifications')
      .distinctOn('event_id')
      .select(['event_id', 'classification_version', 'actor_class', 'confidence', 'reasons_json'])
      .where('event_id', 'in', eventIds)
      .orderBy('event_id', 'asc')
      .orderBy('classification_version', 'desc')
      .execute();
    for (const classification of page) {
      classifications.set(canonicalTrackingEventId(classification.event_id), {
        classificationVersion: classification.classification_version,
        actorClass: classification.actor_class,
        confidence: classification.confidence,
        reasons: classification.reasons_json,
      });
    }
  }
  return rows.map((row) => {
    const classification = classifications.get(canonicalTrackingEventId(row.id));
    return {
      ...row,
      classification_version: classification?.classificationVersion ?? null,
      actor_class: classification?.actorClass ?? null,
      classification_confidence: classification?.confidence ?? null,
      reasons_json: classification?.reasons ?? null,
    };
  });
}

function classificationFromProjectionRow(
  row: TrackingEventProjectionRow,
): EmailEvidenceClassification | null {
  if (Number(row.classification_version) !== 2 || !isEmailEvidenceActorClass(row.actor_class)) {
    return null;
  }
  return {
    version: 2,
    actorClass: row.actor_class,
    confidence: normalizedEvidenceConfidence(row.classification_confidence ?? 'none'),
    reasons: Array.isArray(row.reasons_json)
      ? row.reasons_json
        .filter((reason): reason is string => typeof reason === 'string')
        .slice(0, 10)
        .map((reason) => sanitizeMetadataLabel(reason))
      : [],
  };
}

function isEmailEvidenceActorClass(
  value: string | null,
): value is EmailEvidenceClassification['actorClass'] {
  return value !== null && [
    'system',
    'probable_human',
    'mail_proxy',
    'privacy_proxy',
    'security_scanner',
    'automated_unknown',
    'unknown',
  ].includes(value);
}

function evidenceEventFromProjectionRow(row: TrackingEventProjectionRow): EmailEvidenceEvent {
  return {
    type: row.event_type as EmailEvidenceEventType,
    confidence: normalizedEvidenceConfidence(row.confidence),
    occurredAt: timestampToIso(row.occurred_at) ?? new Date(0).toISOString(),
    automated: Boolean(row.automated),
    classification: classificationFromProjectionRow(row),
  };
}

function summaryEvidenceEventFromProjectionRow(row: TrackingEventProjectionRow): EmailEvidenceEvent {
  const event = evidenceEventFromProjectionRow(row);
  if (event.classification) return event;
  return {
    ...event,
    classification: {
      version: 2,
      actorClass: 'unknown',
      confidence: 'none',
      reasons: ['classification_unavailable'],
    },
  };
}

async function loadTrackingTimeline(
  db: Kysely<ServerDatabase>,
  crypto: TrackingCrypto | null,
  workspaceId: string,
  messageId: number,
  includeSensitive: boolean,
): Promise<EmailTrackingTimelineRecord | null> {
  return withWorkspaceTransaction(
    db,
    { workspaceId, role: 'system' },
    async (trx) => {
      const message = await trx
        .selectFrom('email_messages')
        .select('id')
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', messageId)
        .executeTakeFirst();
      if (!message) return null;
      const tracking = await trx
        .selectFrom('email_tracking_messages')
        .select(['id', 'recipient_count'])
        .where('workspace_id', '=', workspaceId)
        .where('message_id', '=', messageId)
        .executeTakeFirst();
      if (!tracking) {
        return {
          messageId,
          tracked: false,
          warning: null,
          summary: buildEmailEvidenceSummary([]),
          events: [],
          eventsTruncated: false,
        };
      }
      const summary = await loadEmailEvidenceSummaryForTracking(
        trx,
        workspaceId,
        tracking.id,
      );
      const rows = await trx
        .selectFrom('email_tracking_events as event')
        .select([
          ...selectTrackingEventFields(),
          'event.metadata_json as metadata_json',
          'event.raw_metadata_ciphertext as raw_metadata_ciphertext',
          'event.raw_metadata_nonce as raw_metadata_nonce',
          'event.raw_metadata_auth_tag as raw_metadata_auth_tag',
          'event.dedupe_key as dedupe_key',
        ])
        .where('event.workspace_id', '=', workspaceId)
        .where('event.tracking_message_id', '=', tracking.id)
        .orderBy('event.occurred_at', 'desc')
        .orderBy('event.id', 'desc')
        .limit(1_001)
        .execute();
      const eventsTruncated = rows.length > 1_000;
      const projectedRows = await trackingEventsWithHighestClassification(trx, rows.slice(0, 1_000));
      const events: EmailTrackingEventRecord[] = projectedRows.reverse().map((row) => {
        const metadata = sanitizeMetadataObject(jsonObject(row.metadata_json));
        if (
          includeSensitive
          && crypto
          && row.raw_metadata_ciphertext
          && row.raw_metadata_nonce
          && row.raw_metadata_auth_tag
          && row.dedupe_key
        ) {
          try {
            const raw = crypto.openJson({
              ciphertext: row.raw_metadata_ciphertext,
              nonce: row.raw_metadata_nonce,
              authTag: row.raw_metadata_auth_tag,
            }, emailTrackingEventAssociatedData(workspaceId, tracking.id, row.dedupe_key));
            metadata.raw = raw;
          } catch {
            metadata.rawUnavailable = true;
          }
        }
        return {
          id: publicTrackingEventId(row.id),
          type: row.event_type as EmailEvidenceEventType,
          source: row.source,
          confidence: row.confidence as EmailEvidenceConfidence,
          automated: Boolean(row.automated),
          occurredAt: timestampToIso(row.occurred_at) ?? new Date(0).toISOString(),
          metadata,
          classification: classificationFromProjectionRow(row),
        };
      });
      return {
        messageId,
        tracked: true,
        warning: Number(tracking.recipient_count) > 1
          ? 'Mehrere Empfaenger: Ereignisse koennen nicht sicher einer einzelnen Person zugeordnet werden.'
          : null,
        summary,
        events,
        eventsTruncated,
      };
    },
  );
}

export async function loadEmailEvidenceSummaryForTracking(
  trx: WorkspaceTransaction,
  workspaceId: string,
  trackingMessageId: string,
): Promise<EmailEvidenceSummary> {
  let summary = buildEmailEvidenceSummary([]);
  let afterOccurredAt: Date | null = null;
  let afterEventId = '0';
  while (true) {
    let query = trx
      .selectFrom('email_tracking_events as event')
      .select(selectTrackingEventFields())
      .where('event.workspace_id', '=', workspaceId)
      .where('event.tracking_message_id', '=', trackingMessageId);
    if (afterOccurredAt) {
      query = query.where((eb) => eb.or([
        eb('event.occurred_at', '>', afterOccurredAt!),
        eb.and([
          eb('event.occurred_at', '=', afterOccurredAt!),
          eb('event.id', '>', afterEventId),
        ]),
      ]));
    }
    const rows = await query
      .orderBy('event.occurred_at', 'asc')
      .orderBy('event.id', 'asc')
      .limit(EMAIL_TRACKING_SUMMARY_PAGE_SIZE)
      .execute();
    if (rows.length === 0) break;
    const projectedRows = await trackingEventsWithHighestClassification(trx, rows);
    const pageSummary = buildEmailEvidenceSummary(
      projectedRows.map((row) => summaryEvidenceEventFromProjectionRow(row)),
    );
    summary = mergeEmailEvidenceSummaries(summary, pageSummary);
    const last = rows[rows.length - 1]!;
    afterOccurredAt = toDate(last.occurred_at);
    afterEventId = canonicalTrackingEventId(last.id);
    if (rows.length < EMAIL_TRACKING_SUMMARY_PAGE_SIZE) break;
  }
  return summary;
}

function mergeEmailEvidenceSummaries(
  current: EmailEvidenceSummary,
  page: EmailEvidenceSummary,
): EmailEvidenceSummary {
  const probableSessionContinues = current.lastProbableHumanOpenAt !== null
    && page.firstProbableHumanOpenAt !== null
    && Date.parse(page.firstProbableHumanOpenAt) - Date.parse(current.lastProbableHumanOpenAt) < 30 * 60_000;
  return {
    transport: page.transport === 'unknown' ? current.transport : page.transport,
    delivery: higherSummaryValue(
      current.delivery,
      page.delivery,
      ['unknown', 'external_system_reached', 'dsn_delivered'],
    ),
    engagement: higherSummaryValue(
      current.engagement,
      page.engagement,
      ['none', 'automated_fetch', 'probable_open', 'link_interaction', 'human_reply'],
    ),
    confidence: higherSummaryValue(
      current.confidence,
      page.confidence,
      ['none', 'low', 'medium', 'high', 'verified'],
    ),
    mdnDisplayedCount: current.mdnDisplayedCount + page.mdnDisplayedCount,
    pixelFetchCount: current.pixelFetchCount + page.pixelFetchCount,
    automatedPixelFetchCount: current.automatedPixelFetchCount + page.automatedPixelFetchCount,
    unknownPixelFetchCount: current.unknownPixelFetchCount + page.unknownPixelFetchCount,
    probableHumanPixelFetchCount: current.probableHumanPixelFetchCount + page.probableHumanPixelFetchCount,
    probableHumanOpenSessionCount: current.probableHumanOpenSessionCount
      + page.probableHumanOpenSessionCount
      - (probableSessionContinues ? 1 : 0),
    automatedLinkFetchCount: current.automatedLinkFetchCount + page.automatedLinkFetchCount,
    unknownLinkFetchCount: current.unknownLinkFetchCount + page.unknownLinkFetchCount,
    probableHumanLinkFetchCount: current.probableHumanLinkFetchCount + page.probableHumanLinkFetchCount,
    firstPixelFetchedAt: current.firstPixelFetchedAt ?? page.firstPixelFetchedAt,
    lastPixelFetchedAt: page.lastPixelFetchedAt ?? current.lastPixelFetchedAt,
    firstProbableHumanOpenAt: current.firstProbableHumanOpenAt ?? page.firstProbableHumanOpenAt,
    lastProbableHumanOpenAt: page.lastProbableHumanOpenAt ?? current.lastProbableHumanOpenAt,
    openCount: current.openCount + page.openCount,
    clickCount: current.clickCount + page.clickCount,
    automatedOpenCount: current.automatedOpenCount + page.automatedOpenCount,
    probableOpenCount: current.probableOpenCount + page.probableOpenCount,
    automatedClickCount: current.automatedClickCount + page.automatedClickCount,
    probableClickCount: current.probableClickCount + page.probableClickCount,
    firstOpenedAt: current.firstOpenedAt ?? page.firstOpenedAt,
    lastOpenedAt: page.lastOpenedAt ?? current.lastOpenedAt,
    firstClickedAt: current.firstClickedAt ?? page.firstClickedAt,
    lastClickedAt: page.lastClickedAt ?? current.lastClickedAt,
    repliedAt: page.repliedAt ?? current.repliedAt,
  };
}

function higherSummaryValue<T extends string>(
  current: T,
  candidate: T,
  ordered: readonly T[],
): T {
  return ordered.indexOf(candidate) > ordered.indexOf(current) ? candidate : current;
}

export function normalizeInboundEvidenceOccurredAt(value: Date | undefined, observedAt: Date): Date {
  const valueMs = value?.getTime() ?? Number.NaN;
  const observedMs = observedAt.getTime();
  if (!Number.isFinite(valueMs) || !Number.isFinite(observedMs)) return observedAt;
  return valueMs > observedMs + 5 * 60_000 ? observedAt : value!;
}

export function clampInboundEvidenceAfterSmtpAccepted(
  occurredAt: Date,
  smtpAcceptedAt: Date | null,
  observedAt: Date,
): Date {
  if (!smtpAcceptedAt) return occurredAt;
  return occurredAt.getTime() < smtpAcceptedAt.getTime() ? observedAt : occurredAt;
}

async function revokeWorkspaceTracking(
  trx: WorkspaceTransaction,
  workspaceId: string,
  now: Date,
): Promise<void> {
  await trx
    .updateTable('email_tracking_messages')
    .set({ revoked_at: now, updated_at: now })
    .where('workspace_id', '=', workspaceId)
    .where('revoked_at', 'is', null)
    .execute();
  await trx
    .updateTable('email_tracking_token_resolver')
    .set({ revoked_at: now })
    .where('workspace_id', '=', workspaceId)
    .where('revoked_at', 'is', null)
    .execute();
}

async function revokeWorkspaceTokenKind(
  trx: WorkspaceTransaction,
  workspaceId: string,
  kind: 'open' | 'click',
  now: Date,
): Promise<void> {
  await trx
    .updateTable('email_tracking_messages')
    .set(kind === 'open'
      ? { track_opens: false, updated_at: now }
      : { track_links: false, updated_at: now })
    .where('workspace_id', '=', workspaceId)
    .execute();
  await trx
    .updateTable('email_tracking_token_resolver')
    .set({ revoked_at: now })
    .where('workspace_id', '=', workspaceId)
    .where('token_kind', '=', kind)
    .where('revoked_at', 'is', null)
    .execute();
}

async function pruneTrackingWorkspace(
  db: Kysely<ServerDatabase>,
  workspaceId: string,
  now: Date,
): Promise<{ rawMetadataCleared: number; trackingMessagesDeleted: number; expiredTokensDeleted: number }> {
  return withWorkspaceTransaction(
    db,
    { workspaceId, role: 'system' },
    async (trx) => {
      const policy = await trx
        .selectFrom('email_tracking_policies')
        .select(['raw_metadata_retention_days', 'event_retention_days'])
        .where('workspace_id', '=', workspaceId)
        .executeTakeFirst();
      const rawCutoff = addDays(now, -(Number(policy?.raw_metadata_retention_days ?? 7)));
      const eventCutoff = addDays(now, -(Number(policy?.event_retention_days ?? 365)));
      const rawResult = await trx
        .updateTable('email_tracking_events')
        .set({
          raw_metadata_ciphertext: null,
          raw_metadata_nonce: null,
          raw_metadata_auth_tag: null,
        })
        .where('workspace_id', '=', workspaceId)
        .where('created_at', '<', rawCutoff)
        .where('raw_metadata_ciphertext', 'is not', null)
        .executeTakeFirst();
      await trx
        .deleteFrom('email_tracking_events')
        .where('workspace_id', '=', workspaceId)
        .where('created_at', '<', eventCutoff)
        .executeTakeFirst();
      const tokenResult = await trx
        .deleteFrom('email_tracking_token_resolver')
        .where('workspace_id', '=', workspaceId)
        .where('expires_at', '<', now)
        .executeTakeFirst();
      const messageResult = await trx
        .deleteFrom('email_tracking_messages')
        .where('workspace_id', '=', workspaceId)
        .where('token_expires_at', '<', now)
        .where(sql<boolean>`NOT EXISTS (
          SELECT 1
          FROM email_tracking_events AS retained_event
          WHERE retained_event.workspace_id = ${workspaceId}
            AND retained_event.tracking_message_id = email_tracking_messages.id
        )`)
        .executeTakeFirst();
      return {
        rawMetadataCleared: Number(rawResult.numUpdatedRows),
        trackingMessagesDeleted: Number(messageResult.numDeletedRows),
        expiredTokensDeleted: Number(tokenResult.numDeletedRows),
      };
    },
  );
}

async function publishTrackingChanged(
  events: ServerEventPort | undefined,
  workspaceId: string,
  messageId: number,
  evidenceType: string,
  occurredAt: Date,
): Promise<void> {
  await events?.publish({
    type: 'email_tracking.updated',
    workspaceId,
    entityType: 'email_message',
    entityId: String(messageId),
    actorUserId: 'system',
    occurredAt: occurredAt.toISOString(),
    payload: { messageId, evidenceType: sanitizeMetadataLabel(evidenceType) },
  }).catch(() => undefined);
}

function sanitizeMetadataObject(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 30)) {
    const safeKey = key.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 80);
    if (!safeKey) continue;
    if (typeof item === 'string') out[safeKey] = item.slice(0, 500);
    else if (typeof item === 'number' && Number.isFinite(item)) out[safeKey] = item;
    else if (typeof item === 'boolean' || item === null) out[safeKey] = item;
    else if (Array.isArray(item)) out[safeKey] = item.slice(0, 20).map((entry) => String(entry).slice(0, 100));
    else if (item && typeof item === 'object') out[safeKey] = jsonObject(item);
  }
  return out;
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function sanitizeMetadataLabel(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 100) || 'unknown';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeTrackingBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.username || url.password) {
    throw new Error('E-Mail-Tracking PUBLIC_BASE_URL darf keine Zugangsdaten enthalten');
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('E-Mail-Tracking erfordert eine HTTPS PUBLIC_BASE_URL');
  }
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/$/, '');
}

function trackingUrl(baseUrl: string, path: string): string {
  return new URL(path, `${baseUrl}/`).toString();
}

export function emailTrackingLinkAssociatedData(workspaceId: string, trackingId: string, linkId: string): string {
  return `${workspaceId}:${trackingId}:link:${linkId}`;
}

export function emailTrackingEventAssociatedData(workspaceId: string, trackingId: string, dedupeKey: string): string {
  return `${workspaceId}:${trackingId}:event:${dedupeKey}`;
}

function normalizeMessageIdHeader(value: string): string | null {
  const normalized = value.trim().replace(/[\r\n]/g, '');
  if (!normalized || normalized.length > 998) return null;
  return normalized.startsWith('<') && normalized.endsWith('>') ? normalized : `<${normalized.replace(/[<>]/g, '')}>`;
}

function minuteBucket(value: Date): string {
  return value.toISOString().slice(0, 16);
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 86_400_000);
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function timestampToIso(value: Date | string | null): string | null {
  if (value === null) return null;
  const parsed = toDate(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
