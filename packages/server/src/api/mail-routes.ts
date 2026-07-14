import type {
  ApiErrorBody,
  ApiRequest,
  ApiResponse,
  AuthenticatedPrincipal,
  EmailAttachmentListResult,
  EmailAttachmentRecord,
  EmailAccountListResult,
  EmailAccountMutationInput,
  EmailAccountMutationPortResult,
  EmailAccountRecord,
  EmailComposeDraftMutationResult,
  EmailComposeSendInput,
  EmailDiagnosticsReport,
  EmailMessageListResult,
  EmailMailFolderCounts,
  EmailMessageMoveTargetView,
  EmailMessageRawHeadersRecord,
  EmailMessageRecord,
  EmailReplyDraftGenerationResult,
  EmailReplySuggestionRecord,
  EmailReplySuggestionTrigger,
  EmailOAuthProvider,
  EmailOutboundValidationInput,
  EmailReadReceiptRecord,
  EmailReadReceiptRespondAction,
  EmailReadReceiptResponseResult,
  EmailReadReceiptStateResult,
  EmailReportingSnapshot,
  EmailRemoteContentPolicy,
  EmailRemoteContentPolicyMutationInput,
  EmailMessageSecurityRecord,
  EmailMessageSpamDecisionMutationInput,
  EmailMessageSpamStatusMutationInput,
  MailConnectionTestInput,
  SpamDecisionRecord,
  ServerApiPorts,
  SyncInfoRecord,
} from './types';
import {
  data,
  error,
  positiveIntFromPath,
  requireAdmin,
  requirePrincipal,
} from './http';
import { JOB_STALE_LOCK_SECONDS } from '../jobs';
import { autoSubmittedDraftKey } from '../mail-compose-send';
import { handleMailMetadataReadRoute } from './mail-metadata-routes';

const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_MESSAGE_LIMIT = 500;

const EMAIL_OAUTH_APP_KEYS: Record<EmailOAuthProvider, {
  clientId: string;
  clientSecret: string;
  label: string;
}> = {
  google: {
    clientId: 'email_google_oauth_client_id',
    clientSecret: 'email_google_oauth_client_secret',
    label: 'Google',
  },
  microsoft: {
    clientId: 'email_ms_oauth_client_id',
    clientSecret: 'email_ms_oauth_client_secret',
    label: 'Microsoft',
  },
};

