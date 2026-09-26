/**
 * @jest-environment node
 */
/**
 * Inventar der Desktop-Mail-IPC: Jeder registrierte Kanal aus IPCChannels.Email
 * (inkl. workflow:*), dessen Payload eine Objekt-ID traegt, loest ueber den
 * echten Resolver ein Konto auf oder steht ausdruecklich in einer Global-Liste.
 * Die Registrierungen werden abgefangen; die Objekt-Lookups liefern je nach
 * Modus "gefunden in Konto 9" oder "nicht gefunden".
 */
const mockRegistrations = new Map<string, Record<string, unknown>>();
const mockLookup = { found: true };
const FOUND_ACCOUNT = 9;
const SAMPLE_ID = 77;

jest.mock('../../electron/ipc/register', () => ({
  registerIpcHandler: (channel: string, _handler: unknown, options?: Record<string, unknown>) => {
    mockRegistrations.set(channel, options ?? {});
    return () => undefined;
  },
}));

jest.mock('electron', () => ({
  app: { getPath: () => '/tmp', isPackaged: false },
  ipcMain: { handle: jest.fn(), removeHandler: jest.fn() },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {},
  shell: {},
}));

// Ohne requireActual: email-store haengt zirkulaer an email-message-features.
jest.mock('../../electron/email/email-store', () => ({
  getEmailMessageById: () => (mockLookup.found ? { account_id: 9 } : undefined),
  getMessageAccountIds: (ids: number[]) => new Map(mockLookup.found ? ids.map((id) => [id, 9]) : []),
}));
jest.mock('../../electron/email/email-message-attachments-store', () => ({
  getAttachmentById: () => (mockLookup.found ? { message_id: 5 } : undefined),
}));
jest.mock('../../electron/email/email-crm-store', () => ({
  getInternalNoteMessageId: () => (mockLookup.found ? 5 : undefined),
  getCannedResponseById: () => (mockLookup.found ? { account_id: 9 } : undefined),
  getAiPromptById: () => (mockLookup.found ? { account_id: 9 } : undefined),
}));
jest.mock('../../electron/email/email-spam-store', () => ({
  getSpamListEntry: () => (mockLookup.found ? { account_id: 9 } : undefined),
}));
jest.mock('../../electron/workflow/knowledge-base', () => ({
  getKnowledgeBaseById: () => (mockLookup.found ? { account_id: 9 } : undefined),
}));
jest.mock('../../electron/workflow/run-steps', () => ({
  getWorkflowRunMessageId: () => (mockLookup.found ? { message_id: 5 } : undefined),
}));

import { z } from 'zod';
import { IPCChannels } from '../../shared/ipc/channels';
import { getPayloadSchema } from '../../shared/ipc/schemas';
import {
  EMAIL_GLOBAL_OBJECT_CHANNELS,
  EMAIL_SKIP_ACCOUNT_SCOPE,
  resolveEmailChannelAccountScope,
} from '../../electron/ipc/ipc-account-scope';
import { registerEmailHandlers } from '../../electron/ipc/email';
import { registerWorkflowHandlers } from '../../electron/ipc/workflow';

const quietLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

/**
 * Kanaele ohne typisiertes Payload-Schema (z.any): Beispiel-Payloads so, wie der
 * Renderer sie schickt. Ein neuer untypisierter Kanal ohne Eintrag laesst den
 * Test scheitern und erzwingt die Einordnung.
 */
