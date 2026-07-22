import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { sql as kyselySql, type Kysely, type RawBuilder } from 'kysely';
import {
  addressJson,
  buildComposeRfc822,
  type ComposeRfc822Attachment,
  buildOutboundThreadingHeaders,
  buildOutboundWarningBanner,
  ensureTicketInSubject,
  extractDraftBodyForOutboundBlock,
  extractTicketFromSubject,
  generateOutboundMessageId,
  generateTicketCode,
  outboundDraftFingerprint,
  parseOutboundApprovalMarker,
  resolveConfiguredSmtpHost,
  SMTP_HOST_MISSING_ERROR,
} from '@simplecrm/core';

import type {
  EmailComposeSenderApiPort,
  EmailComposeSendInput,
  EmailComposeSendResult,
  EmailOAuthProvider,
  EmailOutboundValidationApiPort,
  EmailOutboundValidationInput,
  PgpMessageCryptoApiPort,
} from './api';
import type { WorkflowExecutionDryRunResult, WorkflowExecutionJobPlan } from './jobs';
import { resolveAttachmentStoragePath, type PostgresSecretPort, type SecretIdentifier } from './db';
import type { ServerDatabase } from './db/schema';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
  type WorkspaceTransaction,
} from './db/workspace-context';
import { computeTextChangeRatio } from './ai-feedback';
import { refreshServerEmailOAuthAccessToken } from './email-oauth';
import { buildDefaultServerAccountMailSettings } from './account-mail-settings-defaults';
import type {
  ServerImapSentCopyAppendInput,
  ServerImapSentCopyAppendResult,
} from './mail-imap-append';
import { sendSmtpMessage, SmtpPreDataSendError, type ServerSmtpSendInput } from './mail-smtp-send';
import { extractWorkspaceTicketFromSubject, listWorkspaceTicketPrefixes } from './mail-ticket-prefixes';
import type { EmailTrackingService } from './email-tracking';
import { outboundReviewApprovedKey, persistManualOutboundApproval } from './mail-outbound-approval-store';

export {
  OUTBOUND_REVIEW_APPROVED_PREFIX,
  outboundReviewApprovedKey,
  persistManualOutboundApproval,
} from './mail-outbound-approval-store';

const EMAIL_OAUTH_APP_KEYS: Record<EmailOAuthProvider, {
  clientId: string;
  clientSecret: string;
}> = {
  google: {
    clientId: 'email_google_oauth_client_id',
    clientSecret: 'email_google_oauth_client_secret',
  },
  microsoft: {
    clientId: 'email_ms_oauth_client_id',
    clientSecret: 'email_ms_oauth_client_secret',
  },
};

const COMPOSE_SEND_LOCK_PREFIX = 'email_compose_sending:';
const COMPOSE_SEND_LOCK_TTL_MS = 15 * 60 * 1000;
const COMPOSE_SMTP_COMMITTED_PREFIX = 'email_compose_smtp_ok:';
const COMPOSE_SMTP_OUTBOX_VALUE = 'outbox';
const COMPOSE_SMTP_SENT_VALUE = 'sent';
const COMPOSE_SMTP_COMMITTED_VALUE = '1';
const COMPOSE_SMTP_SNAPSHOT_PREFIX = 'sent:v2:';
const MAX_COMPOSE_SMTP_SNAPSHOT_BYTES = 96 * 1024 * 1024;
const AUTO_SUBMITTED_DRAFT_PREFIX = 'email_auto_submitted:';

export function autoSubmittedDraftKey(draftId: number): string {
  return `${AUTO_SUBMITTED_DRAFT_PREFIX}${draftId}`;
}

export type ComposeSmtpOutboxState = 'none' | 'outbox' | 'committed';
type ComposeSmtpCommitSnapshot = Readonly<{
  version: 2;
  draftMessageId: number;
  accountId: number;
  rfc822: string;
  inReplyToMessageId: number | null;
  markReplyParentDone: boolean | null;
  trackingMessageId: string | null;
  trackingWarning: string | null;
  recipientCount: number;
  sentCopyCompleted: boolean;
}>;
type StoredComposeSmtpState =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'outbox' }>
  | Readonly<{ kind: 'legacy' }>
  | Readonly<{ kind: 'invalid' }>
  | Readonly<{ kind: 'committed'; snapshot: ComposeSmtpCommitSnapshot }>;
const COMPOSE_MARK_PARENT_DONE_PREFIX = 'compose_mark_parent_done:';
/** Marker set by email.release_outbound (autoSend=true) after ai.outbound_review
 *  returned OK. reviewOutbound.review honours it as "already approved, just send",
 *  so the scheduled-send cron doesn't loop through the review again. */
const OUTBOUND_REVIEW_APPROVED_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_OUTBOUND_WORKFLOWS_PER_SEND = 50;
const OUTBOUND_REVIEW_REASON =
  'Ausgangspruefung wird serverseitig ausgefuehrt; Versand bleibt blockiert, bis die Pruefung abgeschlossen ist.';
const MAX_OUTBOUND_CONTEXT_TEXT = 20_000;

export function isOutboundReviewPendingError(error: string): boolean {
  const normalized = error.trim().toLowerCase();
  return normalized.includes('ausgangspruefung') && normalized.includes('serverseitig');
}

const MAX_SERVER_COMPOSE_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_SERVER_COMPOSE_ATTACHMENT_TOTAL_BYTES = 50 * 1024 * 1024;

type ComposeSendDraft = Readonly<{
  id: number;
  accountId: number | null;
  uid: number;
  folderKind: string;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  messageIdHeader: string | null;
  inReplyToHeader: string | null;
  referencesHeader: string | null;
  ticketCode: string | null;
  threadId: string | null;
  draftAttachmentPathsJson: unknown | null;
  outboundHold: boolean;
  outboundBlockReason: string | null;
}>;

export type ComposeSendAccount = Readonly<{
  id: number;
  sourceSqliteId: number;
  displayName: string;
  emailAddress: string;
  imapHost: string;
  imapUsername: string;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpTls: boolean;
  smtpUsername: string | null;
  smtpUseImapAuth: boolean;
  oauthProvider: string | null;
  protocol: string;
  requestReadReceipt: boolean;
}>;

type ComposeSendParentMessage = Readonly<{
  id: number;
  messageIdHeader: string | null;
  referencesHeader: string | null;
  ticketCode: string | null;
  threadId: string | null;
}>;

export type ComposeSenderStore = Readonly<{
  getDraft(input: {
    workspaceId: string;
    messageId: number;
  }): Promise<ComposeSendDraft | null>;
  getAccount(input: {
    workspaceId: string;
    accountId: number;
  }): Promise<ComposeSendAccount | null>;
  getParentMessage(input: {
    workspaceId: string;
    messageId: number;
  }): Promise<ComposeSendParentMessage | null>;
  getOrCreateThreadForTicket(input: {
    workspaceId: string;
    ticketCode: string;
    accountId?: number | null;
    subject: string;
  }): Promise<string>;
  listKnownTicketPrefixes?(input: {
    workspaceId: string;
  }): Promise<readonly string[]>;
  allocateNextTicketCodeForAccount?(input: {
    workspaceId: string;
    account: ComposeSendAccount;
  }): Promise<string>;
  readSecret?(input: SecretIdentifier): Promise<Buffer | null>;
  writeSecret?(input: SecretIdentifier & { value: string | Buffer }): Promise<unknown>;
  getSyncInfo(input: {
    workspaceId: string;
    keys: readonly string[];
  }): Promise<ReadonlyMap<string, string | null>>;
  setSyncInfo(input: {
    workspaceId: string;
    values: Readonly<Record<string, string | null>>;
  }): Promise<void>;
  deleteSyncInfo(input: {
    workspaceId: string;
    keys: readonly string[];
  }): Promise<void>;
  claimSmtpOutbox(input: {
    workspaceId: string;
    messageId: number;
  }): Promise<'claimed' | 'outbox' | 'committed'>;
  tryAcquireSendingLock(input: {
    workspaceId: string;
    messageId: number;
  }): Promise<boolean>;
  refreshSendingLock?(input: {
    workspaceId: string;
    messageId: number;
  }): Promise<boolean>;
  releaseSendingLock(input: {
    workspaceId: string;
    messageId: number;
  }): Promise<void>;
  updateDraftForSend(input: {
    workspaceId: string;
    messageId: number;
    subject: string;
    bodyText: string;
    bodyHtml: string | null;
    fromJson: unknown | null;
    toJson: unknown | null;
    ccJson: unknown | null;
    bccJson: unknown | null;
    ticketCode: string;
    threadId: string;
    outboundMessageId: string;
    inReplyTo: string | null;
    references: string | null;
  }): Promise<void>;
  markDraftAsSent(input: {
    workspaceId: string;
    messageId: number;
    sentImapSyncFailed: boolean;
  }): Promise<void>;
  markMessageDone(input: {
    workspaceId: string;
    messageId: number;
    done: boolean;
  }): Promise<void>;
}>;

export type ComposeOutboundReviewInput = Readonly<{
  workspaceId: string;
  actorUserId: string;
  draftMessageId: number;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  to: string;
  cc?: string;
  bcc?: string;
  inReplyToMessageId?: number | null;
  attachmentCount: number;
  attachmentPaths?: readonly string[];
}>;

export type ComposeOutboundReviewResult =
  | { allowed: true }
  | { allowed: false; error: string; workflowRunId?: number | null };

export type ComposeOutboundReviewPort = Readonly<{
  review(input: ComposeOutboundReviewInput): Promise<ComposeOutboundReviewResult>;
}>;

export type ComposeSenderOptions = Readonly<{
  store: ComposeSenderStore;
  attachmentsRoot?: string;
  smtpSend?: (input: ServerSmtpSendInput) => Promise<void>;
  sentCopyAppend?: (input: ServerImapSentCopyAppendInput) => Promise<ServerImapSentCopyAppendResult>;
  outboundReview?: ComposeOutboundReviewPort;
  pgpMessages?: Pick<PgpMessageCryptoApiPort, 'prepareOutboundBody' | 'prepareOutboundAttachments'>;
  oauthFetchImpl?: typeof fetch;
  now?: () => Date;
  tracking?: Pick<EmailTrackingService, 'prepareOutbound' | 'recordSending' | 'recordSmtpAccepted' | 'recordSmtpFailed'>;
}>;

export type PostgresComposeSenderOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  attachmentsRoot?: string;
  secrets?: PostgresSecretPort;
  smtpSend?: (input: ServerSmtpSendInput) => Promise<void>;
  sentCopyAppend?: (input: ServerImapSentCopyAppendInput) => Promise<ServerImapSentCopyAppendResult>;
  outboundReview?: ComposeOutboundReviewPort;
  workflowDryRun?: (input: WorkflowExecutionJobPlan) => Promise<WorkflowExecutionDryRunResult>;
  pgpMessages?: Pick<PgpMessageCryptoApiPort, 'prepareOutboundBody' | 'prepareOutboundAttachments'>;
  oauthFetchImpl?: typeof fetch;
  now?: () => Date;
  tracking?: Pick<EmailTrackingService, 'prepareOutbound' | 'recordSending' | 'recordSmtpAccepted' | 'recordSmtpFailed'>;
}>;

