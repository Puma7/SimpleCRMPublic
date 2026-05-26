import { randomUUID } from 'crypto';
import { BrowserWindow, IpcMainInvokeEvent, dialog, shell, type SaveDialogReturnValue } from 'electron';
import fs from 'fs';
import path from 'path';
import { IPCChannels } from '../../shared/ipc/channels';
import { registerIpcHandler } from './register';
import { getCustomerById } from '../sqlite-service';
import { deleteEmailPassword, getEmailPassword, saveEmailPassword } from '../email/email-keytar';
import {
  listEmailAccounts,
  createEmailAccountRecord,
  updateEmailAccountRecord,
  deleteEmailAccountRecord,
  getEmailAccountById,
  getFolderByAccountAndPath,
  listMessagesForFolder,
  listMessagesForAccountView,
  getMailFolderCountsForAccount,
  getMailFolderCountsForScope,
  listMessagesForMailScope,
  getEmailMessageById,
  createComposeDraft,
  updateComposeDraft,
  listMessageIdsForWorkflowBackfill,
  listTagsForMessage,
  listConversationMessagesForScope,
  setMessageSoftDeleted,
  bulkSoftDeleteMessages,
  bulkSetMessagesArchived,
  bulkSetMessageSpam,
  bulkDeleteLocalComposeDrafts,
  deleteLocalComposeDraft,
  setMessageArchived,
  setMessageSeenLocal,
  setMessageDoneLocal,
  setMessageSpam,
  setMessageAssignedTo,
  addMessageTag,
  removeMessageTag,
  moveMessageToMailView,
  listEmailTeamMembers,
  upsertEmailTeamMember,
  deleteEmailTeamMember,
  getComposeSignatureHtml,
  listAccountSignatureRows,
  saveAccountSignature,
  type EmailAccountRow,
} from '../email/email-store';
import { listMessagesByCorrespondentEmail } from '../email/email-correspondent';
import {
  previewInboxArchiveRecovery,
  restoreInboxMessagesFromArchiveSafe,
} from '../email/email-inbox-recovery';
import { sendComposeDraft } from '../email/email-compose-send';
import { testSmtpConnection } from '../email/email-smtp';
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  reorderCategories,
  setMessageCategory,
  clearMessageCategory,
  getMessageCategoryId,
  listCategoryCountsForAccount,
  listCategoryCountsForMailScope,
  addInternalNote,
  updateInternalNote,
  deleteInternalNote,
  listInternalNotes,
  listCannedResponses,
  createCannedResponse,
  updateCannedResponse,
  deleteCannedResponse,
  listAiPrompts,
  createAiPrompt,
  updateAiPrompt,
  deleteAiPrompt,
  moveAiPrompt,
  searchMessagesForAccount,
  searchMessagesForMailScope,
  searchMessagesForMailScopeWithMeta,
  searchMessagesForAccountWithMeta,
  backfillCustomerLinksForMessages,
  setMessageCustomerId,
} from '../email/email-crm-store';
import {
  setMessageSnoozedUntil,
  setDraftScheduledSendAt,
  exportMessageAsEml,
} from '../email/email-message-features';
import { fireWebhookWorkflows } from '../email/email-webhook';
import { clearEmailAccountSyncLock } from '../email/email-sync-mutex';
import { getSyncInfo, setSyncInfo } from '../sqlite-service';
import { getSnoozeSettings, setSnoozeSettings } from '../snooze-settings';
import { getAiSettings, setAiSettings, runChatCompletion } from '../email/email-openai';
import {
  ensureReplySuggestion,
  generateAndStoreReplySuggestion,
  getReplySuggestion,
} from '../email/email-reply-ai';
import {
  getReplySuggestionSettings,
  setReplySuggestionSettings,
} from '../email/reply-suggestion-settings';
import { saveEmailAiApiKey, deleteEmailAiApiKey } from '../email/email-ai-keytar';
import {
  AI_PROVIDER_PRESETS,
  clearAiProfileApiKey,
  createAiProfile,
  deleteAiProfile,
  ensureDefaultAiProfiles,
  getAiProfileById,
  listAiProfiles,
  profileHasApiKey,
  resolvePromptProfileId,
  saveAiProfileApiKey,
  updateAiProfile,
  type AiProviderPreset,
} from '../email/email-ai-profiles';
import { syncInboxImap, testImapConnection } from '../email/email-imap-sync';
import { syncInboxPop3, testPop3Connection } from '../email/email-pop3-sync';
import {
  evaluateOutboundWorkflows,
  runInboundWorkflowsForMessage,
  runDraftCreatedWorkflowsForMessage,
} from '../email/email-workflow-engine';
import {
  getMailSecuritySettings,
  saveMailSecuritySettings,
} from '../email/mail-security-settings';
import { runMailSecurityPipeline } from '../email/mail-security-pipeline';
import { checkMessageWithRspamd } from '../email/rspamd-client';
import {
  getGoogleOAuthAppSettings,
  setGoogleOAuthAppSettings,
  buildGoogleOAuthAuthorizeUrl,
  getMicrosoftOAuthAppSettings,
  setMicrosoftOAuthAppSettings,
  buildMicrosoftOAuthAuthorizeUrl,
} from '../email/email-imap-auth';
import { exchangeGoogleAuthCode } from '../email/email-oauth-google';
import { exchangeMicrosoftAuthCode } from '../email/email-oauth-microsoft';
import { restartEmailWorkflowCrons } from '../email/email-imap-services';
import { listAttachmentsForMessage, getAttachmentById } from '../email/email-message-attachments-store';
import { syncSeenFlagToServer } from '../email/email-imap-flags';

const DANGEROUS_ATTACHMENT_EXT = new Set([
  '.exe',
  '.bat',
  '.cmd',
  '.com',
  '.scr',
  '.pif',
  '.msi',
  '.dll',
  '.js',
  '.jse',
  '.vbs',
  '.vbe',
  '.wsf',
  '.wsh',
  '.ps1',
  '.msc',
  '.hta',
  '.sh',
  '.app',
  '.deb',
  '.rpm',
]);

function isPotentiallyDangerousAttachment(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return ext !== '' && DANGEROUS_ATTACHMENT_EXT.has(ext);
}
import {
  extractEmailAddressesFromRecipientField,
  recipientJsonFromField,
} from '../../shared/email-recipient-parse';
import { getEmailReportingSnapshot } from '../email/email-reported-stats';
import { exportEmailGdprPackage } from '../email/email-gdpr-export';
import { definitionToJson, compileGraphToDefinition } from '../email/email-workflow-graph-compile';
import type { WorkflowGraphDocument } from '../../shared/email-workflow-graph';
import {
  listAllWorkflows,
  getWorkflowById,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  clearInboundWorkflowAppliedForMessage,
} from '../email/email-workflow-store';

interface EmailHandlersOptions {
  logger: Pick<typeof console, 'debug' | 'info' | 'warn' | 'error'>;
  isDevelopment: boolean;
}

type Disposer = () => void;

