/**
 * SMTP-relay submission pipeline.
 *
 * An external system (e.g. the ERP) authenticated against a workspace relay
 * (`smtp_relay_credentials`) and handed us a complete RFC822 message at DATA
 * time. This module turns that submission into:
 *
 *   1. a header-From spoofing check against the relay's allowed accounts,
 *   2. a tracking decision (`evaluateRelayTrackingRule`, incl. the per-message
 *      `X-SimpleCRM-Track` override header),
 *   3. a persisted `email_messages` row (folder 'sent') + an
 *      `smtp_relay_submissions` audit row,
 *   4. an (optionally) tracking-instrumented outbound send through the routing
 *      account's own SMTP credentials,
 *   5. a best-effort IMAP Sent-folder copy and an optional follow-up workflow
 *      enqueue (job type 'workflow.execute', triggerName 'relay').
 *
 * The pipeline mirrors the compose-send flow (mail-compose-send.ts) and reuses
 * its exported helpers (`resolveSmtpAuth`, `buildComposeRfc822`,
 * `generateOutboundMessageId`, tracking transport events). All IO other than
 * the relay port / tracking / SMTP legs goes through the narrow
 * `RelaySubmissionStore` so the pipeline is unit-testable with in-memory fakes;
 * `createPostgresRelaySubmissionStore` is the thin SQL implementation.
 */
import { createHash } from 'node:crypto';

import { sql as kyselySql, type Kysely } from 'kysely';

import {
  buildComposeRfc822,
  evaluateRelayTrackingRule,
  generateOutboundMessageId,
  normalizeEmailAddress,
  normalizeMessageIdHeader,
  resolveConfiguredSmtpHost,
  SMTP_HOST_MISSING_ERROR,
  type ComposeRfc822Attachment,
  type RelayTrackingHeaderOverride,
} from '@simplecrm/core';

import type { SecretIdentifier } from './db';
import type {
  PostgresSmtpRelayPort,
  SmtpRelayConfig,
  SmtpRelayRoutingAccount,
} from './db/postgres-relay-port';
import {
  serverCreatedEmailFolderSourceSqliteId,
  serverCreatedEmailMessageSourceSqliteId,
} from './db/postgres-mail-read-ports';
import type { ServerDatabase } from './db/schema';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
  type WorkspaceTransaction,
} from './db/workspace-context';
import type { EmailTrackingService } from './email-tracking';
import { resolveSmtpAuth, type ComposeSendAccount } from './mail-compose-send';
import type { ServerImapSentCopyAppender } from './mail-imap-append';
import {
  parseMailSource,
  type ServerMailSyncParsedAttachment,
  type ServerMailSyncParsedMessage,
} from './mail-parse';
import { sendSmtpMessage, type ServerSmtpSendInput } from './mail-smtp-send';

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

export type RelaySubmissionInput = Readonly<{
  workspaceId: string;
  relayId: string;
  credentialId: string;
  /** Account resolved by the listener at MAIL FROM time (when available). */
  accountId?: number;
  /** Envelope sender that was already validated via resolveRoutingAccount. */
  envelopeFrom: string;
  /** Envelope recipients accepted at RCPT time. */
  recipients: readonly string[];
  rfc822: Buffer;
}>;

export type RelaySubmissionFailureCode =
  | 'from_mismatch'
  | 'account_not_allowed'
  | 'parse_failed'
  | 'relay_failed'
  | 'persist_failed';

export type RelaySubmissionResult =
  | Readonly<{ ok: true; messageId: number; tracked: boolean }>
  | Readonly<{
    ok: false;
    code: RelaySubmissionFailureCode;
    message: string;
    /** true → the listener should answer 451 so the sender retries. */
    retryable: boolean;
  }>;

export type RelaySubmissionPipeline = Readonly<{
  submitRelay(input: RelaySubmissionInput): Promise<RelaySubmissionResult>;
}>;

// ---------------------------------------------------------------------------
// Narrow store contract (unit tests fake this; Postgres implementation below)
// ---------------------------------------------------------------------------

export type RelaySubmissionPersistInput = Readonly<{
  workspaceId: string;
  relayId: string;
  credentialId: string | null;
  accountId: number;
  accountSourceSqliteId: number;
  /** Message-ID header that will go out on the wire. */
  messageIdHeader: string | null;
  /**
   * Idempotency key, independent of `messageIdHeader`: the tracked path mints
   * a fresh wire Message-ID on every attempt (see submitRelay), so the wire
   * id alone cannot detect a retry. Prefer the ERP's own Message-ID when
   * supplied; only falls back to the (non-stable) minted id when the ERP
   * sent none at all.
   */
  dedupKey: string | null;
  subject: string;
  inReplyTo: string | null;
  referencesHeader: string | null;
  fromJson: unknown | null;
  toJson: unknown | null;
  ccJson: unknown | null;
  bccJson: unknown | null;
  bodyText: string | null;
  bodyHtml: string | null;
  snippet: string | null;
  hasAttachments: boolean;
  attachmentsJson: unknown | null;
  recipientCount: number;
  /** First envelope recipient — used to link the message to a customer. */
  firstRecipient: string | null;
  trackingApplied: boolean;
  trackingRuleReason: string | null;
}>;

export type RelaySubmissionPersistResult =
  | Readonly<{ alreadyRelayed: true; messageId: number | null }>
  // Another attempt for the same dedup key is in flight (persisted, not yet
  // relayed) — the caller must defer rather than send again.
  | Readonly<{ inFlight: true }>
  | Readonly<{ alreadyRelayed: false; messageId: number; submissionId: string }>;

export type RelaySubmissionStore = Readonly<{
  /**
   * Persist the relayed message (email_messages, folder 'sent') plus the
   * smtp_relay_submissions row (status 'received') in one transaction.
   * Must short-circuit with `alreadyRelayed` when a submission with the same
   * (workspace_id, relay_id, dedup_key) is already in status 'relayed'.
   */
  persistMessage(input: RelaySubmissionPersistInput): Promise<RelaySubmissionPersistResult>;
  updateSubmission(input: {
    workspaceId: string;
    submissionId: string;
    status: 'relayed' | 'failed';
    trackingApplied: boolean;
    errorText: string | null;
  }): Promise<void>;
  /** Mirror of the compose outbound-review enqueue (run row + job_queue row). */
  enqueueFollowup(input: {
    workspaceId: string;
    workflowId: number;
    messageId: number;
    triggerName: string;
    context?: Readonly<Record<string, unknown>>;
  }): Promise<{ runId: number } | null>;
  /** sync_info lookup (OAuth app keys) for resolveSmtpAuth. */
  getSyncInfo(input: {
    workspaceId: string;
    keys: readonly string[];
  }): Promise<ReadonlyMap<string, string | null>>;
}>;

