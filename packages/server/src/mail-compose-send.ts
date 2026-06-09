import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { Kysely, RawBuilder } from 'kysely';
import {
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
} from '@simplecrm/core';

import type {
  EmailComposeSenderApiPort,
  EmailComposeSendInput,
  EmailComposeSendResult,
  EmailOAuthProvider,
  EmailOutboundValidationApiPort,
  PgpMessageCryptoApiPort,
} from './api';
import { resolveAttachmentStoragePath, type PostgresSecretPort, type SecretIdentifier } from './db';
import type { ServerDatabase } from './db/schema';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
  type WorkspaceTransaction,
} from './db/workspace-context';
import { computeTextChangeRatio } from './ai-feedback';
import { refreshServerEmailOAuthAccessToken } from './email-oauth';
import type {
  ServerImapSentCopyAppendInput,
  ServerImapSentCopyAppendResult,
} from './mail-imap-append';
import { sendSmtpMessage, type ServerSmtpSendInput } from './mail-smtp-send';

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
const COMPOSE_SMTP_COMMITTED_PREFIX = 'email_compose_smtp_ok:';
const COMPOSE_SMTP_OUTBOX_VALUE = 'outbox';
const COMPOSE_SMTP_COMMITTED_VALUE = '1';

export type ComposeSmtpOutboxState = 'none' | 'outbox' | 'committed';
const COMPOSE_MARK_PARENT_DONE_PREFIX = 'compose_mark_parent_done:';
/** Marker set by email.release_outbound (autoSend=true) after ai.outbound_review
 *  returned OK. reviewOutbound.review honours it as "already approved, just send",
 *  so the scheduled-send cron doesn't loop through the review again. */
export const OUTBOUND_REVIEW_APPROVED_PREFIX = 'outbound_review_approved:';
const OUTBOUND_REVIEW_APPROVED_TTL_MS = 24 * 60 * 60 * 1000;
export function outboundReviewApprovedKey(draftId: number): string {
  return `${OUTBOUND_REVIEW_APPROVED_PREFIX}${draftId}`;
}
const MAX_OUTBOUND_WORKFLOWS_PER_SEND = 50;
const OUTBOUND_REVIEW_REASON =
  'Ausgangspruefung wird serverseitig ausgefuehrt; Versand bleibt blockiert, bis die Pruefung abgeschlossen ist.';
const MAX_OUTBOUND_CONTEXT_TEXT = 20_000;
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

type ComposeSendAccount = Readonly<{
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
    subject: string;
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
}>;

export type PostgresComposeSenderOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  attachmentsRoot?: string;
  secrets?: PostgresSecretPort;
  smtpSend?: (input: ServerSmtpSendInput) => Promise<void>;
  sentCopyAppend?: (input: ServerImapSentCopyAppendInput) => Promise<ServerImapSentCopyAppendResult>;
  outboundReview?: ComposeOutboundReviewPort;
  pgpMessages?: Pick<PgpMessageCryptoApiPort, 'prepareOutboundBody' | 'prepareOutboundAttachments'>;
  oauthFetchImpl?: typeof fetch;
  now?: () => Date;
}>;

export function createEmailComposeSenderPort(options: ComposeSenderOptions): EmailComposeSenderApiPort {
  const smtpSend = options.smtpSend ?? sendSmtpMessage;
  const sentCopyAppend = options.sentCopyAppend;
  const outboundReview = options.outboundReview;
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
      if (draft.accountId !== values.accountId) {
        return { ok: false, error: 'Entwurf gehoert zu einem anderen Konto' };
      }

      const recipientError = validateComposeRecipients(values);
      if (recipientError) return { ok: false, error: recipientError };

      const locked = await options.store.tryAcquireSendingLock({
        workspaceId: input.workspaceId,
        messageId: values.draftMessageId,
      });
      if (!locked) {
        return { ok: false, error: 'Versand laeuft bereits fuer diesen Entwurf.' };
      }

      try {
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
        const rfc822 = buildComposeRfc822({
          from,
          to: smtpTo.join(', '),
          cc: smtpCc.length > 0 ? smtpCc.join(', ') : undefined,
          subject: prepared.finalSubject,
          text: bodyText,
          html: html?.trim() ? html : undefined,
          messageId: prepared.outboundMessageId,
          inReplyTo: prepared.inReplyTo ?? undefined,
          references: prepared.references ?? undefined,
          requestReadReceipt: requestReceipt,
          attachments,
          date: now(),
        }).toString('utf8');

        const smtpOutboxClaim = await options.store.claimSmtpOutbox({
          workspaceId: input.workspaceId,
          messageId: values.draftMessageId,
        });
        if (smtpOutboxClaim !== 'claimed') {
          const sentCopy = await appendSentCopyAfterSmtp({
            append: sentCopyAppend,
            workspaceId: input.workspaceId,
            account,
            draftMessageId: values.draftMessageId,
            rfc822,
          });
          await finalizeSentDraft({
            store: options.store,
            workspaceId: input.workspaceId,
            draftMessageId: values.draftMessageId,
            inReplyToMessageId: values.inReplyToMessageId,
            markReplyParentDone: values.markReplyParentDone,
            recovered: true,
            sentImapSyncFailed: sentCopy.sentImapSyncFailed,
          });
          return {
            ok: true,
            messageId: values.draftMessageId,
            accountId: account.id,
            recoveredSentAppend: true,
            warning: sentCopy.warning,
          };
        }

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

        try {
          const smtpInput: ServerSmtpSendInput = {
            host: account.smtpHost?.trim() || account.imapHost,
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
          await clearSmtpOutboxClaim(options.store, input.workspaceId, values.draftMessageId);
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }

        await markSmtpCommitted(options.store, input.workspaceId, values.draftMessageId);
        const sentCopy = await appendSentCopyAfterSmtp({
          append: sentCopyAppend,
          workspaceId: input.workspaceId,
          account,
          draftMessageId: values.draftMessageId,
          rfc822,
        });
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
          warning: sentCopy.warning,
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
    }),
    pgpMessages: options.pgpMessages,
    oauthFetchImpl: options.oauthFetchImpl,
    now: options.now,
    store: createPostgresComposeSenderStore(options),
  });
}

