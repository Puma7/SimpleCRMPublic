import { randomUUID } from 'crypto';
import { IpcMainInvokeEvent, dialog, shell, type SaveDialogReturnValue } from 'electron';
import fs from 'fs';
import { IPCChannels } from '@shared/ipc/channels';
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
  getEmailMessageById,
  createComposeDraft,
  updateComposeDraft,
  listMessageIdsForWorkflowBackfill,
  listTagsForMessage,
  setMessageSoftDeleted,
  setMessageArchived,
  setMessageAssignedTo,
  listEmailTeamMembers,
  upsertEmailTeamMember,
  deleteEmailTeamMember,
  type EmailAccountRow,
} from '../email/email-store';
import { sendComposeDraft } from '../email/email-compose-send';
import { testSmtpConnection } from '../email/email-smtp';
import {
  listCategories,
  createCategory,
  listCategoryCountsForAccount,
  addInternalNote,
  listInternalNotes,
  listCannedResponses,
  createCannedResponse,
  updateCannedResponse,
  deleteCannedResponse,
  listAiPrompts,
  createAiPrompt,
  updateAiPrompt,
  deleteAiPrompt,
  searchMessagesForAccount,
  setMessageCustomerId,
} from '../email/email-crm-store';
import { getAiSettings, setAiSettings, runChatCompletion } from '../email/email-openai';
import { saveEmailAiApiKey, deleteEmailAiApiKey } from '../email/email-ai-keytar';
import { syncInboxImap, testImapConnection } from '../email/email-imap-sync';
import { syncInboxPop3, testPop3Connection } from '../email/email-pop3-sync';
import {
  evaluateOutboundWorkflows,
  runInboundWorkflowsForMessage,
  runDraftCreatedWorkflowsForMessage,
} from '../email/email-workflow-engine';
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
import { getEmailReportingSnapshot } from '../email/email-reported-stats';
import { exportEmailGdprPackage } from '../email/email-gdpr-export';
import { definitionToJson, compileGraphToDefinition } from '../email/email-workflow-graph-compile';
import type { WorkflowGraphDocument } from '@shared/email-workflow-graph';
import {
  listAllWorkflows,
  getWorkflowById,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
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
          imapHost: string;
          imapPort: number;
          imapTls: boolean;
          imapUsername: string;
          imapPassword: string;
        },
      ) => {
        const tempKey = 'test-temp';
        const row = {
          id: 0,
          display_name: '',
          email_address: '',
          imap_host: payload.imapHost.trim(),
          imap_port: payload.imapPort,
          imap_tls: payload.imapTls ? 1 : 0,
          imap_username: payload.imapUsername.trim(),
          keytar_account_key: tempKey,
          smtp_host: null,
          smtp_port: null,
          smtp_tls: null,
          smtp_username: null,
          smtp_use_imap_auth: 1,
          smtp_keytar_account_key: null,
          protocol: 'imap' as const,
          pop3_host: null,
          pop3_port: 995,
          pop3_tls: 1,
          oauth_provider: null,
          oauth_refresh_keytar_key: null,
          sent_folder_path: 'Sent',
          created_at: '',
          updated_at: '',
        };
        const result = await testImapConnection(row, payload.imapPassword);
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
          return { success: true as const, fetched: result.fetched, folderId: result.folderId, lastUid: 0 };
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
        payload: { messageId: number; subject: string; bodyText: string; bodyHtml?: string; to: string; cc?: string },
      ) => {
        const result = evaluateOutboundWorkflows({
          messageId: payload.messageId,
          subject: payload.subject,
          bodyText: payload.bodyText,
          bodyHtml: payload.bodyHtml,
          to: payload.to,
          cc: payload.cc,
        });
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
        const toJson =
          payload.to && payload.to.trim()
            ? JSON.stringify({ value: [{ address: payload.to.trim() }] })
            : null;
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
        payload: { messageId: number; subject?: string; bodyText?: string; bodyHtml?: string; to?: string; cc?: string },
      ) => {
        const toJson =
          payload.to !== undefined
            ? payload.to.trim()
              ? JSON.stringify({ value: [{ address: payload.to.trim() }] })
              : null
            : undefined;
        const ccJson =
          payload.cc !== undefined
            ? payload.cc.trim()
              ? JSON.stringify({ value: [{ address: payload.cc.trim() }] })
              : null
            : undefined;
        updateComposeDraft(payload.messageId, {
          subject: payload.subject,
          bodyText: payload.bodyText,
          bodyHtml: payload.bodyHtml,
          toJson,
          ccJson,
        });
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
      IPCChannels.Email.ListMessagesByView,
      async (
        _event: IpcMainInvokeEvent,
        payload: {
          accountId: number;
          view: 'inbox' | 'sent' | 'archived' | 'drafts' | 'all';
          limit?: number;
          offset?: number;
          categoryId?: number | null;
        },
      ) => {
        return listMessagesForAccountView(payload.accountId, payload.view, {
          limit: payload.limit,
          offset: payload.offset,
          categoryId: payload.categoryId,
        });
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.SearchMessages,
      async (_event: IpcMainInvokeEvent, payload: { accountId: number; query: string; limit?: number }) => {
        return searchMessagesForAccount(payload.accountId, payload.query, payload.limit ?? 80);
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
          inReplyToMessageId?: number | null;
        },
      ) => {
        const r = await sendComposeDraft(payload);
        if (r.ok) return { success: true as const };
        return { success: false as const, error: r.error };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.TestSmtp,
      async (
        _event: IpcMainInvokeEvent,
        payload: { host: string; port: number; secure: boolean; user: string; password: string },
      ) => {
        const r = await testSmtpConnection({
          host: payload.host,
          port: payload.port,
          secure: payload.secure,
          user: payload.user,
          pass: payload.password,
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
    registerIpcHandler(IPCChannels.Email.CategoryCounts, async (_event: IpcMainInvokeEvent, accountId: number) => {
      return listCategoryCountsForAccount(accountId);
    }, { logger }),
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
      async (_event: IpcMainInvokeEvent, payload: { id?: number; label: string; userTemplate: string; target?: string }) => {
        if (payload.id) {
          updateAiPrompt(payload.id, {
            label: payload.label,
            userTemplate: payload.userTemplate,
            target: payload.target,
          });
          return { success: true as const, id: payload.id };
        }
        const id = createAiPrompt({
          label: payload.label,
          userTemplate: payload.userTemplate,
          target: payload.target,
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
    registerIpcHandler(IPCChannels.Email.GetAiSettings, async () => {
      return { success: true as const, ...getAiSettings() };
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
          const out = await runChatCompletion(
            'Du bist ein Assistent für geschäftliche E-Mails. Antworte nur mit dem bearbeiteten Text, ohne Einleitung.',
            user,
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
    registerIpcHandler(IPCChannels.Email.BackfillInboundWorkflows, async () => {
      const ids = listMessageIdsForWorkflowBackfill();
      let processed = 0;
      for (const id of ids) {
        await runInboundWorkflowsForMessage(id);
        processed += 1;
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
      async (_event: IpcMainInvokeEvent, payload: { id: string; displayName: string; role?: string }) => {
        upsertEmailTeamMember(payload);
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
      async (_event: IpcMainInvokeEvent, graph: WorkflowGraphDocument) => {
        const def = compileGraphToDefinition(graph);
        return { success: true as const, definitionJson: definitionToJson(def) };
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
      async (_event: IpcMainInvokeEvent, payload: { attachmentId: number }) => {
        const row = getAttachmentById(payload.attachmentId);
        if (!row || !fs.existsSync(row.storage_path)) {
          return { success: false as const, error: 'Anhang nicht gefunden' };
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
    registerIpcHandler(IPCChannels.Email.EmailGdprExport, async () => {
      const r = await exportEmailGdprPackage();
      return r;
    }, { logger }),
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