export function createEmailComposeSenderPort(options: ComposeSenderOptions): EmailComposeSenderApiPort {
  const smtpSend = options.smtpSend ?? sendSmtpMessage;
  const sentCopyAppend = options.sentCopyAppend;
  const outboundReview = options.outboundReview;
  const tracking = options.tracking;
  const now = options.now ?? (() => new Date());

  return {
    async send(input) {
      const values = input.values;

      const draft = await options.store.getDraft({
        workspaceId: input.workspaceId,
        messageId: values.draftMessageId,
      });
      if (!draft || draft.uid >= 0) return { ok: false, error: 'Ungueltiger Entwurf' };
      if (draft.folderKind === 'sent') {
        return { ok: true, messageId: draft.id, accountId: draft.accountId };
      }

      const locked = await options.store.tryAcquireSendingLock({
        workspaceId: input.workspaceId,
        messageId: values.draftMessageId,
      });
      if (!locked) {
        return { ok: false, error: 'Versand laeuft bereits fuer diesen Entwurf.' };
      }

      try {
        const storedState = await readStoredSmtpState(
          options.store,
          input.workspaceId,
          values.draftMessageId,
        );
        const recovered = await recoverStoredSmtpState({
          state: storedState,
          store: options.store,
          append: sentCopyAppend,
          tracking,
          workspaceId: input.workspaceId,
          draftMessageId: values.draftMessageId,
        });
        if (recovered) return recovered;

        if (draft.accountId !== values.accountId) {
          return { ok: false, error: 'Entwurf gehoert zu einem anderen Konto' };
        }
        const recipientError = validateComposeRecipients(values);
        if (recipientError) return { ok: false, error: recipientError };

        const account = await options.store.getAccount({
          workspaceId: input.workspaceId,
          accountId: values.accountId,
        });
        if (!account) return { ok: false, error: 'Konto nicht gefunden' };

        let bodyText = values.bodyText;
        let html = Object.prototype.hasOwnProperty.call(values, 'bodyHtml')
          ? values.bodyHtml ?? null
          : draft.bodyHtml ?? null;
        const toJson = recipientJsonObjectFromField(values.to);
        const ccJson = values.cc?.trim() ? recipientJsonObjectFromField(values.cc) : null;
        const bccJson = values.bcc?.trim() ? recipientJsonObjectFromField(values.bcc) : null;
        const smtpTo = extractEmailAddressesFromRecipientField(values.to);
        const smtpCc = values.cc?.trim() ? extractEmailAddressesFromRecipientField(values.cc) : [];
        const smtpBcc = values.bcc?.trim() ? extractEmailAddressesFromRecipientField(values.bcc) : [];
        const recipients = [...new Set([...smtpTo, ...smtpCc, ...smtpBcc])];
        const attachmentResolution = resolveComposeAttachments({
          attachmentPaths: values.attachmentPaths,
          attachmentsRoot: options.attachmentsRoot,
        });
        if (!attachmentResolution.ok) return { ok: false, error: attachmentResolution.error };
        let attachments = attachmentResolution.attachments;

        if (values.pgpEncrypt || values.pgpSign) {
          if (!options.pgpMessages) {
            return { ok: false, error: 'PGP-Versand ist auf diesem Server nicht konfiguriert' };
          }
          if (values.pgpEncrypt && html?.trim()) {
            if (!bodyText.trim()) bodyText = htmlToPlainTextForPgp(html);
            html = null;
          }
          if (attachments.length > 0) {
            if (!options.pgpMessages.prepareOutboundAttachments) {
              return {
                ok: false,
                error: 'PGP-Versand mit Anhaengen ist auf diesem Server nicht konfiguriert',
              };
            }
            const attachmentInput = readComposeAttachmentsForPgp(attachments);
            if (!attachmentInput.ok) return { ok: false, error: attachmentInput.error };
            const pgpAttachments = await options.pgpMessages.prepareOutboundAttachments({
              workspaceId: input.workspaceId,
              actorUserId: input.actorUserId,
              attachments: attachmentInput.attachments,
              recipientEmails: recipients,
              encrypt: values.pgpEncrypt,
              sign: values.pgpSign,
              ...(values.pgpPassphrase === undefined ? {} : { passphrase: values.pgpPassphrase }),
            });
            if (!pgpAttachments.ok) return { ok: false, error: pgpAttachments.error };
            attachments = pgpAttachments.attachments.map((attachment) => ({
              filename: attachment.filename,
              ...(attachment.contentType ? { contentType: attachment.contentType } : {}),
              content: Buffer.from(attachment.content),
            }));
          }
          const pgpPrepared = await options.pgpMessages.prepareOutboundBody({
            workspaceId: input.workspaceId,
            actorUserId: input.actorUserId,
            bodyText,
            recipientEmails: recipients,
            encrypt: values.pgpEncrypt,
            sign: values.pgpSign,
            ...(values.pgpPassphrase === undefined ? {} : { passphrase: values.pgpPassphrase }),
          });
          if (!pgpPrepared.ok) return { ok: false, error: pgpPrepared.error };
          bodyText = pgpPrepared.bodyText;
          if (values.pgpEncrypt) html = null;
        }

        if (draft.outboundHold && !outboundReview) {
          return {
            ok: false,
            error: draft.outboundBlockReason || 'Outbound ist fuer diesen Entwurf blockiert',
          };
        }

        const prepared = await prepareDraftForSend({
          store: options.store,
          workspaceId: input.workspaceId,
          draft,
          account,
          input: values,
          bodyText,
          bodyHtml: html,
          toJson,
          ccJson,
          bccJson,
        });
        const from = formatMailbox(account.displayName, account.emailAddress);
        const requestReceipt = values.requestReadReceipt ?? account.requestReadReceipt;
        const autoSubmittedValues = await options.store.getSyncInfo({
          workspaceId: input.workspaceId,
          keys: [autoSubmittedDraftKey(values.draftMessageId)],
        });
        const autoSubmitted = autoSubmittedValues.get(
          autoSubmittedDraftKey(values.draftMessageId),
        ) === '1';

        if (outboundReview) {
          const review = await outboundReview.review({
            workspaceId: input.workspaceId,
            actorUserId: input.actorUserId,
            draftMessageId: values.draftMessageId,
            subject: prepared.finalSubject,
            bodyText,
            bodyHtml: html,
            to: values.to,
            ...(values.cc === undefined ? {} : { cc: values.cc }),
            ...(values.bcc === undefined ? {} : { bcc: values.bcc }),
            ...(values.inReplyToMessageId === undefined ? {} : { inReplyToMessageId: values.inReplyToMessageId }),
            attachmentCount: attachments.length,
            ...(values.attachmentPaths === undefined ? {} : { attachmentPaths: values.attachmentPaths }),
          });
          if (!review.allowed) {
            return {
              ok: false,
              error: review.error,
              ...(review.workflowRunId === undefined ? {} : { workflowRunId: review.workflowRunId }),
            };
          }
        }

        const auth = await resolveSmtpAuth({
          workspaceId: input.workspaceId,
          account,
          readSecret: options.store.readSecret,
          writeSecret: options.store.writeSecret,
          getSyncInfo: options.store.getSyncInfo,
          oauthFetchImpl: options.oauthFetchImpl,
        });
        if (!auth.ok) return { ok: false, error: auth.error };

        const smtpHost = resolveConfiguredSmtpHost(account.smtpHost);
        if (!smtpHost) return { ok: false, error: SMTP_HOST_MISSING_ERROR };

        let outboundHtml = html;
        let trackingMessageId: string | null = null;
        let trackingWarning: string | null = null;
        if (tracking) {
          try {
            const tracked = await tracking.prepareOutbound({
              workspaceId: input.workspaceId,
              messageId: values.draftMessageId,
              accountId: account.id,
              messageIdHeader: prepared.outboundMessageId,
              recipientCount: recipients.length,
              html,
              pgpProtected: values.pgpEncrypt === true || values.pgpSign === true,
              trackingOverride: values.trackingOverride ?? null,
            });
            outboundHtml = tracked.html;
            trackingMessageId = tracked.trackingMessageId;
            trackingWarning = tracked.warning;
          } catch {
            trackingWarning = 'E-Mail wurde ohne Nachverfolgung versendet, weil der Tracking-Dienst nicht erreichbar war.';
          }
        }
        const rfc822 = buildComposeRfc822({
          from,
          to: smtpTo.join(', '),
          cc: smtpCc.length > 0 ? smtpCc.join(', ') : undefined,
          subject: prepared.finalSubject,
          text: bodyText,
          html: outboundHtml?.trim() ? outboundHtml : undefined,
          messageId: prepared.outboundMessageId,
          inReplyTo: prepared.inReplyTo ?? undefined,
          references: prepared.references ?? undefined,
          requestReadReceipt: requestReceipt,
          attachments,
          ...(autoSubmitted ? { extraHeaders: ['Auto-Submitted: auto-replied'] } : {}),
          date: now(),
        }).toString('utf8');

        const commitSnapshotState: ComposeSmtpCommitSnapshot = {
          version: 2,
          draftMessageId: values.draftMessageId,
          accountId: account.id,
          rfc822,
          inReplyToMessageId: values.inReplyToMessageId ?? null,
          markReplyParentDone: values.markReplyParentDone ?? null,
          trackingMessageId,
          trackingWarning,
          recipientCount: recipients.length,
          sentCopyCompleted: false,
        };
        const commitSnapshot = encodeSmtpCommitSnapshot(commitSnapshotState);
        if (!commitSnapshot) {
          return {
            ok: false,
            error: 'Die erzeugte E-Mail ist zu gross fuer eine sichere SMTP-Wiederherstellung.',
          };
        }
        if (
          options.store.refreshSendingLock
          && !(await options.store.refreshSendingLock({
            workspaceId: input.workspaceId,
            messageId: values.draftMessageId,
          }))
        ) {
          return {
            ok: false,
            error: 'Die Versand-Sperre ist abgelaufen; SMTP wurde nicht gestartet.',
          };
        }

        const smtpOutboxClaim = await options.store.claimSmtpOutbox({
          workspaceId: input.workspaceId,
          messageId: values.draftMessageId,
        });
        if (smtpOutboxClaim !== 'claimed') {
          const claimedState = await readStoredSmtpState(
            options.store,
            input.workspaceId,
            values.draftMessageId,
          );
          return await recoverStoredSmtpState({
            state: claimedState,
            store: options.store,
            append: sentCopyAppend,
            tracking,
            workspaceId: input.workspaceId,
            draftMessageId: values.draftMessageId,
          }) ?? {
            ok: false,
            error: 'SMTP-Versandstatus ist unklar; automatischer Wiederholungsversand wurde blockiert.',
          };
        }

        await tracking?.recordSending({
          workspaceId: input.workspaceId,
          messageId: values.draftMessageId,
          trackingMessageId,
        }).catch(() => undefined);

        try {
          const smtpInput: ServerSmtpSendInput = {
            host: smtpHost,
            port: account.smtpPort ?? 587,
            tls: account.smtpTls,
            user: auth.user,
            envelopeFrom: account.emailAddress,
            recipients,
            rfc822,
          };
          await smtpSend({
            ...smtpInput,
            ...(auth.password !== undefined ? { password: auth.password } : {}),
            ...(auth.accessToken !== undefined ? { accessToken: auth.accessToken } : {}),
          });
        } catch (error) {
          await tracking?.recordSmtpFailed({
            workspaceId: input.workspaceId,
            messageId: values.draftMessageId,
            trackingMessageId,
            stage: 'send',
            ...smtpCodeFromError(error),
          }).catch(() => undefined);
          await clearSmtpOutboxClaim(options.store, input.workspaceId, values.draftMessageId);
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            // Pre-DATA failures provably delivered nothing; anything else
            // after smtpSend started is an unknown outcome.
            ...(error instanceof SmtpPreDataSendError ? {} : { deliveryAmbiguous: true }),
          };
        }

        await markSmtpSent(
          options.store,
          input.workspaceId,
          values.draftMessageId,
          commitSnapshot,
        );
        await tracking?.recordSmtpAccepted({
          workspaceId: input.workspaceId,
          messageId: values.draftMessageId,
          trackingMessageId,
          smtpCode: 250,
          acceptedRecipientCount: recipients.length,
          rejectedRecipientCount: 0,
        }).catch(() => undefined);
        const sentCopy = await appendSentCopyAfterSmtp({
          append: sentCopyAppend,
          workspaceId: input.workspaceId,
          account,
          draftMessageId: values.draftMessageId,
          rfc822,
        });
        if (!sentCopy.sentImapSyncFailed) {
          await markSmtpSent(
            options.store,
            input.workspaceId,
            values.draftMessageId,
            encodeSmtpCommitSnapshot({ ...commitSnapshotState, sentCopyCompleted: true })!,
          );
        }
        await finalizeSentDraft({
          store: options.store,
          workspaceId: input.workspaceId,
          draftMessageId: values.draftMessageId,
          inReplyToMessageId: values.inReplyToMessageId,
          markReplyParentDone: values.markReplyParentDone,
          recovered: false,
          sentImapSyncFailed: sentCopy.sentImapSyncFailed,
        });
        return {
          ok: true,
          messageId: values.draftMessageId,
          accountId: account.id,
          warning: combineComposeWarnings(trackingWarning, sentCopy.warning),
        };
      } finally {
        await options.store.releaseSendingLock({
          workspaceId: input.workspaceId,
          messageId: values.draftMessageId,
        });
      }
    },
  };
}