// ---------------------------------------------------------------------------
// Pipeline factory
// ---------------------------------------------------------------------------

export type RelaySubmissionPipelineDeps = Readonly<{
  /** Required unless a prebuilt `store` is injected (unit tests). */
  db?: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
  store?: RelaySubmissionStore;
  relayPort: Pick<PostgresSmtpRelayPort, 'resolveRoutingAccount' | 'loadRelayConfig'>;
  /** Optional — null/undefined when tracking is not configured on this server. */
  emailTracking?: Pick<
    EmailTrackingService,
    'prepareOutbound' | 'recordSending' | 'recordSmtpAccepted' | 'recordSmtpFailed'
  > | null;
  smtpSend?: (input: ServerSmtpSendInput) => Promise<void>;
  sentCopyAppender?: ServerImapSentCopyAppender | null;
  readSecret?: (input: SecretIdentifier) => Promise<Buffer | null>;
  writeSecret?: (input: SecretIdentifier & { value: string | Buffer }) => Promise<unknown>;
  oauthFetchImpl?: typeof fetch;
  now?: () => Date;
  log?: (message: string, detail?: Readonly<Record<string, unknown>>) => void;
}>;

const MAX_SUBMISSION_ERROR_TEXT = 2_000;
/** A 'received' submission older than this is treated as stale (a crashed
 *  in-flight attempt) and may be retried; a fresher one is still in flight. */
const RELAY_INFLIGHT_STALE_MS = 5 * 60 * 1000;