export function registerEmailHandlers(options: EmailHandlersOptions): Disposer {
  const { logger, isDevelopment } = options;
  const disposers: Disposer[] = [];

  disposers.push(
    registerIpcHandler(IPCChannels.Email.ListAccounts, async () => {
      return listEmailAccounts();
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.CreateAccount,
      async (
        _event: IpcMainInvokeEvent,
        payload: {
          displayName: string;
          emailAddress: string;
          imapHost: string;
          imapPort: number;
          imapTls: boolean;
          imapUsername: string;
          imapPassword: string;
          protocol?: 'imap' | 'pop3';
          pop3Host?: string | null;
          pop3Port?: number;
          pop3Tls?: boolean;
          imapSyncSeenOnOpen?: boolean;
        },
      ) => {
        const keytarAccountKey = `email-${randomUUID()}`;
        await saveEmailPassword(keytarAccountKey, payload.imapPassword);
        try {
          const { id } = createEmailAccountRecord({
            displayName: payload.displayName,
            emailAddress: payload.emailAddress,
            imapHost: payload.imapHost,
            imapPort: payload.imapPort,
            imapTls: payload.imapTls,
            imapUsername: payload.imapUsername,
            keytarAccountKey,
            protocol: payload.protocol,
            pop3Host: payload.pop3Host,
            pop3Port: payload.pop3Port,
            pop3Tls: payload.pop3Tls,
            imapSyncSeenOnOpen: payload.imapSyncSeenOnOpen,
          });
          return { success: true as const, id };
        } catch (err) {
          await deleteEmailPassword(keytarAccountKey).catch(() => undefined);
          throw err;
        }
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.UpdateAccount,
      async (
        _event: IpcMainInvokeEvent,
        payload: {
          id: number;
          displayName?: string;
          emailAddress?: string;
          imapHost?: string;
          imapPort?: number;
          imapTls?: boolean;
          imapUsername?: string;
          imapPassword?: string;
          smtpHost?: string | null;
          smtpPort?: number | null;
          smtpTls?: boolean | null;
          smtpUsername?: string | null;
          smtpUseImapAuth?: boolean;
          smtpPassword?: string;
          protocol?: 'imap' | 'pop3';
          pop3Host?: string | null;
          pop3Port?: number | null;
          pop3Tls?: boolean | null;
          sentFolderPath?: string | null;
          imapSyncSeenOnOpen?: boolean;
          vacationEnabled?: boolean;
          vacationSubject?: string | null;
          vacationBodyText?: string | null;
          requestReadReceipt?: boolean;
        },
      ) => {
        const acc = getEmailAccountById(payload.id);
        if (payload.imapPassword && payload.imapPassword.length > 0 && acc) {
          await saveEmailPassword(acc.keytar_account_key, payload.imapPassword);
        }
        let smtpKey = acc?.smtp_keytar_account_key ?? null;
        if (payload.smtpPassword && payload.smtpPassword.length > 0) {
          if (!smtpKey) {
            smtpKey = `email-smtp-${randomUUID()}`;
          }
          await saveEmailPassword(smtpKey, payload.smtpPassword);
        }
        updateEmailAccountRecord(payload.id, {
          displayName: payload.displayName,
          emailAddress: payload.emailAddress,
          imapHost: payload.imapHost,
          imapPort: payload.imapPort,
          imapTls: payload.imapTls,
          imapUsername: payload.imapUsername,
          protocol: payload.protocol,
          pop3Host: payload.pop3Host,
          pop3Port: payload.pop3Port ?? undefined,
          pop3Tls: payload.pop3Tls === undefined ? undefined : Boolean(payload.pop3Tls),
          sentFolderPath: payload.sentFolderPath,
          imapSyncSeenOnOpen: payload.imapSyncSeenOnOpen,
          vacationEnabled: payload.vacationEnabled,
          vacationSubject: payload.vacationSubject,
          vacationBodyText: payload.vacationBodyText,
          requestReadReceipt: payload.requestReadReceipt,
          smtpHost: payload.smtpHost,
          smtpPort: payload.smtpPort ?? undefined,
          smtpTls: payload.smtpTls ?? undefined,
          smtpUsername: payload.smtpUsername ?? undefined,
          smtpUseImapAuth: payload.smtpUseImapAuth,
          smtpKeytarAccountKey: smtpKey,
        });
        return { success: true as const };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.DeleteAccount, async (_event: IpcMainInvokeEvent, id: number) => {
      await deleteEmailAccountRecord(id);
      return { success: true as const };
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.TestImap,
      async (
        _event: IpcMainInvokeEvent,
        payload: {
          accountId?: number;
          imapHost: string;
          imapPort: number;
          imapTls: boolean;
          imapUsername: string;
          imapPassword: string;
        },
      ) => {
        let password = payload.imapPassword?.trim() ?? '';
        let row: EmailAccountRow;
        if (payload.accountId != null && payload.accountId > 0) {
          const acc = getEmailAccountById(payload.accountId);
          if (!acc) return { success: false as const, error: 'Konto nicht gefunden' };
          row = {
            ...acc,
            imap_host: payload.imapHost.trim(),
            imap_port: payload.imapPort,
            imap_tls: payload.imapTls ? 1 : 0,
            imap_username: payload.imapUsername.trim(),
          };
          if (!password) {
            password = (await getEmailPassword(acc.keytar_account_key)) ?? '';
          }
        } else {
          row = {
            id: 0,
            display_name: '',
            email_address: '',
            imap_host: payload.imapHost.trim(),
            imap_port: payload.imapPort,
            imap_tls: payload.imapTls ? 1 : 0,
            imap_username: payload.imapUsername.trim(),
            keytar_account_key: 'test-temp',
            smtp_host: null,
            smtp_port: null,
            smtp_tls: null,
            smtp_username: null,
            smtp_use_imap_auth: 1,
            smtp_keytar_account_key: null,
            protocol: 'imap',
            pop3_host: null,
            pop3_port: 995,
            pop3_tls: 1,
            oauth_provider: null,
            oauth_refresh_keytar_key: null,
            sent_folder_path: 'Sent',
            imap_sync_seen_on_open: 1,
            vacation_enabled: 0,
            vacation_subject: null,
            vacation_body_text: null,
            request_read_receipt: 0,
            created_at: '',
            updated_at: '',
          };
        }
        const result = await testImapConnection(row, password);
        if (result.ok) {
          return { success: true as const };
        }
        return { success: false as const, error: result.error };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.SyncAccount, async (_event: IpcMainInvokeEvent, accountId: number) => {
      try {
        const acc = getEmailAccountById(accountId);
        if (!acc) return { success: false as const, error: 'Konto nicht gefunden' };
        if ((acc.protocol || 'imap') === 'pop3') {
          const result = await syncInboxPop3(accountId);
          return {
            success: true as const,
            fetched: result.fetched,
            folderId: result.folderId,
            lastUid: result.lastUid,
          };
        }
        const result = await syncInboxImap(accountId);
        return { success: true as const, ...result };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        logger.error('[IPC] email:sync-account', e);
        return { success: false as const, error: message };
      }
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.ListMessages,
      async (
        _event: IpcMainInvokeEvent,
        payload: { accountId: number; folderPath?: string; limit?: number; offset?: number },
      ) => {
        const path = payload.folderPath ?? 'INBOX';
        const folder = getFolderByAccountAndPath(payload.accountId, path);
        if (!folder) {
          return [];
        }
        return listMessagesForFolder(folder.id, { limit: payload.limit, offset: payload.offset });
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.GetMessage, async (_event: IpcMainInvokeEvent, messageId: number) => {
      return getEmailMessageById(messageId) ?? null;
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.ListWorkflows, async () => listAllWorkflows(), { logger }),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.GetWorkflow, async (_event: IpcMainInvokeEvent, id: number) => {
      return getWorkflowById(id) ?? null;
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.CreateWorkflow,
      async (
        _event: IpcMainInvokeEvent,
        payload: {
          name: string;
          trigger: string;
          priority?: number;
          definitionJson: string;
          graphJson?: string | null;
          cronExpr?: string | null;
          scheduleAccountId?: number | null;
          enabled?: boolean;
        },
      ) => {
        const id = createWorkflow(payload);
        restartEmailWorkflowCrons(logger);
        return { success: true as const, id };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.UpdateWorkflow,
      async (
        _event: IpcMainInvokeEvent,
        payload: {
          id: number;
          name?: string;
          trigger?: string;
          priority?: number;
          definitionJson?: string;
          graphJson?: string | null;
          cronExpr?: string | null;
          scheduleAccountId?: number | null;
          enabled?: boolean;
        },
      ) => {
        updateWorkflow(payload.id, {
          name: payload.name,
          trigger: payload.trigger,
          priority: payload.priority,
          definitionJson: payload.definitionJson,
          graphJson: payload.graphJson,
          cronExpr: payload.cronExpr,
          scheduleAccountId: payload.scheduleAccountId,
          enabled: payload.enabled,
        });
        restartEmailWorkflowCrons(logger);
        return { success: true as const };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.DeleteWorkflow, async (_event: IpcMainInvokeEvent, id: number) => {
      deleteWorkflow(id);
      restartEmailWorkflowCrons(logger);
      return { success: true as const };
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.ValidateOutbound,
      async (
        _event: IpcMainInvokeEvent,
        payload: {
          messageId: number;
          subject: string;
          bodyText: string;
          bodyHtml?: string;
          to: string;
          cc?: string;
          bcc?: string;
          attachmentCount?: number;
        },
      ) => {
        const result = await evaluateOutboundWorkflows(
          {
            messageId: payload.messageId,
            subject: payload.subject,
            bodyText: payload.bodyText,
            bodyHtml: payload.bodyHtml,
            to: payload.to,
            cc: payload.cc,
            bcc: payload.bcc,
            attachmentCount: payload.attachmentCount ?? 0,
          },
          { dryRun: true },
        );
        return { success: true as const, allowed: result.allowed, reason: result.reason };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.CreateComposeDraft,
      async (
        _event: IpcMainInvokeEvent,
        payload: { accountId: number; subject?: string; bodyText?: string; to?: string },
      ) => {
        const toJson = payload.to?.trim() ? recipientJsonFromField(payload.to) : null;
        const id = createComposeDraft({
          accountId: payload.accountId,
          subject: payload.subject,
          bodyText: payload.bodyText,
          toJson,
        });
        await runDraftCreatedWorkflowsForMessage(id);
        return { success: true as const, id };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.UpdateComposeDraft,
      async (
        _event: IpcMainInvokeEvent,
        payload: {
          messageId: number;
          subject?: string;
          bodyText?: string;
          bodyHtml?: string;
          to?: string;
          cc?: string;
          bcc?: string;
          draftAttachmentPaths?: string[];
          replyParentMessageId?: number | null;
          markReplyParentDone?: boolean;
        },
      ) => {
        const toJson =
          payload.to !== undefined
            ? payload.to.trim()
              ? recipientJsonFromField(payload.to)
              : null
            : undefined;
        const ccJson =
          payload.cc !== undefined
            ? payload.cc.trim()
              ? recipientJsonFromField(payload.cc)
              : null
            : undefined;
        const bccJson =
          payload.bcc !== undefined
            ? payload.bcc.trim()
              ? recipientJsonFromField(payload.bcc)
              : null
            : undefined;
        updateComposeDraft(payload.messageId, {
          subject: payload.subject,
          bodyText: payload.bodyText,
          bodyHtml: payload.bodyHtml,
          toJson,
          ccJson,
          bccJson,
          draftAttachmentPaths: payload.draftAttachmentPaths,
          replyParentMessageId: payload.replyParentMessageId,
        });
        if (payload.markReplyParentDone !== undefined) {
          const { setComposeMarkReplyParentDone } = await import('../email/compose-reply-done');
          setComposeMarkReplyParentDone(payload.messageId, payload.markReplyParentDone);
        }
        return { success: true as const };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.ListMessageTags, async (_event: IpcMainInvokeEvent, messageId: number) => {
      return listTagsForMessage(messageId);
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.AddMessageTag,
      async (_event: IpcMainInvokeEvent, payload: { messageId: number; tag: string }) => {
        addMessageTag(payload.messageId, payload.tag);
        return { success: true as const };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.RemoveMessageTag,
      async (_event: IpcMainInvokeEvent, payload: { messageId: number; tag: string }) => {
        removeMessageTag(payload.messageId, payload.tag);
        return { success: true as const };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.MoveMessageToView,
      async (
        _event: IpcMainInvokeEvent,
        payload: { messageId: number; view: import('../email/email-store').AccountMailView },
      ) => {
        try {
          moveMessageToMailView(payload.messageId, payload.view);
          return { success: true as const };
        } catch (e) {
          return {
            success: false as const,
            error: e instanceof Error ? e.message : 'Verschieben fehlgeschlagen',
          };
        }
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.ListMessagesByView,
      async (
        _event: IpcMainInvokeEvent,
        payload: {
          accountId: number | 'all';
          view: 'inbox' | 'sent' | 'archived' | 'drafts' | 'spam' | 'trash' | 'all';
          limit?: number;
          offset?: number;
          categoryId?: number | null;
          sort?: import('../../shared/email-list-options').MessageListSortMode;
          listFilter?: import('../../shared/email-list-filters').MessageListFilter;
          doneFilter?: import('../../shared/email-done-filter').MessageDoneFilter;
        },
      ) => {
        return listMessagesForMailScope(payload.accountId, payload.view, {
          limit: payload.limit,
          offset: payload.offset,
          categoryId: payload.categoryId,
          sort: payload.sort,
          listFilter: payload.listFilter,
          doneFilter: payload.doneFilter,
        });
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.SearchMessages,
      async (
        _event: IpcMainInvokeEvent,
        payload: {
          accountId: number | 'all';
          query: string;
          limit?: number;
          offset?: number;
          view?: import('../email/email-store').AccountMailView;
          categoryId?: number | null;
          doneFilter?: import('../../shared/email-done-filter').MessageDoneFilter;
        },
      ) => {
        if (payload.accountId !== 'all') {
          const { rows, searchMode, hasMore } = searchMessagesForAccountWithMeta(
            payload.accountId,
            payload.query,
            {
              limit: payload.limit ?? 80,
              offset: payload.offset ?? 0,
              view: payload.view,
              categoryId: payload.categoryId,
              doneFilter: payload.doneFilter,
            },
          );
          return { messages: rows, searchMode, hasMore };
        }
        const { rows, hasMore } = searchMessagesForMailScopeWithMeta(
          payload.accountId,
          payload.query,
          {
            limit: payload.limit ?? 80,
            offset: payload.offset ?? 0,
            view: payload.view,
            categoryId: payload.categoryId,
            doneFilter: payload.doneFilter,
          },
        );
        return { messages: rows, searchMode: 'like' as const, hasMore };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.SnoozeMessage,
      async (_event: IpcMainInvokeEvent, payload: { messageId: number; until: string | null }) => {
        setMessageSnoozedUntil(payload.messageId, payload.until);
        return { success: true as const };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.ScheduleDraftSend,
      async (_event: IpcMainInvokeEvent, payload: { messageId: number; sendAt: string | null }) => {
        setDraftScheduledSendAt(payload.messageId, payload.sendAt);
        if (payload.sendAt) {
          const { clearScheduledSendDraftMeta } = await import('../email/email-scheduled-send-state');
          clearScheduledSendDraftMeta(payload.messageId);
        }
        return { success: true as const };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.GetScheduledSendDraftState,
      async (_event: IpcMainInvokeEvent, messageId: number) => {
        const { getScheduledSendDraftState } = await import('../email/email-scheduled-send-state');
        const s = getScheduledSendDraftState(messageId);
        return {
          success: true as const,
          failureCount: s.failureCount,
          status: s.status,
          lastError: s.lastError,
        };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.ClearScheduledSendDraftFailure,
      async (_event: IpcMainInvokeEvent, messageId: number) => {
        const { clearScheduledSendDraftMeta } = await import('../email/email-scheduled-send-state');
        clearScheduledSendDraftMeta(messageId);
        return { success: true as const };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.RetryScheduledSendDraft,
      async (_event: IpcMainInvokeEvent, messageId: number) => {
        const { clearScheduledSendDraftMeta } = await import('../email/email-scheduled-send-state');
        const { setDraftScheduledSendAt } = await import('../email/email-message-features');
        clearScheduledSendDraftMeta(messageId);
        setDraftScheduledSendAt(messageId, new Date().toISOString());
        return { success: true as const };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.GetComposeDraftRecoveryState,
      async (_event: IpcMainInvokeEvent, draftMessageId: number) => {
        const { getComposeDraftRecoveryState } = await import('../email/email-compose-send');
        const s = getComposeDraftRecoveryState(draftMessageId);
        return { success: true as const, ...s };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.TestVacationAutoReply,
      async (_event: IpcMainInvokeEvent, accountId: number) => {
        const { sendVacationTestReply } = await import('../email/email-vacation');
        const r = await sendVacationTestReply(accountId);
        if (r.ok) return { success: true as const };
        return { success: false as const, error: r.error };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.ExportMessageEml,
      async (_event: IpcMainInvokeEvent, messageId: number) => {
        const r = await exportMessageAsEml(messageId);
        if (r.ok) return { success: true as const, path: r.path };
        return { success: false as const, error: r.error };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.BackfillCustomerLinks,
      async (_event: IpcMainInvokeEvent, payload?: { accountId?: number; limit?: number }) => {
        const count = backfillCustomerLinksForMessages(payload);
        return { success: true as const, count };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.FireWebhookWorkflow,
      async (_event: IpcMainInvokeEvent, payload: { secret: string; body?: Record<string, unknown> }) => {
        const r = await fireWebhookWorkflows(payload);
        if (r.error) return { success: false as const, error: r.error, fired: 0 };
        return { success: true as const, fired: r.fired };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.ClearAccountSyncLock,
      async (_event: IpcMainInvokeEvent, accountId: number) => {
        clearEmailAccountSyncLock(accountId);
        return { success: true as const };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.GetEmailMiscSettings, async () => {
      return {
        webhookSecret: getSyncInfo('email_webhook_secret') ?? '',
        maxAttachmentMb: getSyncInfo('email_max_attachment_mb') ?? '25',
      };
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.ListUidValidityNotices, async () => {
      const { listUidValidityResetNotices } = await import('../email/email-uidvalidity-reset');
      return listUidValidityResetNotices();
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.DismissUidValidityNotice,
      async (_event: IpcMainInvokeEvent, payload: { noticeId: string }) => {
        const { dismissUidValidityResetNotice } = await import('../email/email-uidvalidity-reset');
        dismissUidValidityResetNotice(payload.noticeId);
        return { success: true as const };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.GetLatestWorkflowRunForMessage,
      async (_event: IpcMainInvokeEvent, payload: { messageId: number }) => {
        const { getLatestWorkflowRunForMessage } = await import('../workflow/run-steps');
        return getLatestWorkflowRunForMessage(payload.messageId);
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.GetMailDiagnostics, async () => {
      const { collectMailDiagnostics } = await import('../email/email-diagnostics');
      return collectMailDiagnostics();
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.ExportLocalMailBackup, async () => {
      const { exportLocalMailBackup } = await import('../email/email-local-backup');
      return exportLocalMailBackup();
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.ListImapAuthNotices, async () => {
      const { listImapAuthNotices } = await import('../email/email-imap-auth-notice');
      return listImapAuthNotices();
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.DismissImapAuthNotice,
      async (_event: IpcMainInvokeEvent, payload: { accountId: number }) => {
        const { dismissImapAuthNotice } = await import('../email/email-imap-auth-notice');
        dismissImapAuthNotice(payload.accountId);
        return { success: true as const };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.SetEmailMiscSettings,
      async (
        _event: IpcMainInvokeEvent,
        payload: { webhookSecret?: string; maxAttachmentMb?: number },
      ) => {
        if (payload.webhookSecret !== undefined) {
          setSyncInfo('email_webhook_secret', payload.webhookSecret.trim());
        }
        if (payload.maxAttachmentMb !== undefined) {
          setSyncInfo('email_max_attachment_mb', String(payload.maxAttachmentMb));
        }
        return { success: true as const };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.GetSnoozeSettings, async () => getSnoozeSettings(), {
      logger,
    }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.SetSnoozeSettings,
      async (_event, payload) => {
        setSnoozeSettings(payload);
        return { success: true as const };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.ListConversationMessages,
      async (
        _event: IpcMainInvokeEvent,
        payload: {
          accountId: number | 'all';
          messageId: number;
          ticketCode?: string | null;
          customerId?: number | null;
          correspondentEmail?: string | null;
          limit?: number;
        },
      ) => {
        const { normalizeEmailAddress } = await import('../../shared/email-address-normalize');
        const raw = payload.correspondentEmail?.trim() ?? '';
        const email = raw.includes('@') ? normalizeEmailAddress(raw) : '';
        if (email) {
          return listMessagesByCorrespondentEmail(payload.accountId, {
            email,
            limit: payload.limit,
          });
        }
        return listConversationMessagesForScope(payload.accountId, {
          excludeMessageId: payload.messageId,
          ticketCode: payload.ticketCode,
          customerId: payload.customerId,
          limit: payload.limit,
        });
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.SendCompose,
      async (
        _event: IpcMainInvokeEvent,
        payload: {
          accountId: number;
          draftMessageId: number;
          subject: string;
          bodyText: string;
          bodyHtml?: string | null;
          to: string;
          cc?: string;
          bcc?: string;
          inReplyToMessageId?: number | null;
          attachmentPaths?: string[];
          markReplyParentDone?: boolean;
        },
      ) => {
        const r = await sendComposeDraft(payload);
        if (r.ok) {
          if (r.warning) {
            return { success: true as const, warning: r.warning };
          }
          if (r.recoveredSentAppend) {
            return { success: true as const, recoveredSentAppend: true as const };
          }
          return { success: true as const };
        }
        return {
          success: false as const,
          error: r.error,
          workflowRunId: 'workflowRunId' in r ? r.workflowRunId ?? null : null,
        };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.TestSmtp,
      async (
        _event: IpcMainInvokeEvent,
        payload: {
          accountId?: number;
          host: string;
          port: number;
          secure: boolean;
          user: string;
          password?: string;
          smtpUseImapAuth?: boolean;
        },
      ) => {
        let pass = payload.password?.trim() ?? '';
        let accessToken: string | undefined;
        if (payload.accountId != null && payload.accountId > 0) {
          const acc = getEmailAccountById(payload.accountId);
          if (!acc) return { success: false as const, error: 'Konto nicht gefunden' };
          const useImap = payload.smtpUseImapAuth ?? Boolean(acc.smtp_use_imap_auth);
          if (useImap) {
            const { resolveImapAuth } = await import('../email/email-imap-auth');
            const auth = await resolveImapAuth(acc);
            if ('accessToken' in auth) {
              accessToken = auth.accessToken;
            } else {
              pass = pass || auth.pass;
            }
          } else if (!pass && acc.smtp_keytar_account_key) {
            pass = (await getEmailPassword(acc.smtp_keytar_account_key)) ?? '';
          }
          if (!pass && !accessToken) {
            pass = (await getEmailPassword(acc.keytar_account_key)) ?? '';
          }
        }
        if (!pass && !accessToken) {
          return { success: false as const, error: 'Kein Passwort oder OAuth-Token verfügbar' };
        }
        const r = await testSmtpConnection({
          host: payload.host,
          port: payload.port,
          secure: payload.secure,
          user: payload.user,
          pass: pass || undefined,
          accessToken,
        });
        if (r.ok) return { success: true as const };
        return { success: false as const, error: r.error };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.ListCategories, async () => listCategories(), { logger }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.CreateCategory,
      async (_event: IpcMainInvokeEvent, payload: { name: string; parentId?: number | null }) => {
        const id = createCategory(payload.name, payload.parentId ?? null);
        return { success: true as const, id };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.UpdateCategory,
      async (
        _event: IpcMainInvokeEvent,
        payload: {
          categoryId: number;
          name?: string;
          parentId?: number | null;
          sortOrder?: number;
        },
      ) => {
        try {
          updateCategory(payload.categoryId, {
            name: payload.name,
            parentId: payload.parentId,
            sortOrder: payload.sortOrder,
          });
          return { success: true as const };
        } catch (e) {
          return {
            success: false as const,
            error: e instanceof Error ? e.message : 'Kategorie konnte nicht gespeichert werden',
          };
        }
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.DeleteCategory, async (_event: IpcMainInvokeEvent, categoryId: number) => {
      try {
        deleteCategory(categoryId);
        return { success: true as const };
      } catch (e) {
        return {
          success: false as const,
          error: e instanceof Error ? e.message : 'Kategorie konnte nicht gelöscht werden',
        };
      }
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.ReorderCategories,
      async (
        _event: IpcMainInvokeEvent,
        payload: { updates: { id: number; parentId: number | null; sortOrder: number }[] },
      ) => {
        try {
          reorderCategories(payload.updates);
          return { success: true as const };
        } catch (e) {
          return {
            success: false as const,
            error: e instanceof Error ? e.message : 'Kategorien konnten nicht sortiert werden',
          };
        }
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.SetMessageCategory,
      async (
        _event: IpcMainInvokeEvent,
        payload: { messageId: number; categoryId: number | null },
      ) => {
        if (payload.categoryId == null) {
          clearMessageCategory(payload.messageId);
        } else {
          setMessageCategory(payload.messageId, payload.categoryId);
        }
        return { success: true as const };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.GetMessageCategory, async (_event: IpcMainInvokeEvent, messageId: number) => {
      return { categoryId: getMessageCategoryId(messageId) };
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.CategoryCounts,
      async (_event: IpcMainInvokeEvent, accountId: number | 'all') =>
        listCategoryCountsForMailScope(accountId),
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.MailFolderCounts,
      async (_event: IpcMainInvokeEvent, accountId: number | 'all') =>
        getMailFolderCountsForScope(accountId),
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.AddInternalNote,
      async (_event: IpcMainInvokeEvent, payload: { messageId: number; body: string }) => {
        addInternalNote(payload.messageId, payload.body);
        return { success: true as const };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.UpdateInternalNote,
      async (_event: IpcMainInvokeEvent, payload: { noteId: number; body: string }) => {
        try {
          updateInternalNote(payload.noteId, payload.body);
          return { success: true as const };
        } catch (e) {
          return {
            success: false as const,
            error: e instanceof Error ? e.message : 'Notiz konnte nicht gespeichert werden',
          };
        }
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.DeleteInternalNote, async (_event: IpcMainInvokeEvent, noteId: number) => {
      deleteInternalNote(noteId);
      return { success: true as const };
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.ListInternalNotes, async (_event: IpcMainInvokeEvent, messageId: number) => {
      return listInternalNotes(messageId);
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.ListCannedResponses, async () => listCannedResponses(), { logger }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.SaveCannedResponse,
      async (_event: IpcMainInvokeEvent, payload: { id?: number; title: string; body: string }) => {
        if (payload.id) {
          updateCannedResponse(payload.id, payload.title, payload.body);
          return { success: true as const, id: payload.id };
        }
        const id = createCannedResponse(payload.title, payload.body);
        return { success: true as const, id };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.DeleteCannedResponse, async (_event: IpcMainInvokeEvent, id: number) => {
      deleteCannedResponse(id);
      return { success: true as const };
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.ListAiPrompts, async () => listAiPrompts(), { logger }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.SaveAiPrompt,
      async (
        _event: IpcMainInvokeEvent,
        payload: {
          id?: number;
          label: string;
          userTemplate: string;
          target?: string;
          profileId?: number | null;
        },
      ) => {
        if (payload.id) {
          updateAiPrompt(payload.id, {
            label: payload.label,
            userTemplate: payload.userTemplate,
            target: payload.target,
            profileId: payload.profileId,
          });
          return { success: true as const, id: payload.id };
        }
        const id = createAiPrompt({
          label: payload.label,
          userTemplate: payload.userTemplate,
          target: payload.target,
          profileId: payload.profileId,
        });
        return { success: true as const, id };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.DeleteAiPrompt, async (_event: IpcMainInvokeEvent, id: number) => {
      deleteAiPrompt(id);
      return { success: true as const };
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.ReorderAiPrompt,
      async (
        _event: IpcMainInvokeEvent,
        payload: { id: number; direction: 'up' | 'down' },
      ) => {
        const ok = moveAiPrompt(payload.id, payload.direction);
        return ok
          ? ({ success: true as const } as const)
          : ({ success: false as const, error: 'Verschieben nicht möglich' } as const);
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.GetAiSettings, async () => {
      await ensureDefaultAiProfiles();
      const rows = listAiProfiles();
      const profiles = await Promise.all(
        rows.map(async (p) => ({
          id: p.id,
          label: p.label,
          provider: p.provider,
          baseUrl: p.base_url,
          model: p.model,
          embeddingModel: p.embedding_model,
          isDefault: p.is_default === 1,
          hasApiKey: await profileHasApiKey(p.id),
        })),
      );
      const legacy = getAiSettings();
      return { success: true as const, ...legacy, profiles, providerPresets: AI_PROVIDER_PRESETS };
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.SetAiSettings,
      async (_event: IpcMainInvokeEvent, payload: { baseUrl?: string; model?: string }) => {
        setAiSettings(payload);
        return { success: true as const };
      },
      { logger }),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.SetAiApiKey, async (_event: IpcMainInvokeEvent, key: string) => {
      await saveEmailAiApiKey(key);
      return { success: true as const };
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.ClearAiApiKey, async () => {
      await deleteEmailAiApiKey();
      return { success: true as const };
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.ListAiProfiles, async () => {
      await ensureDefaultAiProfiles();
      return listAiProfiles();
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.SaveAiProfile,
      async (
        _event: IpcMainInvokeEvent,
        payload: {
          id?: number;
          label: string;
          provider: AiProviderPreset;
          baseUrl: string;
          model: string;
          embeddingModel?: string | null;
          isDefault?: boolean;
          apiKey?: string;
        },
      ) => {
        await ensureDefaultAiProfiles();
        let profileId = payload.id;
        if (profileId != null && profileId > 0) {
          updateAiProfile(profileId, {
            label: payload.label,
            provider: payload.provider,
            baseUrl: payload.baseUrl,
            model: payload.model,
            embeddingModel: payload.embeddingModel,
            isDefault: payload.isDefault,
          });
        } else {
          profileId = createAiProfile({
            label: payload.label,
            provider: payload.provider,
            baseUrl: payload.baseUrl,
            model: payload.model,
            embeddingModel: payload.embeddingModel,
            isDefault: payload.isDefault ?? listAiProfiles().length === 0,
          });
        }
        if (payload.apiKey?.trim()) {
          const row = getAiProfileById(profileId) ?? listAiProfiles().find((p) => p.id === profileId);
          if (!row) {
            return { success: false as const, error: 'KI-Profil nicht gefunden (API-Key nicht gespeichert)' };
          }
          try {
            await saveAiProfileApiKey(row.keytar_account, payload.apiKey.trim());
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.error('[IPC] SaveAiProfile keytar failed:', e);
            return {
              success: false as const,
              error: `API-Key konnte nicht im Schlüsselbund gespeichert werden: ${msg}`,
            };
          }
        }
        return { success: true as const, id: profileId };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.DeleteAiProfile, async (_event: IpcMainInvokeEvent, id: number) => {
      deleteAiProfile(id);
      await ensureDefaultAiProfiles();
      return { success: true as const };
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.SetAiProfileApiKey,
      async (_event: IpcMainInvokeEvent, payload: { profileId: number; apiKey: string }) => {
        const row = listAiProfiles().find((p) => p.id === payload.profileId);
        if (!row) return { success: false as const, error: 'Profil nicht gefunden' };
        await saveAiProfileApiKey(row.keytar_account, payload.apiKey.trim());
        return { success: true as const };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.ClearAiProfileApiKey,
      async (_event: IpcMainInvokeEvent, profileId: number) => {
        const row = listAiProfiles().find((p) => p.id === profileId);
        if (!row) return { success: false as const, error: 'Profil nicht gefunden' };
        await clearAiProfileApiKey(row.keytar_account);
        return { success: true as const };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.GetComposeSignature,
      async (_event: IpcMainInvokeEvent, payload: { accountId: number }) => {
        return { html: getComposeSignatureHtml(payload.accountId) };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.ListAccountSignatures, async () => listAccountSignatureRows(), {
      logger,
    }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.SaveAccountSignature,
      async (
        _event: IpcMainInvokeEvent,
        payload: { accountId: number; signatureHtml: string | null },
      ) => {
        saveAccountSignature(payload.accountId, payload.signatureHtml);
        return { success: true as const };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.AiTransformText,
      async (
        _event: IpcMainInvokeEvent,
        payload: { promptId: number; text: string; customerId?: number | null },
      ) => {
        const prompts = listAiPrompts();
        const p = prompts.find((x) => x.id === payload.promptId);
        if (!p) return { success: false as const, error: 'Prompt nicht gefunden' };
        let user = p.user_template.replace(/\{\{text\}\}/g, payload.text);
        let cust: { name?: string; firstName?: string; email?: string } | null = null;
        if (payload.customerId) {
          const row = getCustomerById(payload.customerId);
          if (row) {
            cust = { name: row.name, firstName: row.firstName, email: row.email };
          }
        }
        if (cust) {
          user = user
            .replace(/\{\{customer\.name\}\}/g, cust.name ?? '')
            .replace(/\{\{customer\.firstName\}\}/g, cust.firstName ?? '')
            .replace(/\{\{customer\.email\}\}/g, cust.email ?? '');
        }
        try {
          const profileId = resolvePromptProfileId(p);
          const out = await runChatCompletion(
            'Du bist ein Assistent für geschäftliche E-Mails. Antworte nur mit dem bearbeiteten Text, ohne Einleitung.',
            user,
            profileId,
          );
          return { success: true as const, text: out };
        } catch (e) {
          return { success: false as const, error: e instanceof Error ? e.message : String(e) };
        }
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.GetReplySuggestion,
      async (_event: IpcMainInvokeEvent, messageId: number) => getReplySuggestion(messageId),
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.EnsureReplySuggestion,
      async (
        _event: IpcMainInvokeEvent,
        payload: { messageId: number; force?: boolean; trigger?: 'inbound' | 'open' },
      ) => {
        ensureReplySuggestion(payload.messageId, {
          force: payload.force,
          trigger: payload.trigger,
        });
        return { success: true as const };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.GetReplySuggestionSettings,
      async (_event: IpcMainInvokeEvent, payload?: { accountId?: number }) =>
        getReplySuggestionSettings(payload?.accountId),
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.SetReplySuggestionSettings,
      async (
        _event: IpcMainInvokeEvent,
        payload: Parameters<typeof setReplySuggestionSettings>[0] & { accountId?: number },
      ) => {
        const { accountId, ...partial } = payload;
        return setReplySuggestionSettings(partial, accountId);
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.GenerateReplyDraft,
      async (
        _event: IpcMainInvokeEvent,
        payload: { messageId: number; promptId?: number; customerId?: number | null },
      ) => generateAndStoreReplySuggestion(payload.messageId, {
        promptId: payload.promptId,
        customerId: payload.customerId,
      }),
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.LinkCustomer,
      async (_event: IpcMainInvokeEvent, payload: { messageId: number; customerId: number | null }) => {
        setMessageCustomerId(payload.messageId, payload.customerId);
        return { success: true as const };
      },
      { logger }),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.SoftDeleteMessage, async (_event: IpcMainInvokeEvent, messageId: number) => {
      setMessageSoftDeleted(messageId, true);
      return { success: true as const };
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.BulkSoftDeleteMessages,
      async (
        _event: IpcMainInvokeEvent,
        payload: { messageIds: number[]; accountId?: number },
      ) => {
        try {
          const count = bulkSoftDeleteMessages(payload.messageIds, payload.accountId);
          return { success: true as const, count };
        } catch (e) {
          return {
            success: false as const,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.BulkSetMessagesArchived,
      async (
        _event: IpcMainInvokeEvent,
        payload: { messageIds: number[]; archived: boolean; accountId?: number },
      ) => {
        try {
          const count = bulkSetMessagesArchived(
            payload.messageIds,
            payload.archived,
            payload.accountId,
          );
          return { success: true as const, count };
        } catch (e) {
          return {
            success: false as const,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.BulkSetMessageSpam,
      async (
        _event: IpcMainInvokeEvent,
        payload: { messageIds: number[]; spam: boolean; accountId?: number },
      ) => {
        try {
          const count = bulkSetMessageSpam(
            payload.messageIds,
            payload.spam,
            payload.accountId,
          );
          return { success: true as const, count };
        } catch (e) {
          return {
            success: false as const,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.BulkDeleteComposeDrafts,
      async (_event: IpcMainInvokeEvent, payload: { messageIds: number[] }) => {
        try {
          const count = bulkDeleteLocalComposeDrafts(payload.messageIds);
          return { success: true as const, count };
        } catch (e) {
          return {
            success: false as const,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.DeleteComposeDraft,
      async (_event: IpcMainInvokeEvent, messageId: number) => {
        try {
          deleteLocalComposeDraft(messageId);
          return { success: true as const };
        } catch (e) {
          return {
            success: false as const,
            error: e instanceof Error ? e.message : 'Entwurf konnte nicht gelöscht werden',
          };
        }
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.RestoreMessage, async (_event: IpcMainInvokeEvent, messageId: number) => {
      setMessageSoftDeleted(messageId, false);
      return { success: true as const };
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.SetMessageArchived,
      async (_event: IpcMainInvokeEvent, payload: { messageId: number; archived: boolean }) => {
        setMessageArchived(payload.messageId, payload.archived);
        return { success: true as const };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.PreviewRestoreInboxFromArchive,
      async (_event: IpcMainInvokeEvent, accountId: number) => {
        const preview = previewInboxArchiveRecovery(accountId);
        if (!preview) {
          return { success: false as const, error: 'Konto nicht gefunden' };
        }
        return { success: true as const, ...preview };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.RestoreInboxFromArchive,
      async (
        _event: IpcMainInvokeEvent,
        payload: { accountId: number; expectedCount: number; confirmPhrase: string },
      ) => {
        const result = restoreInboxMessagesFromArchiveSafe(payload);
        if (!result.ok) {
          return { success: false as const, error: result.error };
        }
        logger.warn(
          `[IPC] RestoreInboxFromArchive account=${payload.accountId} restored=${result.restored}`,
        );
        return { success: true as const, restored: result.restored };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.GetMessageRawHeaders,
      async (_event: IpcMainInvokeEvent, messageId: number) => {
        const row = getEmailMessageById(messageId);
        if (!row) return { success: false as const, error: 'Nachricht nicht gefunden' };
        const { listAttachmentsForMessage } = await import('../email/email-message-attachments-store');
        const { buildEmlForMessage, formatEmlDisplayAppendix } = await import('../email/mail-eml-build');
        const attachments = listAttachmentsForMessage(messageId);
        const { eml, meta } = buildEmlForMessage(row, attachments);
        const rawEml = eml + formatEmlDisplayAppendix(row, meta);
        return {
          success: true as const,
          rawEml,
          emlSource: meta.source,
          rawHeaders: row.raw_headers ?? null,
          messageIdHeader: row.message_id ?? null,
          fromJson: row.from_json ?? null,
        };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.GetMailSecuritySettings, async () => {
      return getMailSecuritySettings();
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.SetMailSecuritySettings,
      async (_event: IpcMainInvokeEvent, payload: Parameters<typeof saveMailSecuritySettings>[0]) => {
        saveMailSecuritySettings(payload);
        return { success: true as const };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.GetMessageSecurity,
      async (_event: IpcMainInvokeEvent, messageId: number) => {
        const row = getEmailMessageById(messageId);
        if (!row) return { success: false as const, error: 'Nachricht nicht gefunden' };
        return {
          success: true as const,
          authSpf: row.auth_spf ?? null,
          authDkim: row.auth_dkim ?? null,
          authDmarc: row.auth_dmarc ?? null,
          authArc: row.auth_arc ?? null,
          authDkimDomains: row.auth_dkim_domains ?? null,
          authError: row.auth_error ?? null,
          rspamdScore: row.rspamd_score ?? null,
          rspamdAction: row.rspamd_action ?? null,
          rspamdSymbols: row.rspamd_symbols ?? null,
          rspamdError: row.rspamd_error ?? null,
          securityCheckedAt: row.security_checked_at ?? null,
        };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.RunMailSecurityCheck,
      async (_event: IpcMainInvokeEvent, messageId: number) => {
        const row = getEmailMessageById(messageId);
        if (!row) return { success: false as const, error: 'Nachricht nicht gefunden' };
        const r = await runMailSecurityPipeline(messageId);
        const updated = getEmailMessageById(messageId);
        return {
          success: true as const,
          authChecked: r.authChecked,
          rspamdChecked: r.rspamdChecked,
          authSpf: updated?.auth_spf ?? null,
          authDmarc: updated?.auth_dmarc ?? null,
          rspamdScore: updated?.rspamd_score ?? null,
        };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.TestRspamdConnection,
      async (
        _event: IpcMainInvokeEvent,
        payload: { rspamdUrl?: string; rspamdTimeoutMs?: number } = {},
      ) => {
        const settings = getMailSecuritySettings();
        const baseUrl = (payload.rspamdUrl ?? settings.rspamdUrl).replace(/\/$/, '');
        const timeoutMs = payload.rspamdTimeoutMs ?? settings.rspamdTimeoutMs;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const res = await fetch(`${baseUrl}/stat`, { signal: controller.signal });
          if (!res.ok) {
            return { success: false as const, error: `HTTP ${res.status}` };
          }
          return { success: true as const, message: `Rspamd erreichbar (${baseUrl})` };
        } catch (e) {
          return {
            success: false as const,
            error: e instanceof Error ? e.message : String(e),
          };
        } finally {
          clearTimeout(timer);
        }
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.SetMessageSeen,
      async (
        _event: IpcMainInvokeEvent,
        payload: { messageId: number; seen: boolean; syncToServer?: boolean },
      ) => {
        const row = getEmailMessageById(payload.messageId);
        if (!row) return { success: false as const, error: 'Nachricht nicht gefunden' };
        setMessageSeenLocal(payload.messageId, payload.seen);
        const acc = getEmailAccountById(row.account_id);
        const accountWantsSync =
          acc != null &&
          (acc.protocol || 'imap') === 'imap' &&
          (acc.imap_sync_seen_on_open ?? 1) !== 0;
        const syncToServer =
          payload.syncToServer !== undefined
            ? payload.syncToServer
            : accountWantsSync;
        if (syncToServer) {
          try {
            await syncSeenFlagToServer(row, payload.seen);
          } catch (e) {
            logger.warn('IMAP seen sync failed', e);
          }
        }
        return { success: true as const };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.SetMessageDone,
      async (
        _event: IpcMainInvokeEvent,
        payload: { messageId: number; done: boolean },
      ) => {
        const row = getEmailMessageById(payload.messageId);
        if (!row) return { success: false as const, error: 'Nachricht nicht gefunden' };
        setMessageDoneLocal(payload.messageId, payload.done);
        return { success: true as const };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.SetMessageSpam,
      async (_event: IpcMainInvokeEvent, payload: { messageId: number; spam: boolean }) => {
        setMessageSpam(payload.messageId, payload.spam);
        return { success: true as const };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.PickComposeAttachments,
      async (event: IpcMainInvokeEvent) => {
        void BrowserWindow.fromWebContents(event.sender);
        const result = await dialog.showOpenDialog({
          properties: ['openFile', 'multiSelections'],
        });
        if (result.canceled || result.filePaths.length === 0) {
          return { success: true as const, paths: [] as string[] };
        }
        return { success: true as const, paths: result.filePaths };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.BackfillInboundWorkflows, async () => {
      const pageSize = 500;
      let offset = 0;
      let processed = 0;
      for (;;) {
        const ids = listMessageIdsForWorkflowBackfill(offset, pageSize);
        if (ids.length === 0) break;
        for (const id of ids) {
          clearInboundWorkflowAppliedForMessage(id);
          await runInboundWorkflowsForMessage(id);
          processed += 1;
        }
        offset += pageSize;
      }
      return { success: true as const, processed };
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.ListTeamMembers, async () => listEmailTeamMembers(), { logger }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.SaveTeamMember,
      async (
        _event: IpcMainInvokeEvent,
        payload: {
          id: string;
          displayName: string;
          role?: string;
          signatureHtml?: string | null;
        },
      ) => {
        upsertEmailTeamMember({
          id: payload.id,
          displayName: payload.displayName,
          role: payload.role,
          signatureHtml: payload.signatureHtml,
        });
        return { success: true as const };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.DeleteTeamMember, async (_event: IpcMainInvokeEvent, id: string) => {
      deleteEmailTeamMember(id);
      return { success: true as const };
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.AssignMessage,
      async (_event: IpcMainInvokeEvent, payload: { messageId: number; teamMemberId: string | null }) => {
        setMessageAssignedTo(payload.messageId, payload.teamMemberId);
        return { success: true as const };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.GetGoogleOAuthApp, async () => {
      return { success: true as const, ...getGoogleOAuthAppSettings() };
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.SetGoogleOAuthApp,
      async (_event: IpcMainInvokeEvent, payload: { clientId: string; clientSecret: string }) => {
        setGoogleOAuthAppSettings(payload);
        return { success: true as const };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.BuildGoogleOAuthUrl,
      async (_event: IpcMainInvokeEvent, redirectUri: string) => {
        const { clientId, clientSecret } = getGoogleOAuthAppSettings();
        if (!clientId || !clientSecret) {
          return { success: false as const, error: 'Google OAuth App-Daten fehlen' };
        }
        const url = buildGoogleOAuthAuthorizeUrl({ clientId, clientSecret, redirectUri });
        return { success: true as const, url };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.FinishGoogleOAuth,
      async (
        _event: IpcMainInvokeEvent,
        payload: { accountId: number; redirectUri: string; code: string },
      ) => {
        const acc = getEmailAccountById(payload.accountId);
        if (!acc) return { success: false as const, error: 'Konto nicht gefunden' };
        const { clientId, clientSecret } = getGoogleOAuthAppSettings();
        if (!clientId || !clientSecret) {
          return { success: false as const, error: 'Google OAuth App-Daten fehlen' };
        }
        let refreshKey = acc.oauth_refresh_keytar_key;
        if (!refreshKey) {
          refreshKey = `email-oauth-${randomUUID()}`;
        }
        try {
          await exchangeGoogleAuthCode({
            clientId,
            clientSecret,
            redirectUri: payload.redirectUri,
            code: payload.code,
            keytarRefreshKey: refreshKey,
          });
          updateEmailAccountRecord(payload.accountId, {
            oauthProvider: 'google',
            oauthRefreshKeytarKey: refreshKey,
          });
          return { success: true as const };
        } catch (e) {
          return { success: false as const, error: e instanceof Error ? e.message : String(e) };
        }
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.TestPop3,
      async (
        _event: IpcMainInvokeEvent,
        payload: { accountId?: number; host: string; port: number; tls: boolean; user: string; password: string },
      ) => {
        if (payload.accountId != null) {
          const acc = getEmailAccountById(payload.accountId);
          if (!acc) return { success: false as const, error: 'Konto nicht gefunden' };
          const pw = await getEmailPassword(acc.keytar_account_key);
          if (!pw) return { success: false as const, error: 'Kein Passwort' };
          const r = await testPop3Connection(acc, pw);
          return r.ok ? { success: true as const } : { success: false as const, error: r.error };
        }
        const fakeAcc = {
          id: 0,
          display_name: '',
          email_address: '',
          imap_host: payload.host.trim(),
          imap_port: payload.port,
          imap_tls: payload.tls ? 1 : 0,
          imap_username: payload.user.trim(),
          keytar_account_key: '',
          smtp_host: null,
          smtp_port: null,
          smtp_tls: null,
          smtp_username: null,
          smtp_use_imap_auth: 1,
          smtp_keytar_account_key: null,
          protocol: 'pop3',
          pop3_host: payload.host.trim(),
          pop3_port: payload.port,
          pop3_tls: payload.tls ? 1 : 0,
          oauth_provider: null,
          oauth_refresh_keytar_key: null,
          sent_folder_path: 'Sent',
          created_at: '',
          updated_at: '',
        };
        const r = await testPop3Connection(fakeAcc as EmailAccountRow, payload.password);
        return r.ok ? { success: true as const } : { success: false as const, error: r.error };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.CompileWorkflowGraph,
      async (
        _event: IpcMainInvokeEvent,
        payload: WorkflowGraphDocument | { graphJson: string },
      ) => {
        try {
          let graph: WorkflowGraphDocument;
          if ('graphJson' in payload && typeof payload.graphJson === 'string') {
            graph = JSON.parse(payload.graphJson) as WorkflowGraphDocument;
          } else {
            graph = payload as WorkflowGraphDocument;
          }
          const def = compileGraphToDefinition(graph);
          const registryOnly = graph.nodes.some(
            (n) =>
              n.type === 'registry' ||
              (n.type === 'action' && !('actionType' in (n.data as object))),
          );
          return {
            success: true as const,
            definitionJson: definitionToJson(def),
            registryOnly,
          };
        } catch (e) {
          return {
            success: false as const,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.ListMessageAttachments, async (_event: IpcMainInvokeEvent, messageId: number) => {
      return listAttachmentsForMessage(messageId);
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.SaveAttachmentToDisk,
      async (_event: IpcMainInvokeEvent, payload: { attachmentId: number }) => {
        const row = getAttachmentById(payload.attachmentId);
        if (!row || !fs.existsSync(row.storage_path)) {
          return { success: false as const, error: 'Anhang nicht gefunden' };
        }
        const dlg = (await dialog.showSaveDialog({
          title: 'Anhang speichern',
          defaultPath: row.filename_display,
        })) as unknown as SaveDialogReturnValue;
        const canceled = dlg.canceled;
        const filePath = dlg.filePath;
        if (canceled || !filePath) return { success: false as const, error: 'Abgebrochen' };
        await fs.promises.copyFile(row.storage_path, filePath);
        return { success: true as const };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.OpenAttachmentPath,
      async (
        _event: IpcMainInvokeEvent,
        payload: { attachmentId: number; confirmOpenRisky?: boolean },
      ): Promise<
        | { success: true }
        | { success: false; error: string }
        | { success: false; needsConfirmation: true; reason: 'risky_file_type' }
      > => {
        const row = getAttachmentById(payload.attachmentId);
        if (!row || !fs.existsSync(row.storage_path)) {
          return { success: false as const, error: 'Anhang nicht gefunden' };
        }
        if (isPotentiallyDangerousAttachment(row.filename_display) && !payload.confirmOpenRisky) {
          return { success: false as const, needsConfirmation: true, reason: 'risky_file_type' };
        }
        const err = await shell.openPath(row.storage_path);
        if (err) return { success: false as const, error: err };
        return { success: true as const };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.EmailReporting,
      async (_event: IpcMainInvokeEvent, accountId: number | null) => {
        return { success: true as const, data: getEmailReportingSnapshot(accountId) };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.EmailGdprExport,
      async (_event: IpcMainInvokeEvent, payload?: { skipAttachments?: boolean }) => {
        const r = await exportEmailGdprPackage({ skipAttachments: Boolean(payload?.skipAttachments) });
        return r;
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.GetMicrosoftOAuthApp, async () => {
      return { success: true as const, ...getMicrosoftOAuthAppSettings() };
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.SetMicrosoftOAuthApp,
      async (_event: IpcMainInvokeEvent, payload: { clientId: string; clientSecret: string }) => {
        setMicrosoftOAuthAppSettings(payload);
        return { success: true as const };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.BuildMicrosoftOAuthUrl, async (_event: IpcMainInvokeEvent, redirectUri: string) => {
      const { clientId } = getMicrosoftOAuthAppSettings();
      if (!clientId) return { success: false as const, error: 'Microsoft Client-ID fehlt' };
      const url = buildMicrosoftOAuthAuthorizeUrl({ clientId, redirectUri: redirectUri.trim() });
      return { success: true as const, url };
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.FinishMicrosoftOAuth,
      async (
        _event: IpcMainInvokeEvent,
        payload: { accountId: number; redirectUri: string; code: string },
      ) => {
        const acc = getEmailAccountById(payload.accountId);
        if (!acc) return { success: false as const, error: 'Konto nicht gefunden' };
        const { clientId, clientSecret } = getMicrosoftOAuthAppSettings();
        if (!clientId || !clientSecret) {
          return { success: false as const, error: 'Microsoft App-Daten fehlen' };
        }
        let refreshKey = acc.oauth_refresh_keytar_key;
        if (!refreshKey) refreshKey = `email-ms-oauth-${randomUUID()}`;
        try {
          await exchangeMicrosoftAuthCode({
            clientId,
            clientSecret,
            redirectUri: payload.redirectUri,
            code: payload.code,
            keytarRefreshKey: refreshKey,
          });
          updateEmailAccountRecord(payload.accountId, {
            oauthProvider: 'microsoft',
            oauthRefreshKeytarKey: refreshKey,
          });
          return { success: true as const };
        } catch (e) {
          return { success: false as const, error: e instanceof Error ? e.message : String(e) };
        }
      },
      { logger },
    ),
  );

  if (isDevelopment) {
    logger.debug('[IPC] Email handlers registered');
  }

  return () => {
    disposers.forEach((d) => d());
  };
}