export function createPostgresEmailComposeSenderPort(
  options: PostgresComposeSenderOptions,
): EmailComposeSenderApiPort {
  return createEmailComposeSenderPort({
    attachmentsRoot: options.attachmentsRoot,
    smtpSend: options.smtpSend,
    sentCopyAppend: options.sentCopyAppend,
    outboundReview: options.outboundReview ?? createPostgresComposeOutboundReviewPort({
      db: options.db,
      now: options.now,
      workflowDryRun: options.workflowDryRun,
    }),
    tracking: options.tracking,
    pgpMessages: options.pgpMessages,
    oauthFetchImpl: options.oauthFetchImpl,
    now: options.now,
    store: createPostgresComposeSenderStore(options),
  });
}

function combineComposeWarnings(...warnings: Array<string | null | undefined>): string | undefined {
  const unique = [...new Set(warnings.map((warning) => warning?.trim()).filter((warning): warning is string => Boolean(warning)))];
  return unique.length > 0 ? unique.join(' ') : undefined;
}

function smtpCodeFromError(error: unknown): { smtpCode?: number } {
  const message = error instanceof Error ? error.message : String(error);
  const match = /(?:^|\s)([45]\d{2})(?:\s|$)/.exec(message);
  return match ? { smtpCode: Number(match[1]) } : {};
}

export function createPostgresEmailOutboundValidationPort(options: {
  db: Kysely<ServerDatabase>;
  workflowDryRun: (input: WorkflowExecutionJobPlan) => Promise<WorkflowExecutionDryRunResult>;
  now?: () => Date;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}): EmailOutboundValidationApiPort {
  return {
    async validate(input) {
      const draft = await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => trx
          .selectFrom('email_messages')
          .select(['id'])
          .where('workspace_id', '=', input.workspaceId)
          .where('id', '=', input.values.messageId)
          .where('uid', '<', 0)
          .where('folder_kind', '=', 'draft')
          .executeTakeFirst(),
        { applySession: options.applyWorkspaceSession },
      );
      if (!draft) {
        return { allowed: false, reason: 'Entwurf nicht gefunden' };
      }

      const workflows = await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => trx
          .selectFrom('email_workflows')
          .select(['id', 'name'])
          .where('workspace_id', '=', input.workspaceId)
          .where('trigger_name', '=', 'outbound')
          .where('enabled', '=', true)
          .orderBy('priority', 'asc')
          .orderBy('id', 'asc')
          .limit(MAX_OUTBOUND_WORKFLOWS_PER_SEND)
          .execute(),
        { applySession: options.applyWorkspaceSession },
      );

      if (workflows.length === 0) {
        return { allowed: true, reason: null, manualApprovalPersistenceRequired: false };
      }

      let firstBlockReason: string | null = null;
      for (const workflow of workflows) {
        const result = await options.workflowDryRun({
          workspaceId: input.workspaceId,
          workflowId: Number(workflow.id),
          messageId: input.values.messageId,
          triggerName: 'outbound',
          actorUserId: input.actorUserId,
          context: buildOutboundValidationContext(input.values),
        });
        if (!result.success) {
          return {
            allowed: false,
            reason: result.error ?? 'Ausgangspruefung fehlgeschlagen',
          };
        }
        if (result.blocked) {
          const reason = result.blockReason?.trim()
            || `Workflow „${workflow.name}" wuerde den Versand blockieren`;
          if (!firstBlockReason) firstBlockReason = reason;
        } else if (result.status === 'error') {
          return {
            allowed: false,
            reason: result.error ?? 'Ausgehender Workflow fehlgeschlagen',
          };
        }
      }

      if (firstBlockReason) {
        return { allowed: false, reason: firstBlockReason };
      }

      if (input.persistence === 'none') {
        return { allowed: true, reason: null, manualApprovalPersistenceRequired: true };
      }

      if (workflows.length > 0) {
        await withWorkspaceTransaction(
          options.db,
          { workspaceId: input.workspaceId, role: 'system' },
          async (trx) => {
            await persistManualOutboundApproval(trx, {
              workspaceId: input.workspaceId,
              draftId: input.values.messageId,
              subject: input.values.subject,
              bodyText: input.values.bodyText,
              bodyHtml: input.values.bodyHtml ?? null,
              to: input.values.to,
              cc: input.values.cc ?? null,
              bcc: input.values.bcc ?? null,
              now: options.now?.(),
            });
          },
          { applySession: options.applyWorkspaceSession },
        );
      }
      return { allowed: true, reason: null, manualApprovalPersistenceRequired: false };
    },
  };
}