function toEpochMs(value: Date | string | number): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function createRelaySubmissionPipeline(
  deps: RelaySubmissionPipelineDeps,
): RelaySubmissionPipeline {
  const store = deps.store ?? (deps.db
    ? createPostgresRelaySubmissionStore({
      db: deps.db,
      applyWorkspaceSession: deps.applyWorkspaceSession,
      now: deps.now,
    })
    : null);
  if (!store) {
    throw new Error('createRelaySubmissionPipeline benoetigt entweder deps.db oder deps.store');
  }
  const smtpSend = deps.smtpSend ?? sendSmtpMessage;
  const emailTracking = deps.emailTracking ?? null;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => undefined);

  return {
    async submitRelay(input) {
      const { workspaceId, relayId } = input;
      const recipients = [...input.recipients];

      // 1. Relay config load — hoisted ahead of parsing so the parser can be
      //    bounded by the relay's OWN configured size cap. Loading it first
      //    only needs relayId (not parsed content), so this is safe.
      let config: SmtpRelayConfig;
      try {
        const loaded = await deps.relayPort.loadRelayConfig({ workspaceId, relayId });
        if (!loaded) {
          return failure('account_not_allowed', 'Relay ist nicht (mehr) konfiguriert', false);
        }
        config = loaded;
      } catch (error) {
        return failure('relay_failed', errorMessage(error), true);
      }

      // 2. Parse. A message we cannot parse is permanently unprocessable.
      //    Bounded by the relay's configured maxMessageBytes rather than the
      //    parser's default cap — an admin who raises the relay's limit
      //    above the default otherwise gets a silent, permanent parse
      //    rejection for exactly the larger messages they configured it for.
      let parsed: ServerMailSyncParsedMessage;
      try {
        parsed = await parseMailSource(input.rfc822, config.maxMessageBytes);
      } catch (error) {
        return failure('parse_failed', errorMessage(error), false);
      }

      // 3. Header-From spoofing check: the header From must resolve to the
      //    SAME allowed account as the (already validated) envelope From.
      let account: SmtpRelayRoutingAccount;
      try {
        // Exactly one From mailbox required: a multi-address From header
        // (RFC5322 permits a comma-separated mailbox-list here) could carry
        // an allowed address FIRST and an attacker-controlled address after
        // it — checking only the first entry while the full header (with
        // every address) is what actually goes out on the wire/pass-through
        // would let a spoofed second sender ride along disguised behind a
        // legitimate one.
        const fromAddresses = parsedAddressEntries(parsed.fromJson);
        if (fromAddresses.length !== 1) {
          return failure(
            'from_mismatch',
            fromAddresses.length === 0
              ? 'Header-From fehlt oder ist ungueltig'
              : 'Header-From darf nur eine Absenderadresse enthalten',
            false,
          );
        }
        const headerFrom = fromAddresses[0]!.address;
        const headerAccount = await deps.relayPort.resolveRoutingAccount({
          workspaceId,
          relayId,
          fromAddress: headerFrom,
        });
        if (!headerAccount) {
          return failure(
            'from_mismatch',
            'Header-From ist fuer dieses Relay nicht freigegeben',
            false,
          );
        }
        let envelopeAccountId: number | null = input.accountId ?? null;
        if (envelopeAccountId === null) {
          const envelopeAccount = await deps.relayPort.resolveRoutingAccount({
            workspaceId,
            relayId,
            fromAddress: input.envelopeFrom,
          });
          envelopeAccountId = envelopeAccount === null ? null : Number(envelopeAccount.id);
        }
        if (envelopeAccountId === null || Number(headerAccount.id) !== envelopeAccountId) {
          return failure(
            'from_mismatch',
            'Header-From und Envelope-From gehoeren nicht zum selben freigegebenen Konto',
            false,
          );
        }
        account = headerAccount;
      } catch (error) {
        return failure('relay_failed', errorMessage(error), true);
      }

      const subject = parsed.subject ?? '';
      const decision = evaluateRelayTrackingRule({
        mode: config.trackingMode,
        subjectPatterns: config.trackingSubjectPatterns,
        allowHeaderOverride: config.allowHeaderOverride,
        subject,
        headerOverride: parseRelayTrackingHeaderOverride(input.rfc822),
      });
      // Tracking rebuilds the MIME from the PARSED parts, which cannot faithfully
      // reproduce two things: (a) inline images referenced from the HTML via
      // `cid:` (the parser does not surface content-ids, so they would ship as
      // ordinary attachments and render broken), and (b) attachments the parser
      // dropped at its size caps (they would silently vanish). In either case we
      // must NOT rebuild — deliver the ERP's original bytes intact via the
      // untracked pass-through instead. Losing the open-signal on such a message
      // is the safe trade vs. delivering broken/incomplete mail.
      const htmlReferencesCid = /\bcid:/i.test(parsed.bodyHtml ?? '');
      const canTrackFaithfully = !htmlReferencesCid && !parsed.attachmentsTruncated;
      // Open tracking works by injecting a pixel into the HTML body — a
      // plain-text / no-HTML message can never carry one. prepareOutbound would
      // still mint a token (instrumentEmailHtml leaves empty HTML unchanged), so
      // without this gate we'd mark such mail "tracked" and later raise
      // "no reaction" follow-up tasks for opens that could never be observed.
      const hasHtmlBody = Boolean(parsed.bodyHtml && parsed.bodyHtml.trim());
      const willTrack = decision.track && emailTracking !== null && canTrackFaithfully && hasHtmlBody;

      // Message-ID contract: pass-through keeps the sender's Message-ID; the
      // tracked/rebuilt path mints our own (see the "OUR Message-ID, not the
      // ERP's" test). A pass-through message WITHOUT a Message-ID gets ours
      // minted and prepended so the DB row matches the wire message.
      //
      // Idempotency contract: the WIRE Message-ID above is NOT a reliable
      // dedup key by itself — the tracked path mints a fresh one on every
      // attempt, so a naive retry check keyed on it would never catch a
      // retried submission and could send the same email twice. `dedupKey`
      // is therefore tracked separately and always prefers the ERP's own
      // Message-ID (stable across retries) regardless of tracking mode. A
      // message that never carried a Message-ID at all falls back to a
      // deterministic hash of the exact submitted bytes (stable: an ERP
      // retry after a lost SMTP response resends the identical DATA) rather
      // than the minted wire id (unstable: a fresh one every attempt, which
      // would never match on retry).
      const incomingMessageId = normalizeMessageIdHeader(parsed.messageId);
      // The Message-ID that will ACTUALLY be on the wire, decided up front and
      // used for BOTH persistence and every send path (tracked rebuild and
      // pass-through), so the audit row / threading always match the delivered
      // mail. We keep the ERP's Message-ID when present (the tracked rebuild
      // reuses it too — tracking references the email_messages id + token, not
      // the Message-ID) and mint one only when the ERP supplied none. Minting
      // eagerly on tracking-intent was the bug: a declined prepareOutbound then
      // passed through the ERP's original id while the row stored the minted one.
      const outgoingMessageId = incomingMessageId
        ?? generateOutboundMessageId(String(account.email_address));
      // The envelope recipients are ALWAYS part of the dedup key, even when the
      // ERP supplies a Message-ID: a Bcc / undisclosed-recipients fan-out sends
      // the SAME Message-ID (and identical DATA) in separate transactions, one
      // per recipient batch. Keying on the Message-ID alone would short-circuit
      // every batch after the first as a replay, so those recipients would be
      // acknowledged but never sent. The stable identity (Message-ID when
      // present, else the raw bytes) is combined with the envelope so a true
      // retry to the SAME recipients still dedupes.
      const dedupKey = hashRelaySubmissionForDedup(
        relayId,
        input.envelopeFrom,
        recipients,
        incomingMessageId ?? input.rfc822,
      );

      // 4. Persist message + submission row (idempotent on the Message-ID).
      let persisted: RelaySubmissionPersistResult;
      try {
        persisted = await store.persistMessage({
          workspaceId,
          relayId,
          credentialId: input.credentialId,
          accountId: Number(account.id),
          accountSourceSqliteId: Number(account.source_sqlite_id),
          messageIdHeader: outgoingMessageId,
          dedupKey,
          subject,
          inReplyTo: parsed.inReplyTo,
          referencesHeader: parsed.referencesHeader,
          fromJson: parsed.fromJson,
          toJson: parsed.toJson,
          ccJson: parsed.ccJson,
          bccJson: parsed.bccJson,
          bodyText: parsed.bodyText,
          bodyHtml: parsed.bodyHtml,
          snippet: parsed.snippet,
          hasAttachments: parsed.hasAttachments,
          attachmentsJson: parsed.attachmentsJson,
          recipientCount: recipients.length,
          firstRecipient: recipients[0] ?? null,
          trackingApplied: willTrack,
          trackingRuleReason: decision.reason,
        });
      } catch (error) {
        return failure('persist_failed', errorMessage(error), true);
      }
      if ('inFlight' in persisted) {
        // A concurrent attempt for the same dedup key is mid-send. Do NOT send
        // again — ask the client to retry (451); by then it will have relayed.
        log('relay submission deferred: concurrent attempt in flight', { workspaceId, relayId });
        return failure('relay_failed', 'Eine parallele Zustellung dieser Nachricht laeuft bereits', true);
      }
      if (persisted.alreadyRelayed) {
        // Same Message-ID already relayed for this workspace: the sender is
        // retrying a submission we completed. Acknowledge without re-sending.
        log('relay submission replay short-circuited', {
          workspaceId,
          relayId,
          messageIdHeader: outgoingMessageId,
        });
        return { ok: true, messageId: persisted.messageId ?? 0, tracked: false };
      }
      const { messageId, submissionId } = persisted;

      // 5. Tracking instrumentation — fail-open exactly like compose-send.
      let outboundHtml = parsed.bodyHtml;
      let trackingMessageId: string | null = null;
      if (willTrack && emailTracking) {
        try {
          const tracked = await emailTracking.prepareOutbound({
            workspaceId,
            messageId,
            accountId: Number(account.id),
            messageIdHeader: outgoingMessageId,
            recipientCount: recipients.length,
            html: parsed.bodyHtml,
            pgpProtected: false,
            // The relay already made its own tracking decision (mode/subject
            // rules + the X-SimpleCRM-Track header) and only reaches this branch
            // when it decided to track. Pass an explicit override so the
            // compose-only "default off for new messages" toggle can't silently
            // suppress a relay send the operator configured to be tracked.
            trackingOverride: true,
          });
          outboundHtml = tracked.html;
          trackingMessageId = tracked.trackingMessageId;
        } catch (error) {
          log('relay tracking prepareOutbound failed; sending untracked', {
            workspaceId,
            messageId,
            error: errorMessage(error),
          });
        }
      }

      // 6. Outgoing RFC822: rebuild when we track (instrumented html + minted
      //    Message-ID), otherwise pass the original bytes through with any
      //    X-SimpleCRM-* control headers stripped.
      // Kept as a Buffer end-to-end so the untracked pass-through preserves the
      // ERP's exact bytes (8BITMIME / ISO-8859-1 bodies must not be mangled by
      // a UTF-8 round-trip before hitting the wire). sendSmtpMessage + the
      // sent-copy appender both accept Buffers.
      let outgoingRfc822: string | Buffer;
      // Rebuild ONLY when tracking was actually applied (a tracking row/token
      // exists). If the rule/header requested tracking but prepareOutbound
      // declined (plain-text/no HTML, policy disabled, HTML over the limit),
      // trackingMessageId is null and the message ships untracked — so take the
      // byte-preserving pass-through instead of rebuilding the MIME (which would
      // drop the ERP's original headers/encodings/parser-capped parts for no
      // tracking benefit).
      if (trackingMessageId !== null) {
        const cc = mailboxListFromAddressJson(parsed.ccJson);
        const replyTo = mailboxListFromAddressJson(parsed.replyToJson);
        outgoingRfc822 = buildComposeRfc822({
          from: mailboxListFromAddressJson(parsed.fromJson) || String(account.email_address),
          // A message with no To: header (Bcc-only / undisclosed recipients)
          // must NOT fall back to the envelope recipient list here — that
          // list is exactly what Bcc exists to keep hidden, and every
          // recipient would see it in the rebuilt, visible To: header. Use
          // the standard RFC5322 empty-group placeholder instead.
          to: mailboxListFromAddressJson(parsed.toJson) || 'undisclosed-recipients:;',
          ...(cc ? { cc } : {}),
          // Preserve the ERP's Reply-To so tracked dunning replies still reach
          // the intended (e.g. collections/ticketing) mailbox rather than the
          // routing account's From.
          ...(replyTo ? { replyTo } : {}),
          subject,
          text: parsed.bodyText ?? '',
          ...(outboundHtml?.trim() ? { html: outboundHtml } : {}),
          messageId: outgoingMessageId,
          ...(parsed.inReplyTo ? { inReplyTo: parsed.inReplyTo } : {}),
          ...(parsed.referencesHeader ? { references: parsed.referencesHeader } : {}),
          attachments: composeAttachmentsFromParsed(parsed.attachments),
          date: now(),
        });
      } else {
        let outgoing = stripSimplecrmHeaders(input.rfc822);
        if (!incomingMessageId) {
          outgoing = Buffer.concat([
            Buffer.from(`Message-ID: ${outgoingMessageId}\r\n`, 'latin1'),
            outgoing,
          ]);
        }
        // Pass the raw bytes through unchanged (only SimpleCRM headers stripped
        // + a Message-ID minted if absent) — NO UTF-8 decode.
        outgoingRfc822 = outgoing;
      }

      // Shared failure path once a submission row exists: record + respond.
      // Defaults to retryable (451) for internal/config-resolution failures;
      // the downstream SMTP send below passes an explicit classification.
      const failSend = async (
        message: string,
        retryable: boolean = true,
      ): Promise<RelaySubmissionResult> => {
        try {
          await store.updateSubmission({
            workspaceId,
            submissionId,
            status: 'failed',
            trackingApplied: trackingMessageId !== null,
            errorText: message.slice(0, MAX_SUBMISSION_ERROR_TEXT),
          });
        } catch (error) {
          log('relay submission failure could not be recorded', {
            workspaceId,
            submissionId,
            error: errorMessage(error),
          });
        }
        return failure('relay_failed', message, retryable);
      };

      // 7. Resolve SMTP auth for the routing account and relay the message.
      //    A THROW here (readSecret / getSyncInfo hits a transient DB/secret
      //    error) must go through failSend, not escape to the listener's generic
      //    451: otherwise the submission stays 'received' and the in-flight
      //    dedup guard would wrongly defer immediate retries for
      //    RELAY_INFLIGHT_STALE_MS even though no send is running. Mark it
      //    failed + retryable so a retry re-attempts immediately.
      let auth: Awaited<ReturnType<typeof resolveSmtpAuth>>;
      try {
        auth = await resolveSmtpAuth({
          workspaceId,
          account: composeSendAccountFromRoutingAccount(account),
          readSecret: deps.readSecret,
          writeSecret: deps.writeSecret,
          getSyncInfo: store.getSyncInfo,
          oauthFetchImpl: deps.oauthFetchImpl,
        });
      } catch (error) {
        return failSend(errorMessage(error), true);
      }
      // A missing SMTP secret / OAuth token / host is a permanent account
      // MISCONFIGURATION: retrying the same DATA will never heal it, so reject
      // permanently (550) rather than have external systems loop forever.
      // BUT a transient failure (e.g. an OAuth token-refresh outage) sets
      // auth.retryable — those DO heal on retry, so surface them as 451.
      if (!auth.ok) return failSend(auth.error, auth.retryable === true);
      const smtpHost = resolveConfiguredSmtpHost(account.smtp_host);
      if (!smtpHost) return failSend(SMTP_HOST_MISSING_ERROR, false);

      await emailTracking?.recordSending({
        workspaceId,
        messageId,
        trackingMessageId,
      }).catch(() => undefined);

      try {
        await smtpSend({
          host: smtpHost,
          port: account.smtp_port === null ? 587 : Number(account.smtp_port),
          tls: Boolean(account.smtp_tls),
          user: auth.user,
          envelopeFrom: String(account.email_address),
          recipients,
          rfc822: outgoingRfc822,
          ...(auth.password !== undefined ? { password: auth.password } : {}),
          ...(auth.accessToken !== undefined ? { accessToken: auth.accessToken } : {}),
        });
      } catch (error) {
        const message = errorMessage(error);
        const { smtpCode } = smtpCodeFromError(message);
        // A permanent (5xx) rejection from the downstream SMTP server — bad
        // recipient, mailbox unavailable, auth revoked — is never going to
        // succeed on retry. Telling the sender to retry it (451) forever just
        // wastes downstream connections and, combined with the dedup-key
        // fix above, could otherwise re-attempt a doomed send indefinitely.
        // Anything else (timeout, connection reset, no code parsed) stays
        // retryable, matching prior behaviour.
        const retryable = smtpCode === undefined || smtpCode < 500;
        await emailTracking?.recordSmtpFailed({
          workspaceId,
          messageId,
          trackingMessageId,
          stage: 'send',
          ...(smtpCode === undefined ? {} : { smtpCode }),
        }).catch(() => undefined);
        return failSend(message, retryable);
      }

      await emailTracking?.recordSmtpAccepted({
        workspaceId,
        messageId,
        trackingMessageId,
        smtpCode: 250,
        acceptedRecipientCount: recipients.length,
        rejectedRecipientCount: 0,
      }).catch(() => undefined);

      // 8. Mark relayed FIRST, before the best-effort Sent-copy below. SMTP
      //    already accepted the message, so a bookkeeping failure here must
      //    NOT surface as retryable (the sender would re-send a delivered
      //    mail) — log and continue instead. Doing this before the IMAP
      //    append (rather than after) shrinks the window between "message
      //    actually sent" and "row marked relayed": persistMessage only
      //    short-circuits a same-dedup-key retry once status is 'relayed',
      //    so every extra await between accept and this write is time during
      //    which a crash/hang + ERP retry would resend an already-delivered
      //    message.
      try {
        await store.updateSubmission({
          workspaceId,
          submissionId,
          status: 'relayed',
          trackingApplied: trackingMessageId !== null,
          errorText: null,
        });
      } catch (error) {
        log('relay submission could not be marked relayed', {
          workspaceId,
          submissionId,
          error: errorMessage(error),
        });
      }

      // 9. Best-effort Sent-folder copy — never fatal, and no longer gates
      //    marking the submission relayed (see above).
      if (deps.sentCopyAppender) {
        try {
          const copy = await deps.sentCopyAppender.append({
            workspaceId,
            accountId: Number(account.id),
            rfc822: outgoingRfc822,
          });
          if (!copy.ok) {
            log('relay sent copy failed', { workspaceId, messageId, error: copy.error });
          }
        } catch (error) {
          log('relay sent copy failed', { workspaceId, messageId, error: errorMessage(error) });
        }
      }

      // 10. Optional follow-up workflow — fail-open, and ONLY when tracking was
      //     actually applied (a tracking row/token exists). The relay-dunning
      //     template waits 2x7 days before email.read_tracking_evidence, then
      //     stops on tracking.tracked=false — so enqueuing it for untracked
      //     traffic (subject didn't match, or prepareOutbound failed open) just
      //     accumulates long-lived delayed jobs/runs that can never act.
      if (config.followupWorkflowId !== null && trackingMessageId !== null) {
        try {
          await store.enqueueFollowup({
            workspaceId,
            workflowId: config.followupWorkflowId,
            messageId,
            // First-class core WorkflowTriggerKind: direction 'outbound',
            // needs the persisted message (tracking evidence follow-up).
            triggerName: 'relay',
            context: {
              relay: {
                relayId,
                submissionId,
                subject,
                recipientCount: recipients.length,
                tracked: trackingMessageId !== null,
              },
              source: 'server_relay_submission',
            },
          });
        } catch (error) {
          log('relay follow-up workflow enqueue failed', {
            workspaceId,
            messageId,
            workflowId: config.followupWorkflowId,
            error: errorMessage(error),
          });
        }
      }

      return { ok: true, messageId, tracked: trackingMessageId !== null };
    },
  };
}

