import { randomUUID } from 'crypto';
import { IpcMainInvokeEvent } from 'electron';
import { IPCChannels } from '@shared/ipc/channels';
import { registerIpcHandler } from './register';
import { getCustomerById } from '../sqlite-service';
import { deleteEmailPassword, saveEmailPassword } from '../email/email-keytar';
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
import { evaluateOutboundWorkflows, runInboundWorkflowsForMessage } from '../email/email-workflow-engine';
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
        payload: { name: string; trigger: 'inbound' | 'outbound'; priority?: number; definitionJson: string; enabled?: boolean },
      ) => {
        const id = createWorkflow(payload);
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
          trigger?: 'inbound' | 'outbound';
          priority?: number;
          definitionJson?: string;
          enabled?: boolean;
        },
      ) => {
        updateWorkflow(payload.id, {
          name: payload.name,
          trigger: payload.trigger,
          priority: payload.priority,
          definitionJson: payload.definitionJson,
          enabled: payload.enabled,
        });
        return { success: true as const };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.DeleteWorkflow, async (_event: IpcMainInvokeEvent, id: number) => {
      deleteWorkflow(id);
      return { success: true as const };
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.ValidateOutbound,
      async (
        _event: IpcMainInvokeEvent,
        payload: { messageId: number; subject: string; bodyText: string; to: string; cc?: string },
      ) => {
        const result = evaluateOutboundWorkflows({
          messageId: payload.messageId,
          subject: payload.subject,
          bodyText: payload.bodyText,
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
        payload: { messageId: number; subject?: string; bodyText?: string; to?: string; cc?: string },
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
        runInboundWorkflowsForMessage(id);
        processed += 1;
      }
      return { success: true as const, processed };
    }, { logger }),
  );

  if (isDevelopment) {
    logger.debug('[IPC] Email handlers registered');
  }

  return () => {
    disposers.forEach((d) => d());
  };
}