const UNTYPED_SAMPLES: Record<string, unknown[]> = {
  'email:list-message-categories': [SAMPLE_ID],
  'email:add-message-category': [{ messageId: SAMPLE_ID, categoryId: 3 }],
  'email:remove-message-category': [{ messageId: SAMPLE_ID, categoryId: 3 }],
  'email:set-message-categories': [{ messageId: SAMPLE_ID, categoryIds: [3] }],
  'email:get-remote-content-policy': [{ messageId: SAMPLE_ID }],
  'email:set-remote-content-policy': [{ messageId: SAMPLE_ID, policy: 'blocked' }],
  'email:get-read-receipt-state': [{ messageId: SAMPLE_ID }],
  'email:respond-read-receipt': [{ messageId: SAMPLE_ID, action: 'decline' }],
  'email:list-thread-messages': [{ threadId: 'thread-77' }],
  'email:list-threads-by-view': [{ accountScope: SAMPLE_ID, view: 'inbox' }],
  'email:merge-threads': [{ aliasThreadId: 'a', canonicalThreadId: 'c', accountId: SAMPLE_ID }],
  'email:split-message-thread': [{ messageId: SAMPLE_ID }],
  'email:list-thread-alias-warnings': [undefined],
  'workflow:approve-draft-send': [{ draftId: SAMPLE_ID }],
  'workflow:dismiss-draft-approval': [{ draftId: SAMPLE_ID }],
};

const ID_KEY = /^(id|.+Id|.+Ids)$/;

function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  let s: z.ZodTypeAny = schema;
  while (s instanceof z.ZodOptional || s instanceof z.ZodNullable || s instanceof z.ZodDefault) {
    s = s.unwrap() as z.ZodTypeAny;
  }
  return s;
}

/** Payloads that name an object, derived from the schema; [] = the channel takes no id. */
function idSamples(schema: z.ZodTypeAny): unknown[] {
  const s = unwrap(schema);
  if (s instanceof z.ZodNumber) return [SAMPLE_ID];
  if (s instanceof z.ZodUnion) return (s.options as z.ZodTypeAny[]).flatMap(idSamples);
  if (s instanceof z.ZodObject) {
    const sample: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(s.shape as Record<string, z.ZodTypeAny>)) {
      if (!ID_KEY.test(key)) continue;
      const inner = unwrap(value);
      sample[key] = inner instanceof z.ZodArray ? [SAMPLE_ID] : inner instanceof z.ZodString ? `${SAMPLE_ID}:1` : SAMPLE_ID;
    }
    return Object.keys(sample).length > 0 ? [sample] : [];
  }
  return [];
}

function isUntyped(schema: z.ZodTypeAny): boolean {
  return schema instanceof z.ZodAny || schema instanceof z.ZodUnknown;
}

function resolveWith(found: boolean, channel: string, payload: unknown) {
  mockLookup.found = found;
  return resolveEmailChannelAccountScope(channel, payload);
}

beforeAll(() => {
  registerEmailHandlers({ logger: quietLogger, isDevelopment: false });
  registerWorkflowHandlers({ logger: quietLogger });
});

const emailChannels = Object.values(IPCChannels.Email) as string[];

