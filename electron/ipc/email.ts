import { randomUUID } from 'crypto';
import { BrowserWindow, IpcMainInvokeEvent, dialog, shell, type SaveDialogReturnValue } from 'electron';
import fs from 'fs';
import { IPCChannels } from '../../shared/ipc/channels';
import { buildAiTransformSystemPrompt } from '../../shared/ai-transform-prompt';
import {
  accountOverrideScopeFromPayload,
  type AccountOverrideScopePayload,
} from '../../shared/mail-account-overrides';
import { registerIpcHandler } from './register';
import {
  resolveAuthContext,
  requireAuthSession,
  requireRealAuthSession,
} from '../auth/current-user';
import { canAccessLocalAccount } from '../auth/auth-store';
import type { AccountAccessLevel } from '../auth/account-access';
import type { MailScopeSession } from '../email/email-store';

function mailScopeSessionFromEvent(event: IpcMainInvokeEvent): MailScopeSession {
  const session = resolveAuthContext(event);
  if (!session) throw new Error('Nicht angemeldet');
  return { userId: session.userId, role: session.role };
}

/**
 * Workspace-weite App-Secrets (OAuth-Client-Secrets, Webhook-Secret) sehen nur
 * Owner und Admin im Klartext; alle anderen erfahren nur, ob eines gesetzt ist.
 */
function canReadEmailAppSecrets(event: IpcMainInvokeEvent): boolean {
  const { role } = requireRealAuthSession(event);
  return role === 'owner' || role === 'admin';
}

function oauthAppSettingsForCaller(
  event: IpcMainInvokeEvent,
  settings: { clientId: string; clientSecret: string },
) {
  const hasSecret = settings.clientSecret.length > 0;
  return canReadEmailAppSecrets(event)
    ? { success: true as const, clientId: settings.clientId, clientSecret: settings.clientSecret, hasSecret }
    : { success: true as const, clientId: settings.clientId, hasSecret };
}

/** Ein leeres Secret-Feld beim Speichern behaelt das gespeicherte Secret. */
function oauthAppSettingsUpdate(payload: { clientId: string; clientSecret: string }) {
  return payload.clientSecret.trim()
    ? { clientId: payload.clientId, clientSecret: payload.clientSecret }
    : { clientId: payload.clientId };
}

function canAccessEmailAccount(
  event: IpcMainInvokeEvent,
  accountId: number,
  access: AccountAccessLevel,
): boolean {
  const session = requireRealAuthSession(event);
  return canAccessLocalAccount({
    userId: session.userId,
    accountId,
    access,
    role: session.role,
  });
}

/** C-A30 (G12): Fenster und Sitzung, an die Anhang-Freigaben gebunden sind. */
function composeAttachmentCaller(event: IpcMainInvokeEvent): ComposeAttachmentCaller {
  const session = requireAuthSession(event);
  return {
    webContentsId: event.sender.id,
    sessionId: session.sessionId,
    userId: session.userId,
    role: session.role,
  };
}

/**
 * C-A79 (G5): Ein Elternbezug wird nur gespeichert, wenn der Aufrufer das Konto
 * der Eltern-Mail lesen darf; sonst bleibt das Feld unveraendert (kein Fehler).
 */