type EmailMessageSpamStatusMutationParseResult =
  | { ok: true; values: EmailMessageSpamStatusMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type EmailMessageSpamDecisionMutationParseResult =
  | { ok: true; values: EmailMessageSpamDecisionMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type EmailMessageBulkMutationParseResult =
  | { ok: true; messageIds: number[]; accountId?: number; flag?: boolean }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type EmailMessageBulkSpamStatusMutationParseResult =
  | {
    ok: true;
    messageIds: number[];
    accountId?: number;
    values: EmailMessageSpamStatusMutationInput;
  }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type EmailOAuthAppMutationParseResult =
  | { ok: true; values: { clientId: string; clientSecret: string } }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type EmailOAuthRedirectParseResult =
  | { ok: true; redirectUri: string }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type EmailOAuthFinishParseResult =
  | { ok: true; accountId: number; redirectUri: string; code: string }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type EmailComposeDraftCreateParseResult =
  | {
    ok: true;
    accountId: number;
    subject?: string;
    bodyText?: string;
    toJson?: unknown | null;
  }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type EmailComposeDraftUpdateParseResult =
  | {
    ok: true;
    values: {
      subject?: string;
      bodyText?: string;
      bodyHtml?: string | null;
      toJson?: unknown | null;
      ccJson?: unknown | null;
      bccJson?: unknown | null;
      draftAttachmentPaths?: readonly string[];
      replyParentMessageId?: number | null;
    };
    markReplyParentDone?: boolean;
  }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type EmailComposeSendParseResult =
  | { ok: true; values: EmailComposeSendInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type EmailComposeAttachmentUploadParseResult =
  | { ok: true; filename: string; contentBase64: string; contentType?: string }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type EmailOutboundValidationParseResult =
  | { ok: true; values: EmailOutboundValidationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type EmailScheduledSendParseResult =
  | { ok: true; sendAt: string | null }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type EmailMessageSnoozeMutationParseResult =
  | { ok: true; until: string | null }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type EmailMessageFlagMutationParseResult =
  | { ok: true; flag: boolean; syncToServer?: boolean }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type EmailMessageActionParseResult =
  | { ok: true; action: string; payload: Record<string, unknown> }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type EmailMessageMoveMutationParseResult =
  | { ok: true; view: EmailMessageMoveTargetView }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type EmailInboxArchiveRecoveryParseResult =
  | { ok: true; expectedCount: number; confirmPhrase: string }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type EmailRemoteContentPolicyMutationParseResult =
  | { ok: true; values: EmailRemoteContentPolicyMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type EmailReadReceiptResponseParseResult =
  | { ok: true; action: EmailReadReceiptRespondAction }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type EmailReplySuggestionEnsureParseResult =
  | { ok: true; force?: boolean; trigger?: EmailReplySuggestionTrigger }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type EmailReplyDraftGenerateParseResult =
  | {
    ok: true;
    promptId?: number;
    profileId?: number;
    customerId?: number | null;
    userContext?: string;
    persistSuggestion?: boolean;
  }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type EmailMessageCustomerLinkMutationParseResult =
  | { ok: true; customerId: number | null }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type EmailMessageCustomerBackfillParseResult =
  | { ok: true; accountId?: number; limit?: number }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type EmailMessageAssignmentMutationParseResult =
  | { ok: true; teamMemberId: string | null }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type EmailAccountMutationParseResult =
  | { ok: true; values: EmailAccountMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type MailConnectionTestParseResult =
  | { ok: true; values: Omit<MailConnectionTestInput, 'workspaceId'> }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type MailRouteHandler = (
  req: ApiRequest,
  ports: ServerApiPorts,
  params: string[],
) => Promise<ApiResponse>;

type MailRouteEntry =
  | { kind: 'route'; pattern: RegExp; handler: MailRouteHandler }
  | { kind: 'delegate'; delegate: (req: ApiRequest, ports: ServerApiPorts) => Promise<ApiResponse | null> };

// Ordered mail read-route table. The array order IS the dispatch order: the
// first matching `route` wins, a `delegate` returns its result if truthy and
// otherwise falls through, and if nothing matches `handleMailReadRoute` returns
// null. This is a faithful, order-preserving transcription of the former
// if-cascade — see plan 014. Any exact-string or more-specific route that could
// be shadowed by a broad `([^/]+)` capture (notably the generic
// `…/messages/:id` at the end) MUST stay above it.
const MAIL_ROUTES: readonly MailRouteEntry[] = [
  { kind: 'route', pattern: /^\/api\/v1\/email\/oauth\/(google|microsoft)\/app$/, handler: (req, ports, params) => handleEmailOAuthApp(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/oauth\/(google|microsoft)\/authorize-url$/, handler: (req, ports, params) => handleEmailOAuthAuthorizeUrl(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/oauth\/(google|microsoft)\/finish$/, handler: (req, ports, params) => handleEmailOAuthFinish(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/accounts$/, handler: (req, ports) => handleEmailAccountsCollection(req, ports) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/accounts\/test-imap$/, handler: (req, ports) => handleMailConnectionTest(req, ports, 'imap') },
  { kind: 'route', pattern: /^\/api\/v1\/email\/accounts\/test-pop3$/, handler: (req, ports) => handleMailConnectionTest(req, ports, 'pop3') },
  { kind: 'route', pattern: /^\/api\/v1\/email\/accounts\/test-smtp$/, handler: (req, ports) => handleMailConnectionTest(req, ports, 'smtp') },
  { kind: 'route', pattern: /^\/api\/v1\/email\/accounts\/([^/]+)\/sync$/, handler: (req, ports, params) => handleEmailAccountSync(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/accounts\/([^/]+)\/sync-lock$/, handler: (req, ports, params) => handleEmailAccountSyncLockClear(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/accounts\/([^/]+)\/vacation-test$/, handler: (req, ports, params) => handleEmailAccountVacationTest(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/accounts\/([^/]+)\/inbox-archive-recovery$/, handler: (req, ports, params) => handleEmailAccountInboxArchiveRecovery(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/accounts\/([^/]+)$/, handler: (req, ports, params) => handleEmailAccountItem(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/folder-counts$/, handler: (req, ports) => handleMailFolderCounts(req, ports) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/diagnostics$/, handler: (req, ports) => handleMailDiagnostics(req, ports) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/reporting$/, handler: (req, ports) => handleEmailReporting(req, ports) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/gdpr-export$/, handler: (req, ports) => handleEmailGdprExport(req, ports) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/threads\/backfill$/, handler: (req, ports) => handleMailThreadBackfill(req, ports) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/backfill-customer-links$/, handler: (req, ports) => handleMessageCustomerLinkBackfill(req, ports) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages$/, handler: (req, ports) => handleMessageList(req, ports) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/conversation$/, handler: (req, ports) => handleConversationMessageList(req, ports) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/bulk\/soft-delete$/, handler: (req, ports) => handleMessageBulkSoftDelete(req, ports) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/bulk\/archive$/, handler: (req, ports) => handleMessageBulkSetArchived(req, ports) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/bulk\/done$/, handler: (req, ports) => handleMessageBulkSetDone(req, ports) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/bulk\/spam-status$/, handler: (req, ports) => handleMessageBulkSetSpamStatus(req, ports) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/bulk\/local-drafts$/, handler: (req, ports) => handleMessageBulkDeleteLocalDrafts(req, ports) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/compose-drafts$/, handler: (req, ports) => handleComposeDraftCreate(req, ports) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/compose\/send$/, handler: (req, ports) => handleComposeSend(req, ports) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/compose\/validate-outbound$/, handler: (req, ports) => handleComposeValidateOutbound(req, ports) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/([^/]+)\/compose-attachments$/, handler: (req, ports, params) => handleComposeAttachmentUpload(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/([^/]+)\/compose-draft$/, handler: (req, ports, params) => handleComposeDraftUpdate(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/([^/]+)\/scheduled-send-state$/, handler: (req, ports, params) => handleScheduledSendDraftState(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/([^/]+)\/compose-draft-recovery-state$/, handler: (req, ports, params) => handleComposeDraftRecoveryState(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/([^/]+)\/scheduled-send-failure$/, handler: (req, ports, params) => handleScheduledSendDraftFailureClear(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/([^/]+)\/scheduled-send\/retry$/, handler: (req, ports, params) => handleScheduledSendDraftRetry(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/([^/]+)\/post-process\/retry$/, handler: (req, ports, params) => handleMessagePostProcessRetry(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/([^/]+)\/scheduled-send$/, handler: (req, ports, params) => handleScheduledSendDraftSchedule(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/threads\/([^/]+)\/messages$/, handler: (req, ports, params) => handleThreadMessageList(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/([^/]+)\/spam-decision$/, handler: (req, ports, params) => handleMessageSpamDecisionMutation(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/([^/]+)\/spam-status$/, handler: (req, ports, params) => handleMessageSpamStatusMutation(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/([^/]+)\/security\/check$/, handler: (req, ports, params) => handleMessageSecurityCheck(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/([^/]+)\/security$/, handler: (req, ports, params) => handleMessageSecurityGet(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/([^/]+)\/raw-headers$/, handler: (req, ports, params) => handleMessageRawHeadersGet(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/([^/]+)\/read-receipt-response$/, handler: (req, ports, params) => handleMessageReadReceiptResponse(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/([^/]+)\/read-receipt-state$/, handler: (req, ports, params) => handleMessageReadReceiptStateGet(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/([^/]+)\/remote-content-policy\/consume$/, handler: (req, ports, params) => handleMessageRemoteContentPolicyConsume(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/([^/]+)\/remote-content-policy$/, handler: (req, ports, params) => handleMessageRemoteContentPolicySet(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/([^/]+)\/snooze$/, handler: (req, ports, params) => handleMessageSnooze(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/([^/]+)\/soft-delete$/, handler: (req, ports, params) => handleMessageSoftDelete(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/([^/]+)\/restore$/, handler: (req, ports, params) => handleMessageRestore(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/([^/]+)\/local-draft$/, handler: (req, ports, params) => handleMessageDeleteLocalDraft(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/([^/]+)\/customer-link$/, handler: (req, ports, params) => handleMessageLinkCustomer(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/([^/]+)\/assignment$/, handler: (req, ports, params) => handleMessageAssign(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/([^/]+)\/archive$/, handler: (req, ports, params) => handleMessageSetArchived(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/([^/]+)\/seen$/, handler: (req, ports, params) => handleMessageSetSeen(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/([^/]+)\/done$/, handler: (req, ports, params) => handleMessageSetDone(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/([^/]+)\/move$/, handler: (req, ports, params) => handleMessageMove(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/([^/]+)\/actions$/, handler: (req, ports, params) => handleMessageAction(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/([^/]+)\/attachments$/, handler: (req, ports, params) => handleMessageAttachmentList(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/([^/]+)\/reply-suggestion$/, handler: (req, ports, params) => handleMessageReplySuggestionGet(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/([^/]+)\/reply-suggestion\/ensure$/, handler: (req, ports, params) => handleMessageReplySuggestionEnsure(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/([^/]+)\/reply-draft$/, handler: (req, ports, params) => handleMessageReplyDraftGenerate(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/attachments\/([^/]+)\/content$/, handler: (req, ports, params) => handleAttachmentContentGet(req, ports, params[0]) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/attachments\/([^/]+)$/, handler: (req, ports, params) => handleAttachmentGet(req, ports, params[0]) },
  { kind: 'delegate', delegate: (req, ports) => handleMailMetadataReadRoute(req, ports) },
  { kind: 'route', pattern: /^\/api\/v1\/email\/messages\/([^/]+)$/, handler: (req, ports, params) => handleMessageGet(req, ports, params[0]) },
];

export async function handleMailReadRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse | null> {
  for (const entry of MAIL_ROUTES) {
    if (entry.kind === 'delegate') {
      const result = await entry.delegate(req, ports);
      if (result) return result;
      continue;
    }
    const match = entry.pattern.exec(req.path);
    if (match) return entry.handler(req, ports, match.slice(1));
  }
  return null;
}

async function handleEmailAccountVacationTest(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const accountId = positiveIntFromPath(rawId);
  if (accountId === null) return error(400, 'invalid_email_account_id', 'email account id muss eine positive Ganzzahl sein');
  if (!ports.emailVacationTests) {
    return error(503, 'email_vacation_test_unavailable', 'Email vacation-test API nicht konfiguriert');
  }

  const result = await ports.emailVacationTests.sendTest({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    accountId,
  });

  if (result.success) {
    await ports.activityLog?.create?.({
      workspaceId: principal.workspaceId,
      actorUserId: principal.userId,
      values: {
        activityType: 'email_vacation_test',
        title: 'Abwesenheitsantwort getestet',
        description: `Testmail an ${result.emailAddress}`,
        metadata: { accountId: result.accountId },
      },
    });
  }

  return data(200, result);
}

async function handleEmailAccountInboxArchiveRecovery(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const accountId = positiveIntFromPath(rawId);
  if (accountId === null) return error(400, 'invalid_email_account_id', 'email account id muss eine positive Ganzzahl sein');

  if (req.method === 'GET') {
    if (!ports.emailMessages?.previewInboxArchiveRecovery) {
      return error(503, 'email_inbox_archive_recovery_unavailable', 'Email inbox archive recovery API nicht konfiguriert');
    }
    const preview = await ports.emailMessages.previewInboxArchiveRecovery({
      workspaceId: principal.workspaceId,
      accountId,
    });
    return preview
      ? data(200, { success: true, ...preview })
      : error(404, 'email_account_not_found', 'Email account nicht gefunden');
  }

  if (req.method === 'POST') {
    if (!ports.emailMessages?.restoreInboxFromArchive) {
      return error(503, 'email_inbox_archive_recovery_unavailable', 'Email inbox archive recovery API nicht konfiguriert');
    }
    const parsed = parseEmailInboxArchiveRecoveryBody(req.body);
    if (!parsed.ok) return parsed.response;
    const result = await ports.emailMessages.restoreInboxFromArchive({
      workspaceId: principal.workspaceId,
      accountId,
      expectedCount: parsed.expectedCount,
      confirmPhrase: parsed.confirmPhrase,
    });
    if (!result.ok) {
      return error(409, 'email_inbox_archive_recovery_failed', result.error);
    }
    if (result.restored > 0) {
      await ports.activityLog?.create?.({
        workspaceId: principal.workspaceId,
        actorUserId: principal.userId,
        values: {
          activityType: 'email_inbox_archive_recovery',
          title: 'Archivierte Posteingangs-Mails wiederhergestellt',
          description: `${result.restored} Nachricht(en) fuer Konto ${accountId} wieder in den Posteingang geholt.`,
          metadata: { accountId, restored: result.restored },
        },
      });
    }
    return data(200, { success: true, restored: safeCount(result.restored) });
  }

  return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
}

async function handleEmailAccountSync(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const accountId = positiveIntFromPath(rawId);
  if (accountId === null) return error(400, 'invalid_email_account_id', 'email account id muss eine positive Ganzzahl sein');
  if (!ports.emailAccounts) return error(503, 'email_accounts_unavailable', 'Email account API nicht konfiguriert');
  if (!ports.jobQueue) return error(503, 'job_queue_unavailable', 'Job queue API nicht konfiguriert');

  const account = await ports.emailAccounts.get({ workspaceId: principal.workspaceId, id: accountId });
  if (!account) return error(404, 'email_account_not_found', 'Email account nicht gefunden');

  const protocol = String(account.protocol ?? '').toLowerCase();
  const jobType = protocol === 'imap' ? 'mail.sync.imap' : protocol === 'pop3' ? 'mail.sync.pop3' : null;
  if (!jobType) {
    return error(409, 'unsupported_email_account_protocol', 'Email account protocol wird nicht unterstuetzt');
  }

  // Optional one-shot full inbox backfill (IMAP only): import older already-read
  // messages skipped by the first-sync cap.
  const fullInbox = jobType === 'mail.sync.imap'
    && typeof req.body === 'object' && req.body !== null
    && (req.body as { fullInbox?: unknown }).fullInbox === true;

  await ports.jobQueue.enqueue({
    workspaceId: principal.workspaceId,
    type: jobType,
    payload: {
      workspaceId: principal.workspaceId,
      accountId,
      actorUserId: principal.userId,
      ...(fullInbox ? { fullInbox: true } : {}),
    },
  });

  return data(202, {
    success: true,
    queued: true,
    accountId,
    jobType,
    fullInbox,
  });
}

async function handleEmailAccountSyncLockClear(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'DELETE') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const accountId = positiveIntFromPath(rawId);
  if (accountId === null) return error(400, 'invalid_email_account_id', 'email account id muss eine positive Ganzzahl sein');
  if (!ports.emailAccounts) return error(503, 'email_accounts_unavailable', 'Email account API nicht konfiguriert');
  if (!ports.jobQueue?.releaseAccountSyncLocks) {
    return error(503, 'job_queue_lock_release_unavailable', 'Job queue lock release API nicht konfiguriert');
  }

  const account = await ports.emailAccounts.get({ workspaceId: principal.workspaceId, id: accountId });
  if (!account) return error(404, 'email_account_not_found', 'Email account nicht gefunden');

  const released = await ports.jobQueue.releaseAccountSyncLocks({
    workspaceId: principal.workspaceId,
    accountId,
    staleBefore: new Date(Date.now() - JOB_STALE_LOCK_SECONDS * 1000),
    limit: 100,
  });

  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'email_account.sync_lock_cleared',
    entityType: 'email_account',
    entityId: String(accountId),
    metadata: {
      accountId,
      released: released.length,
      staleSeconds: JOB_STALE_LOCK_SECONDS,
    },
  });

  return data(200, {
    success: true,
    accountId,
    released: released.length,
  });
}

async function handleMailConnectionTest(
  req: ApiRequest,
  ports: ServerApiPorts,
  protocol: 'imap' | 'pop3' | 'smtp',
): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.mailConnectionTests) {
    return error(503, 'mail_connection_test_unavailable', 'Mail connection test API nicht konfiguriert');
  }

  const parsed = parseMailConnectionTestBody(req.body, protocol);
  if (!parsed.ok) return parsed.response;

  const input = {
    workspaceId: principal.workspaceId,
    ...parsed.values,
  };
  const result = protocol === 'imap'
    ? await ports.mailConnectionTests.testImap(input)
    : protocol === 'pop3'
      ? await ports.mailConnectionTests.testPop3(input)
      : await ports.mailConnectionTests.testSmtp(input);
  return data(200, result);
}

async function handleEmailOAuthApp(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawProvider: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'GET' && req.method !== 'PATCH') {
    return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  }
  const provider = normalizeEmailOAuthProvider(rawProvider);
  if (!provider) return error(400, 'invalid_email_oauth_provider', 'OAuth provider ist ungueltig');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const loaded = await loadEmailOAuthAppSettings(ports, principal, provider);
  if ('status' in loaded) return loaded;

  if (req.method === 'GET') {
    return data(200, {
      success: true,
      clientId: loaded.settings.clientId,
      clientSecret: loaded.settings.clientSecret,
    });
  }

  const parsed = parseEmailOAuthAppMutationBody(req.body);
  if (!parsed.ok) return parsed.response;
  const keys = EMAIL_OAUTH_APP_KEYS[provider];
  if (!ports.syncInfo) return error(503, 'sync_info_unavailable', 'Sync-info API nicht konfiguriert');
  await ports.syncInfo.setMany({
    workspaceId: principal.workspaceId,
    values: {
      [keys.clientId]: parsed.values.clientId,
      [keys.clientSecret]: parsed.values.clientSecret,
    },
  });
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'email_oauth_app.updated',
    entityType: 'sync_info',
    entityId: `email.oauth.${provider}.app`,
    metadata: {
      provider,
      fields: ['clientId', 'clientSecret'],
      clientSecretChanged: true,
    },
  });
  return data(200, { success: true });
}

async function handleEmailOAuthAuthorizeUrl(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawProvider: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const provider = normalizeEmailOAuthProvider(rawProvider);
  if (!provider) return error(400, 'invalid_email_oauth_provider', 'OAuth provider ist ungueltig');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.emailOAuth) return error(503, 'email_oauth_unavailable', 'Email OAuth API nicht konfiguriert');
  const parsed = parseEmailOAuthRedirectBody(req.body);
  if (!parsed.ok) return parsed.response;
  const loaded = await loadEmailOAuthAppSettings(ports, principal, provider);
  if ('status' in loaded) return loaded;
  const config = EMAIL_OAUTH_APP_KEYS[provider];
  if (!loaded.settings.clientId || (provider === 'google' && !loaded.settings.clientSecret)) {
    return data(200, { success: false, error: `${config.label} OAuth App-Daten fehlen` });
  }

  try {
    const url = ports.emailOAuth.buildAuthorizeUrl({
      provider,
      clientId: loaded.settings.clientId,
      clientSecret: loaded.settings.clientSecret,
      redirectUri: parsed.redirectUri,
    });
    return data(200, { success: true, url });
  } catch (cause) {
    return data(200, { success: false, error: cause instanceof Error ? cause.message : String(cause) });
  }
}

async function handleEmailOAuthFinish(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawProvider: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const provider = normalizeEmailOAuthProvider(rawProvider);
  if (!provider) return error(400, 'invalid_email_oauth_provider', 'OAuth provider ist ungueltig');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.emailOAuth) return error(503, 'email_oauth_unavailable', 'Email OAuth API nicht konfiguriert');
  if (!ports.emailAccounts?.setOAuthRefreshToken) {
    return error(503, 'email_accounts_unavailable', 'Email account OAuth API nicht konfiguriert');
  }
  const parsed = parseEmailOAuthFinishBody(req.body);
  if (!parsed.ok) return parsed.response;
  const loaded = await loadEmailOAuthAppSettings(ports, principal, provider);
  if ('status' in loaded) return loaded;
  const config = EMAIL_OAUTH_APP_KEYS[provider];
  if (!loaded.settings.clientId || !loaded.settings.clientSecret) {
    return data(200, { success: false, error: `${config.label} OAuth App-Daten fehlen` });
  }

  let refreshToken: string | null = null;
  try {
    const exchanged = await ports.emailOAuth.exchangeAuthCode({
      provider,
      clientId: loaded.settings.clientId,
      clientSecret: loaded.settings.clientSecret,
      redirectUri: parsed.redirectUri,
      code: parsed.code,
    });
    refreshToken = exchanged.refreshToken;
  } catch (cause) {
    return data(200, { success: false, error: cause instanceof Error ? cause.message : String(cause) });
  }
  if (!refreshToken) {
    return data(200, { success: false, error: `${config.label} OAuth: kein Refresh-Token erhalten` });
  }

  const result = await ports.emailAccounts.setOAuthRefreshToken({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id: parsed.accountId,
    provider,
    refreshToken,
  });
  if (!result) return data(200, { success: false, error: 'Konto nicht gefunden' });
  if (!result.ok) return emailAccountMutationError(result);

  const metadata = {
    fields: ['oauthProvider', 'oauthRefreshToken'],
    oauthProvider: provider,
    oauthRefreshTokenChanged: true,
  };
  await auditEmailAccount(ports, principal, 'email_account.updated', result.account, metadata);
  await publishEmailAccount(ports, principal.workspaceId, 'email_account.updated', result.account, principal.userId, metadata);
  return data(200, { success: true, account: sanitizeEmailAccount(result.account) });
}

async function handleComposeDraftCreate(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.emailMessages?.createComposeDraft) {
    return error(503, 'email_messages_unavailable', 'Email compose-draft API nicht konfiguriert');
  }
  const parsed = parseComposeDraftCreateBody(req.body);
  if (!parsed.ok) return parsed.response;
  const result = await ports.emailMessages.createComposeDraft({
    workspaceId: principal.workspaceId,
    accountId: parsed.accountId,
    values: {
      accountId: parsed.accountId,
      ...(parsed.subject === undefined ? {} : { subject: parsed.subject }),
      ...(parsed.bodyText === undefined ? {} : { bodyText: parsed.bodyText }),
      ...(parsed.toJson === undefined ? {} : { toJson: parsed.toJson }),
    },
  });
  if (!result.ok) return composeDraftMutationError(result.reason);
  return data(200, { success: true, id: result.message.id, message: sanitizeEmailMessage(result.message, true) });
}

async function handleComposeDraftUpdate(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'PATCH') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const messageId = positiveIntFromPath(rawId);
  if (messageId === null) return error(400, 'invalid_email_message_id', 'email message id muss eine positive Ganzzahl sein');
  if (!ports.emailMessages?.updateComposeDraft) {
    return error(503, 'email_messages_unavailable', 'Email compose-draft API nicht konfiguriert');
  }
  const parsed = parseComposeDraftUpdateBody(req.body);
  if (!parsed.ok) return parsed.response;
  const result = await ports.emailMessages.updateComposeDraft({
    workspaceId: principal.workspaceId,
    messageId,
    values: parsed.values,
  });
  if (!result.ok) return composeDraftMutationError(result.reason);
  if (ports.syncInfo) {
    await ports.syncInfo.setMany({
      workspaceId: principal.workspaceId,
      values: {
        [autoSubmittedDraftKey(messageId)]: null,
        ...(parsed.markReplyParentDone === undefined
          ? {}
          : { [`compose_mark_parent_done:${messageId}`]: parsed.markReplyParentDone ? '1' : '0' }),
      },
    });
  } else if (parsed.markReplyParentDone !== undefined) {
    return error(503, 'sync_info_unavailable', 'Sync-info API nicht konfiguriert');
  }
  return data(200, { success: true, message: sanitizeEmailMessage(result.message, true) });
}

async function handleComposeSend(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.emailComposeSender) {
    return error(503, 'email_compose_send_unavailable', 'Email compose-send API nicht konfiguriert');
  }
  const parsed = parseComposeSendBody(req.body);
  if (!parsed.ok) return parsed.response;
  const result = await ports.emailComposeSender.send({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: parsed.values,
  });
  if (!result.ok) {
    return data(200, {
      success: false,
      error: result.error,
      ...(result.workflowRunId === undefined ? {} : { workflowRunId: result.workflowRunId }),
    });
  }

  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'email_message.sent',
    entityType: 'email_message',
    entityId: String(result.messageId),
    metadata: {
      id: result.messageId,
      accountId: result.accountId,
      recoveredSentAppend: result.recoveredSentAppend === true,
      hasWarning: Boolean(result.warning),
    },
  });
  await ports.events?.publish({
    type: 'email_message.updated',
    workspaceId: principal.workspaceId,
    entityType: 'email_message',
    entityId: String(result.messageId),
    actorUserId: principal.userId,
    occurredAt: new Date().toISOString(),
    payload: {
      id: result.messageId,
      accountId: result.accountId,
      fields: ['folderKind', 'outboundHold', 'scheduledSendAt', 'sentImapSyncFailed'],
      source: 'compose_send',
      recoveredSentAppend: result.recoveredSentAppend === true,
    },
  });
  return data(200, {
    success: true,
    ...(result.warning ? { warning: result.warning } : {}),
    ...(result.recoveredSentAppend ? { recoveredSentAppend: true } : {}),
  });
}

async function handleComposeAttachmentUpload(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const draftMessageId = positiveIntFromPath(rawId);
  if (draftMessageId === null) return error(400, 'invalid_email_message_id', 'email message id muss eine positive Ganzzahl sein');
  if (!ports.emailComposeAttachments) {
    return error(503, 'email_compose_attachment_upload_unavailable', 'Email compose-attachment API nicht konfiguriert');
  }
  const parsed = parseComposeAttachmentUploadBody(req.body);
  if (!parsed.ok) return parsed.response;
  const result = await ports.emailComposeAttachments.upload({
    workspaceId: principal.workspaceId,
    draftMessageId,
    filename: parsed.filename,
    contentBase64: parsed.contentBase64,
    ...(parsed.contentType === undefined ? {} : { contentType: parsed.contentType }),
  });
  if (!result.ok) {
    if (result.reason === 'not_found') return error(404, 'compose_draft_not_found', result.error);
    if (result.reason === 'not_local_draft') return error(409, 'compose_draft_not_local', result.error);
    if (result.reason === 'write_failed') return error(500, 'compose_attachment_write_failed', result.error);
    return error(400, 'invalid_compose_attachment', result.error);
  }
  return data(200, {
    success: true,
    path: result.path,
    filename: result.filename,
    sizeBytes: result.sizeBytes,
  });
}

async function handleComposeValidateOutbound(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.emailOutboundValidation) {
    return error(503, 'email_outbound_validation_unavailable', 'Email outbound validation API nicht konfiguriert');
  }
  const parsed = parseOutboundValidationBody(req.body);
  if (!parsed.ok) return parsed.response;
  const result = await ports.emailOutboundValidation.validate({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: parsed.values,
  });
  return data(200, {
    success: true,
    allowed: result.allowed,
    reason: result.reason,
    ...(!result.allowed && result.workflowRunId !== undefined ? { workflowRunId: result.workflowRunId } : {}),
  });
}

async function handleScheduledSendDraftSchedule(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'PATCH') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const messageId = positiveIntFromPath(rawId);
  if (messageId === null) return error(400, 'invalid_email_message_id', 'email message id muss eine positive Ganzzahl sein');
  if (!ports.emailMessages?.scheduleDraftSend) {
    return error(503, 'email_messages_unavailable', 'Email scheduled-send API nicht konfiguriert');
  }
  const parsed = parseScheduledSendBody(req.body);
  if (!parsed.ok) return parsed.response;
  const result = await ports.emailMessages.scheduleDraftSend({
    workspaceId: principal.workspaceId,
    messageId,
    sendAt: parsed.sendAt,
  });
  if (!result.ok) return composeDraftMutationError(result.reason, result.message);
  if (ports.jobQueue) {
    if (parsed.sendAt) {
      const sendAt = new Date(parsed.sendAt);
      if (!Number.isNaN(sendAt.getTime())) {
        await ports.jobQueue.enqueue({
          workspaceId: principal.workspaceId,
          type: 'mail.send.scheduled',
          payload: {
            workspaceId: principal.workspaceId,
            draftId: messageId,
            dueBefore: sendAt.toISOString(),
          },
          runAfter: sendAt,
        });
      }
    } else if (ports.jobQueue.clearScheduledSendJob) {
      await ports.jobQueue.clearScheduledSendJob({
        workspaceId: principal.workspaceId,
        draftId: messageId,
      });
    }
  }
  return data(200, { success: true });
}

async function handleScheduledSendDraftState(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const messageId = positiveIntFromPath(rawId);
  if (messageId === null) return error(400, 'invalid_email_message_id', 'email message id muss eine positive Ganzzahl sein');
  if (!ports.emailMessages?.getScheduledSendDraftState) {
    return error(503, 'email_messages_unavailable', 'Email scheduled-send API nicht konfiguriert');
  }
  const state = await ports.emailMessages.getScheduledSendDraftState({
    workspaceId: principal.workspaceId,
    messageId,
  });
  return data(200, { success: true, ...state });
}

async function handleComposeDraftRecoveryState(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const messageId = positiveIntFromPath(rawId);
  if (messageId === null) return error(400, 'invalid_email_message_id', 'email message id muss eine positive Ganzzahl sein');
  if (!ports.emailMessages?.getComposeDraftRecoveryState) {
    return error(503, 'email_messages_unavailable', 'Email compose-draft recovery API nicht konfiguriert');
  }
  const state = await ports.emailMessages.getComposeDraftRecoveryState({
    workspaceId: principal.workspaceId,
    messageId,
  });
  return data(200, { success: true, ...state });
}

async function handleScheduledSendDraftFailureClear(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'DELETE') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const messageId = positiveIntFromPath(rawId);
  if (messageId === null) return error(400, 'invalid_email_message_id', 'email message id muss eine positive Ganzzahl sein');
  if (!ports.emailMessages?.clearScheduledSendDraftFailure) {
    return error(503, 'email_messages_unavailable', 'Email scheduled-send API nicht konfiguriert');
  }
  await ports.emailMessages.clearScheduledSendDraftFailure({ workspaceId: principal.workspaceId, messageId });
  return data(200, { success: true });
}

async function handleScheduledSendDraftRetry(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'PATCH') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const messageId = positiveIntFromPath(rawId);
  if (messageId === null) return error(400, 'invalid_email_message_id', 'email message id muss eine positive Ganzzahl sein');
  if (!ports.emailMessages?.retryScheduledSendDraft) {
    return error(503, 'email_messages_unavailable', 'Email scheduled-send API nicht konfiguriert');
  }
  const result = await ports.emailMessages.retryScheduledSendDraft({ workspaceId: principal.workspaceId, messageId });
  if (!result.ok) return composeDraftMutationError(result.reason);
  return data(200, { success: true });
}

function composeDraftMutationError(
  reason: 'not_found' | 'not_local_draft' | 'account_not_found' | 'outbound_blocked',
  message?: string,
): ApiResponse<ApiErrorBody> {
  if (reason === 'outbound_blocked') {
    return error(409, 'email_outbound_blocked', message ?? 'Ausgangspruefung wuerde den Versand blockieren');
  }
  if (reason === 'account_not_found') return error(404, 'email_account_not_found', 'Email account nicht gefunden');
  if (reason === 'not_local_draft') {
    return error(409, 'email_message_not_local_draft', 'Nur lokale Entwuerfe koennen hier bearbeitet werden');
  }
  return error(404, 'email_message_not_found', 'Email message nicht gefunden');
}

async function handleEmailAccountsCollection(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.emailAccounts) return error(503, 'email_accounts_unavailable', 'Email account API nicht konfiguriert');
  if (req.method === 'POST') return handleEmailAccountCreate(req, ports, principal);
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const result = await ports.emailAccounts.list({ workspaceId: principal.workspaceId });
  return data(200, sanitizeEmailAccountList(result));
}

async function handleEmailAccountItem(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const id = positiveIntFromPath(rawId);
  if (id === null) return error(400, 'invalid_email_account_id', 'email account id muss eine positive Ganzzahl sein');
  if (!ports.emailAccounts) return error(503, 'email_accounts_unavailable', 'Email account API nicht konfiguriert');
  if (req.method === 'PATCH') return handleEmailAccountUpdate(req, ports, principal, id);
  if (req.method === 'DELETE') return handleEmailAccountDelete(ports, principal, id);
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const account = await ports.emailAccounts.get({ workspaceId: principal.workspaceId, id });
  return account ? data(200, sanitizeEmailAccount(account)) : error(404, 'email_account_not_found', 'Email account nicht gefunden');
}

async function handleEmailAccountCreate(
  req: ApiRequest,
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
): Promise<ApiResponse> {
  if (!ports.emailAccounts?.create) return error(503, 'email_accounts_unavailable', 'Email account create API nicht konfiguriert');
  const parsed = parseEmailAccountMutationBody(req.body);
  if (!parsed.ok) return parsed.response;
  const required = requireEmailAccountCreateValues(parsed.values);
  if (!required.ok) return required.response;

  const result = await ports.emailAccounts.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: required.values,
  });
  if (!result.ok) return emailAccountMutationError(result);

  const safeFields = Object.keys(required.values)
    .filter((field) => field !== 'imapPassword' && field !== 'smtpPassword')
    .sort();
  const passwordChanged = {
    imap: typeof required.values.imapPassword === 'string' && required.values.imapPassword.length > 0,
    smtp: typeof required.values.smtpPassword === 'string' && required.values.smtpPassword.length > 0,
  };
  await auditEmailAccount(ports, principal, 'email_account.created', result.account, {
    fields: safeFields,
    passwordChanged,
  });
  await publishEmailAccount(ports, principal.workspaceId, 'email_account.created', result.account, principal.userId, {
    fields: safeFields,
    passwordChanged,
  });
  return data(200, {
    success: true,
    id: publicEmailAccountId(result.account),
    account: sanitizeEmailAccount(result.account),
  });
}

async function handleEmailAccountUpdate(
  req: ApiRequest,
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  if (!ports.emailAccounts?.update) return error(503, 'email_accounts_unavailable', 'Email account API nicht konfiguriert');
  const parsed = parseEmailAccountMutationBody(req.body);
  if (!parsed.ok) return parsed.response;

  const result = await ports.emailAccounts.update({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
    values: parsed.values,
  });
  if (!result) return error(404, 'email_account_not_found', 'Email account nicht gefunden');
  if (!result.ok) return emailAccountMutationError(result);

  const safeFields = Object.keys(parsed.values)
    .filter((field) => field !== 'imapPassword' && field !== 'smtpPassword')
    .sort();
  const passwordChanged = {
    imap: typeof parsed.values.imapPassword === 'string' && parsed.values.imapPassword.length > 0,
    smtp: typeof parsed.values.smtpPassword === 'string' && parsed.values.smtpPassword.length > 0,
  };
  await auditEmailAccount(ports, principal, 'email_account.updated', result.account, {
    fields: safeFields,
    passwordChanged,
  });
  await publishEmailAccount(ports, principal.workspaceId, 'email_account.updated', result.account, principal.userId, {
    fields: safeFields,
    passwordChanged,
  });
  return data(200, { success: true, account: sanitizeEmailAccount(result.account) });
}

async function handleEmailAccountDelete(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  if (!ports.emailAccounts?.delete) return error(503, 'email_accounts_unavailable', 'Email account API nicht konfiguriert');
  const result = await ports.emailAccounts.delete({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
  });
  if (!result) return error(404, 'email_account_not_found', 'Email account nicht gefunden');
  if (!result.ok) return emailAccountMutationError(result);

  await auditEmailAccount(ports, principal, 'email_account.deleted', result.account, {
    emailAddress: result.account.emailAddress,
  });
  await publishEmailAccount(ports, principal.workspaceId, 'email_account.deleted', result.account, principal.userId, {
    emailAddress: result.account.emailAddress,
  });
  return data(200, { success: true, deleted: true, account: sanitizeEmailAccount(result.account) });
}

function emailAccountMutationError(result: Extract<EmailAccountMutationPortResult, { ok: false }>): ApiResponse {
  switch (result.code) {
    case 'secret_port_unavailable':
      return error(503, 'email_account_secret_unavailable', 'Email account secret storage ist nicht konfiguriert');
    default:
      return error(500, 'email_account_error', 'Email account mutation fehlgeschlagen');
  }
}

function requireEmailAccountCreateValues(
  values: EmailAccountMutationInput,
): { ok: true; values: EmailAccountMutationInput } | { ok: false; response: ApiResponse<ApiErrorBody> } {
  const errors: Array<{ field: string; message: string }> = [];
  for (const field of ['displayName', 'emailAddress', 'imapHost', 'imapUsername'] as const) {
    if (typeof values[field] !== 'string' || values[field].length === 0) {
      errors.push({ field, message: `${field} ist erforderlich` });
    }
  }
  if (typeof values.imapPassword !== 'string' || values.imapPassword.length === 0) {
    errors.push({ field: 'imapPassword', message: 'imapPassword ist erforderlich' });
  }
  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Email account create payload ist ungueltig', { fields: errors }),
    };
  }
  return { ok: true, values };
}

function publicEmailAccountId(account: EmailAccountRecord): number {
  return account.sourceSqliteId > 0 ? account.sourceSqliteId : account.id;
}

async function handleMessageList(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;

  const limit = parseLimit(req.query?.limit);
  if (limit === null) return error(400, 'invalid_limit', `limit muss zwischen 1 und ${MAX_MESSAGE_LIMIT} liegen`);
  const cursor = parseOptionalPositiveInt(req.query?.cursor);
  if (cursor === null) return error(400, 'invalid_cursor', 'cursor muss eine positive Ganzzahl sein');
  const offset = parseOptionalNonNegativeInt(req.query?.offset);
  if (offset === null) return error(400, 'invalid_offset', 'offset muss eine nicht-negative Ganzzahl sein');
  const accountId = parseOptionalPositiveInt(req.query?.accountId);
  if (accountId === null) return error(400, 'invalid_account_id', 'accountId muss eine positive Ganzzahl sein');
  const folderPath = normalizeTextFilter(req.query?.folderPath, 1000);
  if (folderPath === null) return error(400, 'invalid_folder_path', 'folderPath darf maximal 1000 Zeichen haben');
  const folderKind = normalizeTextFilter(req.query?.folderKind, 50);
  if (folderKind === null) return error(400, 'invalid_folder_kind', 'folderKind darf maximal 50 Zeichen haben');
  const view = parseOptionalMessageView(req.query?.view);
  if (view === null) return error(400, 'invalid_view', 'view ist ungueltig');
  const categoryId = parseOptionalPositiveInt(req.query?.categoryId);
  if (categoryId === null) return error(400, 'invalid_category_id', 'categoryId muss eine positive Ganzzahl sein');
  const sort = parseOptionalMessageSort(req.query?.sort);
  if (sort === null) return error(400, 'invalid_sort', 'sort ist ungueltig');
  const listFilter = parseOptionalMessageListFilter(req.query?.listFilter);
  if (listFilter === null) return error(400, 'invalid_list_filter', 'listFilter ist ungueltig');
  const doneFilter = parseOptionalMessageDoneFilter(req.query?.doneFilter);
  if (doneFilter === null) return error(400, 'invalid_done_filter', 'doneFilter ist ungueltig');
  const seen = parseOptionalBoolean(req.query?.seen);
  if (seen === null) return error(400, 'invalid_seen', 'seen muss true oder false sein');
  const done = parseOptionalBoolean(req.query?.done);
  if (done === null) return error(400, 'invalid_done', 'done muss true oder false sein');
  const spam = parseOptionalBoolean(req.query?.spam);
  if (spam === null) return error(400, 'invalid_spam', 'spam muss true oder false sein');
  const search = normalizeTextFilter(req.query?.search, 200);
  if (search === null) return error(400, 'invalid_search', 'search darf maximal 200 Zeichen haben');
  const scopeModeRaw = req.query?.scopeMode;
  if (scopeModeRaw !== undefined && scopeModeRaw !== '' && !isOneOf(scopeModeRaw, ['view', 'broad'])) {
    return error(400, 'invalid_scope_mode', 'scopeMode muss view oder broad sein');
  }
  const scopeIncludeSpam = parseOptionalBoolean(req.query?.scopeIncludeSpam);
  if (scopeIncludeSpam === null) return error(400, 'invalid_scope_include_spam', 'scopeIncludeSpam muss true oder false sein');
  const scopeIncludeTrash = parseOptionalBoolean(req.query?.scopeIncludeTrash);
  if (scopeIncludeTrash === null) return error(400, 'invalid_scope_include_trash', 'scopeIncludeTrash muss true oder false sein');
  const scope =
    scopeModeRaw === 'broad'
      ? {
          mode: 'broad' as const,
          ...(scopeIncludeSpam === undefined ? {} : { includeSpam: scopeIncludeSpam }),
          ...(scopeIncludeTrash === undefined ? {} : { includeTrash: scopeIncludeTrash }),
        }
      : scopeModeRaw === 'view'
        ? { mode: 'view' as const }
        : undefined;

  if (!ports.emailMessages) return error(503, 'email_messages_unavailable', 'Email message API nicht konfiguriert');
  const result = await ports.emailMessages.list({
    workspaceId: principal.workspaceId,
    limit,
    ...(cursor === undefined ? {} : { cursor }),
    ...(offset === undefined ? {} : { offset }),
    ...(accountId === undefined ? {} : { accountId }),
    ...(folderPath === undefined ? {} : { folderPath }),
    ...(folderKind === undefined ? {} : { folderKind }),
    ...(view === undefined ? {} : { view }),
    ...(categoryId === undefined ? {} : { categoryId }),
    ...(sort === undefined ? {} : { sort }),
    ...(listFilter === undefined ? {} : { listFilter }),
    ...(doneFilter === undefined ? {} : { doneFilter }),
    ...(seen === undefined ? {} : { seen }),
    ...(done === undefined ? {} : { done }),
    ...(spam === undefined ? {} : { spam }),
    ...(search === undefined ? {} : { search }),
    ...(scope === undefined ? {} : { scope }),
  });
  return data(200, sanitizeEmailMessageList(result));
}

async function handleMailFolderCounts(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;

  const accountId = parseOptionalPositiveInt(req.query?.accountId);
  if (accountId === null) return error(400, 'invalid_account_id', 'accountId muss eine positive Ganzzahl sein');
  if (!ports.emailMessages?.getFolderCounts) {
    return error(503, 'email_messages_unavailable', 'Email message API nicht konfiguriert');
  }

  const counts = await ports.emailMessages.getFolderCounts({
    workspaceId: principal.workspaceId,
    ...(accountId === undefined ? {} : { accountId }),
  });
  return data(200, sanitizeMailFolderCounts(counts));
}

async function handleMailDiagnostics(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.emailDiagnostics) {
    return error(503, 'email_diagnostics_unavailable', 'Email diagnostics API nicht konfiguriert');
  }
  const report = await ports.emailDiagnostics.collect({
    workspaceId: principal.workspaceId,
  });
  return data(200, sanitizeMailDiagnostics(report));
}

async function handleMessagePostProcessRetry(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string,
): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!requireAdmin(principal)) return error(403, 'forbidden', 'Adminrechte erforderlich');
  const messageId = positiveIntFromPath(rawId);
  if (messageId === null) return error(400, 'invalid_email_message_id', 'email message id muss eine positive Ganzzahl sein');
  if (!ports.emailMessages) return error(503, 'email_messages_unavailable', 'Email message API nicht konfiguriert');
  if (!ports.jobQueue) return error(503, 'job_queue_unavailable', 'Job queue API nicht konfiguriert');

  const message = await ports.emailMessages.get({
    workspaceId: principal.workspaceId,
    id: messageId,
    includeBody: false,
  });
  if (!message) return error(404, 'email_message_not_found', 'Email message nicht gefunden');
  if (message.postProcessDone === true) {
    return error(409, 'email_message_post_process_complete', 'Post-Process ist bereits abgeschlossen');
  }

  await ports.jobQueue.enqueue({
    workspaceId: principal.workspaceId,
    type: 'mail.spam.score',
    payload: {
      workspaceId: principal.workspaceId,
      messageId,
      actorUserId: principal.userId,
      applyStatus: true,
      runSecurityCheck: true,
      enqueueInboundWorkflows: true,
    },
    maxAttempts: 3,
  });
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'email.post_process.retry_queued',
    entityType: 'email_message',
    entityId: String(messageId),
    metadata: {},
  });
  return data(200, { success: true });
}

async function handleEmailReporting(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const accountId = parseOptionalPositiveInt(req.query?.accountId);
  if (accountId === null) return error(400, 'invalid_account_id', 'accountId muss eine positive Ganzzahl sein');
  if (!ports.emailReporting) {
    return error(503, 'email_reporting_unavailable', 'Email reporting API nicht konfiguriert');
  }
  const snapshot = await ports.emailReporting.collect({
    workspaceId: principal.workspaceId,
    ...(accountId === undefined ? {} : { accountId }),
  });
  return data(200, sanitizeEmailReportingSnapshot(snapshot));
}

async function handleEmailGdprExport(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.emailGdprExport) {
    return error(503, 'email_gdpr_export_unavailable', 'Email GDPR export API nicht konfiguriert');
  }

  const skipAttachments = parseOptionalBoolean(req.query?.skipAttachments);
  if (skipAttachments === null) {
    return error(400, 'invalid_skip_attachments', 'skipAttachments muss true oder false sein');
  }

  const result = await ports.emailGdprExport.export({
    workspaceId: principal.workspaceId,
    skipAttachments: skipAttachments === true,
  });
  if (!result.ok) {
    return error(409, result.code, 'Anhaenge zu gross fuer einen Export', {
      attachmentBytes: result.attachmentBytes,
      maxBytes: result.maxBytes,
    });
  }

  return {
    status: 200,
    body: result.stream,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': attachmentDisposition(result.filename),
    },
  };
}

async function handleMailThreadBackfill(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.mailThreadBackfill) {
    return error(503, 'mail_thread_backfill_unavailable', 'Thread-Backfill API nicht konfiguriert');
  }
  const body = (req.body ?? {}) as { limit?: unknown };
  let limit: number | undefined;
  if (body.limit !== undefined) {
    const n = Number(body.limit);
    if (!Number.isSafeInteger(n) || n <= 0) {
      return error(400, 'invalid_limit', 'limit muss eine positive Ganzzahl sein');
    }
    limit = n;
  }
  const result = await ports.mailThreadBackfill.backfill({
    workspaceId: principal.workspaceId,
    ...(limit === undefined ? {} : { limit }),
  });
  return data(202, result);
}

async function handleMessageBulkSoftDelete(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  if (req.method !== 'PATCH') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.emailMessages?.bulkSoftDelete) {
    return error(503, 'email_messages_unavailable', 'Email bulk message API nicht konfiguriert');
  }
  const parsed = parseEmailMessageBulkMutationBody(req.body);
  if (!parsed.ok) return parsed.response;
  const result = await ports.emailMessages.bulkSoftDelete({
    workspaceId: principal.workspaceId,
    messageIds: parsed.messageIds,
    ...(parsed.accountId === undefined ? {} : { accountId: parsed.accountId }),
  });
  return data(200, result);
}

async function handleMessageBulkSetArchived(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  if (req.method !== 'PATCH') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.emailMessages?.bulkSetArchived) {
    return error(503, 'email_messages_unavailable', 'Email bulk message API nicht konfiguriert');
  }
  const parsed = parseEmailMessageBulkMutationBody(req.body, 'archived');
  if (!parsed.ok) return parsed.response;
  const result = await ports.emailMessages.bulkSetArchived({
    workspaceId: principal.workspaceId,
    messageIds: parsed.messageIds,
    archived: parsed.flag ?? false,
    ...(parsed.accountId === undefined ? {} : { accountId: parsed.accountId }),
  });
  return data(200, result);
}

async function handleMessageBulkSetDone(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  if (req.method !== 'PATCH') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.emailMessages?.bulkSetDone) {
    return error(503, 'email_messages_unavailable', 'Email bulk message API nicht konfiguriert');
  }
  const parsed = parseEmailMessageBulkMutationBody(req.body, 'done');
  if (!parsed.ok) return parsed.response;
  const result = await ports.emailMessages.bulkSetDone({
    workspaceId: principal.workspaceId,
    messageIds: parsed.messageIds,
    done: parsed.flag ?? false,
    ...(parsed.accountId === undefined ? {} : { accountId: parsed.accountId }),
  });
  return data(200, result);
}

async function handleMessageBulkSetSpamStatus(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  if (req.method !== 'PATCH') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.emailMessages?.bulkSetSpamStatus) {
    return error(503, 'email_messages_unavailable', 'Email bulk spam-status API nicht konfiguriert');
  }
  const parsed = parseEmailMessageBulkSpamStatusMutationBody(req.body);
  if (!parsed.ok) return parsed.response;
  const result = await ports.emailMessages.bulkSetSpamStatus({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    messageIds: parsed.messageIds,
    values: parsed.values,
    ...(parsed.accountId === undefined ? {} : { accountId: parsed.accountId }),
  });
  return data(200, result);
}

async function handleMessageBulkDeleteLocalDrafts(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  if (req.method !== 'DELETE') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.emailMessages?.bulkDeleteLocalDrafts) {
    return error(503, 'email_messages_unavailable', 'Email local draft bulk-delete API nicht konfiguriert');
  }
  const parsed = parseEmailMessageBulkMutationBody(req.body);
  if (!parsed.ok) return parsed.response;
  const result = await ports.emailMessages.bulkDeleteLocalDrafts({
    workspaceId: principal.workspaceId,
    messageIds: parsed.messageIds,
  });
  return data(200, result);
}

async function handleMessageCustomerLinkBackfill(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.emailMessages?.backfillCustomerLinks) {
    return error(503, 'email_messages_unavailable', 'Email customer-link backfill API nicht konfiguriert');
  }
  const parsed = parseEmailMessageCustomerBackfillBody(req.body);
  if (!parsed.ok) return parsed.response;
  const result = await ports.emailMessages.backfillCustomerLinks({
    workspaceId: principal.workspaceId,
    ...(parsed.accountId === undefined ? {} : { accountId: parsed.accountId }),
    ...(parsed.limit === undefined ? {} : { limit: parsed.limit }),
  });
  return data(200, { success: true, count: safeCount(result.count) });
}

async function handleConversationMessageList(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;

  const limit = parseLimit(req.query?.limit);
  if (limit === null) return error(400, 'invalid_limit', `limit muss zwischen 1 und ${MAX_MESSAGE_LIMIT} liegen`);
  const accountId = parseOptionalPositiveInt(req.query?.accountId);
  if (accountId === null) return error(400, 'invalid_account_id', 'accountId muss eine positive Ganzzahl sein');
  const excludeMessageId = parseOptionalPositiveInt(req.query?.messageId);
  if (excludeMessageId === null) return error(400, 'invalid_email_message_id', 'messageId muss eine positive Ganzzahl sein');
  const ticketCode = normalizeTextFilter(req.query?.ticketCode, 100);
  if (ticketCode === null) return error(400, 'invalid_ticket_code', 'ticketCode darf maximal 100 Zeichen haben');
  const customerId = parseOptionalPositiveInt(req.query?.customerId);
  if (customerId === null) return error(400, 'invalid_customer_id', 'customerId muss eine positive Ganzzahl sein');
  const correspondentEmail = normalizeTextFilter(req.query?.correspondentEmail, 320);
  if (correspondentEmail === null) {
    return error(400, 'invalid_correspondent_email', 'correspondentEmail darf maximal 320 Zeichen haben');
  }

  if (!ports.emailMessages?.listConversation) {
    return error(503, 'email_messages_unavailable', 'Email conversation message API nicht konfiguriert');
  }
  const result = await ports.emailMessages.listConversation({
    workspaceId: principal.workspaceId,
    limit,
    ...(accountId === undefined ? {} : { accountId }),
    ...(excludeMessageId === undefined ? {} : { excludeMessageId }),
    ...(ticketCode === undefined ? {} : { ticketCode }),
    ...(customerId === undefined ? {} : { customerId }),
    ...(correspondentEmail === undefined ? {} : { correspondentEmail }),
  });
  return data(200, sanitizeEmailMessageList(result));
}

async function handleThreadMessageList(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawThreadId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;

  const threadId = textIdFromPath(rawThreadId, 300);
  if (threadId === null) return error(400, 'invalid_email_thread_id', 'email thread id ist ungueltig');
  const limit = parseLimit(req.query?.limit);
  if (limit === null) return error(400, 'invalid_limit', `limit muss zwischen 1 und ${MAX_MESSAGE_LIMIT} liegen`);
  const offset = parseOptionalNonNegativeInt(req.query?.offset);
  if (offset === null) return error(400, 'invalid_offset', 'offset muss eine nicht-negative Ganzzahl sein');

  if (!ports.emailMessages?.listThread) {
    return error(503, 'email_messages_unavailable', 'Email thread message API nicht konfiguriert');
  }
  const result = await ports.emailMessages.listThread({
    workspaceId: principal.workspaceId,
    threadId,
    limit,
    ...(offset === undefined ? {} : { offset }),
  });
  return data(200, sanitizeEmailMessageList(result));
}

async function handleMessageReplySuggestionGet(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const messageId = positiveIntFromPath(rawId);
  if (messageId === null) return error(400, 'invalid_email_message_id', 'email message id muss eine positive Ganzzahl sein');
  if (!ports.aiReplySuggestions?.get) {
    return error(503, 'ai_reply_suggestions_unavailable', 'AI reply suggestion API nicht konfiguriert');
  }
  const result = await ports.aiReplySuggestions.get({
    workspaceId: principal.workspaceId,
    messageId,
  });
  return data(200, sanitizeEmailReplySuggestion(result));
}

async function handleMessageReplySuggestionEnsure(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const messageId = positiveIntFromPath(rawId);
  if (messageId === null) return error(400, 'invalid_email_message_id', 'email message id muss eine positive Ganzzahl sein');

  const parsed = parseEmailReplySuggestionEnsureBody(req.body);
  if (!parsed.ok) return parsed.response;

  if (ports.emailMessages?.get) {
    const message = await ports.emailMessages.get({
      workspaceId: principal.workspaceId,
      id: messageId,
      includeBody: false,
    });
    if (!message) return error(404, 'email_message_not_found', 'Email message nicht gefunden');
  }

  const payload = {
    workspaceId: principal.workspaceId,
    messageId,
    actorUserId: principal.userId,
    ...(parsed.force === undefined ? {} : { force: parsed.force }),
    ...(parsed.trigger === undefined ? {} : { trigger: parsed.trigger }),
  };

  if (ports.jobQueue) {
    await ports.jobQueue.enqueue({
      workspaceId: principal.workspaceId,
      type: 'ai.reply_suggestion',
      payload,
    });
    return data(202, {
      success: true,
      queued: true,
      messageId,
      jobType: 'ai.reply_suggestion',
    });
  }

  if (!ports.aiReplySuggestions?.ensure) {
    return error(503, 'job_queue_unavailable', 'Job queue API nicht konfiguriert');
  }
  await ports.aiReplySuggestions.ensure(payload);
  return data(200, { success: true, queued: false, messageId });
}

async function handleMessageReplyDraftGenerate(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const messageId = positiveIntFromPath(rawId);
  if (messageId === null) return error(400, 'invalid_email_message_id', 'email message id muss eine positive Ganzzahl sein');
  if (!ports.aiReplySuggestions?.generate) {
    return error(503, 'ai_reply_suggestions_unavailable', 'AI reply suggestion API nicht konfiguriert');
  }

  const parsed = parseEmailReplyDraftGenerateBody(req.body);
  if (!parsed.ok) return parsed.response;

  const result = await ports.aiReplySuggestions.generate({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    messageId,
    ...(parsed.promptId === undefined ? {} : { promptId: parsed.promptId }),
    ...(parsed.profileId === undefined ? {} : { profileId: parsed.profileId }),
    ...(parsed.customerId === undefined ? {} : { customerId: parsed.customerId }),
    ...(parsed.userContext === undefined ? {} : { userContext: parsed.userContext }),
    ...(parsed.persistSuggestion === undefined ? {} : { persistSuggestion: parsed.persistSuggestion }),
  });
  return data(200, sanitizeEmailReplyDraftGeneration(result));
}

async function handleMessageSnooze(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'PATCH') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const messageId = positiveIntFromPath(rawId);
  if (messageId === null) return error(400, 'invalid_email_message_id', 'email message id muss eine positive Ganzzahl sein');
  if (!ports.emailMessages?.snooze) {
    return error(503, 'email_messages_unavailable', 'Email snooze message API nicht konfiguriert');
  }
  const parsed = parseEmailMessageSnoozeMutationBody(req.body);
  if (!parsed.ok) return parsed.response;
  const result = await ports.emailMessages.snooze({
    workspaceId: principal.workspaceId,
    messageId,
    until: parsed.until,
  });
  return data(200, result);
}

async function handleMessageRawHeadersGet(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const id = positiveIntFromPath(rawId);
  if (id === null) return error(400, 'invalid_email_message_id', 'email message id muss eine positive Ganzzahl sein');
  if (!ports.emailMessages?.getRawHeaders) {
    return error(503, 'email_messages_unavailable', 'Email raw-header API nicht konfiguriert');
  }
  const rawHeaders = await ports.emailMessages.getRawHeaders({
    workspaceId: principal.workspaceId,
    id,
  });
  return rawHeaders
    ? data(200, sanitizeEmailMessageRawHeaders(rawHeaders))
    : error(404, 'email_message_not_found', 'Email message nicht gefunden');
}

async function handleMessageReadReceiptStateGet(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const messageId = positiveIntFromPath(rawId);
  if (messageId === null) return error(400, 'invalid_email_message_id', 'email message id muss eine positive Ganzzahl sein');
  if (!ports.emailMessages?.getReadReceiptState) {
    return error(503, 'email_messages_unavailable', 'Email read-receipt API nicht konfiguriert');
  }
  const state = await ports.emailMessages.getReadReceiptState({
    workspaceId: principal.workspaceId,
    messageId,
  });
  return state
    ? data(200, sanitizeEmailReadReceiptState(state))
    : error(404, 'email_message_not_found', 'Email message nicht gefunden');
}

async function handleMessageReadReceiptResponse(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const messageId = positiveIntFromPath(rawId);
  if (messageId === null) return error(400, 'invalid_email_message_id', 'email message id muss eine positive Ganzzahl sein');

  const parsed = parseEmailReadReceiptResponseBody(req.body);
  if (!parsed.ok) return parsed.response;

  if (parsed.action === 'send') {
    if (!ports.emailReadReceiptResponder?.send) {
      return error(503, 'email_read_receipt_responder_unavailable', 'Email read-receipt responder API nicht konfiguriert');
    }
    const result = await ports.emailReadReceiptResponder.send({
      workspaceId: principal.workspaceId,
      actorUserId: principal.userId,
      messageId,
    });
    if (result.success && result.receipt) {
      await auditEmailReadReceipt(ports, principal, 'email_read_receipt.created', result.receipt, {
        messageId: result.receipt.messageId,
        direction: result.receipt.direction,
      });
      await publishEmailReadReceipt(ports, principal.workspaceId, 'email_read_receipt.created', result.receipt, principal.userId);
    }
    return data(200, sanitizeEmailReadReceiptResponse(result));
  }

  if (!ports.emailReadReceipts?.create) {
    return error(503, 'email_read_receipts_unavailable', 'Email read receipt API nicht konfiguriert');
  }
  const result = await ports.emailReadReceipts.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: {
      messageId,
      direction: 'declined',
    },
  });
  if (!result.ok) return error(404, 'email_message_not_found', 'Email message nicht gefunden');

  await auditEmailReadReceipt(ports, principal, 'email_read_receipt.created', result.receipt, {
    messageId: result.receipt.messageId,
    direction: result.receipt.direction,
  });
  await publishEmailReadReceipt(ports, principal.workspaceId, 'email_read_receipt.created', result.receipt, principal.userId);
  return data(200, { success: true });
}

async function handleMessageRemoteContentPolicyConsume(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const messageId = positiveIntFromPath(rawId);
  if (messageId === null) return error(400, 'invalid_email_message_id', 'email message id muss eine positive Ganzzahl sein');
  if (!ports.emailMessages?.consumeRemoteContentPolicy) {
    return error(503, 'email_messages_unavailable', 'Email remote-content API nicht konfiguriert');
  }
  const result = await ports.emailMessages.consumeRemoteContentPolicy({
    workspaceId: principal.workspaceId,
    messageId,
  });
  return data(200, result ?? { policy: 'blocked', allowRemote: false });
}

async function handleMessageRemoteContentPolicySet(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'PATCH') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const messageId = positiveIntFromPath(rawId);
  if (messageId === null) return error(400, 'invalid_email_message_id', 'email message id muss eine positive Ganzzahl sein');
  if (!ports.emailMessages?.setRemoteContentPolicy) {
    return error(503, 'email_messages_unavailable', 'Email remote-content API nicht konfiguriert');
  }
  const parsed = parseEmailRemoteContentPolicyMutationBody(req.body);
  if (!parsed.ok) return parsed.response;
  const result = await ports.emailMessages.setRemoteContentPolicy({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    messageId,
    values: parsed.values,
  });
  if (!result.ok) return error(404, 'email_message_not_found', 'Email message nicht gefunden');
  await auditEmailMessageRemoteContentPolicy(ports, principal, result.message, parsed.values);
  await publishEmailMessageUpdated(ports, principal.workspaceId, result.message, principal.userId, {
    action: 'remote_content_policy_updated',
    remoteContentPolicy: result.message.remoteContentPolicy,
    rememberSender: parsed.values.rememberSender === true,
    rememberDomain: parsed.values.rememberDomain === true,
  });
  return data(200, { success: true, ...result.result });
}

async function handleMessageSoftDelete(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'PATCH') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const messageId = positiveIntFromPath(rawId);
  if (messageId === null) return error(400, 'invalid_email_message_id', 'email message id muss eine positive Ganzzahl sein');
  if (!ports.emailMessages?.softDelete) {
    return error(503, 'email_messages_unavailable', 'Email message soft-delete API nicht konfiguriert');
  }
  const result = await ports.emailMessages.softDelete({
    workspaceId: principal.workspaceId,
    messageId,
  });
  return data(200, result);
}

async function handleMessageRestore(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'PATCH') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const messageId = positiveIntFromPath(rawId);
  if (messageId === null) return error(400, 'invalid_email_message_id', 'email message id muss eine positive Ganzzahl sein');
  if (!ports.emailMessages?.restore) {
    return error(503, 'email_messages_unavailable', 'Email message restore API nicht konfiguriert');
  }
  const result = await ports.emailMessages.restore({
    workspaceId: principal.workspaceId,
    messageId,
  });
  return data(200, result);
}

async function handleMessageDeleteLocalDraft(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'DELETE') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const messageId = positiveIntFromPath(rawId);
  if (messageId === null) return error(400, 'invalid_email_message_id', 'email message id muss eine positive Ganzzahl sein');
  if (!ports.emailMessages?.deleteLocalDraft) {
    return error(503, 'email_messages_unavailable', 'Email local draft delete API nicht konfiguriert');
  }
  const result = await ports.emailMessages.deleteLocalDraft({
    workspaceId: principal.workspaceId,
    messageId,
  });
  if (!result.ok) {
    return result.reason === 'not_found'
      ? error(404, 'email_message_not_found', 'Email message nicht gefunden')
      : error(409, 'email_message_not_local_draft', 'Nur lokale Entwuerfe koennen endgueltig geloescht werden');
  }
  return data(200, { count: result.count });
}

async function handleMessageLinkCustomer(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'PATCH') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const messageId = positiveIntFromPath(rawId);
  if (messageId === null) return error(400, 'invalid_email_message_id', 'email message id muss eine positive Ganzzahl sein');
  if (!ports.emailMessages?.linkCustomer) {
    return error(503, 'email_messages_unavailable', 'Email message customer-link API nicht konfiguriert');
  }
  const parsed = parseEmailMessageCustomerLinkMutationBody(req.body);
  if (!parsed.ok) return parsed.response;
  const result = await ports.emailMessages.linkCustomer({
    workspaceId: principal.workspaceId,
    messageId,
    customerId: parsed.customerId,
  });
  if (!result.ok) return emailMessageMetadataMutationError(result.reason);
  return data(200, sanitizeEmailMessage(result.message, false));
}

async function handleMessageAssign(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'PATCH') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const messageId = positiveIntFromPath(rawId);
  if (messageId === null) return error(400, 'invalid_email_message_id', 'email message id muss eine positive Ganzzahl sein');
  if (!ports.emailMessages?.assign) {
    return error(503, 'email_messages_unavailable', 'Email message assignment API nicht konfiguriert');
  }
  const parsed = parseEmailMessageAssignmentMutationBody(req.body);
  if (!parsed.ok) return parsed.response;
  const result = await ports.emailMessages.assign({
    workspaceId: principal.workspaceId,
    messageId,
    teamMemberId: parsed.teamMemberId,
  });
  if (!result.ok) return emailMessageMetadataMutationError(result.reason);
  return data(200, sanitizeEmailMessage(result.message, false));
}

