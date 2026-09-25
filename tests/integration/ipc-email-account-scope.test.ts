/**
 * @jest-environment node
 */
/**
 * Konto-ACL fuer Mail-IPC-Kanaele, deren Payload ein Objekt statt eines Kontos
 * nennt (Entwurf, Notiz, Vorlage, Wissensbasis, Lauf, Bulk-Liste). Echte
 * SQLite, echte Stores, echte Konto-ACL (user_account_access) und echter
 * registerIpcHandler; ersetzt sind nur Electron und die Session. Der Agent hat
 * eine rw-Freigabe auf Konto A, keine auf Konto B.
 */
const mockHandlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
const mockSession: { current: Record<string, unknown> | null } = { current: null };
const mockTestWorkflowOnMessage = jest.fn(async () => ({ success: true }));

jest.mock('electron', () => ({
  app: {
    getPath: () => `${process.cwd()}/.tmp-tests/simplecrm-ipc-account-scope`,
    getName: () => 'simplecrm-test',
    getVersion: () => '0.0.0-test',
    isPackaged: false,
  },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
      mockHandlers.set(channel, handler);
    },
    removeHandler: (channel: string) => {
      mockHandlers.delete(channel);
    },
  },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {},
  shell: {},
}));

jest.mock('../../electron/auth/session-store', () => ({
  ...jest.requireActual('../../electron/auth/session-store'),
  getSessionFromEvent: () => mockSession.current,
  touchSessionActivity: () => undefined,
}));

jest.mock('../../electron/workflow/workflow-executor', () => ({
  executeWorkflowNow: jest.fn(),
  testWorkflowOnMessage: (...args: unknown[]) => mockTestWorkflowOnMessage(...(args as [])),
}));

import Database from 'better-sqlite3';
import { IPCChannels } from '../../shared/ipc/channels';
import { bootstrapFreshDatabaseSchema, closeDatabase } from '../../electron/sqlite-service';
import {
  createComposeDraft,
  createEmailAccountRecord,
  ensureInboxFolderForAccount,
  getEmailMessageById,
} from '../../electron/email/email-store';
import { registerEmailHandlers } from '../../electron/ipc/email';
import { registerWorkflowHandlers } from '../../electron/ipc/workflow';

const event = { sender: { id: 1 } };
const quietLogger = { debug() {}, info() {}, warn() {}, error() {} };

function sessionFor(role: 'agent' | 'admin' | 'owner') {
  return {
    sessionId: `s-${role}`,
    userId: `${role}-1`,
    username: role,
    displayName: role,
    role,
    workspaceId: 'local',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    lastActivityAt: new Date().toISOString(),
  };
}

function invoke(channel: string, payload?: unknown): Promise<any> {
  const handler = mockHandlers.get(channel);
  if (!handler) throw new Error(`kein Handler fuer ${channel}`);
  return payload === undefined ? handler(event) : handler(event, payload);
}

