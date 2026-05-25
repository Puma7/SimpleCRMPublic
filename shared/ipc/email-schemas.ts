import { z } from 'zod';
import { IPCChannels, InvokeChannel } from './channels';

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
const accountMailViewSchema = z.enum([
  'inbox',
  'sent',
  'archived',
  'drafts',
  'spam',
  'trash',
  'all',
]);

const recordArray = z.array(z.record(z.string(), z.unknown()));
const nullableRecord = z.record(z.string(), z.unknown()).nullable();

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
        imapSyncSeenOnOpen: z.boolean().optional(),
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
      host: nonEmptyString,
      port: z.number().int().positive(),
      secure: z.boolean(),
      user: nonEmptyString,
      password: z.string(),
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
  set(IPCChannels.Email.ListMessagesByView, {
    payload: z.object({
      accountId: mailAccountScopeSchema,
      view: accountMailViewSchema,
      limit: z.number().int().positive().optional(),
      offset: z.number().int().nonnegative().optional(),
      categoryId: z.number().int().positive().nullable().optional(),
    }),
    result: recordArray,
  });
  set(IPCChannels.Email.SearchMessages, {
    payload: z.object({
      accountId: mailAccountScopeSchema,
      query: z.string(),
      limit: z.number().int().positive().optional(),
      view: accountMailViewSchema.optional(),
    }),
    result: recordArray,
  });
  set(IPCChannels.Email.ListConversationMessages, {
    payload: z.object({
      accountId: mailAccountScopeSchema,
      messageId: positiveInt,
      ticketCode: z.string().nullable().optional(),
      customerId: z.number().int().positive().nullable().optional(),
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
      view: z.enum(['inbox', 'sent', 'archived', 'drafts', 'spam', 'trash']),
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
        rawHeaders: z.string().nullable(),
        messageIdHeader: z.string().nullable(),
        fromJson: z.string().nullable(),
      }),
      failResult,
    ]),
  });
  set(IPCChannels.Email.SetMessageSeen, {
    payload: z.object({ messageId: positiveInt, seen: z.boolean() }),
    result: standardResult,
  });
  set(IPCChannels.Email.SetMessageSpam, {
    payload: z.object({ messageId: positiveInt, spam: z.boolean() }),
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
      inReplyToMessageId: z.number().int().positive().nullable().optional(),
      attachmentPaths: z.array(z.string()).optional(),
    }),
    result: standardResult,
  });
  set(IPCChannels.Email.GetComposeSignature, {
    payload: z.object({ accountId: positiveInt }),
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
  set(IPCChannels.Email.ListCannedResponses, { payload: voidPayload, result: recordArray });
  set(IPCChannels.Email.SaveCannedResponse, {
    payload: z.object({
      id: z.number().int().positive().optional(),
      title: nonEmptyString,
      body: z.string(),
    }),
    result: standardResult,
  });
  set(IPCChannels.Email.DeleteCannedResponse, { payload: positiveInt, result: standardResult });

  // --- AI ---
  set(IPCChannels.Email.ListAiPrompts, { payload: voidPayload, result: recordArray });
  set(IPCChannels.Email.SaveAiPrompt, {
    payload: z.object({
      id: z.number().int().positive().optional(),
      label: nonEmptyString,
      userTemplate: z.string(),
      target: z.string().optional(),
    }),
    result: standardResult,
  });
  set(IPCChannels.Email.DeleteAiPrompt, { payload: positiveInt, result: standardResult });
  set(IPCChannels.Email.AiTransformText, {
    payload: z.object({
      promptId: positiveInt,
      text: z.string(),
      customerId: z.number().int().positive().nullable().optional(),
    }),
    result: z.union([
      z.object({ success: z.literal(true), text: z.string().optional() }),
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
  set(IPCChannels.Email.ListWorkflows, { payload: voidPayload, result: recordArray });
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
    payload: voidPayload,
    result: z.object({ success: z.literal(true), processed: z.number().int() }),
  });
  set(IPCChannels.Email.CompileWorkflowGraph, {
    payload: z.object({ graphJson: z.string() }),
    result: z.union([
      z.object({ success: z.literal(true), definitionJson: z.string() }),
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
  set(IPCChannels.Email.ListKnowledgeBases, { payload: voidPayload, result: recordArray });
  set(IPCChannels.Email.CreateKnowledgeBase, {
    payload: z.object({ name: nonEmptyString }),
    result: z.union([
      z.object({ success: z.literal(true), id: positiveInt }),
      failResult,
    ]),
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
  set(IPCChannels.Email.ImportKnowledgeFile, {
    payload: z.object({ knowledgeBaseId: positiveInt }),
    result: standardResult,
  });
  set(IPCChannels.Email.ListWorkflowPlugins, { payload: voidPayload, result: recordArray });
  set(IPCChannels.Email.ListWorkflowVersions, { payload: positiveInt, result: recordArray });
  set(IPCChannels.Email.SaveWorkflowVersion, {
    payload: z.object({ workflowId: positiveInt, label: z.string().optional() }),
    result: standardResult,
  });
  set(IPCChannels.Email.RestoreWorkflowVersion, {
    payload: z.object({ workflowId: positiveInt, versionId: positiveInt }),
    result: standardResult,
  });

  // --- Attachments ---
  set(IPCChannels.Email.ListMessageAttachments, { payload: positiveInt, result: recordArray });
  set(IPCChannels.Email.SaveAttachmentToDisk, {
    payload: z.object({ attachmentId: positiveInt }),
    result: standardResult,
  });
  set(IPCChannels.Email.OpenAttachmentPath, {
    payload: z.object({ attachmentId: positiveInt }),
    result: standardResult,
  });

  // --- Reporting & GDPR ---
  set(IPCChannels.Email.EmailReporting, {
    payload: z.number().int().positive().nullable(),
    result: z.object({ success: z.literal(true), data: z.unknown() }),
  });
  set(IPCChannels.Email.EmailGdprExport, {
    payload: z.object({ skipAttachments: z.boolean().optional() }).optional(),
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
    payload: z.object({ redirectUri: z.string().url() }),
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