export function createPostgresComposeOutboundReviewPort(options: {
  db: Kysely<ServerDatabase>;
  workflowDryRun?: (input: WorkflowExecutionJobPlan) => Promise<WorkflowExecutionDryRunResult>;
  now?: () => Date;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}): ComposeOutboundReviewPort {
  return {
    async review(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const now = options.now?.() ?? new Date();

          // Approval-Bypass: if email.release_outbound (autoSend=true) recently
          // approved this draft for the EXACT content present now, skip the
          // review entirely. The marker stores a content fingerprint
          // (subject+body+to/cc/bcc+attachments). On read we recompute the
          // fingerprint from the current send-input and compare:
          //  - hash matches + < 24h: bypass review (covers SMTP retries).
          //  - hash differs: user edited the draft between approval and send;
          //    deny bypass so the change goes through review again.
          //  - no hash (older marker): backward compat — accept fresh markers.
          // The marker is otherwise NOT consumed on read so SMTP retries inside
          // scheduled-send can all bypass; markDraftAsSent clears it on success.
          const approvalKey = outboundReviewApprovedKey(input.draftMessageId);
          const approval = await trx
            .selectFrom('sync_info')
            .select('value')
            .where('workspace_id', '=', input.workspaceId)
            .where('key', '=', approvalKey)
            .executeTakeFirst();
          if (approval?.value) {
            const parsed = parseOutboundApprovalMarker(approval.value);
            const fresh = parsed.approvedAt !== null
              && now.getTime() - parsed.approvedAt.getTime() < OUTBOUND_REVIEW_APPROVED_TTL_MS;
            const currentFingerprint = outboundDraftFingerprint({
              subject: input.subject,
              bodyText: input.bodyText,
              bodyHtml: input.bodyHtml,
              to: input.to,
              cc: input.cc ?? null,
              bcc: input.bcc ?? null,
              attachmentPaths: input.attachmentPaths ?? null,
            });
            const contentMatches = parsed.fingerprint === null || parsed.fingerprint === currentFingerprint;
            if (fresh && contentMatches) {
              await trx
                .updateTable('email_messages')
                .set({ outbound_hold: false, outbound_block_reason: null, updated_at: now })
                .where('workspace_id', '=', input.workspaceId)
                .where('id', '=', input.draftMessageId)
                .execute();
              return { allowed: true };
            }
            if (!fresh || !contentMatches) {
              // Stale OR invalidated by an edit: clear so future reviews start fresh.
              await trx
                .deleteFrom('sync_info')
                .where('workspace_id', '=', input.workspaceId)
                .where('key', '=', approvalKey)
                .execute();
            }
          }

          const workflows = await trx
            .selectFrom('email_workflows')
            .select(['id', 'source_sqlite_id', 'name', 'priority'])
            .where('workspace_id', '=', input.workspaceId)
            .where('trigger_name', '=', 'outbound')
            .where('enabled', '=', true)
            .orderBy('priority', 'asc')
            .orderBy('id', 'asc')
            .limit(MAX_OUTBOUND_WORKFLOWS_PER_SEND)
            .execute();

          if (workflows.length === 0) {
            await trx
              .updateTable('email_messages')
              .set({
                outbound_hold: false,
                outbound_block_reason: null,
                updated_at: now,
              })
              .where('workspace_id', '=', input.workspaceId)
              .where('id', '=', input.draftMessageId)
              .execute();
            return { allowed: true };
          }

          const draft = await trx
            .selectFrom('email_messages')
            .select(['id', 'source_sqlite_id', 'body_text', 'body_html'])
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.draftMessageId)
            .where('uid', '<', 0)
            .where('folder_kind', '=', 'draft')
            .executeTakeFirst();
          if (!draft) return { allowed: false, error: 'Entwurf nicht gefunden' };

          if (options.workflowDryRun) {
            const dryRun = await evaluateComposeOutboundDryRun({
              workflowDryRun: options.workflowDryRun,
              workspaceId: input.workspaceId,
              actorUserId: input.actorUserId,
              draftMessageId: input.draftMessageId,
              subject: input.subject,
              bodyText: input.bodyText,
              bodyHtml: input.bodyHtml,
              to: input.to,
              cc: input.cc,
              bcc: input.bcc,
              inReplyToMessageId: input.inReplyToMessageId,
              attachmentCount: input.attachmentCount,
              attachmentPaths: input.attachmentPaths,
              workflows,
            });
            if (!dryRun.allowed) {
              return { allowed: false, error: dryRun.reason };
            }
          }

          const { plain, html } = extractDraftBodyForOutboundBlock(
            {
              body_text: draft.body_text,
              body_html: draft.body_html,
            },
            {
              bodyText: input.bodyText,
              bodyHtml: input.bodyHtml,
            },
          );
          const banner = buildOutboundWarningBanner(OUTBOUND_REVIEW_REASON);
          const bodyText = `${banner.text}${plain}`;
          const bodyHtml = html.trim()
            ? `${banner.html}${html}`
            : plain.trim()
              ? `<p>${banner.text.replace(/\n/g, '<br/>')}</p><p>${escapeHtml(plain).replace(/\n/g, '<br/>')}</p>`
              : `<p>${banner.text.replace(/\n/g, '<br/>')}</p>`;

          await trx
            .updateTable('email_messages')
            .set({
              body_text: bodyText,
              body_html: bodyHtml,
              snippet: snippetFromText(plain) ?? OUTBOUND_REVIEW_REASON,
              outbound_hold: true,
              outbound_block_reason: OUTBOUND_REVIEW_REASON,
              folder_kind: 'draft',
              seen_local: false,
              archived: false,
              is_spam: false,
              soft_deleted: false,
              updated_at: now,
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.draftMessageId)
            .execute();

          let firstRunId: number | null = null;
          for (const workflow of workflows) {
            const workflowId = Number(workflow.id);
            const workflowSourceSqliteId = workflow.source_sqlite_id === null
              ? -workflowId
              : Number(workflow.source_sqlite_id);
            const run = await trx
              .insertInto('email_workflow_runs')
              .values({
                workspace_id: input.workspaceId,
                source_sqlite_id: null,
                workflow_source_sqlite_id: workflowSourceSqliteId,
                message_source_sqlite_id: Number(draft.source_sqlite_id),
                workflow_id: workflowId,
                message_id: input.draftMessageId,
                direction: 'outbound',
                status: 'queued',
                // jsonb column: stringify the array so node-postgres sends
                // valid JSON instead of a Postgres array literal ({...}).
                log_json: JSON.stringify(['queued:server_compose_outbound_review']),
                source_row: serverApiSourceRow(),
                imported_in_run_id: null,
                started_at: null,
                finished_at: null,
                updated_at: now,
              })
              .returning('id')
              .executeTakeFirstOrThrow();
            const runId = Number(run.id);
            if (firstRunId === null) firstRunId = runId;

            await trx
              .insertInto('job_queue')
              .values({
                type: 'workflow.execute',
                payload: outboundWorkflowJobPayload(input, workflowId, runId),
                run_after: now,
                max_attempts: 5,
                workspace_id: input.workspaceId,
                updated_at: now,
              })
              .execute();
          }

          return {
            allowed: false,
            error: OUTBOUND_REVIEW_REASON,
            workflowRunId: firstRunId,
          };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

function createPostgresComposeSenderStore(options: PostgresComposeSenderOptions): ComposeSenderStore {
  const sendingLockTokens = new Map<string, string>();
  return {
    async getDraft(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom('email_messages')
            .select([
              'id',
              'account_id',
              'uid',
              'folder_kind',
              'subject',
              'body_text',
              'body_html',
              'message_id',
              'in_reply_to',
              'references_header',
              'ticket_code',
              'thread_id',
              'draft_attachment_paths_json',
              'outbound_hold',
              'outbound_block_reason',
            ])
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.messageId)
            .executeTakeFirst();
          return row
            ? {
              id: Number(row.id),
              accountId: row.account_id === null ? null : Number(row.account_id),
              uid: Number(row.uid),
              folderKind: row.folder_kind,
              subject: row.subject,
              bodyText: row.body_text,
              bodyHtml: row.body_html,
              messageIdHeader: row.message_id,
              inReplyToHeader: row.in_reply_to,
              referencesHeader: row.references_header,
              ticketCode: row.ticket_code,
              threadId: row.thread_id,
              draftAttachmentPathsJson: row.draft_attachment_paths_json,
              outboundHold: Boolean(row.outbound_hold),
              outboundBlockReason: row.outbound_block_reason,
            }
            : null;
        },
      );
    },
    async getAccount(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom('email_accounts')
            .select([
              'id',
              'source_sqlite_id',
              'display_name',
              'email_address',
              'imap_host',
              'imap_username',
              'smtp_host',
              'smtp_port',
              'smtp_tls',
              'smtp_username',
              'smtp_use_imap_auth',
              'oauth_provider',
              'protocol',
              'request_read_receipt',
            ])
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.accountId)
            .executeTakeFirst();
          return row
            ? {
              id: Number(row.id),
              sourceSqliteId: Number(row.source_sqlite_id),
              displayName: row.display_name,
              emailAddress: row.email_address,
              imapHost: row.imap_host,
              imapUsername: row.imap_username,
              smtpHost: row.smtp_host,
              smtpPort: row.smtp_port === null ? null : Number(row.smtp_port),
              smtpTls: Boolean(row.smtp_tls),
              smtpUsername: row.smtp_username,
              smtpUseImapAuth: Boolean(row.smtp_use_imap_auth),
              oauthProvider: row.oauth_provider,
              protocol: row.protocol,
              requestReadReceipt: Boolean(row.request_read_receipt),
            }
            : null;
        },
      );
    },
    async getParentMessage(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom('email_messages')
            .select(['id', 'message_id', 'references_header', 'ticket_code', 'thread_id'])
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.messageId)
            .executeTakeFirst();
          return row
            ? {
              id: Number(row.id),
              messageIdHeader: row.message_id,
              referencesHeader: row.references_header,
              ticketCode: row.ticket_code,
              threadId: row.thread_id,
            }
            : null;
        },
      );
    },
    async getOrCreateThreadForTicket(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => getOrCreateThreadForTicket(trx, input.workspaceId, input.ticketCode, input.subject, input.accountId ?? null, options.now?.()),
      );
    },
    async listKnownTicketPrefixes(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => [...(await listWorkspaceTicketPrefixes(trx, input.workspaceId))],
      );
    },
    async allocateNextTicketCodeForAccount(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => allocateNextTicketCodeForAccount(trx, input.workspaceId, input.account, options.now?.()),
      );
    },
    async readSecret(input) {
      return options.secrets?.readSecret(input) ?? null;
    },
    async writeSecret(input) {
      await options.secrets?.writeSecret(input);
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
      );
    },
    async setSyncInfo(input) {
      await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => upsertSyncInfo(trx, input.workspaceId, input.values, options.now?.()),
      );
    },
    async deleteSyncInfo(input) {
      await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          if (input.keys.length === 0) return;
          await trx
            .deleteFrom('sync_info')
            .where('workspace_id', '=', input.workspaceId)
            .where('key', 'in', input.keys)
            .execute();
        },
      );
    },
    async claimSmtpOutbox(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => claimSmtpOutboxInTransaction(trx, input.workspaceId, input.messageId, options.now?.()),
      );
    },
    async tryAcquireSendingLock(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const now = options.now?.() ?? new Date();
          const staleBefore = new Date(now.getTime() - COMPOSE_SEND_LOCK_TTL_MS);
          const token = randomBytes(24).toString('base64url');
          const row = await trx
            .insertInto('sync_info')
            .values({
              workspace_id: input.workspaceId,
              key: sendingInProgressKey(input.messageId),
              value: token,
              last_updated: now,
              source_row: serverApiSourceRow(),
              imported_in_run_id: null,
              updated_at: now,
            })
            .onConflict((oc) => oc
              .columns(['workspace_id', 'key'])
              .doUpdateSet({
                value: token,
                last_updated: now,
                updated_at: now,
              })
              .where(kyselySql<boolean>`sync_info.last_updated <= ${staleBefore}`))
            .returning('value')
            .executeTakeFirst();
          const acquired = row?.value === token;
          if (acquired) {
            sendingLockTokens.set(`${input.workspaceId}\u0000${input.messageId}`, token);
          }
          return acquired;
        },
      );
    },
    async refreshSendingLock(input) {
      const token = sendingLockTokens.get(`${input.workspaceId}\u0000${input.messageId}`);
      if (!token) return false;
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const now = options.now?.() ?? new Date();
          const row = await trx
            .updateTable('sync_info')
            .set({ last_updated: now, updated_at: now })
            .where('workspace_id', '=', input.workspaceId)
            .where('key', '=', sendingInProgressKey(input.messageId))
            .where('value', '=', token)
            .returning('key')
            .executeTakeFirst();
          return Boolean(row);
        },
      );
    },
    async releaseSendingLock(input) {
      const mapKey = `${input.workspaceId}\u0000${input.messageId}`;
      const token = sendingLockTokens.get(mapKey);
      if (!token) return;
      try {
        await withWorkspaceTransaction(
          options.db,
          { workspaceId: input.workspaceId, role: 'system' },
          async (trx) => {
            await trx
              .deleteFrom('sync_info')
              .where('workspace_id', '=', input.workspaceId)
              .where('key', '=', sendingInProgressKey(input.messageId))
              .where('value', '=', token)
              .execute();
          },
        );
      } finally {
        if (sendingLockTokens.get(mapKey) === token) sendingLockTokens.delete(mapKey);
      }
    },
    async updateDraftForSend(input) {
      await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          await trx
            .updateTable('email_messages')
            .set({
              subject: input.subject,
              body_text: input.bodyText,
              body_html: input.bodyHtml,
              snippet: snippetFromText(input.bodyText),
              from_json: input.fromJson,
              to_json: input.toJson,
              cc_json: input.ccJson,
              bcc_json: input.bccJson,
              ticket_code: input.ticketCode,
              thread_id: input.threadId,
              message_id: input.outboundMessageId,
              in_reply_to: input.inReplyTo,
              references_header: input.references,
              updated_at: options.now?.() ?? new Date(),
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.messageId)
            .execute();
          // P2-9 ai_reply_feedback is recorded in markDraftAsSent (post-SMTP)
          // so a held / retried / failed send does not skew the edit-ratio
          // metric or produce duplicate rows.
        },
      );
    },
    async markDraftAsSent(input) {
      await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          // P2-9: capture how much the human changed an AI-suggested draft —
          // only AFTER SMTP committed, so feedback never reflects held /
          // failed sends. Reads snapshot + the sent body in one row select to
          // keep the cost minimal.
          let feedback: { snapshot: string; sentBody: string } | null = null;
          try {
            const existing = await trx
              .selectFrom('email_messages')
              .select(['ai_suggestion_snapshot', 'body_text'])
              .where('workspace_id', '=', input.workspaceId)
              .where('id', '=', input.messageId)
              .executeTakeFirst();
            const snapshot = existing?.ai_suggestion_snapshot;
            if (typeof snapshot === 'string' && snapshot.trim()) {
              feedback = {
                snapshot,
                sentBody: typeof existing?.body_text === 'string' ? existing.body_text : '',
              };
            }
          } catch {
            /* feedback is best-effort */
          }

          await trx
            .updateTable('email_messages')
            .set({
              folder_kind: 'sent',
              outbound_hold: false,
              outbound_block_reason: null,
              archived: false,
              scheduled_send_at: null,
              scheduled_send_actor_user_id: null,
              scheduled_send_trusted_service_principal: null,
              sent_imap_sync_failed: input.sentImapSyncFailed,
              // Null the snapshot after measuring so an accidental re-run of
              // markDraftAsSent does not produce a duplicate feedback row.
              ...(feedback ? { ai_suggestion_snapshot: null } : {}),
              updated_at: options.now?.() ?? new Date(),
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.messageId)
            .execute();

          const draftRow = await trx
            .selectFrom('email_messages as m')
            .innerJoin('email_accounts as a', 'a.id', 'm.account_id')
            .select(['m.from_json', 'a.email_address', 'a.display_name'])
            .where('m.workspace_id', '=', input.workspaceId)
            .where('m.id', '=', input.messageId)
            .executeTakeFirst();
          if (draftRow && !String(draftRow.from_json ?? '').trim()) {
            const fromJson = addressJson({
              value: [{
                address: String(draftRow.email_address).trim(),
                ...(String(draftRow.display_name ?? '').trim()
                  ? { name: String(draftRow.display_name).trim() }
                  : {}),
              }],
            });
            if (fromJson) {
              await trx
                .updateTable('email_messages')
                .set({ from_json: fromJson, updated_at: options.now?.() ?? new Date() })
                .where('workspace_id', '=', input.workspaceId)
                .where('id', '=', input.messageId)
                .execute();
            }
          }
          // SMTP succeeded — drop the outbound-review approval marker so it
          // doesn't linger past the send (and so an edit-then-resend on the
          // same id space would re-run review).
          await trx
            .deleteFrom('sync_info')
            .where('workspace_id', '=', input.workspaceId)
            .where('key', '=', outboundReviewApprovedKey(input.messageId))
            .execute();

          if (feedback) {
            try {
              await trx
                .insertInto('ai_reply_feedback')
                .values({
                  workspace_id: input.workspaceId,
                  message_id: input.messageId,
                  node_type: 'compose.send',
                  suggestion_len: feedback.snapshot.length,
                  sent_len: feedback.sentBody.length,
                  changed_ratio: computeTextChangeRatio(feedback.snapshot, feedback.sentBody),
                  created_at: options.now?.() ?? new Date(),
                })
                .execute();
            } catch {
              /* feedback is best-effort */
            }
          }
        },
      );
    },
    async markMessageDone(input) {
      await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          await trx
            .updateTable('email_messages')
            .set({
              done_local: input.done,
              updated_at: options.now?.() ?? new Date(),
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.messageId)
            .execute();
        },
      );
    },
  };
}