async function handleMessageSetArchived(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'PATCH') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const messageId = positiveIntFromPath(rawId);
  if (messageId === null) return error(400, 'invalid_email_message_id', 'email message id muss eine positive Ganzzahl sein');
  if (!ports.emailMessages?.setArchived) {
    return error(503, 'email_messages_unavailable', 'Email message archive API nicht konfiguriert');
  }
  const parsed = parseEmailMessageFlagMutationBody(req.body, 'archived');
  if (!parsed.ok) return parsed.response;
  const result = await ports.emailMessages.setArchived({
    workspaceId: principal.workspaceId,
    messageId,
    archived: parsed.flag,
  });
  return data(200, result);
}

async function handleMessageSetSeen(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'PATCH') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const messageId = positiveIntFromPath(rawId);
  if (messageId === null) return error(400, 'invalid_email_message_id', 'email message id muss eine positive Ganzzahl sein');
  if (!ports.emailMessages?.setSeen) {
    return error(503, 'email_messages_unavailable', 'Email message seen API nicht konfiguriert');
  }
  const parsed = parseEmailMessageFlagMutationBody(req.body, 'seen');
  if (!parsed.ok) return parsed.response;
  const result = await ports.emailMessages.setSeen({
    workspaceId: principal.workspaceId,
    messageId,
    seen: parsed.flag,
    ...(parsed.syncToServer === undefined ? {} : { syncToServer: parsed.syncToServer }),
  });
  return data(200, result);
}

