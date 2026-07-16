import { z } from 'zod';
import { IPCChannels, InvokeChannel } from './channels';
import { messageListFilterSchema } from '../email-list-filters';
import { messageDoneFilterSchema } from '../email-done-filter';
import { messageSearchScopeSchema } from '../email-search-scope';
import { compileWorkflowGraphPayloadSchema } from './workflow-graph-schema';

type SchemaEntry = {
  payload: z.ZodTypeAny;
  result: z.ZodTypeAny;
};

const voidPayload = z.undefined();
const positiveInt = z.number().int().positive();
const nonEmptyString = z.string().min(1);

const successResult = z.object({ success: z.literal(true) }).passthrough();
const failResult = z.object({ success: z.literal(false), error: z.string().optional() });
const standardResult = z.union([successResult, failResult]);

const mailAccountScopeSchema = z.union([z.literal('all'), positiveInt]);
const accountOverrideMutationFields = {
  accountId: z.number().int().positive().nullable().optional(),
  overrideKey: z.string().max(120).nullable().optional(),
};
const accountOverrideScopePayloadSchema = z
  .union([
    mailAccountScopeSchema,
    z.object({
      accountId: mailAccountScopeSchema.optional(),
      accountScope: mailAccountScopeSchema.optional(),
    }),
  ])
  .optional();
const accountMailViewSchema = z.enum([
  'inbox',
  'sent',
  'archived',
  'drafts',
  'scheduled_send',
  'spam_review',
  'spam',
  'trash',
  'snoozed',
  'all',
]);

const recordArray = z.array(z.record(z.string(), z.unknown()));
const nullableRecord = z.record(z.string(), z.unknown()).nullable();
const conversationLockReason = z.enum(['reply', 'forward', 'edit']);
const conversationLockRecord = z.object({
  messageId: positiveInt,
  userId: nonEmptyString,
  workspaceId: nonEmptyString,
  acquiredAt: nonEmptyString,
  lastHeartbeatAt: nonEmptyString,
  reason: conversationLockReason,
  takeoverCount: z.number().int().nonnegative(),
  displayName: z.string().optional(),
  email: z.string().optional(),
}).passthrough();