// ---------------------------------------------------------------------------
// Pure RFC822 header helpers
// ---------------------------------------------------------------------------

/**
 * Removes every `X-SimpleCRM-*` header AND any top-level `Bcc:`/`Resent-Bcc:`
 * (including folded continuation lines) from the header block only. The body —
 * everything from the first blank line on — is preserved byte-for-byte (latin1
 * round-trip), so MIME part headers inside the body are never touched.
 *
 * Dropping Bcc is required of a submission agent (RFC 6409 §8.3): the ERP puts
 * blind recipients on the SMTP envelope (RCPT TO) and often ALSO leaves a `Bcc:`
 * header in DATA. On the untracked pass-through we forward DATA verbatim, so
 * without this that header is delivered to every recipient, exposing the blind
 * addresses. (The tracked-rebuild path never re-emits bccJson, so it is safe.)
 */
export function stripSimplecrmHeaders(rfc822: Buffer): Buffer {
  const source = rfc822.toString('latin1');
  const { headerLines, rest } = splitRfc822HeaderBlock(source);
  const kept: string[] = [];
  let skippingFold = false;
  for (const line of headerLines) {
    if (/^[ \t]/.test(line)) {
      // Continuation of the previous header line.
      if (!skippingFold) kept.push(line);
      continue;
    }
    if (/^x-simplecrm-[^:]*:/i.test(line) || /^(?:bcc|resent-bcc)[ \t]*:/i.test(line)) {
      skippingFold = true;
      continue;
    }
    skippingFold = false;
    kept.push(line);
  }
  return Buffer.from(kept.join('') + rest, 'latin1');
}