async function prepareDraftForSend(input: {
  store: ComposeSenderStore;
  workspaceId: string;
  draft: ComposeSendDraft;
  account: ComposeSendAccount;
  input: EmailComposeSendInput;
  bodyText: string;
  bodyHtml: string | null;
  toJson: unknown | null;
  ccJson: unknown | null;
  bccJson: unknown | null;
}): Promise<{
  finalSubject: string;
  outboundMessageId: string;
  inReplyTo: string | null;
  references: string | null;
}> {
  let ticketCode: string | null = null;
  let threadId: string | null = null;
  let parentForThreading: ComposeSendParentMessage | null = null;
  const values = input.input;
  if (values.inReplyToMessageId) {
    parentForThreading = await input.store.getParentMessage({
      workspaceId: input.workspaceId,
      messageId: values.inReplyToMessageId,
    });
    if (parentForThreading?.ticketCode) {
      ticketCode = parentForThreading.ticketCode;
      threadId = parentForThreading.threadId;
    }
  }
  if (!ticketCode) {
    const allowedPrefixes = await input.store.listKnownTicketPrefixes?.({
      workspaceId: input.workspaceId,
    });
    ticketCode = extractTicketFromSubject(
      values.subject,
      allowedPrefixes ? { allowedPrefixes } : undefined,
    );
  }
  if (!ticketCode && input.draft.ticketCode?.trim()) {
    ticketCode = input.draft.ticketCode.trim();
  }
  if (!ticketCode) {
    ticketCode = (await input.store.allocateNextTicketCodeForAccount?.({
      workspaceId: input.workspaceId,
      account: input.account,
    }))
      ?? generateTicketCode({ prefix: `ACC${input.account.id}` });
  }
  if (!threadId) {
    threadId = await input.store.getOrCreateThreadForTicket({
      workspaceId: input.workspaceId,
      ticketCode,
      accountId: input.account.id,
      subject: values.subject,
    });
  }

  const finalSubject = ensureTicketInSubject(values.subject.trim() || '(Ohne Betreff)', ticketCode);
  const threadHeaders = buildOutboundThreadingHeaders(
    parentForThreading
      ? {
        message_id: parentForThreading.messageIdHeader,
        references_header: parentForThreading.referencesHeader,
      }
      : null,
  );
  const outboundMessageId =
    input.draft.messageIdHeader?.trim() || generateOutboundMessageId(input.account.emailAddress);

  await input.store.updateDraftForSend({
    workspaceId: input.workspaceId,
    messageId: values.draftMessageId,
    subject: finalSubject,
    bodyText: input.bodyText,
    bodyHtml: input.bodyHtml,
    fromJson: addressJson({
      value: [{
        address: input.account.emailAddress.trim(),
        ...(input.account.displayName.trim()
          ? { name: input.account.displayName.trim() }
          : {}),
      }],
    }),
    toJson: input.toJson,
    ccJson: input.ccJson,
    bccJson: input.bccJson,
    ticketCode,
    threadId,
    outboundMessageId,
    inReplyTo: threadHeaders.inReplyTo ?? null,
    references: threadHeaders.references ?? null,
  });

  return {
    finalSubject,
    outboundMessageId,
    inReplyTo: threadHeaders.inReplyTo ?? null,
    references: threadHeaders.references ?? null,
  };
}

async function finalizeSentDraft(input: {
  store: ComposeSenderStore;
  workspaceId: string;
  draftMessageId: number;
  inReplyToMessageId: number | null | undefined;
  markReplyParentDone: boolean | undefined;
  recovered: boolean;
  sentImapSyncFailed: boolean;
}): Promise<void> {
  await input.store.markDraftAsSent({
    workspaceId: input.workspaceId,
    messageId: input.draftMessageId,
    sentImapSyncFailed: input.sentImapSyncFailed,
  });
  await input.store.deleteSyncInfo({
    workspaceId: input.workspaceId,
    keys: [
      smtpCommittedKey(input.draftMessageId),
      autoSubmittedDraftKey(input.draftMessageId),
    ],
  });

  if (input.inReplyToMessageId) {
    const shouldMark = input.markReplyParentDone !== undefined
      ? input.markReplyParentDone
      : await shouldMarkReplyParentDone(input.store, input.workspaceId, input.draftMessageId);
    if (input.markReplyParentDone !== undefined) {
      await input.store.setSyncInfo({
        workspaceId: input.workspaceId,
        values: {
          [markReplyParentDoneKey(input.draftMessageId)]: input.markReplyParentDone ? '1' : '0',
        },
      });
    }
    if (shouldMark) {
      await input.store.markMessageDone({
        workspaceId: input.workspaceId,
        messageId: input.inReplyToMessageId,
        done: true,
      });
    }
  }
}

async function appendSentCopyAfterSmtp(input: {
  append?: (input: ServerImapSentCopyAppendInput) => Promise<ServerImapSentCopyAppendResult>;
  workspaceId: string;
  account: ComposeSendAccount;
  draftMessageId: number;
  rfc822: string;
}): Promise<{
  sentImapSyncFailed: boolean;
  warning?: string;
}> {
  if ((input.account.protocol || 'imap') !== 'imap') {
    return {
      sentImapSyncFailed: true,
      warning: serverSentAppendWarning(input.account),
    };
  }
  if (!input.append) {
    return {
      sentImapSyncFailed: true,
      warning: serverSentAppendWarning(input.account),
    };
  }

  let result: ServerImapSentCopyAppendResult;
  try {
    result = await input.append({
      workspaceId: input.workspaceId,
      accountId: input.account.id,
      rfc822: input.rfc822,
      estimatedBytes: Buffer.byteLength(input.rfc822, 'utf8'),
    });
  } catch (error) {
    result = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  if (result.ok && !('skipped' in result)) {
    return { sentImapSyncFailed: false };
  }
  if (result.ok && 'skipped' in result) {
    return {
      sentImapSyncFailed: true,
      warning: `E-Mail wurde per SMTP versendet und in SimpleCRM als gesendet markiert. ${result.reason}`,
    };
  }

  return {
    sentImapSyncFailed: true,
    warning: `E-Mail wurde per SMTP versendet und in SimpleCRM als gesendet markiert. Server-Kopie per IMAP APPEND fehlgeschlagen: ${truncateWarning(result.error)}`,
  };
}

async function shouldMarkReplyParentDone(
  store: ComposeSenderStore,
  workspaceId: string,
  draftMessageId: number,
): Promise<boolean> {
  const values = await store.getSyncInfo({
    workspaceId,
    keys: [markReplyParentDoneKey(draftMessageId)],
  });
  return values.get(markReplyParentDoneKey(draftMessageId)) !== '0';
}

function validateComposeRecipients(input: EmailComposeSendInput): string | null {
  const toCheck = validateRecipientField(input.to, 'An');
  if (toCheck) return toCheck;
  if (input.cc?.trim()) {
    const ccCheck = validateRecipientField(input.cc, 'Cc');
    if (ccCheck) return ccCheck;
  }
  if (input.bcc?.trim()) {
    const bccCheck = validateRecipientField(input.bcc, 'Bcc');
    if (bccCheck) return bccCheck;
  }
  return null;
}

function validateRecipientField(raw: string, label: string): string | null {
  const addrs = extractEmailAddressesFromRecipientField(raw);
  return addrs.length === 0
    ? `Mindestens eine gueltige E-Mail-Adresse in "${label}" (z. B. a@b.de oder Name <a@b.de>).`
    : null;
}

function htmlToPlainTextForPgp(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_match, code) => {
      const value = Number(code);
      return Number.isFinite(value) ? String.fromCodePoint(value) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => {
      const value = Number.parseInt(code, 16);
      return Number.isFinite(value) ? String.fromCodePoint(value) : '';
    })
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function recipientJsonObjectFromField(raw: string): { value: { address: string }[] } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const addresses = extractEmailAddressesFromRecipientField(trimmed);
  if (addresses.length === 0) return null;
  return { value: addresses.map((address) => ({ address })) };
}