describe('Inventar: Mail-IPC-Kanaele mit Objekt-ID', () => {
  test('die Registrierung wurde abgefangen', () => {
    expect(mockRegistrations.size).toBeGreaterThan(150);
    expect(mockRegistrations.has(IPCChannels.Email.ApproveDraftSend)).toBe(true);
  });

  test('jeder untypisierte registrierte Kanal hat Beispiel-Payloads', () => {
    const missing = emailChannels.filter(
      (ch) => mockRegistrations.has(ch) && isUntyped(getPayloadSchema(ch as never)) && !(ch in UNTYPED_SAMPLES),
    );
    expect(missing).toEqual([]);
  });

  // C-A78: Kanaele mit Objekt-ID, die der Resolver nicht kannte, liefen ohne Konto-Pruefung.
  test('jede Objekt-ID wird aufgeloest oder der Kanal ist ausdruecklich global', () => {
    const problems: string[] = [];
    for (const channel of emailChannels) {
      if (!mockRegistrations.has(channel)) continue;
      const schema = getPayloadSchema(channel as never);
      const samples = isUntyped(schema) ? UNTYPED_SAMPLES[channel] ?? [] : idSamples(schema);
      const global = EMAIL_SKIP_ACCOUNT_SCOPE.has(channel) || EMAIL_GLOBAL_OBJECT_CHANNELS.has(channel);
      for (const payload of samples) {
        const label = `${channel} ${JSON.stringify(payload)}`;
        const found = resolveWith(true, channel, payload);
        const missing = resolveWith(false, channel, payload);
        if (global) {
          if (found.kind !== 'none') problems.push(`${label}: global, loest aber ${found.kind} auf`);
          continue;
        }
        if (payload === undefined) continue;
        if (found.kind !== 'accounts') {
          problems.push(`${label}: Objekt gefunden, aber kein Konto (${found.kind})`);
        }
        // Nicht gefunden: fail-closed, ausser die Payload nennt das Konto selbst.
        const namesAccountDirectly =
          missing.kind === 'accounts' && missing.accountIds.every((id) => id === SAMPLE_ID);
        if (missing.kind !== 'unresolved' && !namesAccountDirectly) {
          problems.push(`${label}: Objekt fehlt, Ergebnis ${JSON.stringify(missing)} statt unresolved`);
        }
        if (found.kind === 'accounts' && !namesAccountDirectly && !found.accountIds.includes(FOUND_ACCOUNT)) {
          problems.push(`${label}: Konto des Objekts fehlt in ${JSON.stringify(found.accountIds)}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

/**
 * Kanaele, die ein Konto nur lesen (Stufe 'ro'). Jeder andere kontobezogene
 * Kanal veraendert etwas und muss 'rw' verlangen. Wer hier einen Kanal ergaenzt,
 * entscheidet bewusst, dass eine Lese-Freigabe genuegt.
 */
const READ_ONLY_CHANNELS = new Set<string>([
  IPCChannels.Email.ListMessages,
  IPCChannels.Email.GetMessage,
  IPCChannels.Email.ListWorkflows,
  IPCChannels.Email.ListMessageTags,
  IPCChannels.Email.ListMessagesByView,
  IPCChannels.Email.ListMessageIdsByView,
  IPCChannels.Email.SearchMessages,
  IPCChannels.Email.ListConversationMessages,
  IPCChannels.Email.GetScheduledSendDraftState,
  IPCChannels.Email.GetComposeDraftRecoveryState,
  IPCChannels.Email.ExportMessageEml,
  IPCChannels.Email.GetAccountMailSettings,
  IPCChannels.Email.GetLatestWorkflowRunForMessage,
  IPCChannels.Email.GetMessageCategory,
  IPCChannels.Email.ListMessageCategories,
  IPCChannels.Email.CategoryCounts,
  IPCChannels.Email.MailFolderCounts,
  IPCChannels.Email.ListInternalNotes,
  IPCChannels.Email.ListCannedResponses,
  IPCChannels.Email.ListAiPrompts,
  IPCChannels.Email.GetReplySuggestion,
  IPCChannels.Email.GetComposeSignature,
  IPCChannels.Email.PreviewRestoreInboxFromArchive,
  IPCChannels.Email.GetMessageRawHeaders,
  IPCChannels.Email.GetMessageSecurity,
  IPCChannels.Email.ListSpamListEntries,
  IPCChannels.Email.ListMessageAttachments,
  IPCChannels.Email.SaveAttachmentToDisk,
  IPCChannels.Email.OpenAttachmentPath,
  IPCChannels.Email.EmailReporting,
  // Verbraucht nur eine vom Nutzer erteilte Einmal-Freigabe beim Anzeigen.
  IPCChannels.Email.GetRemoteContentPolicy,
  IPCChannels.Email.GetReadReceiptState,
  IPCChannels.Email.ListThreadsByView,
  // Gelesen-Markierung ist bewusst mit Lese-Freigabe erlaubt (kosmetisch).
  IPCChannels.Email.SetMessageSeen,
  // Abruf vom Server aktualisiert nur das lokale Abbild des Postfachs.
  IPCChannels.Email.SyncAccount,
  // Erzwungener Dry-Run.
  IPCChannels.Email.TestWorkflowOnMessage,
  IPCChannels.Email.ListKnowledgeBases,
  IPCChannels.Email.GetKnowledgeBaseDocument,
  IPCChannels.Email.ExportKnowledgeBaseDocument,
  IPCChannels.Email.GetWorkflowRunLog,
  IPCChannels.Email.ListWorkflowRunSteps,
]);

/** Kontobezogene Kanaele, die zusaetzlich nur Owner/Admin erreichen (Kontoverwaltung E16, Workflows G1). */
const OWNER_ADMIN_SCOPED_CHANNELS = new Set<string>([
  IPCChannels.Email.UpdateAccount,
  IPCChannels.Email.DeleteAccount,
  IPCChannels.Email.FinishGoogleOAuth,
  IPCChannels.Email.FinishMicrosoftOAuth,
  IPCChannels.Email.SaveAccountSignature,
  IPCChannels.Email.MergeThreads,
  IPCChannels.Email.SplitMessageThread,
  IPCChannels.Email.ExecuteWorkflowNow,
  IPCChannels.Email.CreateKnowledgeBase,
  IPCChannels.Email.UpdateKnowledgeBase,
  IPCChannels.Email.DeleteKnowledgeBase,
  IPCChannels.Email.AddKnowledgeChunk,
  IPCChannels.Email.SaveKnowledgeBaseDocument,
  IPCChannels.Email.ImportKnowledgeFile,
]);

describe('Klassifizierung: jede kontobezogene Registrierung hat eine explizite Stufe', () => {
  function accountScopedChannels(): string[] {
    return emailChannels.filter((channel) => {
      if (!mockRegistrations.has(channel)) return false;
      if (EMAIL_SKIP_ACCOUNT_SCOPE.has(channel) || EMAIL_GLOBAL_OBJECT_CHANNELS.has(channel)) return false;
      const schema = getPayloadSchema(channel as never);
      const samples = isUntyped(schema) ? UNTYPED_SAMPLES[channel] ?? [] : idSamples(schema);
      return samples.some((payload) => resolveWith(true, channel, payload).kind === 'accounts');
    });
  }

  // C-A2/C-A27/C-A44/C-A52: Ohne explizite Stufe galt register.ts' Default 'ro' auch fuer Mutationen.
  test('Lese-Kanaele verlangen ro, alle anderen rw', () => {
    const wrong: string[] = [];
    for (const channel of accountScopedChannels()) {
      const level = mockRegistrations.get(channel)?.accountAccess;
      const expected = READ_ONLY_CHANNELS.has(channel) ? 'ro' : 'rw';
      if (level !== expected) wrong.push(`${channel}: ${String(level)} statt ${expected}`);
    }
    expect(wrong).toEqual([]);
  });

  test('die Lese-Liste enthaelt nur kontobezogene Kanaele', () => {
    const scoped = new Set(accountScopedChannels());
    expect([...READ_ONLY_CHANNELS].filter((channel) => !scoped.has(channel))).toEqual([]);
  });

  // E16/G1: Hier prueft register.ts zuerst die Rolle; Owner/Admin umgehen die Konto-ACL.
  // Die Stufe bleibt trotzdem 'rw' angegeben, und kein Lese-Kanal wird still Owner/Admin-only.
  test('kontobezogene Owner/Admin-Kanaele sind bekannt und schreibend', () => {
    const ownerAdminOnly = accountScopedChannels().filter((channel) => {
      const roles = mockRegistrations.get(channel)?.requireRole as string[] | undefined;
      return roles !== undefined && roles.every((role) => role === 'owner' || role === 'admin');
    });
    expect(ownerAdminOnly.sort()).toEqual([...OWNER_ADMIN_SCOPED_CHANNELS].sort());
    expect(ownerAdminOnly.filter((channel) => READ_ONLY_CHANNELS.has(channel))).toEqual([]);
  });
});