/** Register Zod payload/result schemas for every `IPCChannels.Email` invoke channel. */
export function applyEmailIpcSchemas(map: Map<InvokeChannel, SchemaEntry>): void {
  const set = (channel: InvokeChannel, entry: SchemaEntry) => {
    map.set(channel, entry);
  };

  // --- Accounts & sync ---
  set(IPCChannels.Email.ListAccounts, { payload: voidPayload, result: recordArray });
  set(IPCChannels.Email.CreateAccount, {
    payload: z.object({
      displayName: nonEmptyString,
      emailAddress: z.string().email(),
      imapHost: nonEmptyString,
      imapPort: z.number().int().positive(),
      imapTls: z.boolean(),
      imapUsername: nonEmptyString,
      imapPassword: z.string(),
      protocol: z.enum(['imap', 'pop3']).optional(),
      pop3Host: z.string().nullable().optional(),
      pop3Port: z.number().int().positive().optional(),
      pop3Tls: z.boolean().optional(),
      imapSyncSeenOnOpen: z.boolean().optional(),
    }),
    result: z.union([
      z.object({ success: z.literal(true), id: positiveInt }),
      failResult,
    ]),
  });
  set(IPCChannels.Email.UpdateAccount, {
    payload: z
      .object({
        id: positiveInt,
        displayName: z.string().optional(),
        emailAddress: z.string().email().optional(),
        imapHost: z.string().optional(),
        imapPort: z.number().int().positive().optional(),
        imapTls: z.boolean().optional(),
        imapUsername: z.string().optional(),
        imapPassword: z.string().optional(),
        smtpHost: z.string().nullable().optional(),
        smtpPort: z.number().int().positive().nullable().optional(),
        smtpTls: z.boolean().nullable().optional(),
        smtpUsername: z.string().nullable().optional(),
        smtpUseImapAuth: z.boolean().optional(),
        smtpPassword: z.string().optional(),
        protocol: z.enum(['imap', 'pop3']).optional(),
        pop3Host: z.string().nullable().optional(),
        pop3Port: z.number().int().positive().nullable().optional(),
        pop3Tls: z.boolean().nullable().optional(),
        sentFolderPath: z.string().nullable().optional(),
        syncSpamFolderPath: z.string().nullable().optional(),
        syncArchiveFolderPath: z.string().nullable().optional(),
        imapSyncSent: z.boolean().optional(),
        imapSyncArchive: z.boolean().optional(),
        imapSyncSpam: z.boolean().optional(),
        imapSyncSeenOnOpen: z.boolean().optional(),
        vacationEnabled: z.boolean().optional(),
        vacationSubject: z.string().nullable().optional(),
        vacationBodyText: z.string().nullable().optional(),
        requestReadReceipt: z.boolean().optional(),
        imapDeleteOptIn: z.boolean().optional(),
      })
      .passthrough(),
    result: standardResult,
  });
  set(IPCChannels.Email.DeleteAccount, { payload: positiveInt, result: standardResult });
  set(IPCChannels.Email.TestImap, {
    payload: z.object({
      accountId: positiveInt.optional(),
      imapHost: nonEmptyString,
      imapPort: z.number().int().positive(),
      imapTls: z.boolean(),
      imapUsername: nonEmptyString,
      imapPassword: z.string(),
    }),
    result: standardResult,
  });
  set(IPCChannels.Email.SyncAccount, {
    payload: positiveInt,
    result: z.union([
      z
        .object({
          success: z.literal(true),
          fetched: z.number().int().nonnegative().optional(),
          folderId: z.number().int().optional(),
          lastUid: z.number().int().optional(),
        })
        .passthrough(),
      failResult,
    ]),
  });
  set(IPCChannels.Email.ImportFullInbox, {
    payload: positiveInt,
    result: z.union([
      z.object({ success: z.literal(true) }).passthrough(),
      failResult,
    ]),
  });
  set(IPCChannels.Email.TestPop3, {
    payload: z
      .object({
        accountId: positiveInt.optional(),
        host: nonEmptyString,
        port: z.number().int().positive(),
        tls: z.boolean(),
        user: nonEmptyString,
        password: z.string(),
      })
      .passthrough(),
    result: standardResult,
  });
  set(IPCChannels.Email.TestSmtp, {
    payload: z.object({
      accountId: positiveInt.optional(),
      host: nonEmptyString,
      port: z.number().int().positive(),
      secure: z.boolean(),
      user: nonEmptyString,
      password: z.string().optional(),
      smtpUseImapAuth: z.boolean().optional(),
    }),
    result: standardResult,
  });

  // --- Messages ---
  set(IPCChannels.Email.ListMessages, {
    payload: z.object({
      accountId: positiveInt,
      folderPath: z.string().optional(),
      limit: z.number().int().positive().optional(),
      offset: z.number().int().nonnegative().optional(),
    }),
    result: recordArray,
  });
  set(IPCChannels.Email.GetMessage, { payload: positiveInt, result: nullableRecord });
  set(IPCChannels.Email.SnoozeMessage, {
    payload: z.object({
      messageId: positiveInt,
      until: z.string().nullable(),
    }),
    result: standardResult,
  });
  set(IPCChannels.Email.ScheduleDraftSend, {
    payload: z.object({
      messageId: positiveInt,
      sendAt: z.string().nullable(),
    }),
    result: standardResult,
  });
  set(IPCChannels.Email.GetScheduledSendDraftState, {
    payload: positiveInt,
    result: z.object({
      success: z.literal(true),
      failureCount: z.number().int().nonnegative(),
      status: z.enum(['ok', 'pending', 'failed']),
      lastError: z.string().nullable(),
    }),
  });
  set(IPCChannels.Email.ClearScheduledSendDraftFailure, {
    payload: positiveInt,
    result: standardResult,
  });
  set(IPCChannels.Email.RetryScheduledSendDraft, {
    payload: positiveInt,
    result: standardResult,
  });
  set(IPCChannels.Email.GetComposeDraftRecoveryState, {
    payload: positiveInt,
    result: z.object({
      success: z.literal(true),
      smtpCommitted: z.boolean(),
      needsResendFinalize: z.boolean(),
    }),
  });
  set(IPCChannels.Email.TestVacationAutoReply, {
    payload: positiveInt,
    result: z.union([
      z.object({ success: z.literal(true) }),
      z.object({ success: z.literal(false), error: z.string() }),
    ]),
  });
  set(IPCChannels.Email.ExportMessageEml, {
    payload: positiveInt,
    result: z.union([
      z.object({ success: z.literal(true), path: z.string() }),
      failResult,
    ]),
  });
  set(IPCChannels.Email.BackfillCustomerLinks, {
    payload: z
      .object({
        accountId: positiveInt.optional(),
        limit: z.number().int().positive().optional(),
      })
      .optional(),
    result: z.object({ success: z.literal(true), count: z.number().int().nonnegative() }),
  });
  set(IPCChannels.Email.BackfillThreads, {
    payload: z
      .object({
        limit: z.number().int().positive().optional(),
      })
      .optional(),
    result: z.object({
      success: z.boolean(),
      scanned: z.number().int().nonnegative(),
      threaded: z.number().int().nonnegative(),
    }),
  });
  set(IPCChannels.Email.FireWebhookWorkflow, {
    payload: z.object({
      secret: z.string(),
      body: z.record(z.string(), z.unknown()).optional(),
    }),
    result: z.union([
      z.object({ success: z.literal(true), fired: z.number().int().nonnegative() }),
      z.object({ success: z.literal(false), error: z.string(), fired: z.number().optional() }),
    ]),
  });
  set(IPCChannels.Email.ClearAccountSyncLock, {
    payload: positiveInt,
    result: standardResult,
  });
  set(IPCChannels.Email.GetEmailMiscSettings, {
    payload: voidPayload,
    result: z.object({
      webhookSecret: z.string(),
      maxAttachmentMb: z.string(),
    }),
  });
  set(IPCChannels.Email.SetEmailMiscSettings, {
    payload: z.object({
      webhookSecret: z.string().optional(),
      maxAttachmentMb: z.number().int().positive().optional(),
    }),
    result: standardResult,
  });

  const snoozeSettingsShape = z.object({
    eveningHour: z.number().int().min(0).max(23),
    eveningMinute: z.number().int().min(0).max(59),
    morningHour: z.number().int().min(0).max(23),
    morningMinute: z.number().int().min(0).max(59),
    nextWeekWeekday: z.number().int().min(0).max(6),
    nextWeekHour: z.number().int().min(0).max(23),
    nextWeekMinute: z.number().int().min(0).max(59),
  });
  set(IPCChannels.Email.GetSnoozeSettings, {
    payload: voidPayload,
    result: snoozeSettingsShape,
  });
  set(IPCChannels.Email.SetSnoozeSettings, {
    payload: snoozeSettingsShape,
    result: standardResult,
  });

  const accountMailSettingsSchema = z.object({
    accountId: positiveInt,
    ticketPrefix: z.string().min(1).max(12),
    ticketNextNumber: z.number().int().min(1),
    ticketNumberPadding: z.number().int().min(1).max(12),
    threadNamespace: z.string().min(1).max(64),
  });
  const accountMailSettingsQuerySchema = z.object({ accountId: positiveInt });
  const accountMailSettingsSetSchema = accountMailSettingsSchema.partial().extend({
    accountId: positiveInt,
  });
  set(IPCChannels.Email.GetAccountMailSettings, {
    payload: accountMailSettingsQuerySchema,
    result: accountMailSettingsSchema,
  });
  set(IPCChannels.Email.SetAccountMailSettings, {
    payload: accountMailSettingsSetSchema,
    result: accountMailSettingsSchema,
  });

  set(IPCChannels.Email.ListUidValidityNotices, {
    payload: voidPayload,
    result: z.array(
      z.object({
        id: z.string(),
        accountId: z.number(),
        folderPath: z.string(),
        oldValidity: z.string().nullable(),
        newValidity: z.string().nullable(),
        messageCount: z.number(),
        backedUpCount: z.number(),
        at: z.string(),
      }),
    ),
  });
  set(IPCChannels.Email.DismissUidValidityNotice, {
    payload: z.object({ noticeId: z.string().min(1) }),
    result: standardResult,
  });
  set(IPCChannels.Email.ListImapAuthNotices, {
    payload: voidPayload,
    result: z.array(
      z.object({
        accountId: z.number(),
        message: z.string(),
        at: z.string(),
      }),
    ),
  });
  set(IPCChannels.Email.DismissImapAuthNotice, {
    payload: z.object({ accountId: z.number().int().positive() }),
    result: standardResult,
  });
  set(IPCChannels.Email.GetLatestWorkflowRunForMessage, {
    payload: z.object({ messageId: positiveInt }),
    result: z
      .object({
        id: positiveInt,
        workflow_id: positiveInt,
        status: z.string(),
        started_at: z.string().nullable(),
        finished_at: z.string().nullable(),
      })
      .nullable(),
  });
  set(IPCChannels.Email.GetMailDiagnostics, {
    payload: voidPayload,
    result: z.object({}).passthrough(),
  });
  set(IPCChannels.Email.RetryMessagePostProcess, {
    payload: positiveInt,
    result: standardResult,
  });
  set(IPCChannels.Email.ExportLocalMailBackup, {
    payload: voidPayload,
    result: z.union([
      z.object({ ok: z.literal(true), path: z.string() }),
      z.object({ ok: z.literal(false), error: z.string() }),
    ]),
  });
  set(IPCChannels.Email.VerifyLocalMailBackup, {
    payload: voidPayload,
    result: z.union([
      z.object({
        ok: z.literal(true),
        path: z.string(),
        schemaGeneration: z.number().optional(),
        schemaGenerationLabel: z.string().optional(),
        exportedAt: z.string().optional(),
        hasDatabase: z.boolean(),
        hasAttachments: z.boolean(),
      }),
      z.object({ ok: z.literal(false), error: z.string() }),
    ]),
  });
  set(IPCChannels.Email.PickLocalMailBackupZip, {
    payload: voidPayload,
    result: z.union([
      z.object({ ok: z.literal(true), path: z.string() }),
      z.object({ ok: z.literal(false), error: z.string() }),
    ]),
  });
  set(IPCChannels.Email.PreviewRestoreLocalMailBackup, {
    payload: z.object({ zipPath: z.string().min(1) }),
    result: z.union([
      z.object({
        ok: z.literal(true),
        path: z.string(),
        previewToken: z.string(),
        schemaGeneration: z.number().optional(),
        schemaGenerationLabel: z.string().optional(),
        currentSchemaGeneration: z.number(),
        exportedAt: z.string().optional(),
        hasAttachments: z.boolean(),
        accountEmails: z.array(z.string()),
        warnings: z.array(z.string()),
      }),
      z.object({ ok: z.literal(false), error: z.string() }),
    ]),
  });
  set(IPCChannels.Email.RestoreLocalMailBackup, {
    payload: z.object({
      zipPath: z.string().min(1),
      previewToken: z.string().min(1),
      confirmPhrase: z.string().min(1),
      createPreBackup: z.boolean(),
    }),
    result: z.union([
      z.object({ ok: z.literal(true), preBackupPath: z.string().optional() }),
      z.object({ ok: z.literal(false), error: z.string() }),
    ]),
  });
  set(IPCChannels.Email.ListMessagesByView, {
    payload: z.object({
      accountId: mailAccountScopeSchema,
      view: accountMailViewSchema,
      limit: z.number().int().positive().optional(),
      offset: z.number().int().nonnegative().optional(),
      categoryId: z.number().int().positive().nullable().optional(),
      sort: z.enum(['date_desc', 'date_asc', 'priority']).optional(),
      listFilter: messageListFilterSchema.optional(),
      doneFilter: messageDoneFilterSchema.optional(),
    }),
    result: recordArray,
  });
  set(IPCChannels.Email.ListMessageIdsByView, {
    payload: z.object({
      accountId: mailAccountScopeSchema,
      view: accountMailViewSchema,
      limit: z.number().int().positive().max(500).optional(),
      offset: z.number().int().nonnegative().optional(),
      categoryId: z.number().int().positive().nullable().optional(),
      listFilter: messageListFilterSchema.optional(),
      doneFilter: messageDoneFilterSchema.optional(),
    }),
    result: z.array(positiveInt),
  });
  set(IPCChannels.Email.SetMessageDone, {
    payload: z.object({
      messageId: positiveInt,
      done: z.boolean(),
    }),
    result: standardResult,
  });
  set(IPCChannels.Email.SearchMessages, {
    payload: z.object({
      accountId: mailAccountScopeSchema,
      query: z.string(),
      limit: z.number().int().positive().optional(),
      offset: z.number().int().nonnegative().optional(),
      view: accountMailViewSchema.optional(),
      categoryId: z.number().int().positive().nullable().optional(),
      doneFilter: messageDoneFilterSchema.optional(),
      scope: messageSearchScopeSchema.optional(),
      sort: z.enum(['date', 'relevance']).optional(),
    }),
    result: z.object({
      messages: recordArray,
      searchMode: z.enum(['fts', 'like', 'regex']),
      hasMore: z.boolean().optional(),
    }),
  });
  set(IPCChannels.Email.ListConversationMessages, {
    payload: z.object({
      accountId: mailAccountScopeSchema,
      messageId: positiveInt,
      ticketCode: z.string().nullable().optional(),
      customerId: z.number().int().positive().nullable().optional(),
      correspondentEmail: z.string().nullable().optional(),
      limit: z.number().int().positive().optional(),
    }),
    result: recordArray,
  });
  set(IPCChannels.Email.ListMessageTags, { payload: positiveInt, result: z.array(z.string()) });
  set(IPCChannels.Email.AddMessageTag, {
    payload: z.object({ messageId: positiveInt, tag: nonEmptyString }),
    result: standardResult,
  });
  set(IPCChannels.Email.RemoveMessageTag, {
    payload: z.object({ messageId: positiveInt, tag: nonEmptyString }),
    result: standardResult,
  });
  set(IPCChannels.Email.MoveMessageToView, {
    payload: z.object({
      messageId: positiveInt,
      view: z.enum(['inbox', 'sent', 'archived', 'drafts', 'spam_review', 'spam', 'trash']),
    }),
    result: standardResult,
  });
  set(IPCChannels.Email.SoftDeleteMessage, { payload: positiveInt, result: standardResult });
  set(IPCChannels.Email.DeleteComposeDraft, { payload: positiveInt, result: standardResult });
  set(IPCChannels.Email.RestoreMessage, { payload: positiveInt, result: standardResult });
  set(IPCChannels.Email.SetMessageArchived, {
    payload: z.object({ messageId: positiveInt, archived: z.boolean() }),
    result: standardResult,
  });
  set(IPCChannels.Email.PreviewRestoreInboxFromArchive, {
    payload: positiveInt,
    result: z.union([
      z.object({
        success: z.literal(true),
        accountId: z.number().int().positive(),
        count: z.number().int().nonnegative(),
        accountEmail: z.string(),
        accountLabel: z.string(),
      }),
      failResult,
    ]),
  });
  set(IPCChannels.Email.RestoreInboxFromArchive, {
    payload: z.object({
      accountId: positiveInt,
      expectedCount: z.number().int().nonnegative(),
      confirmPhrase: z.string().min(1),
    }),
    result: z.union([
      z.object({ success: z.literal(true), restored: z.number().int().nonnegative() }),
      failResult,
    ]),
  });
  set(IPCChannels.Email.GetMessageRawHeaders, {
    payload: positiveInt,
    result: z.union([
      z.object({
        success: z.literal(true),
        rawEml: z.string(),
        emlSource: z.enum(['original', 'reconstructed']),
        rawHeaders: z.string().nullable(),
        messageIdHeader: z.string().nullable(),
        fromJson: z.string().nullable(),
      }),
      failResult,
    ]),
  });
  set(IPCChannels.Email.GetMessageSecurity, {
    payload: positiveInt,
    result: z.union([
      z.object({
        success: z.literal(true),
        authSpf: z.string().nullable(),
        authDkim: z.string().nullable(),
        authDmarc: z.string().nullable(),
        authArc: z.string().nullable(),
        authDkimDomains: z.string().nullable(),
        authError: z.string().nullable(),
        rspamdScore: z.number().nullable(),
        rspamdAction: z.string().nullable(),
        rspamdSymbols: z.string().nullable(),
        rspamdError: z.string().nullable(),
        securityCheckedAt: z.string().nullable(),
        spamStatus: z.string().nullable(),
        spamScore: z.number().nullable(),
        spamScoreLabel: z.string().nullable(),
        spamDecisionSource: z.string().nullable(),
        spamScoreBreakdownJson: z.string().nullable(),
        spamDecidedAt: z.string().nullable(),
      }),
      failResult,
    ]),
  });
  set(IPCChannels.Email.GetMailSecuritySettings, {
    payload: z.undefined().optional(),
    result: z.object({
      mailauthEnabled: z.boolean(),
      rspamdEnabled: z.boolean(),
      rspamdUrl: z.string(),
      rspamdTimeoutMs: z.number(),
      rspamdSpamScore: z.number(),
      autoSpamDmarcFail: z.boolean(),
      autoSpamSpfFail: z.boolean(),
      autoSpamRspamd: z.boolean(),
      senderWhitelist: z.string(),
      senderBlacklist: z.string(),
      spamScoreThreshold: z.number(),
      spamEngineEnabled: z.boolean(),
      spamReviewThreshold: z.number(),
      spamSpamThreshold: z.number(),
      localLearningEnabled: z.boolean(),
      rspamdContributionEnabled: z.boolean(),
      rspamdLearningEnabled: z.boolean(),
      aiSpamWorkflowEnabled: z.boolean(),
    }),
  });
  set(IPCChannels.Email.SetMailSecuritySettings, {
    payload: z.object({
      mailauthEnabled: z.boolean().optional(),
      rspamdEnabled: z.boolean().optional(),
      rspamdUrl: z.string().optional(),
      rspamdTimeoutMs: z.number().optional(),
      rspamdSpamScore: z.number().optional(),
      autoSpamDmarcFail: z.boolean().optional(),
      autoSpamSpfFail: z.boolean().optional(),
      autoSpamRspamd: z.boolean().optional(),
      senderWhitelist: z.string().optional(),
      senderBlacklist: z.string().optional(),
      spamScoreThreshold: z.number().optional(),
      spamEngineEnabled: z.boolean().optional(),
      spamReviewThreshold: z.number().optional(),
      spamSpamThreshold: z.number().optional(),
      localLearningEnabled: z.boolean().optional(),
      rspamdContributionEnabled: z.boolean().optional(),
      rspamdLearningEnabled: z.boolean().optional(),
      aiSpamWorkflowEnabled: z.boolean().optional(),
    }),
    result: standardResult,
  });
  set(IPCChannels.Email.RunMailSecurityCheck, {
    payload: positiveInt,
    result: z.union([
      z.object({
        success: z.literal(true),
        authChecked: z.boolean(),
        rspamdChecked: z.boolean(),
        authSpf: z.string().nullable().optional(),
        authDmarc: z.string().nullable().optional(),
        rspamdScore: z.number().nullable().optional(),
        spamScore: z.number().nullable().optional(),
        spamStatus: z.string().nullable().optional(),
        spamDecisionSource: z.string().nullable().optional(),
      }),
      failResult,
    ]),
  });
  const emailTrackingPolicySchema = z.object({
    enabled: z.boolean(),
    trackOpens: z.boolean(),
    trackLinks: z.boolean(),
    collectDerivedMetadata: z.boolean(),
    collectRawMetadata: z.boolean(),
    ipInsightsEnabled: z.boolean().default(false),
    rawMetadataRetentionDays: z.number().int(),
    eventRetentionDays: z.number().int(),
    tokenTtlDays: z.number().int(),
    legalBasis: z.enum(['consent', 'legitimate_interest', 'contract', 'other']).nullable(),
    privacyNoticeUrl: z.string().nullable(),
    complianceAcknowledgedAt: z.string().nullable(),
    publicBaseUrl: z.string(),
    updatedAt: z.string().nullable(),
  });
  const emailTrackingMutationSchema = z.object({
    enabled: z.boolean().optional(),
    trackOpens: z.boolean().optional(),
    trackLinks: z.boolean().optional(),
    collectDerivedMetadata: z.boolean().optional(),
    collectRawMetadata: z.boolean().optional(),
    ipInsightsEnabled: z.boolean().optional(),
    rawMetadataRetentionDays: z.number().int().optional(),
    eventRetentionDays: z.number().int().optional(),
    tokenTtlDays: z.number().int().optional(),
    legalBasis: z.enum(['consent', 'legitimate_interest', 'contract', 'other']).nullable().optional(),
    privacyNoticeUrl: z.string().nullable().optional(),
    complianceAcknowledged: z.boolean().optional(),
  });
  const emailEvidenceSummarySchema = z.object({
    transport: z.enum(['unknown', 'queued', 'sending', 'smtp_accepted', 'delayed', 'failed', 'bounced']),
    delivery: z.enum(['unknown', 'external_system_reached', 'dsn_delivered']),
    engagement: z.enum(['none', 'automated_fetch', 'probable_open', 'link_interaction', 'human_reply']),
    confidence: z.enum(['none', 'low', 'medium', 'high', 'verified']),
    mdnDisplayedCount: z.number().int().nonnegative().optional(),
    pixelFetchCount: z.number().int().nonnegative().optional(),
    automatedPixelFetchCount: z.number().int().nonnegative().optional(),
    unknownPixelFetchCount: z.number().int().nonnegative().optional(),
    probableHumanPixelFetchCount: z.number().int().nonnegative().optional(),
    probableHumanOpenSessionCount: z.number().int().nonnegative().optional(),
    automatedLinkFetchCount: z.number().int().nonnegative().optional(),
    unknownLinkFetchCount: z.number().int().nonnegative().optional(),
    probableHumanLinkFetchCount: z.number().int().nonnegative().optional(),
    firstPixelFetchedAt: z.string().nullable().optional(),
    lastPixelFetchedAt: z.string().nullable().optional(),
    firstProbableHumanOpenAt: z.string().nullable().optional(),
    lastProbableHumanOpenAt: z.string().nullable().optional(),
    openCount: z.number().int().nonnegative(),
    clickCount: z.number().int().nonnegative(),
    automatedOpenCount: z.number().int().nonnegative().optional(),
    probableOpenCount: z.number().int().nonnegative().optional(),
    automatedClickCount: z.number().int().nonnegative().optional(),
    probableClickCount: z.number().int().nonnegative().optional(),
    firstOpenedAt: z.string().nullable(),
    lastOpenedAt: z.string().nullable(),
    firstClickedAt: z.string().nullable(),
    lastClickedAt: z.string().nullable(),
    repliedAt: z.string().nullable(),
  });
  set(IPCChannels.Email.GetEmailTrackingSettings, {
    payload: z.undefined().optional(),
    result: emailTrackingPolicySchema,
  });
  set(IPCChannels.Email.SetEmailTrackingSettings, {
    payload: emailTrackingMutationSchema,
    result: emailTrackingPolicySchema,
  });
  set(IPCChannels.Email.GetMessageTracking, {
    payload: z.object({ messageId: positiveInt, includeSensitive: z.boolean().optional() }),
    result: z.object({
      messageId: positiveInt,
      tracked: z.boolean(),
      warning: z.string().nullable(),
      summary: emailEvidenceSummarySchema,
      eventsTruncated: z.boolean(),
      events: z.array(z.object({
        id: z.union([positiveInt, z.string().regex(/^[1-9]\d*$/)]),
        type: z.enum([
          'queued', 'sending', 'smtp_accepted', 'smtp_failed', 'delayed', 'bounced',
          'dsn_delivered', 'mdn_displayed', 'open_automated', 'open_probable',
          'click_automated', 'click', 'replied', 'revoked', 'expired',
        ]),
        source: z.string(),
        confidence: z.enum(['none', 'low', 'medium', 'high', 'verified']),
        automated: z.boolean(),
        occurredAt: z.string(),
        metadata: z.record(z.string(), z.unknown()),
        classification: z.object({
          version: z.literal(2),
          actorClass: z.enum([
            'system', 'probable_human', 'mail_proxy', 'privacy_proxy',
            'security_scanner', 'automated_unknown', 'unknown',
          ]),
          confidence: z.enum(['none', 'low', 'medium', 'high', 'verified']),
          reasons: z.array(z.string()),
        }).nullable().optional(),
      })),
    }),
  });
  set(IPCChannels.Email.GetMessageTrackingIpInsight, {
    payload: z.object({
      messageId: positiveInt,
      eventId: z.union([positiveInt, z.string().regex(/^[1-9]\d*$/)]),
    }),
    result: z.object({
      ipAddress: z.string(),
      ipFamily: z.enum(['ipv4', 'ipv6']),
      scope: z.enum(['public', 'private', 'loopback', 'reserved', 'unknown']),
      countryCode: z.string().nullable(),
      continentCode: z.string().nullable(),
      asn: z.number().int().nonnegative().nullable(),
      networkName: z.string().nullable(),
      networkCidr: z.string().nullable(),
      databaseBuildAt: z.string().nullable(),
    }),
  });
  set(IPCChannels.Email.ReclassifyMessageTracking, {
    payload: positiveInt,
    result: z.object({
      classified: z.number().int().nonnegative(),
      unavailableRaw: z.number().int().nonnegative(),
    }),
  });
  set(IPCChannels.Email.RevokeMessageTracking, {
    payload: positiveInt,
    result: z.object({ revoked: z.literal(true) }),
  });
  set(IPCChannels.Email.DeleteMessageTracking, {
    payload: positiveInt,
    result: successResult,
  });
  set(IPCChannels.Email.TestRspamdConnection, {
    payload: z.object({
      rspamdUrl: z.string().optional(),
      rspamdTimeoutMs: z.number().optional(),
    }),
    result: z.union([
      z.object({ success: z.literal(true), message: z.string() }),
      failResult,
    ]),
  });
  set(IPCChannels.Email.SetMessageSeen, {
    payload: z.object({
      messageId: positiveInt,
      seen: z.boolean(),
      syncToServer: z.boolean().optional(),
    }),
    result: standardResult,
  });
  set(IPCChannels.Email.SetMessageSpam, {
    payload: z.object({ messageId: positiveInt, spam: z.boolean() }),
    result: standardResult,
  });
  const spamStatusSchema = z.enum(['clean', 'review', 'spam']);
  set(IPCChannels.Email.SetMessageSpamStatus, {
    payload: z.object({
      messageId: positiveInt,
      status: spamStatusSchema,
      train: z.boolean().optional(),
    }),
    result: standardResult,
  });
  set(IPCChannels.Email.ListSpamListEntries, {
    payload: z.union([z.literal('all'), positiveInt]).optional(),
    result: recordArray,
  });
  set(IPCChannels.Email.SaveSpamListEntry, {
    payload: z.object({
      id: positiveInt.optional(),
      listType: z.enum(['allow', 'block']),
      patternType: z.enum(['email', 'domain']).optional(),
      pattern: z.string().min(1),
      accountId: positiveInt.nullable().optional(),
      note: z.string().nullable().optional(),
    }),
    result: z.union([z.object({ success: z.literal(true), entry: z.record(z.string(), z.unknown()) }), failResult]),
  });
  set(IPCChannels.Email.DeleteSpamListEntry, {
    payload: positiveInt,
    result: standardResult,
  });
  set(IPCChannels.Email.LinkCustomer, {
    payload: z.object({
      messageId: positiveInt,
      customerId: z.number().int().positive().nullable(),
    }),
    result: standardResult,
  });
  set(IPCChannels.Email.AssignMessage, {
    payload: z.object({
      messageId: positiveInt,
      teamMemberId: z.string().nullable(),
    }),
    result: standardResult,
  });

  // --- Compose ---
  set(IPCChannels.Email.CreateComposeDraft, {
    payload: z.object({
      accountId: positiveInt,
      subject: z.string().optional(),
      bodyText: z.string().optional(),
      to: z.string().optional(),
    }),
    result: z.union([
      z.object({ success: z.literal(true), id: positiveInt }),
      failResult,
    ]),
  });
  set(IPCChannels.Email.UpdateComposeDraft, {
    payload: z.object({
      messageId: positiveInt,
      subject: z.string().optional(),
      bodyText: z.string().optional(),
      bodyHtml: z.string().optional(),
      to: z.string().optional(),
      cc: z.string().optional(),
      bcc: z.string().optional(),
      draftAttachmentPaths: z.array(z.string()).optional(),
      replyParentMessageId: z.number().int().positive().nullable().optional(),
      markReplyParentDone: z.boolean().optional(),
    }),
    result: standardResult,
  });
  set(IPCChannels.Email.ValidateOutbound, {
    payload: z.object({
      messageId: positiveInt,
      subject: z.string(),
      bodyText: z.string(),
      bodyHtml: z.string().optional(),
      to: z.string(),
      cc: z.string().optional(),
      bcc: z.string().optional(),
      attachmentCount: z.number().int().nonnegative().optional(),
    }),
    result: z.object({
      success: z.literal(true),
      allowed: z.boolean(),
      reason: z.string().nullable(),
    }),
  });
  set(IPCChannels.Email.SendCompose, {
    payload: z.object({
      accountId: positiveInt,
      draftMessageId: positiveInt,
      subject: z.string(),
      bodyText: z.string(),
      bodyHtml: z.string().nullable().optional(),
      to: nonEmptyString,
      cc: z.string().optional(),
      bcc: z.string().optional(),
      inReplyToMessageId: z.number().int().positive().nullable().optional(),
      attachmentPaths: z.array(z.string()).optional(),
      markReplyParentDone: z.boolean().optional(),
      requestReadReceipt: z.boolean().optional(),
      pgpEncrypt: z.boolean().optional(),
      pgpSign: z.boolean().optional(),
      pgpPassphrase: z.string().optional(),
    }),
    result: z.union([
      z.object({
        success: z.literal(true),
        warning: z.string().optional(),
        recoveredSentAppend: z.literal(true).optional(),
      }),
      failResult,
    ]),
  });
  set(IPCChannels.Email.ListConversationLocks, {
    payload: z.object({
      messageIds: z.array(positiveInt).max(500),
    }),
    result: z.object({ locks: z.array(conversationLockRecord) }),
  });
  set(IPCChannels.Email.GetConversationLock, {
    payload: positiveInt,
    result: z.object({ lock: conversationLockRecord.nullable() }),
  });
  set(IPCChannels.Email.AcquireConversationLock, {
    payload: z.object({
      messageId: positiveInt,
      reason: conversationLockReason.optional(),
    }),
    result: z.object({ lock: conversationLockRecord }),
  });
  set(IPCChannels.Email.HeartbeatConversationLock, {
    payload: positiveInt,
    result: z.object({ lock: conversationLockRecord }),
  });
  set(IPCChannels.Email.ReleaseConversationLock, {
    payload: positiveInt,
    result: z.object({
      released: z.boolean(),
      lock: conversationLockRecord,
    }),
  });
  set(IPCChannels.Email.TakeoverConversationLock, {
    payload: z.object({
      messageId: positiveInt,
      reason: conversationLockReason.optional(),
    }),
    result: z.object({ lock: conversationLockRecord }),
  });
  set(IPCChannels.Email.BulkSoftDeleteMessages, {
    payload: z.object({
      messageIds: z.array(positiveInt).min(1).max(500),
      accountId: positiveInt.optional(),
    }),
    result: z.union([
      z.object({ success: z.literal(true), count: z.number().int().nonnegative() }),
      failResult,
    ]),
  });
  set(IPCChannels.Email.BulkSetMessagesArchived, {
    payload: z.object({
      messageIds: z.array(positiveInt).min(1).max(500),
      archived: z.boolean(),
      accountId: positiveInt.optional(),
    }),
    result: z.union([
      z.object({ success: z.literal(true), count: z.number().int().nonnegative() }),
      failResult,
    ]),
  });
  set(IPCChannels.Email.BulkSetMessageSpam, {
    payload: z.object({
      messageIds: z.array(positiveInt).min(1).max(500),
      spam: z.boolean(),
      accountId: positiveInt.optional(),
    }),
    result: z.union([
      z.object({ success: z.literal(true), count: z.number().int().nonnegative() }),
      failResult,
    ]),
  });
  set(IPCChannels.Email.BulkSetMessageSpamStatus, {
    payload: z.object({
      messageIds: z.array(positiveInt).min(1).max(500),
      status: z.enum(['clean', 'review', 'spam']),
      accountId: positiveInt.optional(),
      train: z.boolean().optional(),
    }),
    result: z.union([
      z.object({ success: z.literal(true), count: z.number().int().nonnegative() }),
      failResult,
    ]),
  });
  set(IPCChannels.Email.BulkSetMessageDone, {
    payload: z.object({
      messageIds: z.array(positiveInt).min(1).max(500),
      done: z.boolean(),
      accountId: positiveInt.optional(),
    }),
    result: z.union([
      z.object({ success: z.literal(true), count: z.number().int().nonnegative() }),
      failResult,
    ]),
  });
  set(IPCChannels.Email.BulkDeleteComposeDrafts, {
    payload: z.object({
      messageIds: z.array(positiveInt).min(1).max(500),
    }),
    result: z.union([
      z.object({ success: z.literal(true), count: z.number().int().nonnegative() }),
      failResult,
    ]),
  });
  set(IPCChannels.Email.GetComposeSignature, {
    payload: z.object({
      accountId: positiveInt,
      teamMemberId: nonEmptyString.max(200).optional(),
    }),
    result: z.object({ html: z.string().nullable() }),
  });
  set(IPCChannels.Email.ListAccountSignatures, { payload: voidPayload, result: recordArray });
  set(IPCChannels.Email.SaveAccountSignature, {
    payload: z.object({
      accountId: positiveInt,
      signatureHtml: z.string().nullable(),
    }),
    result: standardResult,
  });
  set(IPCChannels.Email.PickComposeAttachments, {
    payload: voidPayload,
    result: z.object({ success: z.literal(true), paths: z.array(z.string()) }).passthrough(),
  });

  // --- Categories & counts ---
  set(IPCChannels.Email.ListCategories, { payload: voidPayload, result: recordArray });
  set(IPCChannels.Email.CreateCategory, {
    payload: z.object({
      name: nonEmptyString,
      parentId: z.number().int().positive().nullable().optional(),
    }),
    result: z.union([
      z.object({ success: z.literal(true), id: positiveInt }),
      failResult,
    ]),
  });
  set(IPCChannels.Email.UpdateCategory, {
    payload: z.object({
      categoryId: positiveInt,
      name: nonEmptyString.optional(),
      parentId: z.number().int().positive().nullable().optional(),
      sortOrder: z.number().int().optional(),
    }),
    result: standardResult,
  });
  set(IPCChannels.Email.DeleteCategory, {
    payload: positiveInt,
    result: standardResult,
  });
  set(IPCChannels.Email.ReorderCategories, {
    payload: z.object({
      updates: z
        .array(
          z.object({
            id: positiveInt,
            parentId: z.number().int().positive().nullable(),
            sortOrder: z.number().int().nonnegative(),
          }),
        )
        .min(1)
        .max(500),
    }),
    result: standardResult,
  });
  set(IPCChannels.Email.SetMessageCategory, {
    payload: z.object({
      messageId: positiveInt,
      categoryId: z.number().int().positive().nullable(),
    }),
    result: standardResult,
  });
  set(IPCChannels.Email.GetMessageCategory, {
    payload: positiveInt,
    result: z.object({ categoryId: z.number().int().positive().nullable() }),
  });
  set(IPCChannels.Email.CategoryCounts, {
    payload: mailAccountScopeSchema,
    result: z.array(
      z.object({
        categoryId: z.number().int(),
        count: z.number().int(),
      }),
    ),
  });
  set(IPCChannels.Email.MailFolderCounts, {
    payload: mailAccountScopeSchema,
    result: z.record(z.string(), z.number()),
  });

  // --- CRM helpers ---
  set(IPCChannels.Email.ListInternalNotes, { payload: positiveInt, result: recordArray });
  set(IPCChannels.Email.AddInternalNote, {
    payload: z.object({ messageId: positiveInt, body: nonEmptyString }),
    result: standardResult,
  });
  set(IPCChannels.Email.UpdateInternalNote, {
    payload: z.object({ noteId: positiveInt, body: nonEmptyString }),
    result: standardResult,
  });
  set(IPCChannels.Email.DeleteInternalNote, {
    payload: positiveInt,
    result: standardResult,
  });
  set(IPCChannels.Email.ListCannedResponses, { payload: accountOverrideScopePayloadSchema, result: recordArray });
  set(IPCChannels.Email.SaveCannedResponse, {
    payload: z.object({
      id: z.number().int().positive().optional(),
      title: nonEmptyString,
      body: z.string(),
      ...accountOverrideMutationFields,
    }),
    result: standardResult,
  });
  set(IPCChannels.Email.DeleteCannedResponse, { payload: positiveInt, result: standardResult });

  // --- AI ---
  set(IPCChannels.Email.ListAiPrompts, { payload: accountOverrideScopePayloadSchema, result: recordArray });
  set(IPCChannels.Email.SaveAiPrompt, {
    payload: z.object({
      id: z.number().int().positive().optional(),
      label: nonEmptyString,
      userTemplate: z.string(),
      target: z.string().optional(),
      profileId: z.number().int().positive().nullable().optional(),
      ...accountOverrideMutationFields,
    }),
    result: standardResult,
  });
  set(IPCChannels.Email.DeleteAiPrompt, { payload: positiveInt, result: standardResult });
  set(IPCChannels.Email.ReorderAiPrompt, {
    payload: z.object({
      id: positiveInt,
      direction: z.enum(['up', 'down']),
    }),
    result: standardResult,
  });
  set(IPCChannels.Email.AiTransformText, {
    payload: z.object({
      // Optional in translate mode: when `targetLanguage` is set the call
      // translates `text` (using the default AI profile) instead of running a
      // stored prompt, so no promptId is required.
      promptId: positiveInt.optional(),
      text: z.string(),
      contextText: z.string().max(40000).optional(),
      targetLanguage: z.string().min(1).max(60).optional(),
      inboundContextText: z.string().max(40000).optional(),
      userContext: z.string().max(4000).optional(),
      customerId: z.number().int().positive().nullable().optional(),
      insertMode: z.boolean().optional(),
    }),
    result: z.union([
      z.object({ success: z.literal(true), text: z.string().optional() }),
      failResult,
    ]),
  });
  set(IPCChannels.Email.GetReplySuggestion, {
    payload: positiveInt,
    result: z.object({
      status: z.enum(['none', 'pending', 'ready', 'failed', 'skipped']),
      text: z.string().nullable(),
      error: z.string().nullable(),
      updatedAt: z.string().nullable(),
    }),
  });
  set(IPCChannels.Email.EnsureReplySuggestion, {
    payload: z.object({
      messageId: positiveInt,
      force: z.boolean().optional(),
      trigger: z.enum(['inbound', 'open']).optional(),
    }),
    result: standardResult,
  });
  const replySuggestionSettingsSchema = z.object({
    autoEnabled: z.boolean(),
    triggerOnInbound: z.boolean(),
    triggerOnOpen: z.boolean(),
    categoryMode: z.enum(['any', 'only_listed']),
    categoryIds: z.array(positiveInt),
  });
  const replySuggestionSettingsQuerySchema = z
    .object({ accountId: positiveInt.optional() })
    .optional();
  const replySuggestionSettingsSetSchema = replySuggestionSettingsSchema
    .partial()
    .extend({ accountId: positiveInt.optional() });
  set(IPCChannels.Email.GetReplySuggestionSettings, {
    payload: replySuggestionSettingsQuerySchema,
    result: replySuggestionSettingsSchema,
  });
  set(IPCChannels.Email.SetReplySuggestionSettings, {
    payload: replySuggestionSettingsSetSchema,
    result: replySuggestionSettingsSchema,
  });
  set(IPCChannels.Email.GenerateReplyDraft, {
    payload: z.object({
      messageId: positiveInt,
      promptId: positiveInt.optional(),
      customerId: z.number().int().positive().nullable().optional(),
      userContext: z.string().max(4000).optional(),
      persistSuggestion: z.boolean().optional(),
    }),
    result: z.union([
      z.object({ success: z.literal(true), text: z.string() }),
      failResult,
    ]),
  });
  const aiProviderPresetIdSchema = z.enum([
    'openai',
    'openrouter',
    'anthropic',
    'google',
    'deepseek',
    'ollama',
    'custom',
  ]);
  const aiProfileSummarySchema = z.object({
    id: positiveInt,
    label: z.string(),
    provider: z.string(),
    baseUrl: z.string(),
    model: z.string(),
    embeddingModel: z.string().nullable(),
    isDefault: z.boolean(),
    hasApiKey: z.boolean().optional(),
  });
  set(IPCChannels.Email.GetAiSettings, {
    payload: voidPayload,
    result: z
      .object({
        success: z.literal(true).optional(),
        baseUrl: z.string(),
        model: z.string(),
        embeddingModel: z.string().optional(),
        profiles: z.array(aiProfileSummarySchema).optional(),
        providerPresets: z
          .record(
            z.string(),
            z.object({
              label: z.string(),
              baseUrl: z.string(),
              defaultModel: z.string(),
              defaultEmbeddingModel: z.string().optional(),
            }),
          )
          .optional(),
      })
      .passthrough(),
  });
  set(IPCChannels.Email.SetAiSettings, {
    payload: z.object({
      baseUrl: z.string().optional(),
      model: z.string().optional(),
    }),
    result: standardResult,
  });
  set(IPCChannels.Email.SetAiApiKey, { payload: z.string(), result: standardResult });
  set(IPCChannels.Email.ClearAiApiKey, { payload: voidPayload, result: standardResult });
  set(IPCChannels.Email.ListAiProfiles, { payload: voidPayload, result: recordArray });
  set(IPCChannels.Email.SaveAiProfile, {
    payload: z.object({
      id: z.number().int().positive().optional(),
      label: nonEmptyString,
      provider: aiProviderPresetIdSchema,
      baseUrl: z.string(),
      model: z.string(),
      embeddingModel: z.string().nullable().optional(),
      isDefault: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
      apiKey: z.string().optional(),
    }),
    result: standardResult,
  });
  set(IPCChannels.Email.DeleteAiProfile, { payload: positiveInt, result: standardResult });
  set(IPCChannels.Email.SetAiProfileApiKey, {
    payload: z.object({ profileId: positiveInt, apiKey: z.string() }),
    result: standardResult,
  });
  set(IPCChannels.Email.ClearAiProfileApiKey, { payload: positiveInt, result: standardResult });

  // --- Team ---
  set(IPCChannels.Email.ListTeamMembers, { payload: voidPayload, result: recordArray });
  set(IPCChannels.Email.SaveTeamMember, {
    payload: z.object({
      id: nonEmptyString,
      displayName: nonEmptyString,
      role: z.string().optional(),
      signatureHtml: z.string().nullable().optional(),
    }),
    result: standardResult,
  });
  set(IPCChannels.Email.DeleteTeamMember, { payload: nonEmptyString, result: standardResult });

  // --- Workflows (email:* + workflow:* on Email namespace) ---
  set(IPCChannels.Email.ListWorkflows, { payload: accountOverrideScopePayloadSchema, result: recordArray });
  set(IPCChannels.Email.GetWorkflow, { payload: positiveInt, result: nullableRecord });
  set(IPCChannels.Email.CreateWorkflow, {
    payload: z.object({
      name: nonEmptyString,
      trigger: z.string(),
      priority: z.number().int().optional(),
      definitionJson: z.string(),
      graphJson: z.string().nullable().optional(),
      cronExpr: z.string().nullable().optional(),
      scheduleAccountId: z.number().int().positive().nullable().optional(),
      enabled: z.boolean().optional(),
    }),
    result: z.union([
      z.object({ success: z.literal(true), id: positiveInt }),
      failResult,
    ]),
  });
  set(IPCChannels.Email.UpdateWorkflow, {
    payload: z
      .object({
        id: positiveInt,
        name: z.string().optional(),
        trigger: z.string().optional(),
        priority: z.number().int().optional(),
        definitionJson: z.string().optional(),
        graphJson: z.string().nullable().optional(),
        cronExpr: z.string().nullable().optional(),
        scheduleAccountId: z.number().int().positive().nullable().optional(),
        enabled: z.boolean().optional(),
      })
      .passthrough(),
    result: standardResult,
  });
  set(IPCChannels.Email.DeleteWorkflow, { payload: positiveInt, result: standardResult });
  set(IPCChannels.Email.BackfillInboundWorkflows, {
    payload: z
      .object({
        limit: z.number().int().positive().optional(),
        clearApplied: z.boolean().optional(),
      })
      .optional(),
    result: z.object({
      success: z.literal(true),
      processed: z.number().int().nonnegative(),
      queued: z.number().int().nonnegative().optional(),
      clearedApplied: z.number().int().nonnegative().optional(),
    }),
  });
  set(IPCChannels.Email.CompileWorkflowGraph, {
    payload: compileWorkflowGraphPayloadSchema,
    result: z.union([
      z.object({
        success: z.literal(true),
        definitionJson: z.string(),
        registryOnly: z.boolean().optional(),
      }),
      failResult,
    ]),
  });
  set(IPCChannels.Email.ListWorkflowNodeCatalog, { payload: voidPayload, result: recordArray });
  set(IPCChannels.Email.TestWorkflowOnMessage, {
    payload: z.object({
      workflowId: positiveInt,
      messageId: positiveInt,
      dryRun: z.boolean().optional(),
    }),
    result: z.object({}).passthrough(),
  });
  set(IPCChannels.Email.ExecuteWorkflowNow, {
    payload: z.object({
      workflowId: positiveInt,
      messageId: z.number().int().positive().nullable().optional(),
      dryRun: z.boolean().optional(),
    }),
    result: z.object({}).passthrough(),
  });
  set(IPCChannels.Email.ListWorkflowRuns, { payload: positiveInt, result: recordArray });
  set(IPCChannels.Email.GetWorkflowRunLog, { payload: positiveInt, result: z.array(z.string()) });
  set(IPCChannels.Email.ListWorkflowRunSteps, { payload: positiveInt, result: recordArray });
  set(IPCChannels.Email.ListWorkflowTemplates, { payload: voidPayload, result: recordArray });
  set(IPCChannels.Email.ImportWorkflowBundle, {
    payload: z.object({ json: nonEmptyString }),
    result: z.union([
      z.object({ success: z.literal(true), id: positiveInt }),
      failResult,
    ]),
  });
  set(IPCChannels.Email.ExportWorkflowBundle, {
    payload: positiveInt,
    result: z.union([
      z.object({ success: z.literal(true), bundle: z.unknown() }),
      failResult,
    ]),
  });
  set(IPCChannels.Email.ImportWorkflowBundleFromFile, {
    payload: voidPayload,
    result: z
      .object({
        success: z.literal(true),
        id: z.number().int().positive().nullable(),
        canceled: z.boolean().optional(),
      })
      .passthrough(),
  });
  set(IPCChannels.Email.ExportWorkflowBundleToFile, {
    payload: positiveInt,
    result: z.union([
      z.object({ success: z.literal(true), path: z.string().optional() }),
      failResult,
    ]),
  });
  set(IPCChannels.Email.GetWorkflowAutomationSettings, {
    payload: voidPayload,
    result: z.object({
      imapDeleteOptIn: z.boolean(),
      httpAllowlist: z.string(),
      senderWhitelist: z.string(),
      senderBlacklist: z.string(),
      spamScoreThreshold: z.string(),
    }),
  });
  set(IPCChannels.Email.SetWorkflowAutomationSettings, {
    payload: z.object({
      imapDeleteOptIn: z.boolean().optional(),
      httpAllowlist: z.string().optional(),
      senderWhitelist: z.string().optional(),
      senderBlacklist: z.string().optional(),
      spamScoreThreshold: z.string().optional(),
    }),
    result: standardResult,
  });
  set(IPCChannels.Email.ListKnowledgeBases, { payload: accountOverrideScopePayloadSchema, result: recordArray });
  set(IPCChannels.Email.CreateKnowledgeBase, {
    payload: z.object({
      name: nonEmptyString,
      description: z.string().nullable().optional(),
      knowledgeContext: z.enum(['inbound', 'outbound', 'general']).nullable().optional(),
      ...accountOverrideMutationFields,
    }),
    result: z.union([
      z.object({ success: z.literal(true), id: positiveInt }),
      failResult,
    ]),
  });
  set(IPCChannels.Email.UpdateKnowledgeBase, {
    payload: z.object({
      id: positiveInt,
      name: nonEmptyString.optional(),
      description: z.string().nullable().optional(),
      knowledgeContext: z.enum(['inbound', 'outbound', 'general']).nullable().optional(),
      ...accountOverrideMutationFields,
    }),
    result: standardResult,
  });
  set(IPCChannels.Email.DeleteKnowledgeBase, { payload: positiveInt, result: standardResult });
  set(IPCChannels.Email.AddKnowledgeChunk, {
    payload: z.object({
      knowledgeBaseId: positiveInt,
      title: z.string().optional(),
      content: nonEmptyString,
    }),
    result: z.union([
      z.object({ success: z.literal(true), id: positiveInt }),
      failResult,
    ]),
  });
  set(IPCChannels.Email.GetKnowledgeBaseDocument, {
    payload: positiveInt,
    result: z.union([
      z.object({
        success: z.literal(true),
        content: z.string(),
        fileName: z.string(),
      }),
      failResult,
    ]),
  });
  set(IPCChannels.Email.SaveKnowledgeBaseDocument, {
    payload: z.object({
      knowledgeBaseId: positiveInt,
      content: z.string(),
    }),
    result: standardResult,
  });
  set(IPCChannels.Email.ExportKnowledgeBaseDocument, {
    payload: positiveInt,
    result: z.union([
      z.object({ success: z.literal(true), path: z.string().nullable() }),
      failResult,
    ]),
  });
  set(IPCChannels.Email.ImportKnowledgeFile, {
    payload: z.object({ knowledgeBaseId: positiveInt }),
    result: z.union([
      z.object({ success: z.literal(true), id: z.number().int().nullable() }),
      failResult,
    ]),
  });
  set(IPCChannels.Email.ListWorkflowPlugins, { payload: voidPayload, result: recordArray });
  set(IPCChannels.Email.ListWorkflowVersions, { payload: positiveInt, result: recordArray });
  set(IPCChannels.Email.SaveWorkflowVersion, {
    payload: z.object({ workflowId: positiveInt, label: z.string().optional() }),
    result: standardResult,
  });
  set(IPCChannels.Email.RestoreWorkflowVersion, {
    payload: z.object({
      versionId: positiveInt,
      workflowId: positiveInt.optional(),
    }),
    result: standardResult,
  });

  // --- Attachments ---
  set(IPCChannels.Email.ListMessageAttachments, { payload: positiveInt, result: recordArray });
  set(IPCChannels.Email.SaveAttachmentToDisk, {
    payload: z.object({ attachmentId: positiveInt }),
    result: standardResult,
  });
  set(IPCChannels.Email.OpenAttachmentPath, {
    payload: z.object({
      attachmentId: positiveInt,
      confirmOpenRisky: z.boolean().optional(),
    }),
    result: z.union([
      z.object({ success: z.literal(true) }),
      z.object({ success: z.literal(false), error: z.string().optional() }),
      z.object({
        success: z.literal(false),
        needsConfirmation: z.literal(true),
        reason: z.literal('risky_file_type'),
      }),
    ]),
  });

  // --- Reporting & GDPR ---
  set(IPCChannels.Email.EmailReporting, {
    payload: z.number().int().positive().nullable(),
    result: z.object({ success: z.literal(true), data: z.unknown() }),
  });
  set(IPCChannels.Email.EmailGdprExport, {
    payload: z.object({
      skipAttachments: z.boolean().optional(),
      includeSensitiveTracking: z.boolean().optional(),
    }).optional(),
    result: z.object({}).passthrough(),
  });

  // --- OAuth ---
  const oauthAppResult = z.object({
    success: z.literal(true),
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
  });
  set(IPCChannels.Email.GetGoogleOAuthApp, { payload: voidPayload, result: oauthAppResult });
  set(IPCChannels.Email.SetGoogleOAuthApp, {
    payload: z.object({ clientId: z.string(), clientSecret: z.string() }),
    result: standardResult,
  });
  set(IPCChannels.Email.BuildGoogleOAuthUrl, {
    payload: z.string().url(),
    result: z.union([
      z.object({ success: z.literal(true), url: z.string() }),
      failResult,
    ]),
  });
  set(IPCChannels.Email.FinishGoogleOAuth, {
    payload: z.object({
      accountId: positiveInt,
      redirectUri: z.string(),
      code: nonEmptyString,
    }),
    result: standardResult,
  });
  set(IPCChannels.Email.GetMicrosoftOAuthApp, { payload: voidPayload, result: oauthAppResult });
  set(IPCChannels.Email.SetMicrosoftOAuthApp, {
    payload: z.object({ clientId: z.string(), clientSecret: z.string() }),
    result: standardResult,
  });
  set(IPCChannels.Email.BuildMicrosoftOAuthUrl, {
    payload: z.string(),
    result: z.union([
      z.object({ success: z.literal(true), url: z.string() }),
      failResult,
    ]),
  });
  set(IPCChannels.Email.FinishMicrosoftOAuth, {
    payload: z.object({
      accountId: positiveInt,
      redirectUri: z.string(),
      code: nonEmptyString,
    }),
    result: standardResult,
  });
}