function extractEmailAddressesFromRecipientField(raw: string): string[] {
  const out: string[] = [];
  for (const chunk of raw.split(/[,;]+/)) {
    const text = chunk.trim();
    if (!text) continue;
    const match = /^(.+)<([^>]+)>$/.exec(text);
    const candidate = (match ? match[2] : text)?.trim() ?? '';
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(candidate)) {
      out.push(normalizeRecipientEmailAddress(candidate));
    }
  }
  return [...new Set(out)];
}

function normalizeRecipientEmailAddress(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0) return trimmed;
  const local = trimmed.slice(0, at);
  let domain = trimmed.slice(at + 1);
  try {
    domain = new URL(`http://${domain}`).hostname || domain;
  } catch {
    /* keep lower-cased domain */
  }
  const plus = local.indexOf('+');
  return `${plus >= 0 ? local.slice(0, plus) : local}@${domain}`;
}

type ComposeAttachmentResolution =
  | { ok: true; attachments: ComposeRfc822Attachment[] }
  | { ok: false; error: string };

function resolveComposeAttachments(input: {
  attachmentPaths?: readonly string[];
  attachmentsRoot?: string;
}): ComposeAttachmentResolution {
  const rawPaths = input.attachmentPaths?.map((value) => value.trim()).filter(Boolean) ?? [];
  if (rawPaths.length === 0) return { ok: true, attachments: [] };
  if (!input.attachmentsRoot?.trim()) {
    return { ok: false, error: 'Server-Anhangspeicher ist nicht konfiguriert' };
  }

  const attachments: ComposeRfc822Attachment[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const rawPath of rawPaths) {
    const resolvedPath = resolveAttachmentStoragePath(input.attachmentsRoot, rawPath);
    if (!resolvedPath) {
      return { ok: false, error: 'Anhang liegt ausserhalb des Server-Anhangspeichers' };
    }
    if (seen.has(resolvedPath)) continue;

    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolvedPath);
    } catch {
      return { ok: false, error: `Anhang nicht gefunden: ${path.basename(rawPath) || 'attachment'}` };
    }
    if (!stat.isFile()) {
      return { ok: false, error: `Anhang ist keine Datei: ${path.basename(rawPath) || 'attachment'}` };
    }
    if (stat.size > MAX_SERVER_COMPOSE_ATTACHMENT_BYTES) {
      return { ok: false, error: `Anhang ist groesser als 25 MB: ${path.basename(rawPath) || 'attachment'}` };
    }
    totalBytes += stat.size;
    if (totalBytes > MAX_SERVER_COMPOSE_ATTACHMENT_TOTAL_BYTES) {
      return { ok: false, error: 'Anhaenge sind zusammen groesser als 50 MB' };
    }

    seen.add(resolvedPath);
    attachments.push({
      filename: path.basename(rawPath) || path.basename(resolvedPath) || 'attachment',
      path: resolvedPath,
    });
  }
  return { ok: true, attachments };
}

function readComposeAttachmentsForPgp(
  attachments: readonly ComposeRfc822Attachment[],
): { ok: true; attachments: Array<{ filename: string; contentType?: string; bytes: Buffer }> } | { ok: false; error: string } {
  const out: Array<{ filename: string; contentType?: string; bytes: Buffer }> = [];
  for (const attachment of attachments) {
    try {
      const bytes = attachment.content
        ? Buffer.from(attachment.content)
        : attachment.path
          ? fs.readFileSync(attachment.path)
          : null;
      if (!bytes) {
        return { ok: false, error: `Anhang nicht lesbar: ${attachment.filename || 'attachment'}` };
      }
      out.push({
        filename: attachment.filename,
        ...(attachment.contentType ? { contentType: attachment.contentType } : {}),
        bytes,
      });
    } catch {
      return { ok: false, error: `Anhang nicht lesbar: ${attachment.filename || 'attachment'}` };
    }
  }
  return { ok: true, attachments: out };
}

function buildOutboundValidationContext(values: EmailOutboundValidationInput): Record<string, unknown> {
  return {
    outbound: {
      messageId: values.messageId,
      subject: values.subject,
      bodyText: truncateContextText(values.bodyText),
      bodyHtml: values.bodyHtml === null || values.bodyHtml === undefined
        ? null
        : truncateContextText(values.bodyHtml),
      to: values.to,
      cc: values.cc ?? '',
      bcc: values.bcc ?? '',
      inReplyToMessageId: values.inReplyToMessageId ?? null,
      attachmentCount: values.attachmentCount ?? 0,
      attachmentPaths: [],
    },
    previewOutbound: true,
    eventStrings: outboundValidationEventStrings(values),
    source: 'server_compose_outbound_validate',
  };
}

async function evaluateComposeOutboundDryRun(input: {
  workflowDryRun: (plan: WorkflowExecutionJobPlan) => Promise<WorkflowExecutionDryRunResult>;
  workspaceId: string;
  actorUserId: string;
  draftMessageId: number;
  subject: string;
  bodyText: string;
  bodyHtml: string | null | undefined;
  to: string;
  cc?: string | null;
  bcc?: string | null;
  inReplyToMessageId?: number | null;
  attachmentCount: number;
  attachmentPaths?: readonly string[] | null;
  workflows: readonly { id: number | string | bigint; name: string }[];
}): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  let firstBlockReason: string | null = null;
  for (const workflow of input.workflows) {
    const result = await input.workflowDryRun({
      workspaceId: input.workspaceId,
      workflowId: Number(workflow.id),
      messageId: input.draftMessageId,
      triggerName: 'outbound',
      actorUserId: input.actorUserId,
      context: {
        outbound: {
          messageId: input.draftMessageId,
          subject: input.subject,
          bodyText: truncateContextText(input.bodyText),
          bodyHtml: input.bodyHtml === null || input.bodyHtml === undefined
            ? null
            : truncateContextText(input.bodyHtml),
          to: input.to,
          cc: input.cc ?? '',
          bcc: input.bcc ?? '',
          inReplyToMessageId: input.inReplyToMessageId ?? null,
          attachmentCount: input.attachmentCount,
          attachmentPaths: input.attachmentPaths?.slice(0, 25) ?? [],
        },
        previewOutbound: true,
        eventStrings: outboundValidationEventStrings({
          messageId: input.draftMessageId,
          subject: input.subject,
          bodyText: input.bodyText,
          bodyHtml: input.bodyHtml ?? undefined,
          to: input.to,
          cc: input.cc ?? undefined,
          bcc: input.bcc ?? undefined,
          inReplyToMessageId: input.inReplyToMessageId ?? undefined,
          attachmentCount: input.attachmentCount,
        }),
        source: 'server_compose_outbound_review',
      },
    });
    if (!result.success) {
      return {
        allowed: false,
        reason: result.error ?? 'Ausgangspruefung fehlgeschlagen',
      };
    }
    if (result.blocked) {
      const reason = result.blockReason?.trim()
        || `Workflow „${workflow.name}" wuerde den Versand blockieren`;
      if (!firstBlockReason) firstBlockReason = reason;
    } else if (result.status === 'error') {
      return {
        allowed: false,
        reason: result.error ?? 'Ausgehender Workflow fehlgeschlagen',
      };
    }
  }
  if (firstBlockReason) {
    return { allowed: false, reason: firstBlockReason };
  }
  return { allowed: true };
}

function outboundWorkflowJobPayload(
  input: ComposeOutboundReviewInput,
  workflowId: number,
  runId: number,
): Record<string, unknown> {
  return {
    workspaceId: input.workspaceId,
    workflowId,
    messageId: input.draftMessageId,
    runId,
    triggerName: 'outbound',
    actorUserId: input.actorUserId,
    context: {
      outbound: {
        messageId: input.draftMessageId,
        subject: input.subject,
        bodyText: truncateContextText(input.bodyText),
        bodyHtml: input.bodyHtml === null ? null : truncateContextText(input.bodyHtml),
        to: input.to,
        cc: input.cc ?? '',
        bcc: input.bcc ?? '',
        inReplyToMessageId: input.inReplyToMessageId ?? null,
        attachmentCount: input.attachmentCount,
        attachmentPaths: input.attachmentPaths?.slice(0, 25) ?? [],
      },
      source: 'server_compose_outbound_review',
    },
  };
}

function truncateContextText(value: string): string {
  return value.length > MAX_OUTBOUND_CONTEXT_TEXT
    ? `${value.slice(0, MAX_OUTBOUND_CONTEXT_TEXT)}...`
    : value;
}

