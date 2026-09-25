/**
 * @jest-environment node
 */
/**
 * Stufen der Desktop-Konto-ACL (user_account_access): Wer ein Postfach nur lesen
 * darf ('ro'), darf es lesen und als gelesen markieren, aber nichts veraendern,
 * nichts planen und nichts versenden. Echte SQLite, echte ACL, echter
 * registerIpcHandler; ersetzt sind nur Electron und die Session.
 */
const mockHandlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
const mockSession: { current: Record<string, unknown> | null } = { current: null };

jest.mock('electron', () => ({
  app: {
    getPath: () => `${process.cwd()}/.tmp-tests/simplecrm-ipc-access-levels`,
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

const event = { sender: { id: 1 } };

function invoke(channel: string, payload?: unknown): Promise<any> {
  const handler = mockHandlers.get(channel);
  if (!handler) throw new Error(`kein Handler fuer ${channel}`);
  return payload === undefined ? handler(event) : handler(event, payload);
}

describe('Konto-Freigabe "ro" erlaubt keine Mutationen', () => {
  let db: Database.Database;
  let dispose: () => void;
  let accountA: number;
  let accountB: number;
  let message: number;
  let draft: number;

  function grant(accountId: number, level: 'ro' | 'rw' | 'send_only') {
    db.prepare(
      `INSERT OR REPLACE INTO user_account_access (user_id, account_id, access_level) VALUES ('agent-1', ?, ?)`,
    ).run(accountId, level);
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
    const folderId = ensureInboxFolderForAccount(accountA).id;
    message = Number(
      db.prepare(
        `INSERT INTO email_messages (account_id, folder_id, uid, subject, body_text, from_json)
         VALUES (?, ?, 1, 'Anfrage', 'Inhalt', '{"value":[{"address":"kunde@example.test"}]}')`,
      ).run(accountA, folderId).lastInsertRowid,
    );
    draft = createComposeDraft({ accountId: accountA, subject: 'Entwurf' });
    db.prepare(
      `INSERT INTO users (id, username, display_name, role, password_hash, password_updated_at)
       VALUES ('agent-1', 'agent', 'Agent', 'agent', 'x', ?)`,
    ).run(new Date().toISOString());
    grant(accountA, 'ro');

    mockHandlers.clear();
    mockSession.current = {
      sessionId: 's1',
      userId: 'agent-1',
      username: 'agent',
      displayName: 'Agent',
      role: 'agent',
      workspaceId: 'local',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      lastActivityAt: new Date().toISOString(),
    };
    dispose = registerEmailHandlers({ logger: { debug() {}, info() {}, warn() {}, error() {} }, isDevelopment: false });
  });

  afterEach(() => {
    dispose();
    closeDatabase();
  });

  const row = (id: number) => db.prepare(`SELECT * FROM email_messages WHERE id = ?`).get(id) as Record<string, unknown>;

  // C-A2/C-A44/C-A52: Mutierende Kanaele liefen mit der Default-Stufe 'ro'; ein Lese-Delegierter
  // konnte Entwuerfe anlegen, planen, Nachrichten loeschen oder eine Lesebestaetigung senden.
  test('Mutationen verlangen rw', async () => {
    const attempts: Array<[string, unknown]> = [
      [IPCChannels.Email.CreateComposeDraft, { accountId: accountA, subject: 'Neu' }],
      [IPCChannels.Email.UpdateComposeDraft, { messageId: draft, subject: 'Geaendert' }],
      [IPCChannels.Email.ValidateOutbound, { messageId: draft, subject: 's', bodyText: 'b', to: 'x@example.test' }],
      [IPCChannels.Email.ScheduleDraftSend, { messageId: draft, sendAt: '2030-01-01T10:00:00.000Z' }],
      [IPCChannels.Email.RetryScheduledSendDraft, draft],
      [IPCChannels.Email.ClearScheduledSendDraftFailure, draft],
      [IPCChannels.Email.DeleteComposeDraft, draft],
      [IPCChannels.Email.SoftDeleteMessage, message],
      [IPCChannels.Email.RestoreMessage, message],
      [IPCChannels.Email.SetMessageArchived, { messageId: message, archived: true }],
      [IPCChannels.Email.SetMessageDone, { messageId: message, done: true }],
      [IPCChannels.Email.SetMessageSpam, { messageId: message, spam: true }],
      [IPCChannels.Email.SetMessageSpamStatus, { messageId: message, status: 'spam', train: false }],
      [IPCChannels.Email.BulkSoftDeleteMessages, { messageIds: [message] }],
      [IPCChannels.Email.BulkSetMessageDone, { messageIds: [message], done: true }],
      [IPCChannels.Email.SnoozeMessage, { messageId: message, until: '2030-01-01T10:00:00.000Z' }],
      [IPCChannels.Email.MoveMessageToView, { messageId: message, view: 'archived' }],
      [IPCChannels.Email.AddMessageTag, { messageId: message, tag: 'x' }],
      [IPCChannels.Email.AddInternalNote, { messageId: message, body: 'Notiz' }],
      [IPCChannels.Email.LinkCustomer, { messageId: message, customerId: null }],
      [IPCChannels.Email.AssignMessage, { messageId: message, teamMemberId: null }],
      [IPCChannels.Email.SetRemoteContentPolicy, { messageId: message, policy: 'allowed_sender', rememberSender: true }],
      [IPCChannels.Email.RespondReadReceipt, { messageId: message, action: 'decline' }],
      [IPCChannels.Email.TestVacationAutoReply, accountA],
      [IPCChannels.Email.SaveAccountSignature, { accountId: accountA, signatureHtml: '<p>x</p>' }],
    ];
    for (const [channel, payload] of attempts) {
      await expect(invoke(channel, payload)).rejects.toThrow(/Kein Zugriff/);
    }
    expect(row(message)).toMatchObject({
      soft_deleted: 0,
      archived: 0,
      done_local: 0,
      is_spam: 0,
      snoozed_until: null,
    });
    expect(row(draft)).toMatchObject({ subject: 'Entwurf', scheduled_send_at: null });
    expect(db.prepare(`SELECT COUNT(*) AS c FROM email_messages WHERE account_id = ?`).get(accountA))
      .toEqual({ c: 2 });
    expect(db.prepare(`SELECT COUNT(*) AS c FROM email_internal_notes`).get()).toEqual({ c: 0 });
  });

  test('Lesen und "gelesen" markieren bleiben mit ro moeglich', async () => {
    await expect(invoke(IPCChannels.Email.GetMessage, message)).resolves.toMatchObject({ id: message });
    await expect(invoke(IPCChannels.Email.ListInternalNotes, message)).resolves.toEqual([]);
    await expect(invoke(IPCChannels.Email.SetMessageSeen, { messageId: message, seen: true, syncToServer: false }))
      .resolves.toEqual({ success: true });
    expect(row(message).seen_local).toBe(1);
  });

  test('mit rw sind die Mutationen erlaubt', async () => {
    grant(accountA, 'rw');
    await expect(invoke(IPCChannels.Email.SetMessageDone, { messageId: message, done: true }))
      .resolves.toEqual({ success: true });
    await expect(invoke(IPCChannels.Email.UpdateComposeDraft, { messageId: draft, subject: 'Geaendert' }))
      .resolves.toEqual({ success: true });
    expect(getEmailMessageById(draft)?.subject).toBe('Geaendert');
  });

  // C-A2: Beim Umhaengen eines Entwurfs genuegte fuer das Zielkonto 'ro'.
  test('Entwurf umhaengen verlangt rw auf dem Zielkonto', async () => {
    grant(accountA, 'rw');
    grant(accountB, 'ro');
    await expect(invoke(IPCChannels.Email.UpdateComposeDraft, { messageId: draft, accountId: accountB }))
      .rejects.toThrow(/Kein Zugriff/);
    expect(getEmailMessageById(draft)?.account_id).toBe(accountA);
  });
});