function replyParentMessageIdForCaller(
  event: IpcMainInvokeEvent,
  replyParentMessageId: number | null | undefined,
): number | null | undefined {
  if (replyParentMessageId == null) return replyParentMessageId;
  const parent = getEmailMessageById(replyParentMessageId);
  return parent && canAccessEmailAccount(event, parent.account_id, 'ro') ? replyParentMessageId : undefined;
}

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
  listMessageIdsForMailScope,
  bulkSetMessagesDoneLocal,
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
  bulkSetMessageSpamStatus,
  bulkDeleteLocalComposeDrafts,
  deleteLocalComposeDraft,
  setMessageArchived,
  setMessageSeenLocal,
  clearMessageSeenSyncPending,
  setMessageDoneLocal,
  setMessageSpam,
  setMessageSpamStatus,
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
import {
  deleteSpamListEntry,
  listSpamListEntries,
  saveSpamListEntry,
} from '../email/email-spam-store';
import type { SpamStatus } from '../email/email-spam-types';
import { listMessagesByCorrespondentEmail } from '../email/email-correspondent';
import {
  previewInboxArchiveRecovery,
  restoreInboxMessagesFromArchiveSafe,
} from '../email/email-inbox-recovery';
import { sendComposeDraft } from '../email/email-compose-send';
import { clearScheduledSendActor, recordScheduledSendActor } from '../email/email-scheduled-send-actor';
import {
  composeAttachmentPathsError,
  grantComposeAttachmentPaths,
  type ComposeAttachmentCaller,
} from '../email/compose-attachment-grants';
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
  listMessageCategoryAssignments,
  addMessageCategoryAssignment,
  removeMessageCategoryAssignment,
  setMessageCategoriesExact,
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
import { readSyncInfo, writeSyncInfo } from '../sync-info-store';
import { getSnoozeSettings, setSnoozeSettings } from '../snooze-settings';
import {
  getAccountMailSettings,
  setAccountMailSettings,
} from '../email/account-mail-settings-store';
import { getAiSettings, setAiSettings, runChatCompletion, testAiProfileConnection } from '../email/email-openai';
import {
  getEmailAiCustomerTemplateContext,
  type EmailAiCustomerTemplateContext,
} from '../email/email-ai-customer-context-store';
import {
  consumeAllowedOnceRemoteContentLocal,
  setLocalRemoteContentPolicy,
} from '../email/email-remote-content-store';
import {
  getLocalReadReceiptSettings,
  logLocalReadReceiptDeclined,
} from '../email/email-read-receipt-store';
import {
  ensureReplySuggestion,
  generateAndStoreReplySuggestion,
  generateReplyDraftOnly,
  getReplySuggestion,
} from '../email/email-reply-ai';
import {
  getReplySuggestionSettings,
  setReplySuggestionSettings,
} from '../email/reply-suggestion-settings';
import { saveEmailAiApiKey, deleteEmailAiApiKey } from '../email/email-ai-keytar';
import {
  AI_PROVIDER_PRESETS,
  aiProfileMoveNeedsNewApiKey,
  clearAiProfileApiKey,
  createAiProfile,
  deleteAiProfile,
  ensureDefaultAiProfiles,
  getAiProfileById,
  getDefaultAiProfile,
  listAiProfiles,
  profileHasApiKey,
  resolvePromptProfileId,
  saveAiProfileApiKey,
  updateAiProfile,
  type AiProviderPreset,
} from '../email/email-ai-profiles';
import { syncAccountImap, testImapConnection } from '../email/email-imap-sync';
import { syncInboxPop3, testPop3Connection } from '../email/email-pop3-sync';
import {
  evaluateOutboundWorkflows,
  runInboundWorkflowsForMessage,
  runDraftCreatedWorkflowsForMessage,
} from '../email/email-workflow-engine';
import {
  getMailSecuritySettings,
  rspamdUrlDiffersFromStored,
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
import { isPotentiallyDangerousAttachment } from './attachment-open-risk';

import {
  extractEmailAddressesFromRecipientField,
  recipientJsonFromField,
} from '../../shared/email-recipient-parse';
import { scheduledSendPgpBlockReason } from '../../shared/compose-scheduled-send';
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

// Gespeicherte Zugangsdaten (Keytar-Passwort, OAuth-Token) haengen nur an der
// Konto-ID, nicht am Server. Ein Verbindungstest, der sie nutzt, darf daher nur
// den gespeicherten Server mit der gespeicherten Anmeldung ansprechen; sonst
// schickt ein Skript im Renderer jedes gespeicherte Passwort an einen fremden
// Host. Paritaet: useStored in packages/server/src/mail-connection-test.ts.
const STORED_LOGIN_CHANGED_ERROR = 'Host oder Zugang geändert: bitte Passwort erneut eingeben';

type MailLogin = { host: string; port: number; tls: boolean | string; user: string };

function sameMailEndpoint(stored: MailLogin, requested: MailLogin): boolean {
  return stored.host.trim().toLowerCase() === requested.host.trim().toLowerCase()
    && stored.port === requested.port
    && stored.tls === requested.tls;
}

function sameMailLogin(stored: MailLogin, requested: MailLogin): boolean {
  return sameMailEndpoint(stored, requested) && stored.user.trim() === requested.user.trim();
}

function imapLogin(acc: EmailAccountRow): MailLogin {
  return { host: acc.imap_host, port: acc.imap_port, tls: Boolean(acc.imap_tls), user: acc.imap_username };
}

// Wie testPop3Connection und der POP3-Abruf: POP3-Host faellt auf den IMAP-Host zurueck.
function pop3Login(acc: EmailAccountRow): MailLogin {
  return {
    host: acc.pop3_host || acc.imap_host,
    port: acc.pop3_port ?? 995,
    tls: (acc.pop3_tls ?? 1) === 1,
    user: acc.imap_username,
  };
}

// Transportschutz als ein Wert, damit Test (secure + tls) und Versand
// (smtp_tls + Port) vergleichbar sind.
function smtpTransportSecurity(secure: boolean, requireTls: boolean): string {
  if (secure) return 'implicit';
  return requireTls ? 'starttls' : 'none';
}

// Wie sendSmtpForAccount: smtp_tls heisst implizites TLS auf 465, sonst Pflicht-STARTTLS.
function smtpLogin(acc: EmailAccountRow): MailLogin {
  const port = acc.smtp_port ?? 587;
  const tls = Boolean(acc.smtp_tls);
  return {
    host: acc.smtp_host ?? '',
    port,
    tls: smtpTransportSecurity(tls && port === 465, tls && port !== 465),
    user: acc.smtp_use_imap_auth ? acc.imap_username : acc.smtp_username?.trim() || acc.imap_username,
  };
}

// Abruf, Versand und Verbindungstest schicken die gespeicherten Zugangsdaten an
// den Server, den die Kontozeile nennt. Aendert sich Host, Port oder TLS eines
// Protokolls, muss daher das Passwort mitkommen, mit dem es sich anmeldet
// (IMAP/POP3: IMAP-Passwort; SMTP: bei "wie IMAP" das IMAP-, sonst das
// SMTP-Passwort); das Umschalten von "wie IMAP" zaehlt ebenso. Paritaet zu
// A2a-01/E2: missingCredentialsForEndpointChange in packages/server/src/api/mail-routes.ts.
// Liefert je Passwort die Protokolle, deren Server sich aendert.
function credentialsForEndpointChange(
  current: EmailAccountRow,
  next: EmailAccountRow,
): Map<'imapPassword' | 'smtpPassword', string[]> {
  const checks = [
    { protocol: 'IMAP', login: imapLogin, credential: 'imapPassword', switched: false },
    { protocol: 'POP3', login: pop3Login, credential: 'imapPassword', switched: false },
    {
      protocol: 'SMTP',
      login: smtpLogin,
      credential: next.smtp_use_imap_auth ? 'imapPassword' : 'smtpPassword',
      switched: Boolean(next.smtp_use_imap_auth) !== Boolean(current.smtp_use_imap_auth),
    },
  ] as const;
  const required = new Map<'imapPassword' | 'smtpPassword', string[]>();
  for (const check of checks) {
    const after = check.login(next);
    // Ein geleerter Host schaltet das Protokoll ab; dann geht nichts an einen Server.
    if (!after.host.trim()) continue;
    if (!check.switched && sameMailEndpoint(check.login(current), after)) continue;
    required.set(check.credential, [...(required.get(check.credential) ?? []), check.protocol]);
  }
  return required;
}

function missingCredentialsError(
  required: Map<'imapPassword' | 'smtpPassword', string[]>,
  fresh: { imapPassword: boolean; smtpPassword: boolean },
): string | null {
  const missing = [...required].filter(([field]) => !fresh[field]);
  if (missing.length === 0) return null;
  const details = missing.map(([field, protocols]) =>
    `${field === 'imapPassword' ? 'IMAP-Passwort' : 'SMTP-Passwort'} erforderlich (${
      protocols.map((protocol) => `${protocol}-Server`).join(', ')
    } geaendert)`);
  return `Zugangsdaten bei Serverwechsel neu eingeben: ${details.join('; ')}`;
}

// Wie resolveImapAuth: ein verknuepftes Google-/Microsoft-Konto meldet sich mit
// dem OAuth-Token an, auch wenn ein IMAP-Passwort gespeichert ist.
function usesOAuthLogin(acc: EmailAccountRow): boolean {
  return (acc.oauth_provider === 'google' || acc.oauth_provider === 'microsoft')
    && Boolean(acc.oauth_refresh_keytar_key);
}

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
      // Kontoverwaltung wie mail.account.manage auf dem Server: nur Owner/Admin.
      { logger, requireRole: ['owner', 'admin'] },
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
          syncSpamFolderPath?: string | null;
          syncArchiveFolderPath?: string | null;
          imapSyncSent?: boolean;
          imapSyncArchive?: boolean;
          imapSyncSpam?: boolean;
          imapSyncSeenOnOpen?: boolean;
          vacationEnabled?: boolean;
          vacationSubject?: string | null;
          vacationBodyText?: string | null;
          requestReadReceipt?: boolean;
          imapDeleteOptIn?: boolean;
        },
      ) => {
        const acc = getEmailAccountById(payload.id);
        let replaceOAuthLogin = false;
        if (acc) {
          // Vor dem Speichern der Passwoerter: eine abgelehnte Aenderung darf
          // auch den Schluesselbund nicht anfassen. Die Werte folgen der
          // Zuordnung an updateEmailAccountRecord unten (null bei Port/SMTP-TLS
          // laesst den gespeicherten Wert stehen).
          const required = credentialsForEndpointChange(acc, {
            ...acc,
            imap_host: payload.imapHost ?? acc.imap_host,
            imap_port: payload.imapPort ?? acc.imap_port,
            imap_tls: payload.imapTls === undefined ? acc.imap_tls : Number(payload.imapTls),
            smtp_host: payload.smtpHost === undefined ? acc.smtp_host : payload.smtpHost,
            smtp_port: payload.smtpPort ?? acc.smtp_port,
            smtp_tls: payload.smtpTls == null ? acc.smtp_tls : Number(payload.smtpTls),
            smtp_use_imap_auth: payload.smtpUseImapAuth === undefined
              ? acc.smtp_use_imap_auth
              : Number(payload.smtpUseImapAuth),
            pop3_host: payload.pop3Host === undefined ? acc.pop3_host : payload.pop3Host,
            pop3_port: payload.pop3Port ?? acc.pop3_port,
            pop3_tls: payload.pop3Tls === undefined ? acc.pop3_tls : Number(Boolean(payload.pop3Tls)),
          });
          const missing = missingCredentialsError(required, {
            imapPassword: Boolean(payload.imapPassword),
            smtpPassword: Boolean(payload.smtpPassword),
          });
          if (missing) return { success: false as const, error: missing };
          // Auf dem Desktop hat das OAuth-Token Vorrang vor dem IMAP-Passwort
          // (resolveImapAuth). Verlangt der Serverwechsel das IMAP-Passwort, ersetzt
          // das neue Passwort daher die OAuth-Verknuepfung; sonst ginge das Token an
          // den neuen Server. Auf dem Server hat das Passwort ohnehin Vorrang.
          replaceOAuthLogin = required.has('imapPassword') && usesOAuthLogin(acc);
        }
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
          syncSpamFolderPath: payload.syncSpamFolderPath,
          syncArchiveFolderPath: payload.syncArchiveFolderPath,
          imapSyncSent: payload.imapSyncSent,
          imapSyncArchive: payload.imapSyncArchive,
          imapSyncSpam: payload.imapSyncSpam,
          imapSyncSeenOnOpen: payload.imapSyncSeenOnOpen,
          vacationEnabled: payload.vacationEnabled,
          vacationSubject: payload.vacationSubject,
          vacationBodyText: payload.vacationBodyText,
          requestReadReceipt: payload.requestReadReceipt,
          imapDeleteOptIn: payload.imapDeleteOptIn,
          smtpHost: payload.smtpHost,
          smtpPort: payload.smtpPort ?? undefined,
          smtpTls: payload.smtpTls ?? undefined,
          smtpUsername: payload.smtpUsername ?? undefined,
          smtpUseImapAuth: payload.smtpUseImapAuth,
          smtpKeytarAccountKey: smtpKey,
          ...(replaceOAuthLogin ? { oauthProvider: null, oauthRefreshKeytarKey: null } : {}),
        });
        // Access-Tokens werden nicht zwischengespeichert (jeder Connect holt sie
        // ueber den Refresh-Token), es genuegt also, diesen zu loeschen.
        if (replaceOAuthLogin && acc?.oauth_refresh_keytar_key) {
          await deleteEmailPassword(acc.oauth_refresh_keytar_key).catch((err: unknown) => {
            logger.warn('[IPC] UpdateAccount: OAuth-Refresh-Token nicht geloescht', err);
          });
        }
        return { success: true as const };
      },
      { logger, accountAccess: 'rw', requireRole: ['owner', 'admin'] },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.DeleteAccount, async (_event: IpcMainInvokeEvent, id: number) => {
      await deleteEmailAccountRecord(id);
      return { success: true as const };
    }, { logger, accountAccess: 'rw', requireRole: ['owner', 'admin'] }),
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
            if (!sameMailLogin(imapLogin(acc), imapLogin(row))) {
              return { success: false as const, error: STORED_LOGIN_CHANGED_ERROR };
            }
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
            sync_spam_folder_path: null,
            sync_archive_folder_path: null,
            imap_sync_sent: 0,
            imap_sync_archive: 0,
            imap_sync_spam: 0,
            imap_delete_opt_in: 0,
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
      // Verbindungstests gehoeren zur Kontoverwaltung (E16): mit accountId nutzen
      // sie die gespeicherten Zugangsdaten, dann nur gegen den gespeicherten
      // Server; ohne accountId dienen sie dem Anlegen. Beides nur Owner/Admin.
      { logger, requireRole: ['owner', 'admin'] },
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
        const result = await syncAccountImap(accountId);
        const inbox =
          result.folders.find((f) => f.folderPath.toUpperCase() === 'INBOX') ??
          result.folders[0];
        return {
          success: true as const,
          fetched: result.totalFetched,
          folderId: inbox?.folderId ?? 0,
          lastUid: inbox?.lastUid ?? 0,
          foldersSynced: result.folders.length,
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        logger.error('[IPC] email:sync-account', e);
        return { success: false as const, error: message };
      }
    }, { logger, accountAccess: 'ro' }),
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
      { logger, accountAccess: 'ro' },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.GetMessage, async (_event: IpcMainInvokeEvent, messageId: number) => {
      return getEmailMessageById(messageId) ?? null;
    }, { logger, accountAccess: 'ro' }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.ListWorkflows,
      async (_event: IpcMainInvokeEvent, payload?: AccountOverrideScopePayload) =>
        listAllWorkflows(accountOverrideScopeFromPayload(payload)),
      { logger, accountAccess: 'ro' },
    ),
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
      // G1: Cron/Inbound fuehren gespeicherte Workflows (inkl. Code-Knoten) ohne
      // weitere Rollenpruefung im Main-Prozess aus — anlegen, aendern und
      // loeschen darum nur Owner/Admin, wie ExecuteWorkflowNow.
      { logger, requireRole: ['owner', 'admin'] },
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
      { logger, requireRole: ['owner', 'admin'] },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.DeleteWorkflow, async (_event: IpcMainInvokeEvent, id: number) => {
      deleteWorkflow(id);
      restartEmailWorkflowCrons(logger);
      return { success: true as const };
    }, { logger, requireRole: ['owner', 'admin'] }),
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
        if (result.allowed) {
          const { applyManualComposeOutboundApproval } = await import('../email/outbound-approval.js');
          applyManualComposeOutboundApproval(payload.messageId, {
            subject: payload.subject,
            bodyText: payload.bodyText,
            bodyHtml: payload.bodyHtml ?? null,
            to: payload.to,
            cc: payload.cc ?? null,
            bcc: payload.bcc ?? null,
          });
        }
        return { success: true as const, allowed: result.allowed, reason: result.reason };
      },
      { logger, accountAccess: 'rw' },
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
      { logger, accountAccess: 'rw' },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.UpdateComposeDraft,
      async (
        event: IpcMainInvokeEvent,
        payload: {
          messageId: number;
          accountId?: number;
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
        // Moving the draft (composer "Von" switch) places it in the target account:
        // require the same access there as CreateComposeDraft. The IPC gate already
        // checked the draft's current account (ipc-account-scope).
        if (payload.accountId !== undefined && !canAccessEmailAccount(event, payload.accountId, 'rw')) {
          throw new Error('Kein Zugriff auf dieses Konto');
        }
        const attachmentError = composeAttachmentPathsError(
          composeAttachmentCaller(event),
          payload.messageId,
          payload.draftAttachmentPaths,
        );
        if (attachmentError) throw new Error(attachmentError);
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
        // TA-P3: Inhalt vor dem Speichern festhalten (nur bei KI-/Workflow-Herkunft).
        const sentProvenance = await import('../email/email-sent-provenance.js');
        const originBefore = sentProvenance.readDraftOriginContent(payload.messageId);
        updateComposeDraft(payload.messageId, {
          accountId: payload.accountId,
          subject: payload.subject,
          bodyText: payload.bodyText,
          bodyHtml: payload.bodyHtml,
          toJson,
          ccJson,
          bccJson,
          draftAttachmentPaths: payload.draftAttachmentPaths,
          replyParentMessageId: replyParentMessageIdForCaller(event, payload.replyParentMessageId),
        });
        // Ein Mensch hat einen KI-/Workflow-Entwurf tatsächlich geändert (kein
        // „KI · freigegeben“ mehr); bloßes Speichern ohne Änderung zählt nicht.
        sentProvenance.markDraftOriginEditedIfChanged(payload.messageId, originBefore);
        if (payload.markReplyParentDone !== undefined) {
          const { setComposeMarkReplyParentDone } = await import('../email/compose-reply-done.js');
          setComposeMarkReplyParentDone(payload.messageId, payload.markReplyParentDone);
        }
        return { success: true as const };
      },
      { logger, accountAccess: 'rw' },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.ListMessageTags, async (_event: IpcMainInvokeEvent, messageId: number) => {
      return listTagsForMessage(messageId);
    }, { logger, accountAccess: 'ro' }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.AddMessageTag,
      async (_event: IpcMainInvokeEvent, payload: { messageId: number; tag: string }) => {
        addMessageTag(payload.messageId, payload.tag);
        return { success: true as const };
      },
      { logger, accountAccess: 'rw' },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.RemoveMessageTag,
      async (_event: IpcMainInvokeEvent, payload: { messageId: number; tag: string }) => {
        removeMessageTag(payload.messageId, payload.tag);
        return { success: true as const };
      },
      { logger, accountAccess: 'rw' },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.MoveMessageToView,
      async (
        _event: IpcMainInvokeEvent,
        payload: { messageId: number; view: import('../email/email-store.js').AccountMailView },
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
      { logger, accountAccess: 'rw' },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.ListMessagesByView,
      async (event: IpcMainInvokeEvent, payload: {
          accountId: number | 'all';
          view: 'inbox' | 'sent' | 'sent_ai' | 'archived' | 'drafts' | 'scheduled_send' | 'spam_review' | 'spam' | 'trash' | 'snoozed' | 'all';
          limit?: number;
          offset?: number;
          categoryId?: number | null;
          sort?: import('../../shared/email-list-options.js').MessageListSortMode;
          listFilter?: import('../../shared/email-list-filters.js').MessageListFilter;
          doneFilter?: import('../../shared/email-done-filter.js').MessageDoneFilter;
        }) => {
        const access =
          payload.accountId === 'all' ? mailScopeSessionFromEvent(event) : undefined;
        return listMessagesForMailScope(payload.accountId, payload.view, {
          limit: payload.limit,
          offset: payload.offset,
          categoryId: payload.categoryId,
          sort: payload.sort,
          listFilter: payload.listFilter,
          doneFilter: payload.doneFilter,
        }, access);
      },
      { logger, accountAccess: 'ro' },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.ListMessageIdsByView,
      async (event: IpcMainInvokeEvent, payload: {
          accountId: number | 'all';
          view: 'inbox' | 'sent' | 'sent_ai' | 'archived' | 'drafts' | 'scheduled_send' | 'spam_review' | 'spam' | 'trash' | 'snoozed' | 'all';
          limit?: number;
          offset?: number;
          categoryId?: number | null;
          listFilter?: import('../../shared/email-list-filters.js').MessageListFilter;
          doneFilter?: import('../../shared/email-done-filter.js').MessageDoneFilter;
        }) => {
        const access =
          payload.accountId === 'all' ? mailScopeSessionFromEvent(event) : undefined;
        return listMessageIdsForMailScope(payload.accountId, payload.view, {
          limit: payload.limit,
          offset: payload.offset,
          categoryId: payload.categoryId,
          listFilter: payload.listFilter,
          doneFilter: payload.doneFilter,
        }, access);
      },
      { logger, accountAccess: 'ro' },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.SearchMessages,
      async (event: IpcMainInvokeEvent, payload: {
          accountId: number | 'all';
          query: string;
          limit?: number;
          offset?: number;
          view?: import('../email/email-store.js').AccountMailView;
          categoryId?: number | null;
          doneFilter?: import('../../shared/email-done-filter.js').MessageDoneFilter;
          scope?: import('../../shared/email-search-scope.js').MessageSearchScope;
          sort?: import('../email/email-crm-store.js').MessageSearchSort;
        }) => {
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
              scope: payload.scope,
              sort: payload.sort,
            },
          );
          return { messages: rows, searchMode, hasMore };
        }
        const access = mailScopeSessionFromEvent(event);
        const { rows, searchMode, hasMore } = searchMessagesForMailScopeWithMeta(
          payload.accountId,
          payload.query,
          {
            limit: payload.limit ?? 80,
            offset: payload.offset ?? 0,
            view: payload.view,
            categoryId: payload.categoryId,
            doneFilter: payload.doneFilter,
            scope: payload.scope,
            sort: payload.sort,
          },
          access,
        );
        return { messages: rows, searchMode, hasMore };
      },
      { logger, accountAccess: 'ro' },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.SnoozeMessage,
      async (_event: IpcMainInvokeEvent, payload: { messageId: number; until: string | null }) => {
        setMessageSnoozedUntil(payload.messageId, payload.until);
        return { success: true as const };
      },
      { logger, accountAccess: 'rw' },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.ScheduleDraftSend,
      async (
        event: IpcMainInvokeEvent,
        payload: { messageId: number; sendAt: string | null; pgpEncrypt?: boolean; pgpSign?: boolean },
      ) => {
        if (payload.sendAt) {
          const pgpBlockReason = scheduledSendPgpBlockReason(payload);
          if (pgpBlockReason) {
            return { success: false as const, error: pgpBlockReason };
          }
          const draft = getEmailMessageById(payload.messageId);
          if (!draft) {
            return { success: false as const, error: 'Entwurf nicht gefunden' };
          }
          const { recipientFieldFromJson } = await import('../../shared/email-recipient-parse.js');
          const { parseDraftAttachmentPathsJson } = await import('../../shared/compose-draft-attachments.js');
          const result = await evaluateOutboundWorkflows(
            {
              messageId: payload.messageId,
              accountId: draft.account_id,
              subject: draft.subject ?? '',
              bodyText: draft.body_text ?? '',
              bodyHtml: draft.body_html ?? undefined,
              to: recipientFieldFromJson(draft.to_json),
              cc: recipientFieldFromJson(draft.cc_json) || undefined,
              bcc: recipientFieldFromJson(draft.bcc_json) || undefined,
              attachmentCount: parseDraftAttachmentPathsJson(draft.draft_attachment_paths_json).length,
              attachmentPaths: parseDraftAttachmentPathsJson(draft.draft_attachment_paths_json),
            },
            { dryRun: true },
          );
          if (!result.allowed) {
            return {
              success: false as const,
              error: result.reason ?? 'Ausgangspruefung wuerde den Versand blockieren',
            };
          }
          const { applyManualComposeOutboundApproval } = await import('../email/outbound-approval.js');
          applyManualComposeOutboundApproval(payload.messageId, {
            subject: draft.subject ?? '',
            bodyText: draft.body_text ?? '',
            bodyHtml: draft.body_html ?? null,
            to: recipientFieldFromJson(draft.to_json),
            cc: recipientFieldFromJson(draft.cc_json) || null,
            bcc: recipientFieldFromJson(draft.bcc_json) || null,
            attachmentPaths: parseDraftAttachmentPathsJson(draft.draft_attachment_paths_json),
          });
        }
        // C-A2 (G6): Wer plant, wird fuer die Rechtepruefung beim Versand gespeichert.
        if (payload.sendAt) {
          recordScheduledSendActor(payload.messageId, requireAuthSession(event));
        } else {
          clearScheduledSendActor(payload.messageId);
        }
        setDraftScheduledSendAt(payload.messageId, payload.sendAt);
        if (payload.sendAt) {
          const { clearScheduledSendDraftMeta } = await import('../email/email-scheduled-send-state.js');
          clearScheduledSendDraftMeta(payload.messageId);
        }
        return { success: true as const };
      },
      { logger, accountAccess: 'rw' },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.GetScheduledSendDraftState,
      async (_event: IpcMainInvokeEvent, messageId: number) => {
        const { getScheduledSendDraftState } = await import('../email/email-scheduled-send-state.js');
        const s = getScheduledSendDraftState(messageId);
        return {
          success: true as const,
          failureCount: s.failureCount,
          status: s.status,
          lastError: s.lastError,
        };
      },
      { logger, accountAccess: 'ro' },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.ClearScheduledSendDraftFailure,
      async (_event: IpcMainInvokeEvent, messageId: number) => {
        const { clearScheduledSendDraftMeta } = await import('../email/email-scheduled-send-state.js');
        clearScheduledSendDraftMeta(messageId);
        return { success: true as const };
      },
      { logger, accountAccess: 'rw' },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.RetryScheduledSendDraft,
      async (event: IpcMainInvokeEvent, messageId: number) => {
        const { clearScheduledSendDraftMeta } = await import('../email/email-scheduled-send-state.js');
        const { setDraftScheduledSendAt } = await import('../email/email-message-features.js');
        clearScheduledSendDraftMeta(messageId);
        recordScheduledSendActor(messageId, requireAuthSession(event));
        setDraftScheduledSendAt(messageId, new Date().toISOString());
        return { success: true as const };
      },
      { logger, accountAccess: 'rw' },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.GetComposeDraftRecoveryState,
      async (_event: IpcMainInvokeEvent, draftMessageId: number) => {
        const { getComposeDraftRecoveryState } = await import('../email/email-compose-send.js');
        const s = getComposeDraftRecoveryState(draftMessageId);
        return { success: true as const, ...s };
      },
      { logger, accountAccess: 'ro' },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.TestVacationAutoReply,
      async (_event: IpcMainInvokeEvent, accountId: number) => {
        const { sendVacationTestReply } = await import('../email/email-vacation.js');
        const r = await sendVacationTestReply(accountId);
        if (r.ok) return { success: true as const };
        return { success: false as const, error: r.error };
      },
      { logger, accountAccess: 'rw' },
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
      { logger, accountAccess: 'ro' },
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
      // Wie ExecuteWorkflowNow: das Secret allein berechtigt nicht zum Ausloesen von Workflows.
      { logger, requireRole: ['owner', 'admin'] },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.ClearAccountSyncLock,
      async (_event: IpcMainInvokeEvent, accountId: number) => {
        clearEmailAccountSyncLock(accountId);
        return { success: true as const };
      },
      { logger, accountAccess: 'rw' },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.GetEmailMiscSettings, async (event: IpcMainInvokeEvent) => {
      const webhookSecret = readSyncInfo('email_webhook_secret') ?? '';
      const maxAttachmentMb = readSyncInfo('email_max_attachment_mb') ?? '25';
      const hasSecret = webhookSecret.length > 0;
      return canReadEmailAppSecrets(event)
        ? { webhookSecret, maxAttachmentMb, hasSecret }
        : { maxAttachmentMb, hasSecret };
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.ListUidValidityNotices, async () => {
      const { listUidValidityResetNotices } = await import('../email/email-uidvalidity-reset.js');
      return listUidValidityResetNotices();
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.DismissUidValidityNotice,
      async (_event: IpcMainInvokeEvent, payload: { noticeId: string }) => {
        const { dismissUidValidityResetNotice } = await import('../email/email-uidvalidity-reset.js');
        dismissUidValidityResetNotice(payload.noticeId);
        return { success: true as const };
      },
      { logger, accountAccess: 'rw' },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.GetLatestWorkflowRunForMessage,
      async (_event: IpcMainInvokeEvent, payload: { messageId: number }) => {
        const { getLatestWorkflowRunForMessage } = await import('../workflow/run-steps.js');
        return getLatestWorkflowRunForMessage(payload.messageId);
      },
      { logger, accountAccess: 'ro' },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.GetMailDiagnostics, async () => {
      const { collectMailDiagnostics } = await import('../email/email-diagnostics.js');
      return collectMailDiagnostics();
    }, { logger }),
  );

  // Vollbackup: alle Mails aller Konten und die Passwort-Hashes der App-Benutzer.
  disposers.push(
    registerIpcHandler(IPCChannels.Email.ExportLocalMailBackup, async () => {
      const { exportLocalMailBackup } = await import('../email/email-local-backup.js');
      return exportLocalMailBackup();
    }, { logger, requireRole: ['owner', 'admin'] }),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.VerifyLocalMailBackup, async () => {
      const { verifyLocalMailBackup } = await import('../email/email-local-backup.js');
      return verifyLocalMailBackup();
    }, { logger, requireRole: ['owner', 'admin'] }),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.PickLocalMailBackupZip, async () => {
      const { pickLocalMailBackupZip } = await import('../email/email-local-restore.js');
      return pickLocalMailBackupZip();
    }, { logger, requireAuth: true, requireRealSession: true, requireRole: ['owner'] }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.PreviewRestoreLocalMailBackup,
      async (_event, payload: { zipPath: string }) => {
        const { previewRestoreLocalMailBackup } = await import('../email/email-local-restore.js');
        return previewRestoreLocalMailBackup(payload.zipPath);
      },
      { logger, requireAuth: true, requireRealSession: true, requireRole: ['owner'] },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.RestoreLocalMailBackup,
      async (
        _event,
        payload: {
          zipPath: string;
          previewToken: string;
          confirmPhrase: string;
          createPreBackup: boolean;
        },
      ) => {
        const { restoreLocalMailBackup } = await import('../email/email-local-restore.js');
        return restoreLocalMailBackup(payload);
      },
      // Ersetzt database.sqlite samt Benutzertabelle: so kritisch wie der Hard-Reset (nur Owner).
      { logger, requireAuth: true, requireRealSession: true, requireRole: ['owner'] },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.ListImapAuthNotices, async () => {
      const { listImapAuthNotices } = await import('../email/email-imap-auth-notice.js');
      return listImapAuthNotices();
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.DismissImapAuthNotice,
      async (_event: IpcMainInvokeEvent, payload: { accountId: number }) => {
        const { dismissImapAuthNotice } = await import('../email/email-imap-auth-notice.js');
        dismissImapAuthNotice(payload.accountId);
        return { success: true as const };
      },
      { logger, accountAccess: 'rw' },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.SetEmailMiscSettings,
      async (
        _event: IpcMainInvokeEvent,
        payload: { webhookSecret?: string; maxAttachmentMb?: number },
      ) => {
        // Anders als bei den OAuth-App-Secrets heisst leer hier "entfernen":
        // ohne Secret nimmt der Webhook-Eingang nichts mehr an, das ist der
        // Weg, ihn abzuschalten. Nur Owner/Admin speichern, und sie bekommen
        // das Secret im Formular vorbefuellt.
        if (payload.webhookSecret !== undefined) {
          writeSyncInfo('email_webhook_secret', payload.webhookSecret.trim());
        }
        if (payload.maxAttachmentMb !== undefined) {
          writeSyncInfo('email_max_attachment_mb', String(payload.maxAttachmentMb));
        }
        return { success: true as const };
      },
      { logger, requireRole: ['owner', 'admin'] },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.GetSnoozeSettings, async () => getSnoozeSettings(), {
      logger,
    }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.GetAccountMailSettings,
      async (_event, payload: { accountId: number }) =>
        getAccountMailSettings(payload.accountId),
      { logger, accountAccess: 'ro' },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.SetAccountMailSettings,
      async (
        _event,
        payload: {
          accountId: number;
          ticketPrefix?: string;
          ticketNextNumber?: number;
          ticketNumberPadding?: number;
          threadNamespace?: string;
        },
      ) => {
        const { accountId, ...partial } = payload;
        return setAccountMailSettings(accountId, partial);
      },
      { logger, accountAccess: 'rw' },
    ),
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
      async (event: IpcMainInvokeEvent, payload: {
          accountId: number | 'all';
          messageId: number;
          ticketCode?: string | null;
          customerId?: number | null;
          correspondentEmail?: string | null;
          limit?: number;
        }) => {
        const access =
          payload.accountId === 'all' ? mailScopeSessionFromEvent(event) : undefined;
        const { normalizeEmailAddress } = await import('../../shared/email-address-normalize.js');
        const raw = payload.correspondentEmail?.trim() ?? '';
        const email = raw.includes('@') ? normalizeEmailAddress(raw) : '';
        if (email) {
          return listMessagesByCorrespondentEmail(
            payload.accountId,
            { email, limit: payload.limit },
            access,
          );
        }
        return listConversationMessagesForScope(
          payload.accountId,
          {
            excludeMessageId: payload.messageId,
            ticketCode: payload.ticketCode,
            customerId: payload.customerId,
            limit: payload.limit,
          },
          access,
        );
      },
      { logger, accountAccess: 'ro' },
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
          requestReadReceipt?: boolean;
          pgpEncrypt?: boolean;
          pgpSign?: boolean;
          pgpPassphrase?: string;
        },
      ) => {
        const session = requireAuthSession(_event);
        const attachmentError = composeAttachmentPathsError(
          composeAttachmentCaller(_event),
          payload.draftMessageId,
          payload.attachmentPaths,
        );
        if (attachmentError) {
          return { success: false as const, error: attachmentError, workflowRunId: null };
        }
        const r = await sendComposeDraft({
          ...payload,
          pgpUserId: session.userId,
          actor: { userId: session.userId, role: session.role },
        });
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
      { logger, accountAccess: 'rw' },
    ),
  );

  // „Ohne Ausgangsprüfung senden“ (TA-P2): Senderechte wie SendCompose (rw am
  // Konto des Entwurfs), die Rolle laut Einstellung prüft das Modul selbst.
  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.SendDraftSkipOutboundReview,
      async (event: IpcMainInvokeEvent, payload: { draftId: number }) => {
        const draftId = Number(payload?.draftId);
        if (!Number.isFinite(draftId) || draftId <= 0) {
          return { success: false as const, error: 'Ungültige Entwurfs-ID' };
        }
        const session = requireAuthSession(event);
        const { sendDraftSkippingOutboundReview } = await import('../email/email-outbound-review-skip.js');
        return sendDraftSkippingOutboundReview(draftId, { userId: session.userId, role: session.role });
      },
      { logger, accountAccess: 'rw' },
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
          tls?: boolean;
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
          // Mit "wie IMAP" nimmt resolveImapAuth bei OAuth-Konten immer das Token,
          // auch wenn ein Passwort mitkommt.
          const oauthToken = useImap && usesOAuthLogin(acc);
          if (
            (!pass || oauthToken)
            && (useImap !== Boolean(acc.smtp_use_imap_auth)
              || !sameMailLogin(smtpLogin(acc), {
                host: payload.host,
                port: payload.port,
                tls: smtpTransportSecurity(payload.secure, !payload.secure && (payload.tls ?? true)),
                user: payload.user,
              }))
          ) {
            return { success: false as const, error: STORED_LOGIN_CHANGED_ERROR };
          }
          if (useImap) {
            const { resolveImapAuth } = await import('../email/email-imap-auth.js');
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
          tls: payload.tls,
          user: payload.user,
          pass: pass || undefined,
          accessToken,
        });
        if (r.ok) return { success: true as const };
        return { success: false as const, error: r.error };
      },
      // Kontoverwaltung wie beim IMAP-Test (E16): nur Owner/Admin.
      { logger, requireRole: ['owner', 'admin'] },
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
      { logger, accountAccess: 'rw' },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.GetMessageCategory, async (_event: IpcMainInvokeEvent, messageId: number) => {
      return { categoryId: getMessageCategoryId(messageId) };
    }, { logger, accountAccess: 'ro' }),
  );

  // M:N category assignments (drag-drop adds, ×-chip removes, multi-select dialog).
  // Local-mode counterparts to the HTTP-transport mappings; UI shape matches so
  // the same renderer code works in both modes.
  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.ListMessageCategories,
      async (_event: IpcMainInvokeEvent, messageId: number) => {
        return listMessageCategoryAssignments(messageId).map((categoryId) => ({
          id: categoryId,
          messageId,
          categoryId,
        }));
      },
      { logger, accountAccess: 'ro' },
    ),
  );
  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.AddMessageCategory,
      async (
        _event: IpcMainInvokeEvent,
        payload: { messageId: number; categoryId: number },
      ) => {
        const result = addMessageCategoryAssignment(payload.messageId, payload.categoryId);
        if (result.added) {
          return {
            added: true,
            record: {
              id: payload.categoryId,
              messageId: payload.messageId,
              categoryId: payload.categoryId,
            },
          };
        }
        return { added: false, alreadyAssigned: true };
      },
      { logger, accountAccess: 'rw' },
    ),
  );
  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.RemoveMessageCategory,
      async (
        _event: IpcMainInvokeEvent,
        payload: { messageId: number; categoryId: number },
      ) => removeMessageCategoryAssignment(payload.messageId, payload.categoryId),
      { logger, accountAccess: 'rw' },
    ),
  );
  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.SetMessageCategories,
      async (
        _event: IpcMainInvokeEvent,
        payload: { messageId: number; categoryIds: readonly number[] },
      ) => {
        setMessageCategoriesExact(payload.messageId, payload.categoryIds ?? []);
        return { success: true as const };
      },
      { logger, accountAccess: 'rw' },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.CategoryCounts,
      async (event: IpcMainInvokeEvent, accountId: number | 'all') => {
        const access = accountId === 'all' ? mailScopeSessionFromEvent(event) : undefined;
        return listCategoryCountsForMailScope(accountId, access);
      },
      { logger, accountAccess: 'ro' },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.MailFolderCounts,
      async (event: IpcMainInvokeEvent, accountId: number | 'all') => {
        const access = accountId === 'all' ? mailScopeSessionFromEvent(event) : undefined;
        return getMailFolderCountsForScope(accountId, access);
      },
      { logger, accountAccess: 'ro' },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.AddInternalNote,
      async (_event: IpcMainInvokeEvent, payload: { messageId: number; body: string }) => {
        addInternalNote(payload.messageId, payload.body);
        return { success: true as const };
      },
      { logger, accountAccess: 'rw' },
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
      { logger, accountAccess: 'rw' },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.DeleteInternalNote, async (_event: IpcMainInvokeEvent, noteId: number) => {
      deleteInternalNote(noteId);
      return { success: true as const };
    }, { logger, accountAccess: 'rw' }),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.ListInternalNotes, async (_event: IpcMainInvokeEvent, messageId: number) => {
      return listInternalNotes(messageId);
    }, { logger, accountAccess: 'ro' }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.ListCannedResponses,
      async (_event: IpcMainInvokeEvent, payload?: AccountOverrideScopePayload) =>
        listCannedResponses(accountOverrideScopeFromPayload(payload)),
      { logger, accountAccess: 'ro' },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.SaveCannedResponse,
      async (
        _event: IpcMainInvokeEvent,
        payload: {
          id?: number;
          title: string;
          body: string;
          accountId?: number | null;
          overrideKey?: string | null;
        },
      ) => {
        const scopeOpts = {
          accountId: payload.accountId,
          overrideKey: payload.overrideKey,
        };
        if (payload.id) {
          updateCannedResponse(payload.id, payload.title, payload.body, scopeOpts);
          return { success: true as const, id: payload.id };
        }
        const id = createCannedResponse(payload.title, payload.body, scopeOpts);
        return { success: true as const, id };
      },
      { logger, accountAccess: 'rw' },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.DeleteCannedResponse, async (_event: IpcMainInvokeEvent, id: number) => {
      deleteCannedResponse(id);
      return { success: true as const };
    }, { logger, accountAccess: 'rw' }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.ListAiPrompts,
      async (_event: IpcMainInvokeEvent, payload?: AccountOverrideScopePayload) =>
        listAiPrompts(accountOverrideScopeFromPayload(payload)),
      { logger, accountAccess: 'ro' },
    ),
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
          accountId?: number | null;
          overrideKey?: string | null;
        },
      ) => {
        const scopeFields = {
          accountId: payload.accountId,
          overrideKey: payload.overrideKey,
        };
        if (payload.id) {
          updateAiPrompt(payload.id, {
            label: payload.label,
            userTemplate: payload.userTemplate,
            target: payload.target,
            profileId: payload.profileId,
            ...scopeFields,
          });
          return { success: true as const, id: payload.id };
        }
        const id = createAiPrompt({
          label: payload.label,
          userTemplate: payload.userTemplate,
          target: payload.target,
          profileId: payload.profileId,
          ...scopeFields,
        });
        return { success: true as const, id };
      },
      { logger, accountAccess: 'rw' },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.DeleteAiPrompt, async (_event: IpcMainInvokeEvent, id: number) => {
      deleteAiPrompt(id);
      return { success: true as const };
    }, { logger, accountAccess: 'rw' }),
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
      { logger, accountAccess: 'rw' },
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
      // Zusaetzlich die Felder, die der Server-Client liefert (mapAiProfileRecord):
      // das KI-Panel liest baseUrl, isDefault und hasApiKey, um bei einem
      // Hostwechsel einen neuen Key zu verlangen.
      return Promise.all(
        listAiProfiles().map(async (p) => ({
          ...p,
          baseUrl: p.base_url,
          embeddingModel: p.embedding_model,
          isDefault: p.is_default === 1,
          sortOrder: p.sort_order,
          hasApiKey: await profileHasApiKey(p.id),
        })),
      );
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
          // Wie auf dem Server (F-A4-02): der gespeicherte Key geht nie an einen neuen Host.
          if (await aiProfileMoveNeedsNewApiKey(profileId, payload)) {
            return {
              success: false as const,
              error: 'Zugangsdaten bei Serverwechsel neu eingeben: API-Key erforderlich (Base-URL oder Anbieter geändert)',
            };
          }
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

  // „Verbindung testen“: gleiche Rechte wie das Bearbeiten der KI-Profile.
  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.TestAiProfile,
      async (_event: IpcMainInvokeEvent, profileId: number) => testAiProfileConnection(profileId),
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.GetComposeSignature,
      async (_event: IpcMainInvokeEvent, payload: { accountId: number; teamMemberId?: string }) => {
        return { html: getComposeSignatureHtml(payload.accountId, payload.teamMemberId) };
      },
      { logger, accountAccess: 'ro' },
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
      // Kontoverwaltung wie UpdateAccount (E16); Server: mail.account.manage.
      { logger, accountAccess: 'rw', requireRole: ['owner', 'admin'] },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.AiTransformText,
      async (
        _event: IpcMainInvokeEvent,
        payload: {
          promptId?: number;
          text: string;
          contextText?: string;
          targetLanguage?: string;
          inboundContextText?: string;
          userContext?: string;
          customerId?: number | null;
          insertMode?: boolean;
        },
      ) => {
        const source = payload.text?.trim() ?? '';
        if (!source) return { success: false as const, error: 'Text fehlt' };

        // Translate mode: no stored prompt, translate `text` into targetLanguage
        // using the default AI profile. `contextText` (the surrounding message)
        // is given to the model only as context.
        const targetLanguage = payload.targetLanguage?.trim();
        if (targetLanguage) {
          const profileId = getDefaultAiProfile()?.id ?? null;
          const ctx = payload.contextText?.trim() ?? '';
          const useContext = ctx.length > 0 && ctx !== source;
          const system =
            `Du bist ein professioneller Übersetzer. Übersetze den folgenden Text nach ${targetLanguage}. ` +
            'Gib AUSSCHLIESSLICH die Übersetzung zurück — keine Anführungszeichen, keine Erklärungen, keine Anrede.' +
            (useContext ? `\n\nKONTEXT (nur zum Verständnis, NICHT übersetzen oder ausgeben):\n${ctx}` : '');
          try {
            const out = await runChatCompletion(system, source, profileId);
            if (!out.trim()) return { success: false as const, error: 'KI-Antwort leer' };
            return { success: true as const, text: out.trim() };
          } catch (e) {
            return { success: false as const, error: e instanceof Error ? e.message : String(e) };
          }
        }

        if (payload.promptId == null) return { success: false as const, error: 'Prompt fehlt' };
        const prompts = listAiPrompts();
        const p = prompts.find((x) => x.id === payload.promptId);
        if (!p) return { success: false as const, error: 'Prompt nicht gefunden' };
        let cust: EmailAiCustomerTemplateContext | null = null;
        if (payload.customerId) {
          cust = getEmailAiCustomerTemplateContext(payload.customerId);
        }
        const values: Record<string, string> = { text: payload.text };
        if (cust) {
          values['customer.name'] = cust.name ?? '';
          values['customer.firstName'] = cust.firstName ?? '';
          values['customer.email'] = cust.email ?? '';
        }
        // Single pass with a callback: the compose text is inserted literally ($-patterns
        // stay text) and is never rescanned, so placeholders inside it cannot expand.
        const user = p.user_template.replace(
          /\{\{(text|customer\.name|customer\.firstName|customer\.email)\}\}/g,
          (match, key: string) => (Object.prototype.hasOwnProperty.call(values, key) ? values[key]! : match),
        );
        try {
          const profileId = resolvePromptProfileId(p);
          const out = await runChatCompletion(
            buildAiTransformSystemPrompt({
              sourceText: payload.text,
              contextText: payload.contextText,
              inboundContextText: payload.inboundContextText,
              userContext: payload.userContext,
              insertMode: payload.insertMode,
            }),
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
      { logger, accountAccess: 'ro' },
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
      { logger, accountAccess: 'rw' },
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
        payload: {
          messageId: number;
          promptId?: number;
          customerId?: number | null;
          userContext?: string;
          persistSuggestion?: boolean;
        },
      ) => {
        const opts = {
          promptId: payload.promptId,
          customerId: payload.customerId,
          userContext: payload.userContext,
        };
        if (payload.persistSuggestion === false) {
          return generateReplyDraftOnly(payload.messageId, opts);
        }
        return generateAndStoreReplySuggestion(payload.messageId, opts);
      },
      { logger, accountAccess: 'rw' },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.LinkCustomer,
      async (_event: IpcMainInvokeEvent, payload: { messageId: number; customerId: number | null }) => {
        setMessageCustomerId(payload.messageId, payload.customerId);
        return { success: true as const };
      },
      { logger, accountAccess: 'rw' }),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.SoftDeleteMessage, async (_event: IpcMainInvokeEvent, messageId: number) => {
      setMessageSoftDeleted(messageId, true);
      return { success: true as const };
    }, { logger, accountAccess: 'rw' }),
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
      { logger, accountAccess: 'rw' },
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
      { logger, accountAccess: 'rw' },
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
            { train: true, source: 'bulk-manual' },
          );
          return { success: true as const, count };
        } catch (e) {
          return {
            success: false as const,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      },
      { logger, accountAccess: 'rw' },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.BulkSetMessageSpamStatus,
      async (
        _event: IpcMainInvokeEvent,
        payload: { messageIds: number[]; status: SpamStatus; accountId?: number; train?: boolean },
      ) => {
        try {
          const count = bulkSetMessageSpamStatus(
            payload.messageIds,
            payload.status,
            payload.accountId,
            { train: payload.train !== false, source: 'bulk-manual' },
          );
          return { success: true as const, count };
        } catch (e) {
          return {
            success: false as const,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      },
      { logger, accountAccess: 'rw' },
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
      { logger, accountAccess: 'rw' },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.BulkSetMessageDone,
      async (
        _event: IpcMainInvokeEvent,
        payload: { messageIds: number[]; done: boolean; accountId?: number },
      ) => {
        try {
          const count = bulkSetMessagesDoneLocal(
            payload.messageIds,
            payload.done,
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
      { logger, accountAccess: 'rw' },
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
      { logger, accountAccess: 'rw' },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.RestoreMessage, async (_event: IpcMainInvokeEvent, messageId: number) => {
      setMessageSoftDeleted(messageId, false);
      return { success: true as const };
    }, { logger, accountAccess: 'rw' }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.SetMessageArchived,
      async (_event: IpcMainInvokeEvent, payload: { messageId: number; archived: boolean }) => {
        setMessageArchived(payload.messageId, payload.archived);
        return { success: true as const };
      },
      { logger, accountAccess: 'rw' },
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
      { logger, accountAccess: 'ro' },
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
      { logger, accountAccess: 'rw' },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.GetMessageRawHeaders,
      async (_event: IpcMainInvokeEvent, messageId: number) => {
        const row = getEmailMessageById(messageId);
        if (!row) return { success: false as const, error: 'Nachricht nicht gefunden' };
        const { listAttachmentsForMessage } = await import('../email/email-message-attachments-store.js');
        const { buildEmlForMessage, formatEmlDisplayAppendix } = await import('../email/mail-eml-build.js');
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
      { logger, accountAccess: 'ro' },
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
      async (event: IpcMainInvokeEvent, payload: Parameters<typeof saveMailSecuritySettings>[0]) => {
        // Wie auf dem Server (settings-routes handleMailSecuritySettings): Die
        // Rspamd-Pruefung schickt jede eingehende Mail roh an diese URL, aendern
        // duerfen sie nur Owner und Admin. Das Panel sendet die geladene URL bei
        // jedem Speichern mit; unveraendert bleibt das fuer alle Rollen erlaubt.
        if (payload.rspamdUrl !== undefined && rspamdUrlDiffersFromStored(payload.rspamdUrl)) {
          const { role } = requireRealAuthSession(event);
          if (role !== 'owner' && role !== 'admin') {
            throw new Error('Die Rspamd-URL darf nur von Administratoren geändert werden');
          }
        }
        saveMailSecuritySettings(payload);
        return { success: true as const };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.ListSpamListEntries,
      async (_event: IpcMainInvokeEvent, payload?: number | 'all') => {
        return listSpamListEntries(payload ?? 'all');
      },
      { logger, accountAccess: 'ro' },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.SaveSpamListEntry,
      async (_event: IpcMainInvokeEvent, payload: Parameters<typeof saveSpamListEntry>[0]) => {
        try {
          const entry = saveSpamListEntry(payload);
          return { success: true as const, entry };
        } catch (e) {
          return { success: false as const, error: e instanceof Error ? e.message : String(e) };
        }
      },
      { logger, accountAccess: 'rw' },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.DeleteSpamListEntry,
      async (_event: IpcMainInvokeEvent, id: number) => {
        if (!deleteSpamListEntry(id)) {
          return { success: false as const, error: 'Listen-Eintrag nicht gefunden' };
        }
        return { success: true as const };
      },
      { logger, accountAccess: 'rw' },
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
          spamStatus: row.spam_status ?? null,
          spamScore: row.spam_score ?? null,
          spamScoreLabel: row.spam_score_label ?? null,
          spamDecisionSource: row.spam_decision_source ?? null,
          spamScoreBreakdownJson: row.spam_score_breakdown_json ?? null,
          spamDecidedAt: row.spam_decided_at ?? null,
        };
      },
      { logger, accountAccess: 'ro' },
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
          spamScore: r.spam?.score ?? updated?.spam_score ?? null,
          spamStatus: r.spam?.status ?? updated?.spam_score_label ?? null,
          spamDecisionSource: r.spam?.source ?? updated?.spam_decision_source ?? null,
        };
      },
      { logger, accountAccess: 'rw' },
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
      // Ruft eine frei waehlbare URL ab; auf dem Server ebenfalls nur fuer Admins.
      { logger, requireRole: ['owner', 'admin'] },
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
        const acc = getEmailAccountById(row.account_id);
        const accountWantsSync =
          acc != null &&
          (acc.protocol || 'imap') === 'imap' &&
          (acc.imap_sync_seen_on_open ?? 1) !== 0;
        const syncToServer =
          payload.syncToServer !== undefined
            ? payload.syncToServer
            : accountWantsSync;
        setMessageSeenLocal(payload.messageId, payload.seen, syncToServer);
        if (syncToServer) {
          try {
            await syncSeenFlagToServer(row, payload.seen);
            clearMessageSeenSyncPending(payload.messageId);
          } catch (e) {
            logger.warn('IMAP seen sync failed', e);
          }
        }
        return { success: true as const };
      },
      // Bewusst 'ro': Gelesen markieren ist kosmetisch; alle anderen Mutationen verlangen 'rw'.
      { logger, accountAccess: 'ro' },
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
      { logger, accountAccess: 'rw' },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.SetMessageSpam,
      async (_event: IpcMainInvokeEvent, payload: { messageId: number; spam: boolean }) => {
        setMessageSpam(payload.messageId, payload.spam, { train: true, source: 'manual' });
        return { success: true as const };
      },
      { logger, accountAccess: 'rw' },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.SetMessageSpamStatus,
      async (
        _event: IpcMainInvokeEvent,
        payload: { messageId: number; status: SpamStatus; train?: boolean },
      ) => {
        setMessageSpamStatus(payload.messageId, payload.status, {
          train: payload.train !== false,
          source: 'manual',
        });
        return { success: true as const };
      },
      { logger, accountAccess: 'rw' },
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
        // C-A30 (G12): Nur so gewaehlte Dateien darf dieses Fenster anhaengen.
        const { sessionId } = requireAuthSession(event);
        return {
          success: true as const,
          paths: grantComposeAttachmentPaths(event.sender.id, sessionId, result.filePaths),
        };
      },
      { logger },
    ),
  );

  // C-A30 (G12): Drag-and-drop. Nur der Preload ruft diesen Kanal auf, mit Pfaden
  // aus webUtils.getPathForFile (PreloadOnlyInvokeChannels); freigegeben werden
  // nur vorhandene regulaere Dateien.
  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.RegisterDroppedComposeAttachments,
      async (event: IpcMainInvokeEvent, payload: { paths: string[] }) => {
        const { sessionId } = requireAuthSession(event);
        return {
          success: true as const,
          paths: grantComposeAttachmentPaths(event.sender.id, sessionId, payload.paths),
        };
      },
      { logger },
    ),
  );

  // G1: fuehrt alle aktiven Inbound-Workflows erneut ueber alle Konten aus —
  // nur Owner/Admin (Server: workflows.manage).
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
    }, { logger, requireRole: ['owner', 'admin'] }),
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
      { logger, accountAccess: 'rw' },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.GetGoogleOAuthApp, async (event: IpcMainInvokeEvent) => {
      return oauthAppSettingsForCaller(event, getGoogleOAuthAppSettings());
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.SetGoogleOAuthApp,
      async (_event: IpcMainInvokeEvent, payload: { clientId: string; clientSecret: string }) => {
        setGoogleOAuthAppSettings(oauthAppSettingsUpdate(payload));
        return { success: true as const };
      },
      { logger, requireRole: ['owner', 'admin'] },
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
      // Ersetzt den Refresh-Token des Kontos: Kontoverwaltung wie UpdateAccount (E16), Server requireAdmin.
      { logger, accountAccess: 'rw', requireRole: ['owner', 'admin'] },
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
          const host = payload.host.trim();
          const user = payload.user.trim();
          const testAcc: EmailAccountRow = {
            ...acc,
            pop3_host: host || acc.pop3_host,
            pop3_port: payload.port ?? acc.pop3_port,
            pop3_tls: payload.tls ? 1 : 0,
            imap_host: host || acc.imap_host,
            imap_port: payload.port ?? acc.imap_port,
            imap_tls: payload.tls ? 1 : 0,
            imap_username: user || acc.imap_username,
          };
          if (payload.password.trim().length === 0 && !sameMailLogin(pop3Login(acc), pop3Login(testAcc))) {
            return { success: false as const, error: STORED_LOGIN_CHANGED_ERROR };
          }
          const pw =
            payload.password.trim().length > 0
              ? payload.password
              : await getEmailPassword(acc.keytar_account_key);
          if (!pw) return { success: false as const, error: 'Kein Passwort' };
          const r = await testPop3Connection(testAcc, pw);
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
      // Kontoverwaltung wie beim IMAP-Test (E16): nur Owner/Admin.
      { logger, requireRole: ['owner', 'admin'] },
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
    }, { logger, accountAccess: 'ro' }),
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
      { logger, accountAccess: 'ro' },
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
      { logger, accountAccess: 'ro' },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.EmailReporting,
      async (event: IpcMainInvokeEvent, accountId: number | null) => {
        const access = accountId === null ? mailScopeSessionFromEvent(event) : undefined;
        return {
          success: true as const,
          data: getEmailReportingSnapshot(accountId, access),
        };
      },
      { logger, accountAccess: 'ro' },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.EmailGdprExport,
      async (_event: IpcMainInvokeEvent, payload?: { skipAttachments?: boolean }) => {
        const r = await exportEmailGdprPackage({ skipAttachments: Boolean(payload?.skipAttachments) });
        return r;
      },
      { logger, requireRole: ['owner', 'admin'] },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.GetMicrosoftOAuthApp, async (event: IpcMainInvokeEvent) => {
      return oauthAppSettingsForCaller(event, getMicrosoftOAuthAppSettings());
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.SetMicrosoftOAuthApp,
      async (_event: IpcMainInvokeEvent, payload: { clientId: string; clientSecret: string }) => {
        setMicrosoftOAuthAppSettings(oauthAppSettingsUpdate(payload));
        return { success: true as const };
      },
      { logger, requireRole: ['owner', 'admin'] },
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
      IPCChannels.Email.GetRemoteContentPolicy,
      async (event: IpcMainInvokeEvent, payload: { messageId: number }) => {
        const row = getEmailMessageById(payload.messageId);
        if (!row) return { policy: 'blocked' as const, allowRemote: false };
        if (!canAccessEmailAccount(event, row.account_id, 'ro')) {
          throw new Error('Kein Zugriff');
        }
        return consumeAllowedOnceRemoteContentLocal(payload.messageId);
      },
      { logger, accountAccess: 'ro', requireAuth: true, requireRealSession: true },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.SetRemoteContentPolicy,
      async (
        event: IpcMainInvokeEvent,
        payload: {
          messageId: number;
          policy: 'blocked' | 'allowed_once' | 'allowed_sender' | 'allowed_domain';
          rememberSender?: boolean;
          rememberDomain?: boolean;
        },
      ) => {
        const row = getEmailMessageById(payload.messageId);
        if (!row) return { success: false as const, error: 'Nachricht nicht gefunden' };
        if (!canAccessEmailAccount(event, row.account_id, 'rw')) {
          return { success: false as const, error: 'Kein Zugriff' };
        }
        let remember: { scope: 'sender' | 'domain'; value: string } | undefined;
        if (payload.rememberSender || payload.rememberDomain) {
          try {
            const p = JSON.parse(row.from_json ?? '{}') as { value?: { address?: string }[] };
            const addr = p.value?.[0]?.address?.toLowerCase() ?? '';
            if (addr) {
              if (payload.rememberSender) remember = { scope: 'sender', value: addr };
              else if (payload.rememberDomain) {
                const dom = addr.includes('@') ? addr.split('@')[1]! : addr;
                remember = { scope: 'domain', value: dom };
              }
            }
          } catch {
            /* ignore */
          }
        }
        setLocalRemoteContentPolicy(payload.messageId, payload.policy, remember);
        return { success: true as const };
      },
      { logger, accountAccess: 'rw', requireAuth: true, requireRealSession: true },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.GetReadReceiptState,
      async (event: IpcMainInvokeEvent, payload: { messageId: number }) => {
        const row = getEmailMessageById(payload.messageId);
        if (!row) return { success: false as const, error: 'Nachricht nicht gefunden' };
        if (!canAccessEmailAccount(event, row.account_id, 'ro')) {
          return { success: false as const, error: 'Kein Zugriff' };
        }
        const settings = getLocalReadReceiptSettings(row.account_id);
        return {
          success: true as const,
          requested: (row as { read_receipt_requested?: number }).read_receipt_requested === 1,
          respond: settings.respond,
          trustedDomains: settings.trustedDomains,
        };
      },
      { logger, accountAccess: 'ro' },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.RespondReadReceipt,
      async (event: IpcMainInvokeEvent, payload: { messageId: number; action: 'send' | 'decline' }) => {
        const row = getEmailMessageById(payload.messageId);
        if (!row) return { success: false as const, error: 'Nachricht nicht gefunden' };
        if (!canAccessEmailAccount(event, row.account_id, 'rw')) {
          return { success: false as const, error: 'Kein Zugriff' };
        }
        if (payload.action === 'send') {
          const { domainTrusted } = await import('../email/email-read-receipt.js');
          const settings = getLocalReadReceiptSettings(row.account_id);
          if (settings.respond === 'never') {
            return { success: false as const, error: 'Lesebestätigungen sind deaktiviert' };
          }
          if (settings.respond === 'always_trusted') {
            try {
              const from = JSON.parse(row.from_json ?? '{}') as { value?: { address?: string }[] };
              const addr = from.value?.[0]?.address ?? '';
              const dom = addr.includes('@') ? addr.split('@')[1]! : '';
              if (!domainTrusted(settings.trustedDomains, dom)) {
                return { success: false as const, error: 'Absender nicht in vertrauenswürdigen Domains' };
              }
            } catch {
              return { success: false as const, error: 'Absender nicht verifizierbar' };
            }
          }
          const { sendReadReceiptMdn } = await import('../email/email-read-receipt-mdn.js');
          const r = await sendReadReceiptMdn(payload.messageId);
          if (!r.ok) return { success: false as const, error: r.error };
          return { success: true as const };
        }
        logLocalReadReceiptDeclined(payload.messageId);
        return { success: true as const };
      },
      { logger, accountAccess: 'rw', requireAuth: true, requireRealSession: true },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.ListThreadMessages,
      async (event: IpcMainInvokeEvent, payload: { threadId: string; limit?: number; offset?: number }) => {
        const { listThreadMessages } = await import('../email/email-thread-aggregate.js');
        return listThreadMessages(
          payload.threadId,
          payload.limit ?? 50,
          payload.offset ?? 0,
          mailScopeSessionFromEvent(event),
        );
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.MergeThreads,
      async (
        event: IpcMainInvokeEvent,
        payload: { aliasThreadId: string; canonicalThreadId: string; accountId: number },
      ) => {
        if (!canAccessEmailAccount(event, payload.accountId, 'rw')) {
          return { success: false as const, error: 'Kein Zugriff' };
        }
        const { mergeThreads } = await import('../email/email-thread-admin.js');
        const r = mergeThreads(
          payload.aliasThreadId,
          payload.canonicalThreadId,
          payload.accountId,
        );
        if (!r.ok) return { success: false as const, error: r.error };
        return { success: true as const };
      },
      { logger, accountAccess: 'rw', requireAuth: true, requireRealSession: true, requireRole: ['owner', 'admin'] },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.SplitMessageThread,
      async (event: IpcMainInvokeEvent, payload: { messageId: number }) => {
        requireRealAuthSession(event);
        const { splitMessageToOwnThread } = await import('../email/email-thread-admin.js');
        const r = splitMessageToOwnThread(payload.messageId);
        if (!r.ok) return { success: false as const, error: r.error };
        return { success: true as const, threadId: r.threadId };
      },
      { logger, accountAccess: 'rw', requireAuth: true, requireRealSession: true, requireRole: ['owner', 'admin'] },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.ListThreadAliasWarnings,
      async (event: IpcMainInvokeEvent) => {
        const { listPendingThreadAliasWarnings } = await import('../email/email-thread-heuristics.js');
        return listPendingThreadAliasWarnings(50, mailScopeSessionFromEvent(event));
      },
      { logger, requireAuth: true },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.ListThreadsByView,
      async (event: IpcMainInvokeEvent, payload: {
          accountScope: number | 'all';
          view: string;
          limit?: number;
          offset?: number;
        }) => {
        const access =
          payload.accountScope === 'all' ? mailScopeSessionFromEvent(event) : undefined;
        const { listThreadsForMailScope } = await import('../email/email-thread-aggregate.js');
        return listThreadsForMailScope(
          payload.accountScope as number | 'all',
          payload.view as import('../email/email-store.js').AccountMailView,
          { limit: payload.limit, offset: payload.offset },
          access,
        );
      },
      { logger, accountAccess: 'ro' },
    ),
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
      // Ersetzt den Refresh-Token des Kontos: Kontoverwaltung wie UpdateAccount (E16), Server requireAdmin.
      { logger, accountAccess: 'rw', requireRole: ['owner', 'admin'] },
    ),
  );

  if (isDevelopment) {
    logger.debug('[IPC] Email handlers registered');
  }

  return () => {
    disposers.forEach((d) => d());
  };
}