async function handleMessageSetDone(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'PATCH') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const messageId = positiveIntFromPath(rawId);
  if (messageId === null) return error(400, 'invalid_email_message_id', 'email message id muss eine positive Ganzzahl sein');
  if (!ports.emailMessages?.setDone) {
    return error(503, 'email_messages_unavailable', 'Email message done API nicht konfiguriert');
  }
  const parsed = parseEmailMessageFlagMutationBody(req.body, 'done');
  if (!parsed.ok) return parsed.response;
  const result = await ports.emailMessages.setDone({
    workspaceId: principal.workspaceId,
    messageId,
    done: parsed.flag,
  });
  return data(200, result);
}

async function handleMessageMove(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'PATCH') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const messageId = positiveIntFromPath(rawId);
  if (messageId === null) return error(400, 'invalid_email_message_id', 'email message id muss eine positive Ganzzahl sein');
  if (!ports.emailMessages?.moveToView) {
    return error(503, 'email_messages_unavailable', 'Email message move API nicht konfiguriert');
  }
  const parsed = parseEmailMessageMoveMutationBody(req.body);
  if (!parsed.ok) return parsed.response;
  const result = await ports.emailMessages.moveToView({
    workspaceId: principal.workspaceId,
    messageId,
    view: parsed.view,
  });
  return data(200, result);
}

async function handleMessageAction(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const messageId = positiveIntFromPath(rawId);
  if (messageId === null) return error(400, 'invalid_email_message_id', 'email message id muss eine positive Ganzzahl sein');
  const parsed = parseEmailMessageActionBody(req.body);
  if (!parsed.ok) return parsed.response;

  const payload = parsed.payload;
  switch (parsed.action) {
    case 'archive':
      return messageActionSuccess(await handleMessageSetArchived(
        { ...req, method: 'PATCH', body: { archived: true } },
        ports,
        String(messageId),
      ));
    case 'unarchive':
      return messageActionSuccess(await handleMessageSetArchived(
        { ...req, method: 'PATCH', body: { archived: false } },
        ports,
        String(messageId),
      ));
    case 'mark_seen':
      return messageActionSuccess(await handleMessageSetSeen(
        {
          ...req,
          method: 'PATCH',
          body: {
            seen: true,
            ...(typeof payload.syncToServer === 'boolean' ? { syncToServer: payload.syncToServer } : {}),
          },
        },
        ports,
        String(messageId),
      ));
    case 'mark_unseen':
      return messageActionSuccess(await handleMessageSetSeen(
        {
          ...req,
          method: 'PATCH',
          body: {
            seen: false,
            ...(typeof payload.syncToServer === 'boolean' ? { syncToServer: payload.syncToServer } : {}),
          },
        },
        ports,
        String(messageId),
      ));
    case 'spam':
    case 'not_spam':
    case 'spam_review':
      return messageActionSuccess(await handleMessageSpamStatusMutation(
        {
          ...req,
          method: 'PATCH',
          body: {
            status: parsed.action === 'spam'
              ? 'spam'
              : parsed.action === 'spam_review'
                ? 'review'
                : 'clean',
            train: payload.train === true,
            source: 'api',
          },
        },
        ports,
        String(messageId),
      ));
    case 'link_customer':
      return messageActionSuccess(await handleMessageLinkCustomer(
        { ...req, method: 'PATCH', body: { customerId: payload.customerId } },
        ports,
        String(messageId),
      ));
    case 'assign':
      return messageActionSuccess(await handleMessageAssign(
        { ...req, method: 'PATCH', body: { teamMemberId: payload.teamMemberId } },
        ports,
        String(messageId),
      ));
    case 'add_tag': {
      const tagResponse = await handleMailMetadataReadRoute(
        {
          ...req,
          method: 'POST',
          path: `/api/v1/email/messages/${messageId}/tags`,
          body: { tag: payload.tag },
        },
        ports,
      );
      return messageActionSuccess(tagResponse ?? error(404, 'email_action_route_not_found', 'Email action route nicht gefunden'));
    }
    default:
      return error(
        400,
        'action_failed',
        'Unbekannte action (archive, unarchive, mark_seen, mark_unseen, spam, spam_review, not_spam, link_customer, assign, add_tag)',
      );
  }
}

function messageActionSuccess(response: ApiResponse): ApiResponse {
  if (response.status < 200 || response.status >= 300) return response;
  return data(200, { success: true });
}

async function handleMessageGet(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const id = positiveIntFromPath(rawId);
  if (id === null) return error(400, 'invalid_email_message_id', 'email message id muss eine positive Ganzzahl sein');
  const includeBody = parseOptionalBoolean(req.query?.includeBody);
  if (includeBody === null) return error(400, 'invalid_include_body', 'includeBody muss true oder false sein');

  if (!ports.emailMessages) return error(503, 'email_messages_unavailable', 'Email message API nicht konfiguriert');
  const message = await ports.emailMessages.get({
    workspaceId: principal.workspaceId,
    id,
    includeBody: includeBody === true,
  });
  return message
    ? data(200, sanitizeEmailMessage(message, includeBody === true))
    : error(404, 'email_message_not_found', 'Email message nicht gefunden');
}

async function handleMessageSecurityGet(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const id = positiveIntFromPath(rawId);
  if (id === null) return error(400, 'invalid_email_message_id', 'email message id muss eine positive Ganzzahl sein');
  if (!ports.emailMessages?.getSecurity) {
    return error(503, 'email_messages_unavailable', 'Email message security API nicht konfiguriert');
  }
  const security = await ports.emailMessages.getSecurity({ workspaceId: principal.workspaceId, id });
  return security
    ? data(200, sanitizeEmailMessageSecurity(security))
    : error(404, 'email_message_not_found', 'Email message nicht gefunden');
}

async function handleMessageSecurityCheck(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const messageId = positiveIntFromPath(rawId);
  if (messageId === null) return error(400, 'invalid_email_message_id', 'email message id muss eine positive Ganzzahl sein');
  if (!ports.emailMessages?.runSecurityCheck) {
    return error(503, 'email_messages_unavailable', 'Email message security check API nicht konfiguriert');
  }

  const parsed = parseEmailMessageSpamDecisionMutationBody(req.body);
  if (!parsed.ok) return parsed.response;

  const result = await ports.emailMessages.runSecurityCheck({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    messageId,
    values: parsed.values,
  });
  if (!result) return error(404, 'email_message_not_found', 'Email message nicht gefunden');

  const breakdown = result.decision ? spamDecisionBreakdownSummary(result.decision.breakdown) : null;
  await auditEmailMessageSecurityCheck(ports, principal, result.message, {
    authChecked: result.authChecked,
    rspamdChecked: result.rspamdChecked,
    applyStatus: parsed.values.applyStatus === true,
    spamDecisionId: result.decision?.id ?? null,
  });
  if (result.decision && breakdown) {
    await auditEmailMessageSpamDecision(ports, principal, result.message, result.decision, {
      applyStatus: parsed.values.applyStatus === true,
      hasBreakdown: breakdown.hasBreakdown,
      reasonCount: breakdown.reasonCount,
      featureKeyCount: breakdown.featureKeyCount,
      source: 'security_check',
    });
    await publishSpamDecisionCreated(ports, principal.workspaceId, result.decision, principal.userId, breakdown);
  }
  await publishEmailMessageUpdated(ports, principal.workspaceId, result.message, principal.userId, {
    securityChecked: true,
    authChecked: result.authChecked,
    rspamdChecked: result.rspamdChecked,
    spamDecisionId: result.decision?.id ?? null,
    spamScore: result.decision?.score ?? result.security.spamScore,
    spamScoreStatus: result.decision?.status ?? result.security.spamScoreLabel,
    spamDecisionSource: result.decision?.source ?? result.security.spamDecisionSource,
    applyStatus: parsed.values.applyStatus === true,
    spamStatus: result.message.spamStatus,
    isSpam: result.message.isSpam,
    ...(breakdown ? {
      hasBreakdown: breakdown.hasBreakdown,
      reasonCount: breakdown.reasonCount,
      featureKeyCount: breakdown.featureKeyCount,
    } : {}),
  });

  return data(200, {
    message: sanitizeEmailMessage(result.message, false),
    security: sanitizeEmailMessageSecurity(result.security),
    decision: result.decision ? sanitizeSpamDecision(result.decision) : null,
    authChecked: result.authChecked,
    rspamdChecked: result.rspamdChecked,
  });
}

async function handleMessageSpamStatusMutation(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'PATCH') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const messageId = positiveIntFromPath(rawId);
  if (messageId === null) return error(400, 'invalid_email_message_id', 'email message id muss eine positive Ganzzahl sein');
  if (!ports.emailMessages?.setSpamStatus) {
    return error(503, 'email_messages_unavailable', 'Email message API nicht konfiguriert');
  }

  const parsed = parseEmailMessageSpamStatusMutationBody(req.body);
  if (!parsed.ok) return parsed.response;

  const message = await ports.emailMessages.setSpamStatus({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    messageId,
    values: parsed.values,
  });
  if (!message) return error(404, 'email_message_not_found', 'Email message nicht gefunden');

  await auditEmailMessageSpamStatus(ports, principal, message, {
    status: message.spamStatus,
    train: parsed.values.train !== false,
    source: parsed.values.source ?? 'manual',
    featureKeyCount: parsed.values.featureKeys?.length ?? 0,
  });
  await publishEmailMessageUpdated(ports, principal.workspaceId, message, principal.userId, {
    spamStatus: message.spamStatus,
    isSpam: message.isSpam,
    train: parsed.values.train !== false,
    source: parsed.values.source ?? 'manual',
    featureKeyCount: parsed.values.featureKeys?.length ?? 0,
  });
  return data(200, sanitizeEmailMessage(message, false));
}