/** Parses the `X-SimpleCRM-Track` header ('on'/'off', case-insensitive). */
export function parseRelayTrackingHeaderOverride(
  rfc822: Buffer,
): RelayTrackingHeaderOverride | null {
  const value = readTopLevelHeaderValue(rfc822, 'x-simplecrm-track')?.toLowerCase() ?? null;
  return value === 'on' || value === 'off' ? value : null;
}

/**
 * Splits an RFC822 string into top-level header lines (terminators preserved)
 * and the remainder starting at the blank separator line. A message without a
 * blank line is treated as headers-only.
 */
function splitRfc822HeaderBlock(source: string): { headerLines: string[]; rest: string } {
  const match = /(\r?\n)(\r?\n)/.exec(source);
  const headerEnd = match ? match.index + match[1]!.length : source.length;
  const headerSection = source.slice(0, headerEnd);
  const rest = source.slice(headerEnd);
  return {
    headerLines: headerSection.length > 0 ? headerSection.split(/(?<=\n)/) : [],
    rest,
  };
}

function readTopLevelHeaderValue(rfc822: Buffer, lowerCaseName: string): string | null {
  const { headerLines } = splitRfc822HeaderBlock(rfc822.toString('latin1'));
  const prefix = `${lowerCaseName}:`;
  for (let index = 0; index < headerLines.length; index += 1) {
    const line = headerLines[index]!;
    if (!line.toLowerCase().startsWith(prefix)) continue;
    let value = line.slice(prefix.length);
    for (
      let next = index + 1;
      next < headerLines.length && /^[ \t]/.test(headerLines[next]!);
      next += 1
    ) {
      value += ` ${headerLines[next]!}`;
    }
    return value.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return null;
}

// ---------------------------------------------------------------------------
// Small mapping helpers
// ---------------------------------------------------------------------------

function composeSendAccountFromRoutingAccount(
  account: SmtpRelayRoutingAccount,
): ComposeSendAccount {
  return {
    id: Number(account.id),
    sourceSqliteId: Number(account.source_sqlite_id),
    displayName: String(account.display_name ?? ''),
    emailAddress: String(account.email_address ?? ''),
    // Not part of the relay routing columns and not needed by resolveSmtpAuth.
    imapHost: '',
    imapUsername: String(account.imap_username ?? ''),
    smtpHost: account.smtp_host,
    smtpPort: account.smtp_port === null ? null : Number(account.smtp_port),
    smtpTls: Boolean(account.smtp_tls),
    smtpUsername: account.smtp_username,
    smtpUseImapAuth: Boolean(account.smtp_use_imap_auth),
    oauthProvider: account.oauth_provider,
    protocol: String(account.protocol ?? 'imap'),
    requestReadReceipt: false,
  };
}

function composeAttachmentsFromParsed(
  attachments: readonly ServerMailSyncParsedAttachment[] | undefined,
): ComposeRfc822Attachment[] {
  return (attachments ?? []).map((attachment) => ({
    filename: attachment.filename,
    content: attachment.content,
    ...(attachment.contentType ? { contentType: attachment.contentType } : {}),
  }));
}

function parsedAddressEntries(value: unknown): Array<{ address: string; name: string }> {
  const parsed = typeof value === 'string' ? safeJsonParse(value) : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const list = (parsed as { value?: unknown }).value;
  if (!Array.isArray(list)) return [];
  const entries: Array<{ address: string; name: string }> = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const address = String((entry as { address?: unknown }).address ?? '').trim();
    if (!address) continue;
    const name = String((entry as { name?: unknown }).name ?? '').trim();
    entries.push({ address, name });
  }
  return entries;
}