export function createPostgresEmailOutboundValidationPort(options: {
  db: Kysely<ServerDatabase>;
  now?: () => Date;
}): EmailOutboundValidationApiPort {
  const outboundReview = createPostgresComposeOutboundReviewPort(options);
  return {
    async validate(input) {
      const result = await outboundReview.review({
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        draftMessageId: input.values.messageId,
        subject: input.values.subject,
        bodyText: input.values.bodyText,
        bodyHtml: input.values.bodyHtml ?? null,
        to: input.values.to,
        ...(input.values.cc === undefined ? {} : { cc: input.values.cc }),
        ...(input.values.bcc === undefined ? {} : { bcc: input.values.bcc }),
        ...(input.values.inReplyToMessageId === undefined
          ? {}
          : { inReplyToMessageId: input.values.inReplyToMessageId }),
        attachmentCount: input.values.attachmentCount ?? 0,
      });
      if (result.allowed) return { allowed: true, reason: null };
      return {
        allowed: false,
        reason: result.error,
        ...(result.workflowRunId === undefined ? {} : { workflowRunId: result.workflowRunId }),
      };
    },
  };
}

export function createPostgresComposeOutboundReviewPort(options: {
  db: Kysely<ServerDatabase>;
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
        async (trx) => getOrCreateThreadForTicket(trx, input.workspaceId, input.ticketCode, input.subject, options.now?.()),
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
          const row = await trx
            .insertInto('sync_info')
            .values({
              workspace_id: input.workspaceId,
              key: sendingInProgressKey(input.messageId),
              value: '1',
              last_updated: now,
              source_row: serverApiSourceRow(),
              imported_in_run_id: null,
              updated_at: now,
            })
            .onConflict((oc) => oc.columns(['workspace_id', 'key']).doNothing())
            .returning('key')
            .executeTakeFirst();
          return Boolean(row);
        },
      );
    },
    async releaseSendingLock(input) {
      await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          await trx
            .deleteFrom('sync_info')
            .where('workspace_id', '=', input.workspaceId)
            .where('key', '=', sendingInProgressKey(input.messageId))
            .execute();
        },
      );
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
              sent_imap_sync_failed: input.sentImapSyncFailed,
              // Null the snapshot after measuring so an accidental re-run of
              // markDraftAsSent does not produce a duplicate feedback row.
              ...(feedback ? { ai_suggestion_snapshot: null } : {}),
              updated_at: options.now?.() ?? new Date(),
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.messageId)
            .execute();
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
  if (!ticketCode) ticketCode = extractTicketFromSubject(values.subject) ?? generateTicketCode();
  if (!threadId) {
    threadId = await input.store.getOrCreateThreadForTicket({
      workspaceId: input.workspaceId,
      ticketCode,
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
    keys: [smtpCommittedKey(input.draftMessageId)],
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

type ResolvedSmtpAuth =
  | { ok: true; user: string; password?: string; accessToken?: string }
  | { ok: false; error: string };

async function resolveSmtpAuth(input: {
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
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
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
  if (row?.value === COMPOSE_SMTP_COMMITTED_VALUE) return 'committed';
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

async function markSmtpCommitted(
  store: ComposeSenderStore,
  workspaceId: string,
  messageId: number,
): Promise<void> {
  await store.setSyncInfo({
    workspaceId,
    values: { [smtpCommittedKey(messageId)]: COMPOSE_SMTP_COMMITTED_VALUE },
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
  nowInput?: Date,
): Promise<string> {
  const existing = await trx
    .selectFrom('email_threads')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('ticket_code', '=', ticketCode)
    .executeTakeFirst();
  if (existing?.id) return existing.id;

  const now = nowInput ?? new Date();
  const threadId = `th-${randomBytes(8).toString('hex')}`;
  const inserted = await trx
    .insertInto('email_threads')
    .values({
      id: threadId,
      workspace_id: workspaceId,
      ticket_code: ticketCode,
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
    })
    .onConflict((oc) => oc.columns(['workspace_id', 'ticket_code']).doUpdateSet({ updated_at: now }))
    .returning('id')
    .executeTakeFirst();
  return inserted?.id ?? threadId;
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
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  return kyselySql`'{"origin":"server_api"}'::jsonb`;
}