async function handleMessageSpamDecisionMutation(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const messageId = positiveIntFromPath(rawId);
  if (messageId === null) return error(400, 'invalid_email_message_id', 'email message id muss eine positive Ganzzahl sein');
  if (!ports.emailMessages?.evaluateSpamDecision) {
    return error(503, 'email_messages_unavailable', 'Email message API nicht konfiguriert');
  }

  const parsed = parseEmailMessageSpamDecisionMutationBody(req.body);
  if (!parsed.ok) return parsed.response;

  const result = await ports.emailMessages.evaluateSpamDecision({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    messageId,
    values: parsed.values,
  });
  if (!result) return error(404, 'email_message_not_found', 'Email message nicht gefunden');

  const breakdown = spamDecisionBreakdownSummary(result.decision.breakdown);
  await auditEmailMessageSpamDecision(ports, principal, result.message, result.decision, {
    applyStatus: parsed.values.applyStatus === true,
    hasBreakdown: breakdown.hasBreakdown,
    reasonCount: breakdown.reasonCount,
    featureKeyCount: breakdown.featureKeyCount,
  });
  await publishSpamDecisionCreated(ports, principal.workspaceId, result.decision, principal.userId, breakdown);
  await publishEmailMessageUpdated(ports, principal.workspaceId, result.message, principal.userId, {
    spamDecisionId: result.decision.id,
    spamScore: result.decision.score,
    spamScoreStatus: result.decision.status,
    spamDecisionSource: result.decision.source,
    applyStatus: parsed.values.applyStatus === true,
    spamStatus: result.message.spamStatus,
    isSpam: result.message.isSpam,
    hasBreakdown: breakdown.hasBreakdown,
    reasonCount: breakdown.reasonCount,
    featureKeyCount: breakdown.featureKeyCount,
  });

  return data(200, {
    message: sanitizeEmailMessage(result.message, false),
    decision: sanitizeSpamDecision(result.decision),
  });
}

async function handleMessageAttachmentList(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawMessageId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const messageId = positiveIntFromPath(rawMessageId);
  if (messageId === null) return error(400, 'invalid_email_message_id', 'email message id muss eine positive Ganzzahl sein');

  if (!ports.emailAttachments) return error(503, 'email_attachments_unavailable', 'Email attachment API nicht konfiguriert');
  const result = await ports.emailAttachments.listForMessage({
    workspaceId: principal.workspaceId,
    messageId,
  });
  return data(200, sanitizeEmailAttachmentList(result));
}

async function handleAttachmentGet(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const id = positiveIntFromPath(rawId);
  if (id === null) return error(400, 'invalid_email_attachment_id', 'email attachment id muss eine positive Ganzzahl sein');

  if (!ports.emailAttachments) return error(503, 'email_attachments_unavailable', 'Email attachment API nicht konfiguriert');
  const attachment = await ports.emailAttachments.get({
    workspaceId: principal.workspaceId,
    id,
  });
  return attachment
    ? data(200, sanitizeEmailAttachment(attachment))
    : error(404, 'email_attachment_not_found', 'Email attachment nicht gefunden');
}

async function handleAttachmentContentGet(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const id = positiveIntFromPath(rawId);
  if (id === null) return error(400, 'invalid_email_attachment_id', 'email attachment id muss eine positive Ganzzahl sein');

  if (!ports.emailAttachmentContent) {
    return error(503, 'email_attachment_content_unavailable', 'Email attachment content API nicht konfiguriert');
  }
  const result = await ports.emailAttachmentContent.get({
    workspaceId: principal.workspaceId,
    id,
  });
  if (!result.ok) {
    if (result.reason === 'not_found') return error(404, 'email_attachment_not_found', 'Email attachment nicht gefunden');
    if (result.reason === 'file_not_found') {
      return error(404, 'email_attachment_file_not_found', 'Email attachment file nicht gefunden');
    }
    return error(409, 'email_attachment_file_unavailable', 'Email attachment file ist nicht aus dem konfigurierten Attachment-Root lesbar');
  }

  const record = result.record;
  const body = Buffer.from(record.content);
  return {
    status: 200,
    body,
    headers: {
      'Cache-Control': 'private, max-age=0, must-revalidate',
      'Content-Disposition': attachmentDisposition(record.filename),
      'Content-Length': String(record.sizeBytes),
      'Content-Type': record.contentType || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      ...(record.contentSha256 ? { ETag: `"sha256:${record.contentSha256}"` } : {}),
    },
  };
}

function sanitizeEmailAccountList(result: EmailAccountListResult): EmailAccountListResult {
  return { items: result.items.map(sanitizeEmailAccount) };
}

function sanitizeEmailAccount(account: EmailAccountRecord): EmailAccountRecord {
  return {
    id: account.id,
    sourceSqliteId: account.sourceSqliteId,
    displayName: account.displayName,
    emailAddress: account.emailAddress,
    protocol: account.protocol,
    imapHost: account.imapHost,
    imapPort: account.imapPort,
    imapTls: account.imapTls,
    imapUsername: account.imapUsername,
    smtpHost: account.smtpHost,
    smtpPort: account.smtpPort,
    smtpTls: account.smtpTls,
    smtpUsername: account.smtpUsername,
    smtpUseImapAuth: account.smtpUseImapAuth,
    pop3Host: account.pop3Host,
    pop3Port: account.pop3Port,
    pop3Tls: account.pop3Tls,
    oauthProvider: account.oauthProvider,
    sentFolderPath: account.sentFolderPath,
    syncSpamFolderPath: account.syncSpamFolderPath,
    syncArchiveFolderPath: account.syncArchiveFolderPath,
    imapSyncSent: account.imapSyncSent,
    imapSyncArchive: account.imapSyncArchive,
    imapSyncSpam: account.imapSyncSpam,
    imapSyncSeenOnOpen: account.imapSyncSeenOnOpen,
    vacationEnabled: account.vacationEnabled,
    vacationSubject: account.vacationSubject,
    vacationBodyText: account.vacationBodyText,
    requestReadReceipt: account.requestReadReceipt,
    imapDeleteOptIn: account.imapDeleteOptIn,
    defaultRemoteContentPolicy: account.defaultRemoteContentPolicy,
    respondToReadReceipts: account.respondToReadReceipts,
    imapPasswordConfigured: account.imapPasswordConfigured,
    smtpPasswordConfigured: account.smtpPasswordConfigured,
    oauthRefreshConfigured: account.oauthRefreshConfigured,
    updatedAt: account.updatedAt,
  };
}

function sanitizeEmailMessageList(result: EmailMessageListResult): EmailMessageListResult {
  return {
    items: result.items.map((message) => sanitizeEmailMessage(message, false)),
    nextCursor: result.nextCursor,
    ...(result.searchMode === undefined ? {} : { searchMode: result.searchMode }),
    ...(result.hasMore === undefined ? {} : { hasMore: result.hasMore }),
  };
}

function sanitizeEmailMessage(message: EmailMessageRecord, includeBody: boolean): EmailMessageRecord {
  return {
    id: message.id,
    sourceSqliteId: message.sourceSqliteId,
    accountId: message.accountId,
    folderId: message.folderId,
    uid: message.uid,
    messageId: message.messageId,
    subject: message.subject,
    from: message.from,
    to: message.to,
    cc: message.cc,
    bcc: message.bcc,
    dateReceived: message.dateReceived,
    snippet: message.snippet,
    seenLocal: message.seenLocal,
    doneLocal: message.doneLocal,
    archived: message.archived,
    softDeleted: message.softDeleted,
    folderKind: message.folderKind,
    threadId: message.threadId,
    imapThreadId: message.imapThreadId,
    ticketCode: message.ticketCode,
    customerId: message.customerId,
    hasAttachments: message.hasAttachments,
    assignedTo: message.assignedTo,
    assignedToUserId: message.assignedToUserId,
    isSpam: message.isSpam,
    spamStatus: message.spamStatus,
    pgpStatus: message.pgpStatus,
    remoteContentPolicy: message.remoteContentPolicy,
    readReceiptRequested: message.readReceiptRequested,
    snoozedUntil: message.snoozedUntil,
    draftAttachmentPathsJson: message.draftAttachmentPathsJson,
    replyParentMessageId: message.replyParentMessageId,
    ...(message.searchSnippet === undefined ? {} : { searchSnippet: message.searchSnippet }),
    ...(includeBody ? {
      bodyText: message.bodyText,
      bodyHtml: message.bodyHtml,
    } : {}),
    updatedAt: message.updatedAt,
  };
}

function sanitizeEmailReplySuggestion(suggestion: EmailReplySuggestionRecord): EmailReplySuggestionRecord {
  return {
    status: suggestion.status,
    text: suggestion.text,
    error: suggestion.error,
    updatedAt: suggestion.updatedAt,
  };
}

function sanitizeEmailReplyDraftGeneration(result: EmailReplyDraftGenerationResult): EmailReplyDraftGenerationResult {
  return result.success
    ? { success: true, text: result.text }
    : { success: false, error: result.error };
}

function sanitizeEmailMessageSecurity(security: EmailMessageSecurityRecord): EmailMessageSecurityRecord {
  return {
    authSpf: security.authSpf,
    authDkim: security.authDkim,
    authDmarc: security.authDmarc,
    authArc: security.authArc,
    authDkimDomains: security.authDkimDomains,
    authError: security.authError,
    rspamdScore: security.rspamdScore,
    rspamdAction: security.rspamdAction,
    rspamdSymbols: security.rspamdSymbols,
    rspamdError: security.rspamdError,
    securityCheckedAt: security.securityCheckedAt,
    spamStatus: security.spamStatus,
    spamScore: security.spamScore,
    spamScoreLabel: security.spamScoreLabel,
    spamDecisionSource: security.spamDecisionSource,
    spamScoreBreakdownJson: security.spamScoreBreakdownJson,
    spamDecidedAt: security.spamDecidedAt,
  };
}

function sanitizeEmailMessageRawHeaders(rawHeaders: EmailMessageRawHeadersRecord): EmailMessageRawHeadersRecord {
  return {
    rawEml: rawHeaders.rawEml,
    emlSource: rawHeaders.emlSource,
    rawHeaders: rawHeaders.rawHeaders,
    messageIdHeader: rawHeaders.messageIdHeader,
    fromJson: rawHeaders.fromJson,
  };
}

function sanitizeEmailReadReceiptState(
  state: EmailReadReceiptStateResult,
): EmailReadReceiptStateResult & { success: true } {
  return {
    success: true,
    requested: state.requested,
    respond: state.respond,
    trustedDomains: state.trustedDomains,
  };
}

function sanitizeEmailReadReceiptResponse(result: EmailReadReceiptResponseResult): EmailReadReceiptResponseResult {
  if (result.success) return { success: true };
  return {
    success: false,
    error: typeof result.error === 'string' && result.error.trim()
      ? result.error.trim().slice(0, 1000)
      : 'MDN konnte nicht gesendet werden',
  };
}

function sanitizeMailFolderCounts(counts: EmailMailFolderCounts): EmailMailFolderCounts {
  return {
    inbox: safeCount(counts.inbox),
    inboxUnread: safeCount(counts.inboxUnread),
    sentFailed: safeCount(counts.sentFailed),
    drafts: safeCount(counts.drafts),
    scheduledSend: safeCount(counts.scheduledSend),
    archived: safeCount(counts.archived),
    spamReview: safeCount(counts.spamReview),
    spam: safeCount(counts.spam),
    trash: safeCount(counts.trash),
    snoozed: safeCount(counts.snoozed),
  };
}

function sanitizeMailDiagnostics(report: EmailDiagnosticsReport): EmailDiagnosticsReport {
  return {
    collectedAt: typeof report.collectedAt === 'string' ? report.collectedAt : new Date().toISOString(),
    schemaGeneration: safeCount(report.schemaGeneration),
    schemaGenerationLabel: typeof report.schemaGenerationLabel === 'string'
      ? report.schemaGenerationLabel.slice(0, 300)
      : '',
    sizes: {
      databaseBytes: safeNullableCount(report.sizes.databaseBytes),
      attachmentsBytes: safeCount(report.sizes.attachmentsBytes),
    },
    messages: {
      total: safeCount(report.messages.total),
      pendingPostProcess: safeCount(report.messages.pendingPostProcess),
      outboundHold: safeCount(report.messages.outboundHold),
      byFolderKind: sanitizeCountMap(report.messages.byFolderKind),
      ...(report.messages.oldestPendingPostProcessSeconds !== undefined
        ? { oldestPendingPostProcessSeconds: safeNullableCount(report.messages.oldestPendingPostProcessSeconds) }
        : {}),
      ...(Array.isArray(report.messages.pendingPostProcessSamples)
        ? {
            pendingPostProcessSamples: report.messages.pendingPostProcessSamples.slice(0, 20).map((message) => ({
              id: safeCount(message.id),
              accountId: safeNullableCount(message.accountId),
              subject: typeof message.subject === 'string' ? message.subject.slice(0, 300) : null,
              ageSeconds: safeCount(message.ageSeconds),
            })),
          }
        : {}),
      ...(Array.isArray(report.messages.failedScheduledSends)
        ? {
            failedScheduledSends: report.messages.failedScheduledSends.slice(0, 20).map((failure) => ({
              messageId: safeCount(failure.messageId),
              failureCount: safeCount(failure.failureCount),
              lastError: typeof failure.lastError === 'string' ? failure.lastError.slice(0, 500) : null,
            })),
          }
        : {}),
    },
    workflows: {
      runsLast24h: safeCount(report.workflows.runsLast24h),
      runsBlockedLast24h: safeCount(report.workflows.runsBlockedLast24h),
      runsErrorLast24h: safeCount(report.workflows.runsErrorLast24h),
      ...(Array.isArray(report.workflows.trappingOutbound)
        ? {
            trappingOutbound: report.workflows.trappingOutbound.slice(0, 100).map((w) => ({
              id: safeCount(w.id),
              name: typeof w.name === 'string' ? w.name.slice(0, 200) : '',
              reason: typeof w.reason === 'string' ? w.reason.slice(0, 500) : '',
            })),
          }
        : {}),
    },
    aiUsage: {
      events24h: safeCount(report.aiUsage.events24h),
      tokens24h: safeCount(report.aiUsage.tokens24h),
      costMicroUsd24h: safeCount(report.aiUsage.costMicroUsd24h),
      avgLatencyMs24h: safeCount(report.aiUsage.avgLatencyMs24h),
      events30d: safeCount(report.aiUsage.events30d),
      tokens30d: safeCount(report.aiUsage.tokens30d),
      costMicroUsd30d: safeCount(report.aiUsage.costMicroUsd30d),
      byNodeType24h: sanitizeCountMap(report.aiUsage.byNodeType24h),
    },
    notices: {
      imapAuth: safeCount(report.notices.imapAuth),
      uidValidity: safeCount(report.notices.uidValidity),
    },
    syncInfo: {
      totalKeys: safeCount(report.syncInfo.totalKeys),
      prefixes: sanitizeCountMap(report.syncInfo.prefixes),
    },
    background: {
      cronScheduled: report.background.cronScheduled === true,
      cronTickInFlight: report.background.cronTickInFlight === true,
      syncInFlightAccountIds: sanitizeNumberList(report.background.syncInFlightAccountIds),
      idleImapAccountIds: sanitizeNumberList(report.background.idleImapAccountIds),
    },
    accounts: report.accounts.map((account) => ({
      id: safeCount(account.id),
      email: typeof account.email === 'string' ? account.email.slice(0, 320) : '',
      protocol: typeof account.protocol === 'string' ? account.protocol.slice(0, 20) : 'imap',
      inboxLastSyncedAt: typeof account.inboxLastSyncedAt === 'string' ? account.inboxLastSyncedAt : null,
    })),
    ...(report.operations
      ? {
          operations: {
            inboundLagSeconds: safeNullableCount(report.operations.inboundLagSeconds),
            postProcessRetrying: safeCount(report.operations.postProcessRetrying),
            smtpCommitRecoveries: safeCount(report.operations.smtpCommitRecoveries),
            mfaLocks: safeCount(report.operations.mfaLocks),
          },
        }
      : {}),
    ...(report.jobQueue
      ? {
          jobQueue: {
            ready: safeCount(report.jobQueue.ready),
            locked: safeCount(report.jobQueue.locked),
            deadLetter: safeCount(report.jobQueue.deadLetter),
            workflowDeadLetter: safeCount(report.jobQueue.workflowDeadLetter),
            lagSeconds: safeCount(report.jobQueue.lagSeconds),
            oldestLockedSeconds: safeNullableCount(report.jobQueue.oldestLockedSeconds),
            samples: report.jobQueue.samples.slice(0, 20).map((job) => ({
              id: safeCount(job.id),
              type: typeof job.type === 'string' ? job.type.slice(0, 100) : '',
              attempts: safeCount(job.attempts),
              maxAttempts: safeCount(job.maxAttempts),
              lockedBy: typeof job.lockedBy === 'string' ? job.lockedBy.slice(0, 200) : null,
              lockedSeconds: safeNullableCount(job.lockedSeconds),
              lastError: typeof job.lastError === 'string' ? job.lastError.slice(0, 500) : null,
              engine: job.engine === 'graphile' ? 'graphile' as const : 'legacy' as const,
              terminal: job.terminal === true,
            })),
          },
        }
      : {}),
  };
}

function sanitizeEmailReportingSnapshot(snapshot: EmailReportingSnapshot): EmailReportingSnapshot {
  return {
    accounts: snapshot.accounts.map((account) => ({
      id: safeCount(account.id),
      displayName: typeof account.displayName === 'string' ? account.displayName.slice(0, 320) : '',
      emailAddress: typeof account.emailAddress === 'string' ? account.emailAddress.slice(0, 320) : '',
      protocol: typeof account.protocol === 'string' && account.protocol.trim()
        ? account.protocol.trim().slice(0, 50)
        : 'imap',
    })),
    totals: {
      messages: safeCount(snapshot.totals.messages),
      unread: safeCount(snapshot.totals.unread),
      archived: safeCount(snapshot.totals.archived),
      withCustomer: safeCount(snapshot.totals.withCustomer),
      withAssignment: safeCount(snapshot.totals.withAssignment),
      withAttachments: safeCount(snapshot.totals.withAttachments),
    },
    perAccount: snapshot.perAccount.map((row) => ({
      accountId: safeCount(row.accountId),
      messages: safeCount(row.messages),
      unread: safeCount(row.unread),
      archived: safeCount(row.archived),
    })),
    workflowRuns24h: snapshot.workflowRuns24h.map((row) => ({
      workflowId: safeCount(row.workflowId),
      count: safeCount(row.count),
      errors: safeCount(row.errors),
    })),
  };
}

function safeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

function safeNullableCount(value: unknown): number | null {
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
}

function sanitizeCountMap(value: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, count] of Object.entries(value)) {
    const normalizedKey = key.trim().slice(0, 100);
    if (!normalizedKey) continue;
    out[normalizedKey] = safeCount(count);
  }
  return out;
}

function sanitizeNumberList(value: readonly number[]): number[] {
  return value
    .filter((item) => Number.isSafeInteger(item) && item > 0)
    .map((item) => Math.trunc(item));
}

async function auditEmailAccount(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  action: 'email_account.created' | 'email_account.updated' | 'email_account.deleted',
  account: EmailAccountRecord,
  metadata: Record<string, unknown>,
): Promise<void> {
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action,
    entityType: 'email_account',
    entityId: String(account.id),
    metadata: {
      id: account.id,
      sourceSqliteId: account.sourceSqliteId,
      emailAddress: account.emailAddress,
      ...metadata,
    },
  });
}

async function publishEmailAccount(
  ports: ServerApiPorts,
  workspaceId: string,
  type: 'email_account.created' | 'email_account.updated' | 'email_account.deleted',
  account: EmailAccountRecord,
  actorUserId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await ports.events?.publish({
    type,
    workspaceId,
    entityType: 'email_account',
    entityId: String(account.id),
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      id: account.id,
      sourceSqliteId: account.sourceSqliteId,
      emailAddress: account.emailAddress,
      ...payload,
    },
  });
}

async function auditEmailReadReceipt(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  action: 'email_read_receipt.created',
  receipt: EmailReadReceiptRecord,
  metadata: Record<string, unknown>,
): Promise<void> {
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action,
    entityType: 'email_read_receipt',
    entityId: String(receipt.id),
    metadata: {
      id: receipt.id,
      sourceSqliteId: receipt.sourceSqliteId,
      ...metadata,
    },
  });
}

async function publishEmailReadReceipt(
  ports: ServerApiPorts,
  workspaceId: string,
  type: 'email_read_receipt.created',
  receipt: EmailReadReceiptRecord,
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type,
    workspaceId,
    entityType: 'email_read_receipt',
    entityId: String(receipt.id),
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      id: receipt.id,
      sourceSqliteId: receipt.sourceSqliteId,
      messageSourceSqliteId: receipt.messageSourceSqliteId,
      messageId: receipt.messageId,
      direction: receipt.direction,
      recipient: receipt.recipient,
      at: receipt.at,
    },
  });
}

