/**
 * @jest-environment node
 */
/**
 * Elternbezug im Verfasser ueber den echten registerIpcHandler mit echter
 * Konto-ACL (user_account_access) auf SQLite. Ersetzt sind nur Electron, die
 * Sitzung sowie SMTP und die IMAP-Ablage.
 */
const mockHandlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
const mockSession: { current: Record<string, unknown> | null } = { current: null };
const mockSendSmtp = jest.fn();

jest.mock('electron', () => ({
  app: {
    getPath: () => `${process.cwd()}/.tmp-tests/simplecrm-compose-reply-parent`,
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
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: {},
  shell: {},
}));

jest.mock('../../electron/auth/session-store', () => ({
  ...jest.requireActual('../../electron/auth/session-store'),
  getSessionFromEvent: () => mockSession.current,
  touchSessionActivity: () => undefined,
}));

jest.mock('../../electron/email/email-smtp', () => ({
  sendSmtpForAccount: (...args: unknown[]) => mockSendSmtp(...args),
  testSmtpConnection: jest.fn(),
}));

jest.mock('../../electron/email/email-imap-append', () => ({
  appendSentToImap: jest.fn().mockResolvedValue(undefined),
}));

import Database from 'better-sqlite3';
import { IPCChannels } from '../../shared/ipc/channels';
import { bootstrapFreshDatabaseSchema, closeDatabase } from '../../electron/sqlite-service';
import {
  createComposeDraft,
  createEmailAccountRecord,
  ensureInboxFolderForAccount,
  getEmailMessageById,
  insertOrUpdateEmailMessage,
} from '../../electron/email/email-store';
import { registerEmailHandlers } from '../../electron/ipc/email';

const event = { sender: { id: 1 } };
const quietLogger = { debug() {}, info() {}, warn() {}, error() {} };

function agentSession() {
  return {
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
}

describe('Verfasser: Elternbezug nur mit Recht am Konto der Eltern-Mail', () => {
  let db: Database.Database;
  let dispose: () => void;
  let serviceAccountId: number;
  let salesAccountId: number;
  let parentId: number;
  let draftId: number;

  function account(name: string): number {
    return createEmailAccountRecord({
      displayName: name,
      emailAddress: `${name}@firma.test`,
      imapHost: 'imap.firma.test',
      imapPort: 993,
      imapTls: true,
      imapUsername: `${name}@firma.test`,
    }).id;
  }

  function grant(accountId: number, level: 'ro' | 'rw') {
    db.prepare(
      'INSERT INTO user_account_access (user_id, account_id, access_level) VALUES (?, ?, ?)',
    ).run('agent-1', accountId, level);
  }

  function invoke(channel: string, payload: unknown) {
    const handler = mockHandlers.get(channel);
    if (!handler) throw new Error(`${channel} handler not registered`);
    return handler(event, payload);
  }

  const storedParent = () =>
    (getEmailMessageById(draftId) as { reply_parent_message_id?: number | null } | undefined)
      ?.reply_parent_message_id ?? null;

  beforeEach(() => {
    mockSendSmtp.mockReset().mockResolvedValue(undefined);
    db = new Database(':memory:');
    bootstrapFreshDatabaseSchema(db, { keepDbAssigned: true });
    db.prepare(
      `INSERT INTO users (id, username, display_name, role, password_hash, password_updated_at)
       VALUES ('agent-1', 'agent', 'Agent', 'agent', 'x', ?)`,
    ).run(new Date().toISOString());
    serviceAccountId = account('service');
    salesAccountId = account('vertrieb');
    grant(serviceAccountId, 'rw');
    const folder = ensureInboxFolderForAccount(salesAccountId);
    parentId = insertOrUpdateEmailMessage({
      accountId: salesAccountId,
      folderId: folder.id,
      uid: 3,
      messageId: '<frage@kunde.test>',
      inReplyTo: null,
      referencesHeader: null,
      subject: 'Frage',
      fromJson: JSON.stringify({ value: [{ address: 'kunde@kunde.test' }] }),
      toJson: null,
      ccJson: null,
      dateReceived: '2026-09-20T10:00:00.000Z',
      snippet: 'Frage',
      bodyText: 'Frage',
      bodyHtml: null,
      seenLocal: true,
    }).id;
    draftId = createComposeDraft({ accountId: serviceAccountId });
    mockHandlers.clear();
    mockSession.current = agentSession();
    dispose = registerEmailHandlers({ logger: quietLogger, isDevelopment: false });
  });

  afterEach(() => {
    dispose();
    closeDatabase();
  });

  // C-A79: UpdateComposeDraft speicherte eine Eltern-Mail aus einem Konto ohne Zugriff; der geplante Versand nutzte sie spaeter fuer Header, Ticket und „erledigt".
  test('UpdateComposeDraft speichert keinen Elternbezug auf ein Konto ohne Leserecht', async () => {
    await expect(
      invoke(IPCChannels.Email.UpdateComposeDraft, {
        messageId: draftId,
        subject: 'Re: Frage',
        replyParentMessageId: parentId,
      }),
    ).resolves.toEqual({ success: true });

    expect(storedParent()).toBeNull();
    expect(getEmailMessageById(draftId)?.subject).toBe('Re: Frage');
  });

  test('UpdateComposeDraft speichert den Elternbezug mit Leserecht und kann ihn wieder loesen', async () => {
    grant(salesAccountId, 'ro');

    await invoke(IPCChannels.Email.UpdateComposeDraft, { messageId: draftId, replyParentMessageId: parentId });
    expect(storedParent()).toBe(parentId);

    await invoke(IPCChannels.Email.UpdateComposeDraft, { messageId: draftId, replyParentMessageId: null });
    expect(storedParent()).toBeNull();
  });

  test('SendCompose prueft die Eltern-Mail gegen die Sitzung des Absenders', async () => {
    await expect(
      invoke(IPCChannels.Email.SendCompose, {
        accountId: serviceAccountId,
        draftMessageId: draftId,
        subject: 'Re: Frage',
        bodyText: 'Antwort',
        to: 'kunde@kunde.test',
        inReplyToMessageId: parentId,
      }),
    ).resolves.toEqual({ success: true });

    const [, message] = mockSendSmtp.mock.calls[0] as [number, { inReplyTo?: string }];
    expect(message.inReplyTo).toBeUndefined();
    expect(getEmailMessageById(parentId)?.done_local).toBe(0);
  });
});