function outboundValidationEventStrings(
  values: EmailOutboundValidationInput,
): Record<string, string> {
  const bodyText = values.bodyText ?? '';
  const bodyHtml = values.bodyHtml ?? '';
  const htmlPlain = bodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const attachmentCount = values.attachmentCount ?? 0;
  return {
    subject: values.subject ?? '',
    body_text: bodyText,
    snippet: bodyText.slice(0, 500),
    from_address: '',
    to_address: values.to ?? '',
    cc_address: values.cc ?? '',
    combined_text: [
      values.subject,
      bodyText,
      htmlPlain,
      values.to,
      values.cc,
      values.bcc,
    ].filter(Boolean).join('\n'),
    has_attachments: attachmentCount > 0 ? 'true' : 'false',
    attachment_names: '',
    attachment_types: '',
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function resolveSmtpUser(account: ComposeSendAccount): string {
  return account.smtpUseImapAuth
    ? account.imapUsername
    : account.smtpUsername?.trim() || account.imapUsername;
}

export type ResolvedSmtpAuth =
  | { ok: true; user: string; password?: string; accessToken?: string }
  // `retryable` distinguishes a TRANSIENT failure (e.g. an OAuth token-refresh
  // request that hit a provider/network outage) — which can heal on retry —
  // from a permanent MISCONFIGURATION (missing secret / provider / app config).
  // Callers that gate SMTP retry semantics (the relay listener's 451 vs 550)
  // read it; the compose path ignores it. Absent/false ⇒ treat as permanent.
  | { ok: false; error: string; retryable?: boolean };

/** Resolves SMTP credentials for an account (dedicated SMTP secret, IMAP-auth
 *  fallback, then OAuth refresh). Exported so the SMTP-relay submission
 *  pipeline reuses the exact compose-send auth resolution. */
export async function resolveSmtpAuth(input: {
  workspaceId: string;
  account: ComposeSendAccount;
  readSecret?: (input: SecretIdentifier) => Promise<Buffer | null>;
  writeSecret?: (input: SecretIdentifier & { value: string | Buffer }) => Promise<unknown>;
  getSyncInfo: (input: {
    workspaceId: string;
    keys: readonly string[];
  }) => Promise<ReadonlyMap<string, string | null>>;
  oauthFetchImpl?: typeof fetch;
}): Promise<ResolvedSmtpAuth> {
  if (!input.readSecret) {
    return { ok: false, error: 'Email account secret storage ist nicht konfiguriert' };
  }

  const user = resolveSmtpUser(input.account);
  if (!input.account.smtpUseImapAuth) {
    const smtpSecret = await input.readSecret(emailAccountSecretIdentifier(input.workspaceId, input.account.id, 'smtp'));
    if (smtpSecret) {
      return {
        ok: true,
        user,
        password: smtpSecret.toString('utf8'),
      };
    }
  }

  const imapSecret = await input.readSecret(emailAccountSecretIdentifier(input.workspaceId, input.account.id, 'imap'));
  if (imapSecret) {
    return {
      ok: true,
      user,
      password: imapSecret.toString('utf8'),
    };
  }

  if (input.account.oauthProvider) {
    return resolveOAuthSmtpAuth({
      workspaceId: input.workspaceId,
      account: input.account,
      user,
      readSecret: input.readSecret,
      writeSecret: input.writeSecret,
      getSyncInfo: input.getSyncInfo,
      oauthFetchImpl: input.oauthFetchImpl,
    });
  }
  return { ok: false, error: 'Kein SMTP-Passwort verfuegbar' };
}

async function resolveOAuthSmtpAuth(input: {
  workspaceId: string;
  account: ComposeSendAccount;
  user: string;
  readSecret: (input: SecretIdentifier) => Promise<Buffer | null>;
  writeSecret?: (input: SecretIdentifier & { value: string | Buffer }) => Promise<unknown>;
  getSyncInfo: (input: {
    workspaceId: string;
    keys: readonly string[];
  }) => Promise<ReadonlyMap<string, string | null>>;
  oauthFetchImpl?: typeof fetch;
}): Promise<ResolvedSmtpAuth> {
  const provider = normalizeEmailOAuthProvider(input.account.oauthProvider);
  if (!provider) return { ok: false, error: 'OAuth-Provider wird serverseitig nicht unterstuetzt' };

  const refreshIdentifier = emailAccountSecretIdentifier(input.workspaceId, input.account.id, 'oauth_refresh');
  const refreshSecret = await input.readSecret(refreshIdentifier);
  if (!refreshSecret) return { ok: false, error: 'OAuth-Refresh-Token fehlt' };

  const keys = EMAIL_OAUTH_APP_KEYS[provider];
  const settings = await input.getSyncInfo({
    workspaceId: input.workspaceId,
    keys: [keys.clientId, keys.clientSecret],
  });
  const clientId = settings.get(keys.clientId)?.trim() ?? '';
  const clientSecret = settings.get(keys.clientSecret)?.trim() ?? '';
  if (!clientId || !clientSecret) {
    return { ok: false, error: 'OAuth-Appdaten sind serverseitig nicht konfiguriert' };
  }

  const refreshToken = refreshSecret.toString('utf8');
  try {
    const refreshed = await refreshServerEmailOAuthAccessToken({
      provider,
      clientId,
      clientSecret,
      refreshToken,
      fetchImpl: input.oauthFetchImpl,
    });
    if (refreshed.refreshToken && refreshed.refreshToken !== refreshToken) {
      await input.writeSecret?.({ ...refreshIdentifier, value: refreshed.refreshToken });
    }
    return {
      ok: true,
      user: input.user,
      accessToken: refreshed.accessToken,
    };
  } catch (error) {
    // A thrown refresh failure is transient (token endpoint down, network
    // blip) — the token may refresh fine on the next attempt, so mark it
    // retryable rather than permanently rejecting the send.
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      retryable: true,
    };
  }
}

function normalizeEmailOAuthProvider(value: string | null): EmailOAuthProvider | null {
  return value === 'google' || value === 'microsoft' ? value : null;
}

function emailAccountSecretIdentifier(
  workspaceId: string,
  accountId: number,
  secret: 'imap' | 'smtp' | 'oauth_refresh',
): SecretIdentifier {
  const kind = secret === 'imap'
    ? 'email.account.imap_password'
    : secret === 'smtp'
      ? 'email.account.smtp_password'
      : 'email.account.oauth_refresh_token';
  return {
    workspaceId,
    kind,
    name: `email_account:${accountId}:${secret}`,
  };
}

function encodeSmtpCommitSnapshot(snapshot: ComposeSmtpCommitSnapshot): string | null {
  const value = `${COMPOSE_SMTP_SNAPSHOT_PREFIX}${JSON.stringify(snapshot)}`;
  return Buffer.byteLength(value, 'utf8') <= MAX_COMPOSE_SMTP_SNAPSHOT_BYTES ? value : null;
}

function parseStoredSmtpState(value: string | null, draftMessageId: number): StoredComposeSmtpState {
  if (value === null) return { kind: 'none' };
  if (value === COMPOSE_SMTP_OUTBOX_VALUE) return { kind: 'outbox' };
  if (value === COMPOSE_SMTP_SENT_VALUE || value === COMPOSE_SMTP_COMMITTED_VALUE) {
    return { kind: 'legacy' };
  }
  if (
    !value.startsWith(COMPOSE_SMTP_SNAPSHOT_PREFIX)
    || Buffer.byteLength(value, 'utf8') > MAX_COMPOSE_SMTP_SNAPSHOT_BYTES
  ) {
    return { kind: 'invalid' };
  }

  try {
    const parsed: unknown = JSON.parse(value.slice(COMPOSE_SMTP_SNAPSHOT_PREFIX.length));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { kind: 'invalid' };
    const candidate = parsed as Record<string, unknown>;
    const inReplyToMessageId = candidate.inReplyToMessageId;
    const markReplyParentDone = candidate.markReplyParentDone;
    const trackingMessageId = candidate.trackingMessageId;
    const trackingWarning = candidate.trackingWarning;
    const recipientCount = candidate.recipientCount;
    const sentCopyCompleted = candidate.sentCopyCompleted;
    if (
      candidate.version !== 2
      || candidate.draftMessageId !== draftMessageId
      || !Number.isSafeInteger(candidate.accountId)
      || Number(candidate.accountId) <= 0
      || typeof candidate.rfc822 !== 'string'
      || candidate.rfc822.length === 0
      || !(
        inReplyToMessageId === null
        || (Number.isSafeInteger(inReplyToMessageId) && Number(inReplyToMessageId) > 0)
      )
      || !(markReplyParentDone === null || typeof markReplyParentDone === 'boolean')
      || !(
        trackingMessageId === undefined
        || trackingMessageId === null
        || (typeof trackingMessageId === 'string' && trackingMessageId.length > 0 && trackingMessageId.length <= 128)
      )
      || !(
        trackingWarning === undefined
        || trackingWarning === null
        || (typeof trackingWarning === 'string' && trackingWarning.length <= 2_048)
      )
      || !(
        recipientCount === undefined
        || (Number.isSafeInteger(recipientCount) && Number(recipientCount) >= 0 && Number(recipientCount) <= 1_000)
      )
      || !(sentCopyCompleted === undefined || typeof sentCopyCompleted === 'boolean')
    ) {
      return { kind: 'invalid' };
    }
    return {
      kind: 'committed',
      snapshot: {
        version: 2,
        draftMessageId,
        accountId: Number(candidate.accountId),
        rfc822: candidate.rfc822,
        inReplyToMessageId: inReplyToMessageId === null ? null : Number(inReplyToMessageId),
        markReplyParentDone,
        trackingMessageId: typeof trackingMessageId === 'string' ? trackingMessageId : null,
        trackingWarning: typeof trackingWarning === 'string' ? trackingWarning : null,
        recipientCount: recipientCount === undefined ? 0 : Number(recipientCount),
        sentCopyCompleted: sentCopyCompleted === true,
      },
    };
  } catch {
    return { kind: 'invalid' };
  }
}

async function readStoredSmtpState(
  store: ComposeSenderStore,
  workspaceId: string,
  draftMessageId: number,
): Promise<StoredComposeSmtpState> {
  const key = smtpCommittedKey(draftMessageId);
  const values = await store.getSyncInfo({ workspaceId, keys: [key] });
  return parseStoredSmtpState(values.get(key) ?? null, draftMessageId);
}

async function recoverStoredSmtpState(input: {
  state: StoredComposeSmtpState;
  store: ComposeSenderStore;
  append?: (input: ServerImapSentCopyAppendInput) => Promise<ServerImapSentCopyAppendResult>;
  tracking?: Pick<EmailTrackingService, 'recordSmtpAccepted'>;
  workspaceId: string;
  draftMessageId: number;
}): Promise<EmailComposeSendResult | null> {
  if (input.state.kind === 'none') return null;
  if (input.state.kind === 'outbox') {
    return {
      ok: false,
      error: 'SMTP-Versandstatus ist nach einer Unterbrechung unklar; automatischer Wiederholungsversand wurde zum Schutz vor Duplikaten blockiert.',
    };
  }
  if (input.state.kind === 'legacy') {
    return {
      ok: false,
      error: 'Der Legacy-SMTP-Marker enthaelt keine unveraenderliche Versandkopie; automatische Wiederherstellung wurde blockiert.',
    };
  }
  if (input.state.kind === 'invalid') {
    return {
      ok: false,
      error: 'Der SMTP-Commit-Marker ist ungueltig; automatische Wiederherstellung wurde blockiert.',
    };
  }

  const account = await input.store.getAccount({
    workspaceId: input.workspaceId,
    accountId: input.state.snapshot.accountId,
  });
  if (!account) {
    return {
      ok: false,
      error: 'SMTP wurde bereits bestaetigt, aber das Versandkonto fuer die Sent-Wiederherstellung fehlt.',
    };
  }
  await input.tracking?.recordSmtpAccepted({
    workspaceId: input.workspaceId,
    messageId: input.draftMessageId,
    trackingMessageId: input.state.snapshot.trackingMessageId,
    smtpCode: 250,
    acceptedRecipientCount: input.state.snapshot.recipientCount,
    rejectedRecipientCount: 0,
  }).catch(() => undefined);
  const sentCopy = input.state.snapshot.sentCopyCompleted
    ? { sentImapSyncFailed: false }
    : await appendSentCopyAfterSmtp({
      append: input.append,
      workspaceId: input.workspaceId,
      account,
      draftMessageId: input.draftMessageId,
      rfc822: input.state.snapshot.rfc822,
    });
  if (!input.state.snapshot.sentCopyCompleted && !sentCopy.sentImapSyncFailed) {
    await markSmtpSent(
      input.store,
      input.workspaceId,
      input.draftMessageId,
      encodeSmtpCommitSnapshot({ ...input.state.snapshot, sentCopyCompleted: true })!,
    );
  }
  await finalizeSentDraft({
    store: input.store,
    workspaceId: input.workspaceId,
    draftMessageId: input.draftMessageId,
    inReplyToMessageId: input.state.snapshot.inReplyToMessageId,
    markReplyParentDone: input.state.snapshot.markReplyParentDone ?? undefined,
    recovered: true,
    sentImapSyncFailed: sentCopy.sentImapSyncFailed,
  });
  return {
    ok: true,
    messageId: input.draftMessageId,
    accountId: account.id,
    recoveredSentAppend: true,
    warning: combineComposeWarnings(input.state.snapshot.trackingWarning, sentCopy.warning),
  };
}

async function claimSmtpOutboxInTransaction(
  trx: WorkspaceTransaction,
  workspaceId: string,
  messageId: number,
  nowInput?: Date,
): Promise<'claimed' | 'outbox' | 'committed'> {
  const key = smtpCommittedKey(messageId);
  const now = nowInput ?? new Date();
  const inserted = await trx
    .insertInto('sync_info')
    .values({
      workspace_id: workspaceId,
      key,
      value: COMPOSE_SMTP_OUTBOX_VALUE,
      last_updated: now,
      source_row: serverApiSourceRow(),
      imported_in_run_id: null,
      updated_at: now,
    })
    .onConflict((oc) => oc.columns(['workspace_id', 'key']).doNothing())
    .returning('key')
    .executeTakeFirst();
  if (inserted) return 'claimed';

  const row = await trx
    .selectFrom('sync_info')
    .select('value')
    .where('workspace_id', '=', workspaceId)
    .where('key', '=', key)
    .executeTakeFirst();
  if (
    row?.value === COMPOSE_SMTP_COMMITTED_VALUE
    || row?.value === COMPOSE_SMTP_SENT_VALUE
    || row?.value?.startsWith(COMPOSE_SMTP_SNAPSHOT_PREFIX)
  ) {
    return 'committed';
  }
  return 'outbox';
}

async function clearSmtpOutboxClaim(
  store: ComposeSenderStore,
  workspaceId: string,
  messageId: number,
): Promise<void> {
  const key = smtpCommittedKey(messageId);
  const values = await store.getSyncInfo({ workspaceId, keys: [key] });
  if (values.get(key) !== COMPOSE_SMTP_OUTBOX_VALUE) return;
  await store.deleteSyncInfo({ workspaceId, keys: [key] });
}

async function markSmtpSent(
  store: ComposeSenderStore,
  workspaceId: string,
  messageId: number,
  snapshot: string,
): Promise<void> {
  await store.setSyncInfo({
    workspaceId,
    values: { [smtpCommittedKey(messageId)]: snapshot },
  });
}

function smtpCommittedKey(messageId: number): string {
  return `${COMPOSE_SMTP_COMMITTED_PREFIX}${messageId}`;
}

function sendingInProgressKey(messageId: number): string {
  return `${COMPOSE_SEND_LOCK_PREFIX}${messageId}`;
}

function markReplyParentDoneKey(messageId: number): string {
  return `${COMPOSE_MARK_PARENT_DONE_PREFIX}${messageId}`;
}

function serverSentAppendWarning(account: ComposeSendAccount): string | undefined {
  if ((account.protocol || 'imap') !== 'imap') {
    return 'E-Mail wurde per SMTP versendet und in SimpleCRM als gesendet markiert. POP3-Konten koennen keine Kopie per IMAP auf dem Server ablegen.';
  }
  return 'E-Mail wurde per SMTP versendet und in SimpleCRM als gesendet markiert. Server-Kopie per IMAP APPEND ist fuer diesen Sender nicht konfiguriert.';
}

function truncateWarning(value: string): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > 300 ? `${text.slice(0, 297)}...` : text;
}