async function auditEmailMessageSpamStatus(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  message: EmailMessageRecord,
  metadata: Record<string, unknown>,
): Promise<void> {
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'email_message.spam_status_updated',
    entityType: 'email_message',
    entityId: String(message.id),
    metadata: {
      id: message.id,
      sourceSqliteId: message.sourceSqliteId,
      accountId: message.accountId,
      ...metadata,
    },
  });
}

async function auditEmailMessageSpamDecision(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  message: EmailMessageRecord,
  decision: SpamDecisionRecord,
  metadata: Record<string, unknown>,
): Promise<void> {
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'email_message.spam_decision_evaluated',
    entityType: 'email_message',
    entityId: String(message.id),
    metadata: {
      id: message.id,
      sourceSqliteId: message.sourceSqliteId,
      accountId: message.accountId,
      decisionId: decision.id,
      score: decision.score,
      status: decision.status,
      source: decision.source,
      ...metadata,
    },
  });
}

async function auditEmailMessageSecurityCheck(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  message: EmailMessageRecord,
  metadata: Record<string, unknown>,
): Promise<void> {
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'email_message.security_checked',
    entityType: 'email_message',
    entityId: String(message.id),
    metadata: {
      id: message.id,
      sourceSqliteId: message.sourceSqliteId,
      accountId: message.accountId,
      ...metadata,
    },
  });
}

async function auditEmailMessageRemoteContentPolicy(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  message: EmailMessageRecord,
  values: EmailRemoteContentPolicyMutationInput,
): Promise<void> {
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'email_message.remote_content_policy_updated',
    entityType: 'email_message',
    entityId: String(message.id),
    metadata: {
      id: message.id,
      sourceSqliteId: message.sourceSqliteId,
      accountId: message.accountId,
      policy: values.policy,
      rememberSender: values.rememberSender === true,
      rememberDomain: values.rememberDomain === true,
    },
  });
}

async function publishSpamDecisionCreated(
  ports: ServerApiPorts,
  workspaceId: string,
  decision: SpamDecisionRecord,
  actorUserId: string,
  breakdown: ReturnType<typeof spamDecisionBreakdownSummary>,
): Promise<void> {
  await ports.events?.publish({
    type: 'spam_decision.created',
    workspaceId,
    entityType: 'spam_decision',
    entityId: String(decision.id),
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      id: decision.id,
      sourceSqliteId: decision.sourceSqliteId,
      messageId: decision.messageId,
      accountId: decision.accountId,
      score: decision.score,
      status: decision.status,
      source: decision.source,
      modelVersion: decision.modelVersion,
      hasBreakdown: breakdown.hasBreakdown,
      reasonCount: breakdown.reasonCount,
      featureKeyCount: breakdown.featureKeyCount,
    },
  });
}

async function publishEmailMessageUpdated(
  ports: ServerApiPorts,
  workspaceId: string,
  message: EmailMessageRecord,
  actorUserId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await ports.events?.publish({
    type: 'email_message.updated',
    workspaceId,
    entityType: 'email_message',
    entityId: String(message.id),
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      id: message.id,
      sourceSqliteId: message.sourceSqliteId,
      accountId: message.accountId,
      ...payload,
    },
  });
}

function sanitizeSpamDecision(decision: SpamDecisionRecord): SpamDecisionRecord {
  return {
    id: decision.id,
    sourceSqliteId: decision.sourceSqliteId,
    messageSourceSqliteId: decision.messageSourceSqliteId,
    accountSourceSqliteId: decision.accountSourceSqliteId,
    messageId: decision.messageId,
    accountId: decision.accountId,
    score: decision.score,
    status: decision.status,
    source: decision.source,
    breakdown: decision.breakdown,
    modelVersion: decision.modelVersion,
    createdAt: decision.createdAt,
    updatedAt: decision.updatedAt,
  };
}

function spamDecisionBreakdownSummary(breakdown: unknown): {
  hasBreakdown: boolean;
  reasonCount: number;
  featureKeyCount: number;
} {
  if (!isPlainObject(breakdown)) {
    return { hasBreakdown: breakdown !== null && breakdown !== undefined, reasonCount: 0, featureKeyCount: 0 };
  }
  return {
    hasBreakdown: true,
    reasonCount: Array.isArray(breakdown.reasons) ? breakdown.reasons.length : 0,
    featureKeyCount: Array.isArray(breakdown.featureKeys) ? breakdown.featureKeys.length : 0,
  };
}

function sanitizeEmailAttachmentList(result: EmailAttachmentListResult): EmailAttachmentListResult {
  return {
    items: result.items.map(sanitizeEmailAttachment),
  };
}

function sanitizeEmailAttachment(attachment: EmailAttachmentRecord): EmailAttachmentRecord {
  return {
    id: attachment.id,
    sourceSqliteId: attachment.sourceSqliteId,
    messageSourceSqliteId: attachment.messageSourceSqliteId,
    messageId: attachment.messageId,
    filename: attachment.filename,
    contentType: attachment.contentType,
    sizeBytes: attachment.sizeBytes,
    contentSha256: attachment.contentSha256,
    updatedAt: attachment.updatedAt,
  };
}

function normalizeEmailOAuthProvider(rawProvider: string | undefined): EmailOAuthProvider | null {
  return rawProvider === 'google' || rawProvider === 'microsoft' ? rawProvider : null;
}

async function loadEmailOAuthAppSettings(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  provider: EmailOAuthProvider,
): Promise<{ settings: { clientId: string; clientSecret: string } } | ApiResponse<ApiErrorBody>> {
  if (!ports.syncInfo) return error(503, 'sync_info_unavailable', 'Sync-info API nicht konfiguriert');
  const keys = EMAIL_OAUTH_APP_KEYS[provider];
  const rows = await ports.syncInfo.getMany({
    workspaceId: principal.workspaceId,
    keys: [keys.clientId, keys.clientSecret],
  });
  return {
    settings: {
      clientId: syncInfoValue(rows, keys.clientId),
      clientSecret: syncInfoValue(rows, keys.clientSecret),
    },
  };
}

function syncInfoValue(rows: readonly SyncInfoRecord[], key: string): string {
  return rows.find((row) => row.key === key)?.value ?? '';
}

function parseEmailOAuthAppMutationBody(body: unknown): EmailOAuthAppMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_email_oauth_app_payload', 'OAuth app payload muss ein JSON-Objekt sein'),
    };
  }
  const errors: Array<{ field: string; message: string }> = [];
  for (const key of Object.keys(body)) {
    if (key !== 'clientId' && key !== 'clientSecret') errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }
  const clientId = normalizeOAuthAppText(body.clientId, 'clientId', 1000);
  if (!clientId.ok) errors.push({ field: 'clientId', message: clientId.message });
  const clientSecret = normalizeOAuthAppText(body.clientSecret, 'clientSecret', 2000);
  if (!clientSecret.ok) errors.push({ field: 'clientSecret', message: clientSecret.message });
  if (errors.length > 0 || !clientId.ok || !clientSecret.ok) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'OAuth app payload ist ungueltig', { fields: errors }),
    };
  }
  return {
    ok: true,
    values: {
      clientId: clientId.value,
      clientSecret: clientSecret.value,
    },
  };
}

function parseEmailOAuthRedirectBody(body: unknown): EmailOAuthRedirectParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_email_oauth_redirect_payload', 'OAuth redirect payload muss ein JSON-Objekt sein'),
    };
  }
  const errors: Array<{ field: string; message: string }> = [];
  for (const key of Object.keys(body)) {
    if (key !== 'redirectUri') errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }
  const redirectUri = normalizeOAuthRedirectUri(body.redirectUri);
  if (!redirectUri.ok) errors.push({ field: 'redirectUri', message: redirectUri.message });
  if (errors.length > 0 || !redirectUri.ok) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'OAuth redirect payload ist ungueltig', { fields: errors }),
    };
  }
  return { ok: true, redirectUri: redirectUri.value };
}

function parseEmailOAuthFinishBody(body: unknown): EmailOAuthFinishParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_email_oauth_finish_payload', 'OAuth finish payload muss ein JSON-Objekt sein'),
    };
  }
  const errors: Array<{ field: string; message: string }> = [];
  for (const key of Object.keys(body)) {
    if (key !== 'accountId' && key !== 'redirectUri' && key !== 'code') {
      errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
    }
  }
  const accountId = normalizePositiveBodyInt(body.accountId, 'accountId');
  if (!accountId.ok) errors.push({ field: 'accountId', message: accountId.message });
  const redirectUri = normalizeOAuthRedirectUri(body.redirectUri);
  if (!redirectUri.ok) errors.push({ field: 'redirectUri', message: redirectUri.message });
  const code = normalizeRequiredBodyText(body.code, 'code', 10000);
  if (!code.ok) errors.push({ field: 'code', message: code.message });
  if (errors.length > 0 || !accountId.ok || !redirectUri.ok || !code.ok) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'OAuth finish payload ist ungueltig', { fields: errors }),
    };
  }
  return {
    ok: true,
    accountId: accountId.value,
    redirectUri: redirectUri.value,
    code: code.value,
  };
}

function normalizeOAuthRedirectUri(rawValue: unknown): { ok: true; value: string } | { ok: false; message: string } {
  const text = normalizeRequiredBodyText(rawValue, 'redirectUri', 2000);
  if (!text.ok) return text;
  try {
    const parsed = new URL(text.value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, message: 'redirectUri muss eine HTTP(S)-URL sein' };
    }
    return { ok: true, value: text.value };
  } catch {
    return { ok: false, message: 'redirectUri muss eine gueltige URL sein' };
  }
}

function normalizeOAuthAppText(
  rawValue: unknown,
  field: string,
  maxLength: number,
): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof rawValue !== 'string') return { ok: false, message: `${field} muss ein String sein` };
  const value = rawValue.trim();
  if (value.length > maxLength) return { ok: false, message: `${field} darf maximal ${maxLength} Zeichen haben` };
  return { ok: true, value };
}

function parseComposeDraftCreateBody(body: unknown): EmailComposeDraftCreateParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_compose_draft_payload', 'Compose-draft payload muss ein JSON-Objekt sein'),
    };
  }
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['accountId', 'subject', 'bodyText', 'to']);
  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }
  const accountId = normalizePositiveBodyInt(body.accountId, 'accountId');
  if (!accountId.ok) errors.push({ field: 'accountId', message: accountId.message });
  const subject = Object.prototype.hasOwnProperty.call(body, 'subject')
    ? normalizeComposeOptionalText(body.subject, 'subject', 1000)
    : { ok: true as const, value: undefined };
  if (!subject.ok) errors.push({ field: 'subject', message: subject.message });
  const bodyText = Object.prototype.hasOwnProperty.call(body, 'bodyText')
    ? normalizeComposeOptionalText(body.bodyText, 'bodyText', 2_000_000)
    : { ok: true as const, value: undefined };
  if (!bodyText.ok) errors.push({ field: 'bodyText', message: bodyText.message });
  const toJson = Object.prototype.hasOwnProperty.call(body, 'to')
    ? normalizeRecipientJsonBody(body.to, 'to')
    : { ok: true as const, value: undefined };
  if (!toJson.ok) errors.push({ field: 'to', message: toJson.message });
  if (errors.length > 0 || !accountId.ok || !subject.ok || !bodyText.ok || !toJson.ok) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Compose-draft payload ist ungueltig', { fields: errors }),
    };
  }
  return {
    ok: true,
    accountId: accountId.value,
    ...(subject.value === undefined ? {} : { subject: subject.value }),
    ...(bodyText.value === undefined ? {} : { bodyText: bodyText.value }),
    ...(toJson.value === undefined ? {} : { toJson: toJson.value }),
  };
}

function parseComposeDraftUpdateBody(body: unknown): EmailComposeDraftUpdateParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_compose_draft_payload', 'Compose-draft payload muss ein JSON-Objekt sein'),
    };
  }
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set([
    'subject',
    'bodyText',
    'bodyHtml',
    'to',
    'cc',
    'bcc',
    'draftAttachmentPaths',
    'replyParentMessageId',
    'markReplyParentDone',
  ]);
  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }
  const values: Partial<Extract<EmailComposeDraftUpdateParseResult, { ok: true }>['values']> = {};

  assignComposeText(values, errors, body, 'subject', 'subject', 1000);
  assignComposeText(values, errors, body, 'bodyText', 'bodyText', 2_000_000);
  assignComposeText(values, errors, body, 'bodyHtml', 'bodyHtml', 2_000_000);
  assignRecipientJson(values, errors, body, 'to', 'toJson');
  assignRecipientJson(values, errors, body, 'cc', 'ccJson');
  assignRecipientJson(values, errors, body, 'bcc', 'bccJson');

  if (Object.prototype.hasOwnProperty.call(body, 'draftAttachmentPaths')) {
    const parsed = normalizeDraftAttachmentPaths(body.draftAttachmentPaths);
    if (parsed.ok) values.draftAttachmentPaths = parsed.value;
    else errors.push({ field: 'draftAttachmentPaths', message: parsed.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'replyParentMessageId')) {
    if (body.replyParentMessageId === null) values.replyParentMessageId = null;
    else {
      const parsed = normalizePositiveBodyInt(body.replyParentMessageId, 'replyParentMessageId');
      if (parsed.ok) values.replyParentMessageId = parsed.value;
      else errors.push({ field: 'replyParentMessageId', message: parsed.message });
    }
  }
  let markReplyParentDone: boolean | undefined;
  if (Object.prototype.hasOwnProperty.call(body, 'markReplyParentDone')) {
    if (typeof body.markReplyParentDone === 'boolean') markReplyParentDone = body.markReplyParentDone;
    else errors.push({ field: 'markReplyParentDone', message: 'markReplyParentDone muss true oder false sein' });
  }
  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Compose-draft payload ist ungueltig', { fields: errors }),
    };
  }
  return {
    ok: true,
    values,
    ...(markReplyParentDone === undefined ? {} : { markReplyParentDone }),
  };
}

function parseComposeSendBody(body: unknown): EmailComposeSendParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_compose_send_payload', 'Compose-send payload muss ein JSON-Objekt sein'),
    };
  }
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set([
    'accountId',
    'draftMessageId',
    'subject',
    'bodyText',
    'bodyHtml',
    'to',
    'cc',
    'bcc',
    'inReplyToMessageId',
    'attachmentPaths',
    'markReplyParentDone',
    'requestReadReceipt',
    'pgpEncrypt',
    'pgpSign',
    'pgpPassphrase',
    'pgpUserId',
  ]);
  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }

  const accountId = normalizePositiveBodyInt(body.accountId, 'accountId');
  if (!accountId.ok) errors.push({ field: 'accountId', message: accountId.message });
  const draftMessageId = normalizePositiveBodyInt(body.draftMessageId, 'draftMessageId');
  if (!draftMessageId.ok) errors.push({ field: 'draftMessageId', message: draftMessageId.message });
  const subject = normalizeComposeOptionalText(body.subject, 'subject', 1000);
  if (!subject.ok) errors.push({ field: 'subject', message: subject.message });
  const bodyText = normalizeComposeOptionalText(body.bodyText, 'bodyText', 2_000_000);
  if (!bodyText.ok) errors.push({ field: 'bodyText', message: bodyText.message });
  const to = normalizeRequiredBodyText(body.to, 'to', 10_000);
  if (!to.ok) errors.push({ field: 'to', message: to.message });

  const values: Partial<EmailComposeSendInput> = {};
  if (Object.prototype.hasOwnProperty.call(body, 'bodyHtml')) {
    if (body.bodyHtml === null) values.bodyHtml = null;
    else {
      const parsed = normalizeComposeOptionalText(body.bodyHtml, 'bodyHtml', 2_000_000);
      if (parsed.ok) values.bodyHtml = parsed.value;
      else errors.push({ field: 'bodyHtml', message: parsed.message });
    }
  }
  for (const field of ['cc', 'bcc'] as const) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    const parsed = normalizeComposeOptionalText(body[field], field, 10_000);
    if (parsed.ok) values[field] = parsed.value;
    else errors.push({ field, message: parsed.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'inReplyToMessageId')) {
    if (body.inReplyToMessageId === null) values.inReplyToMessageId = null;
    else {
      const parsed = normalizePositiveBodyInt(body.inReplyToMessageId, 'inReplyToMessageId');
      if (parsed.ok) values.inReplyToMessageId = parsed.value;
      else errors.push({ field: 'inReplyToMessageId', message: parsed.message });
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'attachmentPaths')) {
    const parsed = normalizeDraftAttachmentPaths(body.attachmentPaths);
    if (parsed.ok) values.attachmentPaths = parsed.value;
    else errors.push({ field: 'attachmentPaths', message: parsed.message });
  }
  for (const field of ['markReplyParentDone', 'requestReadReceipt', 'pgpEncrypt', 'pgpSign'] as const) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    const parsed = normalizeBooleanBody(body[field], field);
    if (parsed.ok) values[field] = parsed.value;
    else errors.push({ field, message: parsed.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'pgpPassphrase')) {
    const parsed = normalizeComposeOptionalText(body.pgpPassphrase, 'pgpPassphrase', 10_000);
    if (parsed.ok) values.pgpPassphrase = parsed.value || undefined;
    else errors.push({ field: 'pgpPassphrase', message: parsed.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'pgpUserId')) {
    const parsed = normalizeComposeOptionalText(body.pgpUserId, 'pgpUserId', 500);
    if (!parsed.ok) errors.push({ field: 'pgpUserId', message: parsed.message });
  }

  if (
    errors.length > 0 ||
    !accountId.ok ||
    !draftMessageId.ok ||
    !subject.ok ||
    !bodyText.ok ||
    !to.ok
  ) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Compose-send payload ist ungueltig', { fields: errors }),
    };
  }
  return {
    ok: true,
    values: {
      accountId: accountId.value,
      draftMessageId: draftMessageId.value,
      subject: subject.value,
      bodyText: bodyText.value,
      to: to.value,
      ...values,
    },
  };
}

function parseComposeAttachmentUploadBody(body: unknown): EmailComposeAttachmentUploadParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_compose_attachment_payload', 'Compose-attachment payload muss ein JSON-Objekt sein'),
    };
  }
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['filename', 'contentBase64', 'contentType']);
  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }

  const filename = normalizeRequiredBodyText(body.filename, 'filename', 240);
  if (!filename.ok) errors.push({ field: 'filename', message: filename.message });
  const contentBase64 = normalizeRequiredBodyText(body.contentBase64, 'contentBase64', 36_000_000);
  if (!contentBase64.ok) errors.push({ field: 'contentBase64', message: contentBase64.message });
  let contentType: string | undefined;
  if (Object.prototype.hasOwnProperty.call(body, 'contentType')) {
    const parsed = normalizeComposeOptionalText(body.contentType, 'contentType', 200);
    if (parsed.ok) contentType = parsed.value || undefined;
    else errors.push({ field: 'contentType', message: parsed.message });
  }

  if (errors.length > 0 || !filename.ok || !contentBase64.ok) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Compose-attachment payload ist ungueltig', { fields: errors }),
    };
  }
  return {
    ok: true,
    filename: filename.value,
    contentBase64: contentBase64.value,
    ...(contentType === undefined ? {} : { contentType }),
  };
}