describe('Mail-IPC: Objekt-IDs werden auf ihr Konto aufgeloest', () => {
  let db: Database.Database;
  let disposeEmail: () => void;
  let disposeWorkflow: () => void;
  let accountA: number;
  let accountB: number;
  let messageA: number;
  let messageB: number;
  let draftA: number;
  let draftB: number;
  let noteB: number;
  let cannedB: number;
  let cannedGlobal: number;
  let promptB: number;
  let spamB: number;
  let kbB: number;
  let runB: number;

  function insertMessage(accountId: number, uid: number, extra: Record<string, unknown> = {}): number {
    const folderId = ensureInboxFolderForAccount(accountId).id;
    const cols = { account_id: accountId, folder_id: folderId, uid, subject: `Mail ${uid}`, body_text: 'Inhalt', ...extra };
    const keys = Object.keys(cols);
    const r = db
      .prepare(`INSERT INTO email_messages (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
      .run(...Object.values(cols));
    return Number(r.lastInsertRowid);
  }

  function insertRow(table: string, cols: Record<string, unknown>): number {
    const keys = Object.keys(cols);
    const r = db
      .prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
      .run(...Object.values(cols));
    return Number(r.lastInsertRowid);
  }

  beforeEach(() => {
    db = new Database(':memory:');
    bootstrapFreshDatabaseSchema(db, { keepDbAssigned: true });
    const account = (name: string) =>
      createEmailAccountRecord({
        displayName: name,
        emailAddress: `${name}@firma.de`,
        imapHost: 'imap.firma.de',
        imapPort: 993,
        imapTls: true,
        imapUsername: `${name}@firma.de`,
      }).id;
    accountA = account('service');
    accountB = account('vertrieb');
    messageA = insertMessage(accountA, 1, { thread_id: 'T1' });
    messageB = insertMessage(accountB, 1, { thread_id: 'T1-B' });
    draftA = createComposeDraft({ accountId: accountA, subject: 'Entwurf A' });
    draftB = createComposeDraft({ accountId: accountB, subject: 'Entwurf B' });
    noteB = insertRow('email_internal_notes', { message_id: messageB, body: 'Notiz B' });
    cannedB = insertRow('email_canned_responses', { title: 'Vorlage B', body: 'b', account_id: accountB });
    cannedGlobal = insertRow('email_canned_responses', { title: 'Vorlage global', body: 'g' });
    promptB = insertRow('email_ai_prompts', { label: 'Prompt B', user_template: 'x', account_id: accountB });
    spamB = insertRow('email_spam_list_entries', {
      list_type: 'block',
      pattern_type: 'domain',
      pattern: 'spam-b.test',
      account_id: accountB,
    });
    kbB = insertRow('workflow_knowledge_bases', { name: 'Wissen B', account_id: accountB });
    const workflowId = insertRow('email_workflows', {
      name: 'W',
      trigger: 'inbound',
      definition_json: '{}',
    });
    runB = insertRow('email_workflow_runs', {
      workflow_id: workflowId,
      message_id: messageB,
      direction: 'inbound',
      status: 'ok',
      log_json: JSON.stringify(['Inhalt aus Konto B']),
    });
    // Kontouebergreifender Alias: Thread T1-B (Konto B) haengt an T1 (Konto A).
    insertRow('email_thread_aliases', {
      alias_thread_id: 'T1-B',
      canonical_thread_id: 'T1',
      account_id: accountB,
      confidence: 'medium',
      source: 'cross_account_subject',
    });

    insertRow('users', {
      id: 'agent-1',
      username: 'agent',
      display_name: 'Agent',
      role: 'agent',
      password_hash: 'x',
      password_updated_at: new Date().toISOString(),
    });
    db.prepare(`INSERT INTO user_account_access (user_id, account_id, access_level) VALUES (?, ?, 'rw')`)
      .run('agent-1', accountA);

    mockHandlers.clear();
    mockTestWorkflowOnMessage.mockClear();
    mockSession.current = sessionFor('agent');
    disposeEmail = registerEmailHandlers({ logger: quietLogger, isDevelopment: false });
    disposeWorkflow = registerWorkflowHandlers({ logger: quietLogger });
  });

  afterEach(() => {
    disposeWorkflow();
    disposeEmail();
    closeDatabase();
  });

  const row = (table: string, id: number) =>
    db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Record<string, unknown> | undefined;

  // C-A14: Bulk-Kanaele ohne accountId liefen ohne Konto-Pruefung, fremde Nachrichten liessen sich loeschen/aendern.
  test.each([
    [IPCChannels.Email.BulkSoftDeleteMessages, {}, 'soft_deleted', 0],
    [IPCChannels.Email.BulkSetMessagesArchived, { archived: true }, 'archived', 0],
    [IPCChannels.Email.BulkSetMessageSpam, { spam: true }, 'is_spam', 0],
    [IPCChannels.Email.BulkSetMessageSpamStatus, { status: 'spam', train: false }, 'spam_status', 'clean'],
    [IPCChannels.Email.BulkSetMessageDone, { done: true }, 'done_local', 0],
  ] as const)('%s prueft das Konto jeder Nachricht', async (channel, extra, column, unchanged) => {
    await expect(invoke(channel, { messageIds: [messageA, messageB], ...extra })).rejects.toThrow(/Kein Zugriff/);
    expect(row('email_messages', messageA)?.[column]).toBe(unchanged);
    expect(row('email_messages', messageB)?.[column]).toBe(unchanged);

    // Mit eigenem accountId als Filter wird die fremde Nachricht trotzdem geprueft.
    await expect(
      invoke(channel, { messageIds: [messageB], accountId: accountA, ...extra }),
    ).rejects.toThrow(/Kein Zugriff/);

    await expect(invoke(channel, { messageIds: [messageA], ...extra })).resolves.toEqual({ success: true, count: 1 });
  });

  // C-B4: Entwuerfe fremder Konten liessen sich einzeln und per Bulk endgueltig loeschen.
  test('Entwurf loeschen (einzeln und Bulk) nur im eigenen Konto', async () => {
    await expect(invoke(IPCChannels.Email.DeleteComposeDraft, draftB)).rejects.toThrow(/Kein Zugriff/);
    await expect(invoke(IPCChannels.Email.BulkDeleteComposeDrafts, { messageIds: [draftA, draftB] }))
      .rejects.toThrow(/Kein Zugriff/);
    await expect(invoke(IPCChannels.Email.GetComposeDraftRecoveryState, draftB)).rejects.toThrow(/Kein Zugriff/);
    expect(getEmailMessageById(draftA)).toBeDefined();
    expect(getEmailMessageById(draftB)).toBeDefined();

    await expect(invoke(IPCChannels.Email.DeleteComposeDraft, draftA)).resolves.toEqual({ success: true });
    expect(getEmailMessageById(draftA)).toBeUndefined();
  });

  // C-A25: Notiz-IDs wurden nicht aufgeloest, fremde interne Notizen liessen sich aendern und loeschen.
  test('interne Notizen fremder Konten bleiben unberuehrt', async () => {
    await expect(invoke(IPCChannels.Email.UpdateInternalNote, { noteId: noteB, body: 'ueberschrieben' }))
      .rejects.toThrow(/Kein Zugriff/);
    await expect(invoke(IPCChannels.Email.DeleteInternalNote, noteB)).rejects.toThrow(/Kein Zugriff/);
    expect(row('email_internal_notes', noteB)?.body).toBe('Notiz B');
  });

  // C-A29: Das mitgeschickte Zielkonto ersetzte den Eigentuemer; fremde Vorlagen liessen sich umhaengen und loeschen.
  test('Vorlagen, KI-Prompts und Spam-Eintraege pruefen das Konto der bestehenden Zeile', async () => {
    const attempts: Array<[string, unknown]> = [
      [IPCChannels.Email.SaveCannedResponse, { id: cannedB, title: 'Fremd', body: 'x', accountId: accountA }],
      [IPCChannels.Email.SaveCannedResponse, { id: cannedB, title: 'Fremd', body: 'x' }],
      [IPCChannels.Email.DeleteCannedResponse, cannedB],
      [IPCChannels.Email.SaveAiPrompt, { id: promptB, label: 'Fremd', userTemplate: 'y', accountId: accountA }],
      [IPCChannels.Email.DeleteAiPrompt, promptB],
      [IPCChannels.Email.ReorderAiPrompt, { id: promptB, direction: 'up' }],
      [IPCChannels.Email.SaveSpamListEntry, { id: spamB, listType: 'allow', pattern: 'x.test', accountId: accountA }],
      [IPCChannels.Email.DeleteSpamListEntry, spamB],
      [IPCChannels.Email.ListSpamListEntries, accountB],
    ];
    for (const [channel, payload] of attempts) {
      await expect(invoke(channel, payload)).rejects.toThrow(/Kein Zugriff/);
    }
    expect(row('email_canned_responses', cannedB)).toMatchObject({ title: 'Vorlage B', account_id: accountB });
    expect(row('email_ai_prompts', promptB)).toMatchObject({ label: 'Prompt B', account_id: accountB });
    expect(row('email_spam_list_entries', spamB)).toMatchObject({ list_type: 'block', account_id: accountB });

    // Globale Zeilen (account_id NULL) bleiben wie bisher fuer jeden bearbeitbar.
    await expect(invoke(IPCChannels.Email.SaveCannedResponse, {
      id: cannedGlobal,
      title: 'Global neu',
      body: 'g',
      accountId: null,
    })).resolves.toMatchObject({ success: true });
    expect(row('email_canned_responses', cannedGlobal)?.title).toBe('Global neu');
  });

  // C-A25: Thread-Inhalt lief ohne Kontofilter; ein Alias zog Nachrichten fremder Konten mit.
  test('Thread-Nachrichten und Alias-Warnungen zeigen nur zugaengliche Konten', async () => {
    const thread = (await invoke(IPCChannels.Email.ListThreadMessages, { threadId: 'T1' })) as Array<{ id: number }>;
    expect(thread.map((m) => m.id)).toEqual([messageA]);

    const warnings = (await invoke(IPCChannels.Email.ListThreadAliasWarnings)) as Array<{ messageId: number }>;
    expect(warnings.map((w) => w.messageId)).not.toContain(messageB);

    mockSession.current = sessionFor('admin');
    const all = (await invoke(IPCChannels.Email.ListThreadMessages, { threadId: 'T1' })) as Array<{ id: number }>;
    expect(all.map((m) => m.id).sort()).toEqual([messageA, messageB].sort());
    const allWarnings = (await invoke(IPCChannels.Email.ListThreadAliasWarnings)) as Array<{ messageId: number }>;
    expect(allWarnings.map((w) => w.messageId)).toContain(messageB);
  });

  // C-A65: Freigabe/Verwerfen wartender KI-Entwuerfe lief ohne Konto-Pruefung (workflow:-Kanaele fielen aus dem Resolver).
  test('KI-Entwurf freigeben oder verwerfen nur im eigenen Konto', async () => {
    await expect(invoke(IPCChannels.Email.ApproveDraftSend, { draftId: draftB })).rejects.toThrow(/Kein Zugriff/);
    await expect(invoke(IPCChannels.Email.DismissDraftApproval, { draftId: draftB })).rejects.toThrow(/Kein Zugriff/);
    expect(row('email_messages', draftB)).toMatchObject({ scheduled_send_at: null });
  });

  // C-A24: workflow:test-on-message lief auf Nachrichten fremder Konten.
  test('Workflow-Test nur auf Nachrichten des eigenen Kontos', async () => {
    await expect(invoke(IPCChannels.Email.TestWorkflowOnMessage, { workflowId: 1, messageId: messageB }))
      .rejects.toThrow(/Kein Zugriff/);
    expect(mockTestWorkflowOnMessage).not.toHaveBeenCalled();

    await invoke(IPCChannels.Email.TestWorkflowOnMessage, { workflowId: 1, messageId: messageA });
    expect(mockTestWorkflowOnMessage).toHaveBeenCalledTimes(1);
  });

  // C-A49: Wissensbasen und Lauf-Logs fremder Konten waren per ID les- und schreibbar.
  test('Wissensbasen und Workflow-Laeufe pruefen das Konto ihres Objekts', async () => {
    const reads: Array<[string, unknown]> = [
      [IPCChannels.Email.GetKnowledgeBaseDocument, kbB],
      [IPCChannels.Email.ExportKnowledgeBaseDocument, kbB],
      [IPCChannels.Email.GetWorkflowRunLog, runB],
      [IPCChannels.Email.ListWorkflowRunSteps, runB],
    ];
    for (const [channel, payload] of reads) {
      await expect(invoke(channel, payload)).rejects.toThrow(/Kein Zugriff/);
    }

    // Schreiben ist seit G1 Owner/Admin vorbehalten; die Rollenpruefung greift vor der Konto-ACL.
    const writes: Array<[string, unknown]> = [
      [IPCChannels.Email.SaveKnowledgeBaseDocument, { knowledgeBaseId: kbB, content: 'neu' }],
      [IPCChannels.Email.AddKnowledgeChunk, { knowledgeBaseId: kbB, content: 'neu' }],
      [IPCChannels.Email.ImportKnowledgeFile, { knowledgeBaseId: kbB }],
      [IPCChannels.Email.UpdateKnowledgeBase, { id: kbB, name: 'Fremd', accountId: accountA }],
      [IPCChannels.Email.DeleteKnowledgeBase, kbB],
    ];
    for (const [channel, payload] of writes) {
      await expect(invoke(channel, payload)).rejects.toThrow('Keine Berechtigung');
    }
    expect(row('workflow_knowledge_bases', kbB)).toMatchObject({ name: 'Wissen B', account_id: accountB });

    // Owner/Admin umgehen die Konto-ACL; die Aufloesung der Wissensbasis haelt sie nicht auf.
    mockSession.current = sessionFor('admin');
    await expect(invoke(IPCChannels.Email.UpdateKnowledgeBase, { id: kbB, name: 'Wissen neu', accountId: accountA }))
      .resolves.toEqual({ success: true });
    expect(row('workflow_knowledge_bases', kbB)).toMatchObject({ name: 'Wissen neu', account_id: accountA });
  });

  // C-A78: Nicht aufloesbare Objekt-IDs uebersprangen die Konto-ACL (fail-open).
  test('unbekannte Objekt-IDs lehnen Nicht-Admins ab, Owner/Admin sehen die Handler-Antwort', async () => {
    await expect(invoke(IPCChannels.Email.DeleteComposeDraft, 999_999)).rejects.toThrow(/Kein Zugriff/);
    await expect(invoke(IPCChannels.Email.BulkSetMessageDone, { messageIds: [messageA, 999_999], done: true }))
      .rejects.toThrow(/Kein Zugriff/);
    expect(row('email_messages', messageA)?.done_local).toBe(0);
    await expect(invoke(IPCChannels.Email.UpdateInternalNote, { noteId: 999_999, body: 'x' }))
      .rejects.toThrow(/Kein Zugriff/);

    mockSession.current = sessionFor('admin');
    await expect(invoke(IPCChannels.Email.DeleteComposeDraft, 999_999))
      .resolves.toEqual({ success: false, error: 'Entwurf nicht gefunden' });
  });

  test('Owner und Admin umgehen die Konto-ACL wie bisher', async () => {
    mockSession.current = sessionFor('owner');
    await expect(invoke(IPCChannels.Email.BulkSoftDeleteMessages, { messageIds: [messageA, messageB] }))
      .resolves.toEqual({ success: true, count: 2 });
    await expect(invoke(IPCChannels.Email.DeleteComposeDraft, draftB)).resolves.toEqual({ success: true });
    await expect(invoke(IPCChannels.Email.DeleteCannedResponse, cannedB)).resolves.toEqual({ success: true });
  });
});