function mailboxListFromAddressJson(value: unknown): string {
  return parsedAddressEntries(value)
    .map((entry) => (entry.name ? `${entry.name} <${entry.address}>` : entry.address))
    .join(', ');
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function failure(
  code: RelaySubmissionFailureCode,
  message: string,
  retryable: boolean,
): RelaySubmissionResult {
  return { ok: false, code, message, retryable };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function smtpCodeFromError(message: string): { smtpCode?: number } {
  const match = /(?:^|\s)([45]\d{2})(?:\s|$)/.exec(message);
  return match ? { smtpCode: Number(match[1]) } : {};
}

/** Deterministic dedup key for a relayed submission, stable across true retries
 *  (identical identity + identical envelope, e.g. an ERP resend after a lost
 *  SMTP response) yet distinct per recipient set.
 *
 *  The envelope (sender + recipients) MUST be part of the key: a Bcc-only /
 *  undisclosed-recipients fan-out sends the SAME message — same Message-ID and
 *  byte-identical DATA — in separate transactions, one per recipient batch.
 *  Keying on the identity alone would treat every batch after the first as a
 *  replay and silently drop it, so those recipients would never receive the
 *  mail. `identity` is the ERP's Message-ID when present (stable across retries,
 *  unlike our re-minted wire id) or the raw bytes otherwise. Addresses use an
 *  EXACT case-insensitive canonicalization (trim + lowercase) — NOT
 *  normalizeEmailAddress, which folds plus-tags: on a domain where
 *  kunde@x and kunde+shop@x are distinct mailboxes, folding them would make a
 *  Bcc batch to the second collide with the first and be dropped as a replay.
 *  Recipients are sorted so RCPT ordering does not change the key. */
function hashRelaySubmissionForDedup(
  relayId: string,
  envelopeFrom: string,
  recipients: readonly string[],
  identity: string | Buffer,
): string {
  const canonical = (address: string): string => address.trim().toLowerCase();
  const hash = createHash('sha256').update(relayId).update('\0');
  hash.update(canonical(envelopeFrom)).update('\0');
  const normalizedRecipients = recipients.map(canonical).sort();
  for (const recipient of normalizedRecipients) hash.update(recipient).update('\0');
  return `sha256:${hash.update(identity).digest('hex')}`;
}

// ---------------------------------------------------------------------------
// Postgres store (thin, SQL-only)
// ---------------------------------------------------------------------------

export type PostgresRelaySubmissionStoreOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
  now?: () => Date;
}>;

/** Local drafts/sent copies use negative uids above the POP3 pseudo-uid range
 *  (mirrors nextLocalDraftUid in postgres-mail-read-ports.ts). */
const POP3_UID_CEILING = -1_000_000;

export function createPostgresRelaySubmissionStore(
  options: PostgresRelaySubmissionStoreOptions,
): RelaySubmissionStore {
  const now = options.now ?? (() => new Date());

  return {
    async persistMessage(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const timestamp = now();

          if (input.dedupKey) {
            const existing = await trx
              .selectFrom('smtp_relay_submissions')
              .select(['id', 'status', 'message_id', 'updated_at'])
              .where('workspace_id', '=', input.workspaceId)
              .where('relay_id', '=', input.relayId)
              .where('dedup_key', '=', input.dedupKey)
              // Lock the row so a concurrent retry of the SAME dedup key
              // serializes here instead of both racing past to smtpSend.
              .forUpdate()
              .executeTakeFirst();
            if (existing?.status === 'relayed') {
              return {
                alreadyRelayed: true as const,
                messageId: existing.message_id === null ? null : Number(existing.message_id),
              };
            }
            if (existing && existing.status === 'received'
              && timestamp.getTime() - toEpochMs(existing.updated_at) < RELAY_INFLIGHT_STALE_MS) {
              // A 'received' row touched recently means another attempt is
              // between persistence and SMTP-accept — retrying now would deliver
              // twice. Defer this attempt (the caller returns a retryable 451);
              // once the first finishes the row is 'relayed' and the next retry
              // short-circuits. A STALE 'received' (crashed mid-send) or a
              // 'failed' row falls through and is retried below.
              return { inFlight: true as const };
            }
            if (existing) {
              // Retry of a previously failed/interrupted submission with the
              // same dedup key: reuse the audit row (UNIQUE constraint) and
              // the already persisted message instead of duplicating it. The
              // outgoing bytes for THIS attempt are rebuilt from the current
              // payload (see submitRelay), so refresh the stored content to
              // match what is actually about to go out on the wire — an ERP
              // retry can legitimately carry corrected content under the same
              // Message-ID, and the persisted row is the DSGVO/audit record
              // of what was communicated.
              const messageId = existing.message_id === null
                ? await insertRelayedMessage(trx, input, timestamp)
                : await updateRelayedMessageContent(trx, Number(existing.message_id), input, timestamp);
              await trx
                .updateTable('smtp_relay_submissions')
                .set({
                  status: 'received',
                  // Refresh the credential to THIS attempt's: an ERP retry may
                  // authenticate with a different (e.g. rotated) credential, and
                  // the audit row must attribute the send to the credential that
                  // actually delivered it — not the first attempt's — for
                  // revocation/forensics.
                  credential_id: input.credentialId,
                  account_id: input.accountId,
                  message_id: messageId,
                  tracking_applied: input.trackingApplied,
                  tracking_rule_reason: input.trackingRuleReason,
                  recipient_count: input.recipientCount,
                  smtp_message_id_header: input.messageIdHeader,
                  error_text: null,
                  updated_at: timestamp,
                })
                .where('workspace_id', '=', input.workspaceId)
                .where('id', '=', String(existing.id))
                .execute();
              return {
                alreadyRelayed: false as const,
                messageId,
                submissionId: String(existing.id),
              };
            }
          }

          const messageId = await insertRelayedMessage(trx, input, timestamp);
          const submission = await trx
            .insertInto('smtp_relay_submissions')
            .values({
              workspace_id: input.workspaceId,
              relay_id: input.relayId,
              credential_id: input.credentialId,
              account_id: input.accountId,
              message_id: messageId,
              tracking_applied: input.trackingApplied,
              tracking_rule_reason: input.trackingRuleReason,
              status: 'received',
              smtp_message_id_header: input.messageIdHeader,
              dedup_key: input.dedupKey,
              recipient_count: input.recipientCount,
              error_text: null,
              created_at: timestamp,
              updated_at: timestamp,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          return {
            alreadyRelayed: false as const,
            messageId,
            submissionId: String(submission.id),
          };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },

    async updateSubmission(input) {
      await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          await trx
            .updateTable('smtp_relay_submissions')
            .set({
              status: input.status,
              tracking_applied: input.trackingApplied,
              error_text: input.errorText,
              updated_at: now(),
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.submissionId)
            .execute();
        },
        { applySession: options.applyWorkspaceSession },
      );
    },

    async enqueueFollowup(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const timestamp = now();
          const workflow = await trx
            .selectFrom('email_workflows')
            .select(['id', 'source_sqlite_id', 'enabled', 'trigger_name'])
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.workflowId)
            .executeTakeFirst();
          // Re-check the trigger at enqueue time, not just at attach time: the
          // workflow could have been edited from 'relay' to another trigger
          // after it was attached, and runServerWorkflowGraph would otherwise
          // run it against the relayed message via the first-trigger fallback.
          if (!workflow || !workflow.enabled || workflow.trigger_name !== 'relay') return null;
          const message = await trx
            .selectFrom('email_messages')
            .select(['id', 'source_sqlite_id'])
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.messageId)
            .executeTakeFirst();
          if (!message) return null;

          const workflowId = Number(workflow.id);
          const run = await trx
            .insertInto('email_workflow_runs')
            .values({
              workspace_id: input.workspaceId,
              source_sqlite_id: null,
              workflow_source_sqlite_id: workflow.source_sqlite_id === null
                ? -workflowId
                : Number(workflow.source_sqlite_id),
              message_source_sqlite_id: Number(message.source_sqlite_id),
              workflow_id: workflowId,
              message_id: input.messageId,
              direction: 'outbound',
              status: 'queued',
              // jsonb column: stringify the array so node-postgres sends valid
              // JSON instead of a Postgres array literal ({...}).
              log_json: JSON.stringify(['queued:server_relay_followup']),
              source_row: relaySourceRow(),
              imported_in_run_id: null,
              started_at: null,
              finished_at: null,
              updated_at: timestamp,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          const runId = Number(run.id);

          await trx
            .insertInto('job_queue')
            .values({
              type: 'workflow.execute',
              payload: {
                workspaceId: input.workspaceId,
                workflowId,
                messageId: input.messageId,
                runId,
                triggerName: input.triggerName,
                ...(input.context === undefined ? {} : { context: input.context }),
              },
              run_after: timestamp,
              max_attempts: 5,
              workspace_id: input.workspaceId,
              updated_at: timestamp,
            })
            .execute();
          return { runId };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },

    async getSyncInfo(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const rows = await trx
            .selectFrom('sync_info')
            .select(['key', 'value'])
            .where('workspace_id', '=', input.workspaceId)
            .where('key', 'in', input.keys)
            .execute();
          const values = new Map<string, string | null>();
          for (const key of input.keys) values.set(key, null);
          for (const row of rows) values.set(row.key, row.value);
          return values;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

/** Mirrors createPostgresComposeDraftInTransaction's email_messages insert for
 *  an already-built relayed message stored with folder_kind 'sent'. */
async function insertRelayedMessage(
  trx: WorkspaceTransaction,
  input: RelaySubmissionPersistInput,
  timestamp: Date,
): Promise<number> {
  const folder = await ensureRelayAnchorFolder(trx, input, timestamp);
  const customer = await resolveCustomerForRecipient(
    trx,
    input.workspaceId,
    input.firstRecipient,
  );
  const uid = await nextLocalRelayUid(trx, input.workspaceId, input.accountId, folder.id);

  const row = await trx
    .insertInto('email_messages')
    .values({
      workspace_id: input.workspaceId,
      source_sqlite_id: serverCreatedEmailMessageSourceSqliteId(),
      account_source_sqlite_id: input.accountSourceSqliteId,
      folder_source_sqlite_id: folder.sourceSqliteId,
      account_id: input.accountId,
      folder_id: folder.id,
      uid,
      message_id: input.messageIdHeader,
      in_reply_to: input.inReplyTo,
      references_header: input.referencesHeader,
      subject: input.subject || '(Ohne Betreff)',
      from_json: input.fromJson,
      to_json: input.toJson,
      cc_json: input.ccJson,
      bcc_json: input.bccJson,
      date_received: timestamp,
      snippet: input.snippet,
      body_text: input.bodyText,
      body_html: input.bodyHtml,
      seen_local: true,
      done_local: false,
      sent_imap_sync_failed: false,
      archived: false,
      soft_deleted: false,
      outbound_hold: false,
      outbound_block_reason: null,
      thread_id: null,
      ticket_code: null,
      customer_source_sqlite_id: customer?.sourceSqliteId ?? null,
      customer_id: customer?.id ?? null,
      folder_kind: 'sent',
      imap_thread_id: null,
      has_attachments: input.hasAttachments,
      attachments_json: input.attachmentsJson,
      draft_attachment_paths_json: null,
      post_process_done: false,
      reply_parent_message_id: null,
      assigned_to: null,
      legacy_assigned_to_user_id: null,
      assigned_to_user_id: null,
      is_spam: false,
      spam_status: 'clean',
      snoozed_until: null,
      scheduled_send_at: null,
      pop3_uidl: null,
      remote_content_policy: 'blocked',
      read_receipt_requested: false,
      thread_resolver_version: 0,
      source_row: relaySourceRow(),
      created_at: timestamp,
      updated_at: timestamp,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return Number(row.id);
}

/** Refreshes a previously persisted (but not yet successfully relayed)
 *  email_messages row with the current attempt's content. A retry can
 *  legitimately carry corrected content under the same dedup key, and the
 *  outgoing bytes actually sent are always rebuilt from the current attempt
 *  (see submitRelay) — so the stored audit row must track it, not the first
 *  attempt's now-stale content. */
async function updateRelayedMessageContent(
  trx: WorkspaceTransaction,
  messageId: number,
  input: RelaySubmissionPersistInput,
  timestamp: Date,
): Promise<number> {
  // A retry can legitimately carry corrected recipients under the same
  // dedup key — re-resolve the customer link from the CURRENT firstRecipient
  // rather than leaving the first attempt's linkage in place, since the
  // relay follow-up task reads customer_id off this row.
  const customer = await resolveCustomerForRecipient(
    trx,
    input.workspaceId,
    input.firstRecipient,
  );
  // The routing account can also legitimately differ between attempts (the
  // From-address mapping or allowed-accounts config changed between the
  // failed first attempt and the retry) — the send always goes out through
  // the CURRENT account, so the anchor folder/uid must move with it or the
  // audit row keeps pointing at whichever mailbox happened to route the
  // first attempt.
  const folder = await ensureRelayAnchorFolder(trx, input, timestamp);
  const uid = await nextLocalRelayUid(trx, input.workspaceId, input.accountId, folder.id);
  await trx
    .updateTable('email_messages')
    .set({
      account_id: input.accountId,
      account_source_sqlite_id: input.accountSourceSqliteId,
      folder_id: folder.id,
      folder_source_sqlite_id: folder.sourceSqliteId,
      uid,
      message_id: input.messageIdHeader,
      in_reply_to: input.inReplyTo,
      references_header: input.referencesHeader,
      subject: input.subject || '(Ohne Betreff)',
      from_json: input.fromJson,
      to_json: input.toJson,
      cc_json: input.ccJson,
      bcc_json: input.bccJson,
      snippet: input.snippet,
      body_text: input.bodyText,
      body_html: input.bodyHtml,
      has_attachments: input.hasAttachments,
      attachments_json: input.attachmentsJson,
      customer_source_sqlite_id: customer?.sourceSqliteId ?? null,
      customer_id: customer?.id ?? null,
      updated_at: timestamp,
    })
    .where('workspace_id', '=', input.workspaceId)
    .where('id', '=', messageId)
    .execute();
  return messageId;
}

/** Same folder anchor as ensureServerComposeDraftFolder (postgres-mail-read-
 *  ports.ts, module-private there): locally created messages hang off the
 *  account's INBOX folder row; folder_kind carries the 'sent' semantics. */
async function ensureRelayAnchorFolder(
  trx: WorkspaceTransaction,
  input: Pick<RelaySubmissionPersistInput, 'workspaceId' | 'accountId' | 'accountSourceSqliteId'>,
  timestamp: Date,
): Promise<{ id: number; sourceSqliteId: number }> {
  const existing = await trx
    .selectFrom('email_folders')
    .select(['id', 'source_sqlite_id'])
    .where('workspace_id', '=', input.workspaceId)
    .where('account_id', '=', input.accountId)
    .where((eb) => eb.or([
      eb('path', '=', 'INBOX'),
      eb('path', '=', 'Inbox'),
      eb('path', '=', 'inbox'),
    ]))
    .orderBy('id', 'asc')
    .executeTakeFirst();
  if (existing) {
    return { id: Number(existing.id), sourceSqliteId: Number(existing.source_sqlite_id) };
  }

  const inserted = await trx
    .insertInto('email_folders')
    .values({
      workspace_id: input.workspaceId,
      source_sqlite_id: serverCreatedEmailFolderSourceSqliteId(),
      account_source_sqlite_id: input.accountSourceSqliteId,
      account_id: input.accountId,
      path: 'INBOX',
      delimiter: '/',
      uidvalidity: null,
      uidvalidity_str: null,
      last_uid: 0,
      last_synced_at: null,
      pop3_uidl_str: null,
      source_row: relaySourceRow(),
      imported_in_run_id: null,
      updated_at: timestamp,
    })
    .onConflict((oc) => oc.columns(['workspace_id', 'account_source_sqlite_id', 'path']).doUpdateSet({
      account_id: input.accountId,
      updated_at: timestamp,
    }))
    .returning(['id', 'source_sqlite_id'])
    .executeTakeFirstOrThrow();
  return { id: Number(inserted.id), sourceSqliteId: Number(inserted.source_sqlite_id) };
}

/** Next free negative uid for locally created rows (mirror of the module-
 *  private nextLocalDraftUid in postgres-mail-read-ports.ts). */
async function nextLocalRelayUid(
  trx: WorkspaceTransaction,
  workspaceId: string,
  accountId: number,
  folderId: number,
): Promise<number> {
  // Serialize UID allocation per folder: lock the folder row so two concurrent
  // relay persists for the same account/folder cannot both read the same
  // min(uid) and pick the same next negative uid (which the local-uid UNIQUE
  // constraint would then reject, spuriously deferring one as persist_failed).
  await trx
    .selectFrom('email_folders')
    .select('id')
    .where('id', '=', folderId)
    .forUpdate()
    .executeTakeFirst();
  const row = await trx
    .selectFrom('email_messages')
    .select((eb) => eb.fn.min<number>('uid').as('min_uid'))
    .where('workspace_id', '=', workspaceId)
    .where('account_id', '=', accountId)
    .where('folder_id', '=', folderId)
    .where('uid', '<', 0)
    .where('uid', '>', POP3_UID_CEILING)
    .executeTakeFirst();
  return row?.min_uid != null ? Number(row.min_uid) - 1 : -1;
}

/** Customer linkage by FIRST recipient — same matching shape as
 *  backfillCustomerLinks (normalizeEmailAddress on both sides, first match). */
async function resolveCustomerForRecipient(
  trx: WorkspaceTransaction,
  workspaceId: string,
  firstRecipient: string | null,
): Promise<{ id: number; sourceSqliteId: number } | null> {
  if (!firstRecipient) return null;
  const target = normalizeEmailAddress(firstRecipient);
  if (!target) return null;

  const customers = await trx
    .selectFrom('customers')
    .select(['id', 'source_sqlite_id', 'email'])
    .where('workspace_id', '=', workspaceId)
    .where(kyselySql<boolean>`email IS NOT NULL AND btrim(email) <> ''`)
    .execute();
  for (const customer of customers) {
    if (normalizeEmailAddress(String(customer.email ?? '')) === target) {
      return {
        id: Number(customer.id),
        sourceSqliteId: Number(customer.source_sqlite_id),
      };
    }
  }
  return null;
}

function relaySourceRow(): Record<string, string> {
  return { origin: 'server_relay' };
}