function parseOutboundValidationBody(body: unknown): EmailOutboundValidationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_outbound_validation_payload', 'Outbound validation payload muss ein JSON-Objekt sein'),
    };
  }
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set([
    'messageId',
    'subject',
    'bodyText',
    'bodyHtml',
    'to',
    'cc',
    'bcc',
    'inReplyToMessageId',
    'attachmentCount',
  ]);
  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }

  const messageId = normalizePositiveBodyInt(body.messageId, 'messageId');
  if (!messageId.ok) errors.push({ field: 'messageId', message: messageId.message });
  const subject = normalizeComposeOptionalText(body.subject, 'subject', 1000);
  if (!subject.ok) errors.push({ field: 'subject', message: subject.message });
  const bodyText = normalizeComposeOptionalText(body.bodyText, 'bodyText', 2_000_000);
  if (!bodyText.ok) errors.push({ field: 'bodyText', message: bodyText.message });
  const to = normalizeRequiredBodyText(body.to, 'to', 10_000);
  if (!to.ok) errors.push({ field: 'to', message: to.message });

  const values: Partial<EmailOutboundValidationInput> = {};
  if (Object.prototype.hasOwnProperty.call(body, 'bodyHtml')) {
    if (body.bodyHtml === null) values.bodyHtml = null;
    else {
      const parsed = normalizeComposeOptionalText(body.bodyHtml, 'bodyHtml', 2_000_000);
      if (parsed.ok) values.bodyHtml = parsed.value;
      else errors.push({ field: 'bodyHtml', message: parsed.message });
    }
  }
  for (const field of ['cc', 'bcc'] as const) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    const parsed = normalizeComposeOptionalText(body[field], field, 10_000);
    if (parsed.ok) values[field] = parsed.value;
    else errors.push({ field, message: parsed.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'inReplyToMessageId')) {
    if (body.inReplyToMessageId === null) values.inReplyToMessageId = null;
    else {
      const parsed = normalizePositiveBodyInt(body.inReplyToMessageId, 'inReplyToMessageId');
      if (parsed.ok) values.inReplyToMessageId = parsed.value;
      else errors.push({ field: 'inReplyToMessageId', message: parsed.message });
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'attachmentCount')) {
    const parsed = normalizeNonNegativeBodyInt(body.attachmentCount, 'attachmentCount');
    if (parsed.ok) values.attachmentCount = parsed.value;
    else errors.push({ field: 'attachmentCount', message: parsed.message });
  }

  if (
    errors.length > 0 ||
    !messageId.ok ||
    !subject.ok ||
    !bodyText.ok ||
    !to.ok
  ) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Outbound validation payload ist ungueltig', { fields: errors }),
    };
  }
  return {
    ok: true,
    values: {
      messageId: messageId.value,
      subject: subject.value,
      bodyText: bodyText.value,
      to: to.value,
      ...values,
    },
  };
}

function parseScheduledSendBody(body: unknown): EmailScheduledSendParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_scheduled_send_payload', 'Scheduled-send payload muss ein JSON-Objekt sein'),
    };
  }
  const errors: Array<{ field: string; message: string }> = [];
  for (const key of Object.keys(body)) {
    if (key !== 'sendAt') errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }
  if (body.sendAt === null || body.sendAt === undefined || body.sendAt === '') {
    return errors.length > 0
      ? { ok: false, response: error(400, 'validation_error', 'Scheduled-send payload ist ungueltig', { fields: errors }) }
      : { ok: true, sendAt: null };
  }
  if (typeof body.sendAt !== 'string') errors.push({ field: 'sendAt', message: 'sendAt muss ein ISO-Zeitpunkt oder null sein' });
  const sendAt = typeof body.sendAt === 'string' ? body.sendAt.trim() : '';
  if (typeof body.sendAt === 'string' && (!sendAt || sendAt.length > 100 || Number.isNaN(Date.parse(sendAt)))) {
    errors.push({ field: 'sendAt', message: 'sendAt muss ein gueltiger ISO-Zeitpunkt oder null sein' });
  }
  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Scheduled-send payload ist ungueltig', { fields: errors }),
    };
  }
  return { ok: true, sendAt };
}

function assignComposeText(
  values: Partial<NonNullable<Extract<EmailComposeDraftUpdateParseResult, { ok: true }>['values']>>,
  errors: Array<{ field: string; message: string }>,
  body: Record<string, unknown>,
  bodyField: 'subject' | 'bodyText' | 'bodyHtml',
  valueField: 'subject' | 'bodyText' | 'bodyHtml',
  maxLength: number,
): void {
  if (!Object.prototype.hasOwnProperty.call(body, bodyField)) return;
  const parsed = normalizeComposeOptionalText(body[bodyField], bodyField, maxLength);
  if (parsed.ok) values[valueField] = parsed.value;
  else errors.push({ field: bodyField, message: parsed.message });
}

function assignRecipientJson(
  values: Partial<NonNullable<Extract<EmailComposeDraftUpdateParseResult, { ok: true }>['values']>>,
  errors: Array<{ field: string; message: string }>,
  body: Record<string, unknown>,
  bodyField: 'to' | 'cc' | 'bcc',
  valueField: 'toJson' | 'ccJson' | 'bccJson',
): void {
  if (!Object.prototype.hasOwnProperty.call(body, bodyField)) return;
  const parsed = normalizeRecipientJsonBody(body[bodyField], bodyField);
  if (parsed.ok) values[valueField] = parsed.value;
  else errors.push({ field: bodyField, message: parsed.message });
}

function normalizeComposeOptionalText(
  rawValue: unknown,
  field: string,
  maxLength: number,
): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof rawValue !== 'string') return { ok: false, message: `${field} muss ein String sein` };
  if (rawValue.length > maxLength) return { ok: false, message: `${field} darf maximal ${maxLength} Zeichen haben` };
  return { ok: true, value: rawValue };
}

function normalizeRecipientJsonBody(
  rawValue: unknown,
  field: string,
): { ok: true; value: unknown | null } | { ok: true; value: undefined } | { ok: false; message: string } {
  if (rawValue === undefined) return { ok: true, value: undefined };
  if (typeof rawValue !== 'string') return { ok: false, message: `${field} muss ein String sein` };
  const value = recipientJsonObjectFromField(rawValue);
  return { ok: true, value };
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

function normalizeDraftAttachmentPaths(rawValue: unknown): { ok: true; value: readonly string[] } | { ok: false; message: string } {
  if (!Array.isArray(rawValue)) return { ok: false, message: 'draftAttachmentPaths muss ein Array sein' };
  if (rawValue.length > 200) return { ok: false, message: 'draftAttachmentPaths darf maximal 200 Eintraege haben' };
  const paths: string[] = [];
  for (const item of rawValue) {
    if (typeof item !== 'string') return { ok: false, message: 'draftAttachmentPaths darf nur Strings enthalten' };
    const path = item.trim();
    if (!path) continue;
    if (path.length > 4000) return { ok: false, message: 'draftAttachmentPaths-Eintraege duerfen maximal 4000 Zeichen haben' };
    if (!paths.includes(path)) paths.push(path);
  }
  return { ok: true, value: paths };
}

function parseEmailAccountMutationBody(body: unknown): EmailAccountMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_email_account_payload', 'Email account payload muss ein JSON-Objekt sein'),
    };
  }

  const values: EmailAccountMutationInput = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set([
    'displayName',
    'emailAddress',
    'imapHost',
    'imapPort',
    'imapTls',
    'imapUsername',
    'imapPassword',
    'smtpHost',
    'smtpPort',
    'smtpTls',
    'smtpUsername',
    'smtpUseImapAuth',
    'smtpPassword',
    'protocol',
    'pop3Host',
    'pop3Port',
    'pop3Tls',
    'sentFolderPath',
    'syncSpamFolderPath',
    'syncArchiveFolderPath',
    'imapSyncSent',
    'imapSyncArchive',
    'imapSyncSpam',
    'imapSyncSeenOnOpen',
    'vacationEnabled',
    'vacationSubject',
    'vacationBodyText',
    'requestReadReceipt',
    'imapDeleteOptIn',
  ]);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }

  assignParsed(values, errors, body, 'displayName', (value) => normalizeRequiredBodyText(value, 'displayName', 320));
  assignParsed(values, errors, body, 'emailAddress', normalizeEmailAddressBody);
  assignParsed(values, errors, body, 'imapHost', (value) => normalizeRequiredBodyText(value, 'imapHost', 500));
  assignParsed(values, errors, body, 'imapPort', (value) => normalizePositiveBodyInt(value, 'imapPort'));
  assignParsed(values, errors, body, 'imapTls', (value) => normalizeBooleanBody(value, 'imapTls'));
  assignParsed(values, errors, body, 'imapUsername', (value) => normalizeRequiredBodyText(value, 'imapUsername', 500));
  assignParsed(values, errors, body, 'imapPassword', normalizePasswordBody);
  assignParsed(values, errors, body, 'smtpHost', (value) => normalizeNullableBodyText(value, 'smtpHost', 500));
  assignParsed(values, errors, body, 'smtpPort', (value) => normalizeNullablePositiveBodyInt(value, 'smtpPort'));
  assignParsed(values, errors, body, 'smtpTls', (value) => normalizeBooleanBody(value, 'smtpTls'));
  assignParsed(values, errors, body, 'smtpUsername', (value) => normalizeNullableBodyText(value, 'smtpUsername', 500));
  assignParsed(values, errors, body, 'smtpUseImapAuth', (value) => normalizeBooleanBody(value, 'smtpUseImapAuth'));
  assignParsed(values, errors, body, 'smtpPassword', normalizePasswordBody);
  assignParsed(values, errors, body, 'protocol', normalizeProtocolBody);
  assignParsed(values, errors, body, 'pop3Host', (value) => normalizeNullableBodyText(value, 'pop3Host', 500));
  assignParsed(values, errors, body, 'pop3Port', (value) => normalizeNullablePositiveBodyInt(value, 'pop3Port'));
  assignParsed(values, errors, body, 'pop3Tls', (value) => normalizeBooleanBody(value, 'pop3Tls'));
  assignParsed(values, errors, body, 'sentFolderPath', (value) => normalizeNullableBodyText(value, 'sentFolderPath', 500));
  assignParsed(values, errors, body, 'syncSpamFolderPath', (value) => normalizeNullableBodyText(value, 'syncSpamFolderPath', 500));
  assignParsed(values, errors, body, 'syncArchiveFolderPath', (value) => normalizeNullableBodyText(value, 'syncArchiveFolderPath', 500));
  assignParsed(values, errors, body, 'imapSyncSent', (value) => normalizeBooleanBody(value, 'imapSyncSent'));
  assignParsed(values, errors, body, 'imapSyncArchive', (value) => normalizeBooleanBody(value, 'imapSyncArchive'));
  assignParsed(values, errors, body, 'imapSyncSpam', (value) => normalizeBooleanBody(value, 'imapSyncSpam'));
  assignParsed(values, errors, body, 'imapSyncSeenOnOpen', (value) => normalizeBooleanBody(value, 'imapSyncSeenOnOpen'));
  assignParsed(values, errors, body, 'vacationEnabled', (value) => normalizeBooleanBody(value, 'vacationEnabled'));
  assignParsed(values, errors, body, 'vacationSubject', (value) => normalizeNullableBodyText(value, 'vacationSubject', 500));
  assignParsed(values, errors, body, 'vacationBodyText', (value) => normalizeNullableBodyText(value, 'vacationBodyText', 10000));
  assignParsed(values, errors, body, 'requestReadReceipt', (value) => normalizeBooleanBody(value, 'requestReadReceipt'));
  assignParsed(values, errors, body, 'imapDeleteOptIn', (value) => normalizeBooleanBody(value, 'imapDeleteOptIn'));

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Email account payload ist ungueltig', { fields: errors }),
    };
  }
  return { ok: true, values };
}

function parseEmailMessageSpamStatusMutationBody(body: unknown): EmailMessageSpamStatusMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_email_message_spam_status_payload', 'Email message spam-status payload muss ein JSON-Objekt sein'),
    };
  }

  const values: EmailMessageSpamStatusMutationInput = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['status', 'train', 'source', 'featureKeys']);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'status')) {
    const status = normalizeSpamStatusBody(body.status);
    if (status.ok) values.status = status.value;
    else errors.push({ field: 'status', message: status.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'train')) {
    if (typeof body.train === 'boolean') values.train = body.train;
    else errors.push({ field: 'train', message: 'train muss true oder false sein' });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'source')) {
    const source = normalizeRequiredBodyText(body.source, 'source', 100);
    if (source.ok) values.source = source.value;
    else errors.push({ field: 'source', message: source.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'featureKeys')) {
    const featureKeys = normalizeNullableFeatureKeysBody(body.featureKeys);
    if (featureKeys.ok) values.featureKeys = featureKeys.value;
    else errors.push({ field: 'featureKeys', message: featureKeys.message });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Email message spam-status payload ist ungueltig', { fields: errors }),
    };
  }
  if (values.status === undefined) {
    return { ok: false, response: error(400, 'validation_error', 'status ist erforderlich') };
  }
  if (values.source === undefined) values.source = 'manual';
  if (values.train === undefined) values.train = true;

  return { ok: true, values };
}

function parseEmailMessageSpamDecisionMutationBody(body: unknown): EmailMessageSpamDecisionMutationParseResult {
  if (body === undefined || body === null) return { ok: true, values: { applyStatus: false } };
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_email_message_spam_decision_payload', 'Email message spam-decision payload muss ein JSON-Objekt sein'),
    };
  }

  const values: EmailMessageSpamDecisionMutationInput = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['applyStatus']);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'applyStatus')) {
    if (typeof body.applyStatus === 'boolean') values.applyStatus = body.applyStatus;
    else errors.push({ field: 'applyStatus', message: 'applyStatus muss true oder false sein' });
  }
  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Email message spam-decision payload ist ungueltig', { fields: errors }),
    };
  }
  if (values.applyStatus === undefined) values.applyStatus = false;
  return { ok: true, values };
}

function parseEmailMessageBulkMutationBody(
  body: unknown,
  flagName?: 'archived' | 'done',
): EmailMessageBulkMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_email_message_bulk_payload', 'Bulk-Payload muss ein JSON-Objekt sein'),
    };
  }

  const rawIds = body.messageIds;
  if (!Array.isArray(rawIds)) {
    return {
      ok: false,
      response: error(400, 'invalid_email_message_ids', 'messageIds muss ein Array sein'),
    };
  }
  if (rawIds.length > 500) {
    return {
      ok: false,
      response: error(400, 'invalid_email_message_ids', 'messageIds darf maximal 500 Eintraege enthalten'),
    };
  }

  const messageIds: number[] = [];
  for (const rawId of rawIds) {
    const id = positiveIntFromValue(rawId);
    if (id === null) {
      return {
        ok: false,
        response: error(400, 'invalid_email_message_ids', 'messageIds muss positive Ganzzahlen enthalten'),
      };
    }
    if (!messageIds.includes(id)) messageIds.push(id);
  }

  const accountId = body.accountId === undefined || body.accountId === null || body.accountId === ''
    ? undefined
    : positiveIntFromValue(body.accountId);
  if (accountId === null) {
    return {
      ok: false,
      response: error(400, 'invalid_account_id', 'accountId muss eine positive Ganzzahl sein'),
    };
  }

  if (flagName === undefined) {
    return {
      ok: true,
      messageIds,
      ...(accountId === undefined ? {} : { accountId }),
    };
  }

  const flag = body[flagName];
  if (typeof flag !== 'boolean') {
    return {
      ok: false,
      response: error(400, `invalid_${flagName}`, `${flagName} muss ein Boolean sein`),
    };
  }
  return {
    ok: true,
    messageIds,
    flag,
    ...(accountId === undefined ? {} : { accountId }),
  };
}

function parseEmailMessageBulkSpamStatusMutationBody(
  body: unknown,
): EmailMessageBulkSpamStatusMutationParseResult {
  const bulk = parseEmailMessageBulkMutationBody(body);
  if (!bulk.ok) return bulk;
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_email_message_bulk_payload', 'Bulk-Payload muss ein JSON-Objekt sein'),
    };
  }

  const valuesBody: Record<string, unknown> = {};
  const hasSource = Object.prototype.hasOwnProperty.call(body, 'source');
  for (const key of ['status', 'train', 'source', 'featureKeys']) {
    if (Object.prototype.hasOwnProperty.call(body, key)) valuesBody[key] = body[key];
  }
  const parsedValues = parseEmailMessageSpamStatusMutationBody(valuesBody);
  if (!parsedValues.ok) return parsedValues;
  return {
    ok: true,
    messageIds: bulk.messageIds,
    values: {
      ...parsedValues.values,
      source: hasSource ? parsedValues.values.source : 'bulk-manual',
    },
    ...(bulk.accountId === undefined ? {} : { accountId: bulk.accountId }),
  };
}

function parseEmailMessageSnoozeMutationBody(body: unknown): EmailMessageSnoozeMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_email_message_snooze_payload', 'Snooze-Payload muss ein JSON-Objekt sein'),
    };
  }
  if (body.until === null || body.until === undefined || body.until === '') return { ok: true, until: null };
  if (typeof body.until !== 'string') {
    return {
      ok: false,
      response: error(400, 'invalid_snooze_until', 'until muss ein ISO-Zeitpunkt oder null sein'),
    };
  }
  const until = body.until.trim();
  if (!until || until.length > 100 || Number.isNaN(Date.parse(until))) {
    return {
      ok: false,
      response: error(400, 'invalid_snooze_until', 'until muss ein gueltiger ISO-Zeitpunkt oder null sein'),
    };
  }
  return { ok: true, until };
}

function parseEmailMessageFlagMutationBody(
  body: unknown,
  flagName: 'archived' | 'seen' | 'done',
): EmailMessageFlagMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_email_message_flag_payload', 'Flag-Payload muss ein JSON-Objekt sein'),
    };
  }
  const errors: Array<{ field: string; message: string }> = [];
  for (const key of Object.keys(body)) {
    if (key !== flagName && !(flagName === 'seen' && key === 'syncToServer')) {
      errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
    }
  }
  if (typeof body[flagName] !== 'boolean') {
    errors.push({ field: flagName, message: `${flagName} muss true oder false sein` });
  }
  if (flagName === 'seen' && body.syncToServer !== undefined && typeof body.syncToServer !== 'boolean') {
    errors.push({ field: 'syncToServer', message: 'syncToServer muss true oder false sein' });
  }
  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Flag-Payload ist ungueltig', { fields: errors }),
    };
  }
  return {
    ok: true,
    flag: body[flagName] as boolean,
    ...(flagName === 'seen' && body.syncToServer !== undefined
      ? { syncToServer: body.syncToServer as boolean }
      : {}),
  };
}

function parseEmailMessageActionBody(body: unknown): EmailMessageActionParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_email_message_action_payload', 'Action-Payload muss ein JSON-Objekt sein'),
    };
  }
  const action = typeof body.action === 'string' ? body.action.trim() : '';
  if (!action) {
    return { ok: false, response: error(400, 'validation_error', 'action ist erforderlich') };
  }
  if (body.payload !== undefined && !isPlainObject(body.payload)) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'payload muss ein JSON-Objekt sein'),
    };
  }
  const payload = body.payload === undefined
    ? Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'action' && key !== 'payload'))
    : body.payload;
  return {
    ok: true,
    action,
    payload,
  };
}

function parseEmailMessageMoveMutationBody(body: unknown): EmailMessageMoveMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_email_message_move_payload', 'Move-Payload muss ein JSON-Objekt sein'),
    };
  }
  const errors: Array<{ field: string; message: string }> = [];
  for (const key of Object.keys(body)) {
    if (key !== 'view') errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }
  const rawView = body.view;
  if (typeof rawView !== 'string') {
    errors.push({ field: 'view', message: 'view ist erforderlich' });
    return {
      ok: false,
      response: error(400, 'validation_error', 'Move-Payload ist ungueltig', { fields: errors }),
    };
  }
  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Move-Payload ist ungueltig', { fields: errors }),
    };
  }
  const view = rawView.trim();
  if (view === 'inbox' || view === 'archived' || view === 'trash' || view === 'spam_review' || view === 'spam') {
    return { ok: true, view };
  }
  return {
    ok: false,
    response: error(
      409,
      'email_message_move_view_unsupported',
      'Diese Zielansicht ist keine gueltige Move-Aktion',
    ),
  };
}

function parseEmailInboxArchiveRecoveryBody(body: unknown): EmailInboxArchiveRecoveryParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_email_inbox_archive_recovery_payload', 'Inbox-Archive-Recovery-Payload muss ein JSON-Objekt sein'),
    };
  }

  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['expectedCount', 'confirmPhrase']);
  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }

  const expectedCount = normalizeNonNegativeBodyInt(body.expectedCount, 'expectedCount');
  if (!expectedCount.ok) errors.push({ field: 'expectedCount', message: expectedCount.message });

  const confirmPhrase = normalizeRequiredBodyText(body.confirmPhrase, 'confirmPhrase', 500);
  if (!confirmPhrase.ok) errors.push({ field: 'confirmPhrase', message: confirmPhrase.message });

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Inbox-Archive-Recovery-Payload ist ungueltig', { fields: errors }),
    };
  }
  return {
    ok: true,
    expectedCount: expectedCount.ok ? expectedCount.value : 0,
    confirmPhrase: confirmPhrase.ok ? confirmPhrase.value : '',
  };
}