function formatMailbox(displayName: string, emailAddress: string): string {
  const name = displayName.trim();
  if (!name) return emailAddress.trim();
  return `${name.replace(/[\r\n"]/g, ' ').trim()} <${emailAddress.trim()}>`;
}

async function getOrCreateThreadForTicket(
  trx: WorkspaceTransaction,
  workspaceId: string,
  ticketCode: string,
  subject: string,
  accountId?: number | null,
  nowInput?: Date,
): Promise<string> {
  const existing = await trx
    .selectFrom('email_threads')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('ticket_code', '=', ticketCode)
    .where('account_id', accountId == null ? 'is' : '=', accountId ?? null)
    .executeTakeFirst();
  if (existing?.id) return existing.id;

  const now = nowInput ?? new Date();
  const threadId = `th-${randomBytes(12).toString('hex')}`;
  const values = {
    id: threadId,
    workspace_id: workspaceId,
    ticket_code: ticketCode,
    account_id: accountId ?? null,
    root_message_source_sqlite_id: null,
    root_message_id: null,
    last_message_at: null,
    message_count: 0,
    has_unread: false,
    has_attachments: false,
    subject_normalized: normalizeThreadSubject(subject),
    source_row: serverApiSourceRow(),
    imported_in_run_id: null,
    created_at: now,
    updated_at: now,
  };

  const inserted = accountId == null
    ? await trx
      .insertInto('email_threads')
      .values(values)
      .onConflict((oc) => oc
        .columns(['workspace_id', 'ticket_code'])
        .where('account_id', 'is', null)
        .doUpdateSet({ updated_at: now }))
      .returning('id')
      .executeTakeFirst()
    : await trx
      .insertInto('email_threads')
      .values(values)
      .onConflict((oc) => oc
        .columns(['workspace_id', 'account_id', 'ticket_code'])
        .doUpdateSet({ updated_at: now }))
      .returning('id')
      .executeTakeFirst();

  if (inserted?.id) return inserted.id;

  const existingAfterConflict = await trx
    .selectFrom('email_threads')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('ticket_code', '=', ticketCode)
    .where('account_id', accountId == null ? 'is' : '=', accountId ?? null)
    .executeTakeFirst();
  return existingAfterConflict?.id ?? threadId;
}

function formatServerTicketSequence(value: number, padding: number): string {
  const normalizedValue = Number.isSafeInteger(value) && value > 0 ? value : 1;
  const normalizedPadding = Number.isSafeInteger(padding) && padding > 0 ? Math.min(padding, 12) : 6;
  return String(normalizedValue).padStart(normalizedPadding, '0');
}

async function allocateNextTicketCodeForAccount(
  trx: WorkspaceTransaction,
  workspaceId: string,
  account: ComposeSendAccount,
  nowInput?: Date,
): Promise<string> {
  const now = nowInput ?? new Date();
  const defaultSettings = buildDefaultServerAccountMailSettings(account);
  await trx
    .insertInto('email_account_mail_settings')
    .values({
      workspace_id: workspaceId,
      account_source_sqlite_id: account.sourceSqliteId,
      account_id: account.id,
      ticket_prefix: defaultSettings.ticketPrefix,
      ticket_next_number: defaultSettings.ticketNextNumber,
      ticket_number_padding: defaultSettings.ticketNumberPadding,
      thread_namespace: defaultSettings.threadNamespace,
      source_row: serverApiSourceRow(),
      imported_in_run_id: null,
      created_at: now,
      updated_at: now,
    })
    .onConflict((oc) => oc.columns(['workspace_id', 'account_id']).doNothing())
    .execute();

  const row = await trx
    .selectFrom('email_account_mail_settings')
    .select(['ticket_prefix', 'ticket_next_number', 'ticket_number_padding'])
    .where('workspace_id', '=', workspaceId)
    .where('account_id', '=', account.id)
    .forUpdate()
    .executeTakeFirstOrThrow();
  const prefix = row.ticket_prefix.trim() || `ACC${account.id}`;
  const currentNumber = Number(row.ticket_next_number);
  const padding = Number(row.ticket_number_padding);
  const ticketCode = generateTicketCode({
    prefix,
    sequence: formatServerTicketSequence(currentNumber, padding),
  });
  const nextNumber = (Number.isSafeInteger(currentNumber) && currentNumber > 0 ? currentNumber : 1) + 1;

  await trx
    .updateTable('email_account_mail_settings')
    .set({
      ticket_next_number: nextNumber,
      updated_at: now,
    })
    .where('workspace_id', '=', workspaceId)
    .where('account_id', '=', account.id)
    .execute();
  return ticketCode;
}

async function upsertSyncInfo(
  trx: WorkspaceTransaction,
  workspaceId: string,
  values: Readonly<Record<string, string | null>>,
  nowInput?: Date,
): Promise<void> {
  const entries = Object.entries(values);
  if (entries.length === 0) return;
  const now = nowInput ?? new Date();
  await trx
    .insertInto('sync_info')
    .values(entries.map(([key, value]) => ({
      workspace_id: workspaceId,
      key,
      value,
      last_updated: now,
      source_row: serverApiSourceRow(),
      imported_in_run_id: null,
      updated_at: now,
    })))
    .onConflict((oc) => oc.columns(['workspace_id', 'key']).doUpdateSet({
      value: (eb) => eb.ref('excluded.value'),
      last_updated: now,
      updated_at: now,
    }))
    .execute();
}

function normalizeThreadSubject(subject: string): string | null {
  const value = subject
    .replace(/\[[A-Z]+-[A-F0-9]{6,10}\]/gi, '')
    .replace(/^(re|aw|fwd|fw):\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return value || null;
}

function snippetFromText(text: string): string | null {
  const value = text.trim();
  if (!value) return null;
  return value.length > 220 ? `${value.slice(0, 217)}...` : value;
}

function serverApiSourceRow(): RawBuilder<unknown> {
  return kyselySql`'{"origin":"server_api"}'::jsonb`;
}