function parseEmailRemoteContentPolicyMutationBody(body: unknown): EmailRemoteContentPolicyMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_email_remote_content_payload', 'Remote-content payload muss ein JSON-Objekt sein'),
    };
  }
  const values: Partial<EmailRemoteContentPolicyMutationInput> = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['policy', 'rememberSender', 'rememberDomain']);
  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }
  const policy = normalizeRemoteContentPolicyBody(body.policy);
  if (policy.ok) values.policy = policy.value;
  else errors.push({ field: 'policy', message: policy.message });
  if (Object.prototype.hasOwnProperty.call(body, 'rememberSender')) {
    if (typeof body.rememberSender === 'boolean') values.rememberSender = body.rememberSender;
    else errors.push({ field: 'rememberSender', message: 'rememberSender muss true oder false sein' });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'rememberDomain')) {
    if (typeof body.rememberDomain === 'boolean') values.rememberDomain = body.rememberDomain;
    else errors.push({ field: 'rememberDomain', message: 'rememberDomain muss true oder false sein' });
  }
  if (values.rememberSender === true && values.rememberDomain === true) {
    errors.push({ field: 'rememberDomain', message: 'rememberSender und rememberDomain duerfen nicht gleichzeitig true sein' });
  }
  if (errors.length > 0 || values.policy === undefined) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Remote-content payload ist ungueltig', { fields: errors }),
    };
  }
  return { ok: true, values: values as EmailRemoteContentPolicyMutationInput };
}

function parseEmailReadReceiptResponseBody(body: unknown): EmailReadReceiptResponseParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_email_read_receipt_response_payload', 'Read-receipt response payload muss ein JSON-Objekt sein'),
    };
  }

  const errors: Array<{ field: string; message: string }> = [];
  for (const key of Object.keys(body)) {
    if (key !== 'action') errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }

  const rawAction = body.action;
  if (typeof rawAction !== 'string') {
    errors.push({ field: 'action', message: 'action ist erforderlich' });
  } else {
    const action = rawAction.trim();
    if (action !== 'send' && action !== 'decline') {
      errors.push({ field: 'action', message: 'action muss send oder decline sein' });
    }
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Read-receipt response payload ist ungueltig', { fields: errors }),
    };
  }

  return { ok: true, action: (rawAction as string).trim() as EmailReadReceiptRespondAction };
}

function parseEmailReplySuggestionEnsureBody(body: unknown): EmailReplySuggestionEnsureParseResult {
  if (body === undefined || body === null) return { ok: true };
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_reply_suggestion_payload', 'Reply suggestion payload muss ein JSON-Objekt sein'),
    };
  }
  const result: { force?: boolean; trigger?: EmailReplySuggestionTrigger } = {};
  if (Object.prototype.hasOwnProperty.call(body, 'force')) {
    const force = normalizeBooleanBody(body.force, 'force');
    if (!force.ok) {
      return {
        ok: false,
        response: error(400, 'invalid_reply_suggestion_force', force.message),
      };
    }
    result.force = force.value;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'trigger')) {
    if (body.trigger !== 'inbound' && body.trigger !== 'open') {
      return {
        ok: false,
        response: error(400, 'invalid_reply_suggestion_trigger', 'trigger muss inbound oder open sein'),
      };
    }
    result.trigger = body.trigger;
  }
  return { ok: true, ...result };
}

function parseEmailReplyDraftGenerateBody(body: unknown): EmailReplyDraftGenerateParseResult {
  if (body === undefined || body === null) return { ok: true };
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_reply_draft_payload', 'Reply draft payload muss ein JSON-Objekt sein'),
    };
  }
  const result: {
    promptId?: number;
    profileId?: number;
    customerId?: number | null;
    userContext?: string;
    persistSuggestion?: boolean;
  } = {};
  if (Object.prototype.hasOwnProperty.call(body, 'promptId')) {
    const promptId = normalizePositiveBodyInt(body.promptId, 'promptId');
    if (!promptId.ok) return { ok: false, response: error(400, 'invalid_prompt_id', promptId.message) };
    result.promptId = promptId.value;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'profileId')) {
    const profileId = normalizePositiveBodyInt(body.profileId, 'profileId');
    if (!profileId.ok) return { ok: false, response: error(400, 'invalid_profile_id', profileId.message) };
    result.profileId = profileId.value;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'customerId')) {
    const customerId = normalizeNullablePositiveBodyInt(body.customerId, 'customerId');
    if (!customerId.ok) return { ok: false, response: error(400, 'invalid_customer_id', customerId.message) };
    result.customerId = customerId.value;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'userContext')) {
    const userContext = normalizeRequiredBodyText(body.userContext, 'userContext', 4000);
    if (!userContext.ok) return { ok: false, response: error(400, 'invalid_user_context', userContext.message) };
    result.userContext = userContext.value;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'persistSuggestion')) {
    if (typeof body.persistSuggestion !== 'boolean') {
      return {
        ok: false,
        response: error(400, 'invalid_persist_suggestion', 'persistSuggestion muss ein Boolean sein'),
      };
    }
    result.persistSuggestion = body.persistSuggestion;
  }
  return { ok: true, ...result };
}

function parseEmailMessageCustomerLinkMutationBody(body: unknown): EmailMessageCustomerLinkMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_email_message_customer_link_payload', 'Customer-Link-Payload muss ein JSON-Objekt sein'),
    };
  }
  const errors: Array<{ field: string; message: string }> = [];
  for (const key of Object.keys(body)) {
    if (key !== 'customerId') errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }
  const rawCustomerId = body.customerId;
  let customerId: number | null = null;
  if (rawCustomerId !== null) {
    const parsed = positiveIntFromValue(rawCustomerId);
    if (parsed === null) errors.push({ field: 'customerId', message: 'customerId muss eine positive Ganzzahl oder null sein' });
    else customerId = parsed;
  }
  if (!Object.prototype.hasOwnProperty.call(body, 'customerId')) {
    errors.push({ field: 'customerId', message: 'customerId ist erforderlich' });
  }
  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Customer-Link-Payload ist ungueltig', { fields: errors }),
    };
  }
  return { ok: true, customerId };
}

function parseEmailMessageCustomerBackfillBody(body: unknown): EmailMessageCustomerBackfillParseResult {
  if (body === undefined || body === null) return { ok: true };
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_email_customer_backfill_payload', 'Customer-Link-Backfill-Payload muss ein JSON-Objekt sein'),
    };
  }
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['accountId', 'limit']);
  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }
  let accountId: number | undefined;
  if (body.accountId !== undefined && body.accountId !== null && body.accountId !== '') {
    const parsedAccountId = positiveIntFromValue(body.accountId);
    if (parsedAccountId === null) errors.push({ field: 'accountId', message: 'accountId muss eine positive Ganzzahl sein' });
    else accountId = parsedAccountId;
  }
  let limit: number | undefined;
  if (body.limit !== undefined && body.limit !== null && body.limit !== '') {
    const parsedLimit = positiveIntFromValue(body.limit);
    if (parsedLimit === null) errors.push({ field: 'limit', message: 'limit muss eine positive Ganzzahl sein' });
    else limit = parsedLimit;
  }
  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Customer-Link-Backfill-Payload ist ungueltig', { fields: errors }),
    };
  }
  return {
    ok: true,
    ...(accountId === undefined ? {} : { accountId }),
    ...(limit === undefined ? {} : { limit }),
  };
}

function parseEmailMessageAssignmentMutationBody(body: unknown): EmailMessageAssignmentMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_email_message_assignment_payload', 'Assignment-Payload muss ein JSON-Objekt sein'),
    };
  }
  const errors: Array<{ field: string; message: string }> = [];
  for (const key of Object.keys(body)) {
    if (key !== 'teamMemberId') errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }
  const rawTeamMemberId = body.teamMemberId;
  let teamMemberId: string | null = null;
  if (rawTeamMemberId !== null) {
    const parsed = normalizeRequiredBodyText(rawTeamMemberId, 'teamMemberId', 200);
    if (parsed.ok) teamMemberId = parsed.value;
    else errors.push({ field: 'teamMemberId', message: parsed.message });
  }
  if (!Object.prototype.hasOwnProperty.call(body, 'teamMemberId')) {
    errors.push({ field: 'teamMemberId', message: 'teamMemberId ist erforderlich' });
  }
  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Assignment-Payload ist ungueltig', { fields: errors }),
    };
  }
  return { ok: true, teamMemberId };
}

function emailMessageMetadataMutationError(reason: 'not_found' | 'customer_not_found' | 'team_member_not_found'): ApiResponse<ApiErrorBody> {
  if (reason === 'customer_not_found') {
    return error(409, 'customer_not_found', 'Kunde nicht gefunden');
  }
  if (reason === 'team_member_not_found') {
    return error(409, 'email_team_member_not_found', 'Teammitglied nicht gefunden');
  }
  return error(404, 'email_message_not_found', 'Email message nicht gefunden');
}

function parseMailConnectionTestBody(
  body: unknown,
  protocol: 'imap' | 'pop3' | 'smtp',
): MailConnectionTestParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_mail_connection_test_payload', 'Mail connection test payload muss ein JSON-Objekt sein'),
    };
  }

  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = protocol === 'imap'
    ? new Set(['accountId', 'imapHost', 'imapPort', 'imapTls', 'imapUsername', 'imapPassword'])
    : protocol === 'pop3'
      ? new Set(['accountId', 'host', 'port', 'tls', 'user', 'password'])
      : new Set(['accountId', 'host', 'port', 'secure', 'user', 'password', 'smtpUseImapAuth']);
  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }

  const values: Partial<Omit<MailConnectionTestInput, 'workspaceId'>> = {};
  if (body.accountId !== undefined) {
    const accountId = normalizePositiveBodyInt(body.accountId, 'accountId');
    if (accountId.ok) values.accountId = accountId.value;
    else errors.push({ field: 'accountId', message: accountId.message });
  }

  const hostField = protocol === 'imap' ? 'imapHost' : 'host';
  const portField = protocol === 'imap' ? 'imapPort' : 'port';
  const tlsField = protocol === 'imap' ? 'imapTls' : protocol === 'pop3' ? 'tls' : 'secure';
  const userField = protocol === 'imap' ? 'imapUsername' : 'user';
  const passwordField = protocol === 'imap' ? 'imapPassword' : 'password';

  const host = normalizeRequiredBodyText(body[hostField], hostField, 500);
  if (host.ok) values.host = host.value;
  else errors.push({ field: hostField, message: host.message });

  const port = normalizePortBody(body[portField], portField);
  if (port.ok) values.port = port.value;
  else errors.push({ field: portField, message: port.message });

  const tls = normalizeBooleanBody(body[tlsField], tlsField);
  if (tls.ok) values.tls = tls.value;
  else errors.push({ field: tlsField, message: tls.message });

  const user = normalizeRequiredBodyText(body[userField], userField, 500);
  if (user.ok) values.user = user.value;
  else errors.push({ field: userField, message: user.message });

  const password = normalizePasswordBody(body[passwordField]);
  if (password.ok) values.password = password.value;
  else errors.push({ field: passwordField, message: password.message });

  if (protocol === 'smtp' && body.smtpUseImapAuth !== undefined) {
    const smtpUseImapAuth = normalizeBooleanBody(body.smtpUseImapAuth, 'smtpUseImapAuth');
    if (smtpUseImapAuth.ok) values.smtpUseImapAuth = smtpUseImapAuth.value;
    else errors.push({ field: 'smtpUseImapAuth', message: smtpUseImapAuth.message });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Mail connection test payload ist ungueltig', { fields: errors }),
    };
  }
  return { ok: true, values: values as Omit<MailConnectionTestInput, 'workspaceId'> };
}

function normalizeSpamStatusBody(rawValue: unknown): { ok: true; value: 'clean' | 'review' | 'spam' } | { ok: false; message: string } {
  if (typeof rawValue !== 'string') return { ok: false, message: 'status muss clean, review oder spam sein' };
  const value = rawValue.trim();
  return value === 'clean' || value === 'review' || value === 'spam'
    ? { ok: true, value }
    : { ok: false, message: 'status muss clean, review oder spam sein' };
}

function normalizeRequiredBodyText(
  rawValue: unknown,
  field: string,
  maxLength: number,
): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof rawValue !== 'string') return { ok: false, message: `${field} muss ein String sein` };
  const value = rawValue.trim();
  if (!value) return { ok: false, message: `${field} darf nicht leer sein` };
  if (value.length > maxLength) return { ok: false, message: `${field} darf maximal ${maxLength} Zeichen haben` };
  return { ok: true, value };
}

function normalizeEmailAddressBody(rawValue: unknown): { ok: true; value: string } | { ok: false; message: string } {
  const parsed = normalizeRequiredBodyText(rawValue, 'emailAddress', 320);
  if (!parsed.ok) return parsed;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.value)) {
    return { ok: false, message: 'emailAddress muss eine gueltige E-Mail-Adresse sein' };
  }
  return parsed;
}

function normalizeNullableBodyText(
  rawValue: unknown,
  field: string,
  maxLength: number,
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (rawValue === null) return { ok: true, value: null };
  if (typeof rawValue !== 'string') return { ok: false, message: `${field} muss ein String oder null sein` };
  const value = rawValue.trim();
  if (!value) return { ok: true, value: null };
  if (value.length > maxLength) return { ok: false, message: `${field} darf maximal ${maxLength} Zeichen haben` };
  return { ok: true, value };
}

function normalizePasswordBody(rawValue: unknown): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof rawValue !== 'string') return { ok: false, message: 'password muss ein String sein' };
  if (rawValue.length > 10000) return { ok: false, message: 'password darf maximal 10000 Zeichen haben' };
  return { ok: true, value: rawValue };
}

function normalizeBooleanBody(rawValue: unknown, field: string): { ok: true; value: boolean } | { ok: false; message: string } {
  return typeof rawValue === 'boolean'
    ? { ok: true, value: rawValue }
    : { ok: false, message: `${field} muss true oder false sein` };
}

function normalizePositiveBodyInt(rawValue: unknown, field: string): { ok: true; value: number } | { ok: false; message: string } {
  const value = positiveIntFromValue(rawValue);
  return value === null
    ? { ok: false, message: `${field} muss eine positive Ganzzahl sein` }
    : { ok: true, value };
}

function normalizeNonNegativeBodyInt(rawValue: unknown, field: string): { ok: true; value: number } | { ok: false; message: string } {
  const value = typeof rawValue === 'number' && Number.isInteger(rawValue) && rawValue >= 0
    ? rawValue
    : null;
  return value === null
    ? { ok: false, message: `${field} muss eine nicht-negative Ganzzahl sein` }
    : { ok: true, value };
}

function normalizePortBody(rawValue: unknown, field: string): { ok: true; value: number } | { ok: false; message: string } {
  const value = positiveIntFromValue(rawValue);
  return value === null || value > 65535
    ? { ok: false, message: `${field} muss eine positive Ganzzahl zwischen 1 und 65535 sein` }
    : { ok: true, value };
}

function normalizeNullablePositiveBodyInt(rawValue: unknown, field: string): { ok: true; value: number | null } | { ok: false; message: string } {
  if (rawValue === null || rawValue === '') return { ok: true, value: null };
  const value = positiveIntFromValue(rawValue);
  return value === null
    ? { ok: false, message: `${field} muss eine positive Ganzzahl oder null sein` }
    : { ok: true, value };
}

function normalizeProtocolBody(rawValue: unknown): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof rawValue !== 'string') return { ok: false, message: 'protocol muss imap oder pop3 sein' };
  const value = rawValue.trim();
  return value === 'imap' || value === 'pop3'
    ? { ok: true, value }
    : { ok: false, message: 'protocol muss imap oder pop3 sein' };
}

function normalizeRemoteContentPolicyBody(
  rawValue: unknown,
): { ok: true; value: EmailRemoteContentPolicy } | { ok: false; message: string } {
  if (typeof rawValue !== 'string') {
    return { ok: false, message: 'policy muss blocked, allowed_once, allowed_sender oder allowed_domain sein' };
  }
  const value = rawValue.trim();
  if (
    value === 'blocked'
    || value === 'allowed_once'
    || value === 'allowed_sender'
    || value === 'allowed_domain'
  ) {
    return { ok: true, value };
  }
  return { ok: false, message: 'policy muss blocked, allowed_once, allowed_sender oder allowed_domain sein' };
}

function assignParsed<K extends keyof EmailAccountMutationInput>(
  values: EmailAccountMutationInput,
  errors: Array<{ field: string; message: string }>,
  body: Record<string, unknown>,
  field: K,
  normalize: (value: unknown) => { ok: true; value: EmailAccountMutationInput[K] } | { ok: false; message: string },
): void {
  if (!Object.prototype.hasOwnProperty.call(body, field)) return;
  const result = normalize(body[field as string]);
  if (result.ok) values[field] = result.value;
  else errors.push({ field: String(field), message: result.message });
}

function normalizeNullableFeatureKeysBody(
  rawValue: unknown,
): { ok: true; value: readonly string[] | null } | { ok: false; message: string } {
  if (rawValue === null) return { ok: true, value: null };
  if (!Array.isArray(rawValue)) return { ok: false, message: 'featureKeys muss ein Array aus Strings oder null sein' };
  const normalized: string[] = [];
  for (const item of rawValue) {
    if (typeof item !== 'string') return { ok: false, message: 'featureKeys muss ein Array aus Strings oder null sein' };
    const value = item.trim();
    if (!value) return { ok: false, message: 'featureKeys darf keine leeren Eintraege enthalten' };
    if (value.length > 300) return { ok: false, message: 'featureKeys-Eintraege duerfen maximal 300 Zeichen haben' };
    if (!normalized.includes(value)) normalized.push(value);
  }
  if (normalized.length > 200) return { ok: false, message: 'featureKeys darf maximal 200 Eintraege enthalten' };
  return { ok: true, value: normalized };
}

function parseLimit(value: string | undefined): number | null {
  if (value === undefined || value === '') return DEFAULT_MESSAGE_LIMIT;
  const limit = parsePositiveInt(value);
  if (limit === null || limit > MAX_MESSAGE_LIMIT) return null;
  return limit;
}

function parseOptionalPositiveInt(value: string | undefined): number | undefined | null {
  if (value === undefined || value === '') return undefined;
  return parsePositiveInt(value);
}

function parseOptionalNonNegativeInt(value: string | undefined): number | undefined | null {
  if (value === undefined || value === '') return undefined;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parsePositiveInt(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function positiveIntFromValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value === 'string') return parsePositiveInt(value.trim());
  return null;
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined | null {
  if (value === undefined || value === '') return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function normalizeTextFilter(value: string | undefined, maxLength: number): string | undefined | null {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > maxLength) return null;
  return normalized;
}

function textIdFromPath(value: string | undefined, maxLength: number): string | null {
  if (!value) return null;
  try {
    const decoded = decodeURIComponent(value).trim();
    if (!decoded || decoded.length > maxLength) return null;
    return decoded;
  } catch {
    return null;
  }
}

function parseOptionalMessageView(value: string | undefined) {
  if (value === undefined || value === '') return undefined;
  return isOneOf(value, ['inbox', 'sent', 'archived', 'drafts', 'scheduled_send', 'spam_review', 'spam', 'trash', 'snoozed', 'all'])
    ? value
    : null;
}

function parseOptionalMessageSort(value: string | undefined) {
  if (value === undefined || value === '') return undefined;
  return isOneOf(value, ['date_desc', 'date_asc', 'priority', 'relevance']) ? value : null;
}

function parseOptionalMessageListFilter(value: string | undefined) {
  if (value === undefined || value === '') return undefined;
  return isOneOf(value, ['all', 'unread', 'attachment', 'customer', 'workflow']) ? value : null;
}

function parseOptionalMessageDoneFilter(value: string | undefined) {
  if (value === undefined || value === '') return undefined;
  return isOneOf(value, ['all', 'open', 'done']) ? value : null;
}

function isOneOf<const T extends readonly string[]>(value: string, allowed: T): value is T[number] {
  return (allowed as readonly string[]).includes(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function attachmentDisposition(filename: string): string {
  const fallback = filename.replace(/[\\/\r\n"]/g, '_').trim() || 'attachment';
  const ascii = fallback.replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fallback)}`;
}
