/**
 * @jest-environment node
 */
/**
 * Geplanter Versand und der Planende: Planen, Retry und Freigeben ueber den
 * echten registerIpcHandler, Versand ueber den echten processDueScheduledSends,
 * Konto-ACL (user_account_access) und Benutzer auf SQLite. Ersetzt sind nur
 * Electron, die Sitzung sowie SMTP und die IMAP-Ablage.
 */
const mockHandlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
const mockSession: { current: Record<string, unknown> | null } = { current: null };
const mockSendSmtp = jest.fn();

jest.mock('electron', () => ({
  app: {
    getPath: () => `${process.cwd()}/.tmp-tests/simplecrm-scheduled-send-actor`,
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
import { setDraftApprovalPending } from '../../electron/email/email-draft-approval';
import { setDraftScheduledSendAt } from '../../electron/email/email-message-features';
import { getScheduledSendDraftState } from '../../electron/email/email-scheduled-send-state';
import { processDueScheduledSends } from '../../electron/email/email-scheduled-send';
import { registerEmailHandlers } from '../../electron/ipc/email';
import { registerWorkflowHandlers } from '../../electron/ipc/workflow';

const quietLogger = { debug() {}, info() {}, warn() {}, error() {} };
const PAST = '2026-01-01T08:00:00.000Z';

function sessionFor(userId: string) {
  return {
    sessionId: `s-${userId}`,
    userId,
    username: userId,
    displayName: userId,
    role: 'agent',
    workspaceId: 'local',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    lastActivityAt: new Date().toISOString(),
  };
}

describe('Geplanter Versand prueft vor SMTP, ob der Planende noch senden darf', () => {
  let db: Database.Database;
  let disposers: Array<() => void>;
  let accountId: number;
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

  function user(id: string) {
    db.prepare(
      `INSERT INTO users (id, username, display_name, role, password_hash, password_updated_at)
       VALUES (?, ?, ?, 'agent', 'x', ?)`,
    ).run(id, id, id, new Date().toISOString());
  }

  function grant(userId: string, target: number, level: 'ro' | 'rw') {
    db.prepare(
      'INSERT OR REPLACE INTO user_account_access (user_id, account_id, access_level) VALUES (?, ?, ?)',
    ).run(userId, target, level);
  }

  function as(userId: string) {
    mockSession.current = sessionFor(userId);
  }

  function invoke(channel: string, payload: unknown) {
    const handler = mockHandlers.get(channel);
    if (!handler) throw new Error(`${channel} handler not registered`);
    return handler({ sender: { id: 1 } }, payload);
  }

  const actorKey = (id: number) =>
    (db.prepare('SELECT value FROM sync_info WHERE key = ?').get(`scheduled_send_actor:${id}`) as
      | { value: string }
      | undefined)?.value ?? null;

  const runDue = () => processDueScheduledSends({ warn() {}, debug() {} });

  beforeEach(() => {
    mockSendSmtp.mockReset().mockResolvedValue(undefined);
    db = new Database(':memory:');
    bootstrapFreshDatabaseSchema(db, { keepDbAssigned: true });
    user('agent-1');
    user('agent-2');
    accountId = account('service');
    grant('agent-1', accountId, 'rw');
    draftId = createComposeDraft({
      accountId,
      subject: 'Angebot',
      bodyText: 'Hallo',
      toJson: JSON.stringify({ value: [{ address: 'kunde@kunde.test' }] }),
    });
    mockHandlers.clear();
    as('agent-1');
    disposers = [
      registerEmailHandlers({ logger: quietLogger, isDevelopment: false }),
      registerWorkflowHandlers({ logger: quietLogger }),
    ];
  });

  afterEach(() => {
    for (const dispose of disposers) dispose();
    closeDatabase();
  });

  // C-A2: Der Hintergrundversand nutzte die Konto-Zugangsdaten ohne zu pruefen, ob der Planende nach einem Rechteentzug noch senden darf.
  test('haelt den Versand an, wenn dem Planenden das Schreibrecht entzogen wurde', async () => {
    await expect(
      invoke(IPCChannels.Email.ScheduleDraftSend, { messageId: draftId, sendAt: PAST }),
    ).resolves.toEqual({ success: true });
    grant('agent-1', accountId, 'ro');

    await expect(runDue()).resolves.toBe(0);

    expect(mockSendSmtp).not.toHaveBeenCalled();
    const draft = getEmailMessageById(draftId)!;
    expect(draft.folder_kind).toBe('draft');
    expect((draft as { scheduled_send_at?: string | null }).scheduled_send_at).toBeNull();
    expect(getScheduledSendDraftState(draftId)).toMatchObject({
      status: 'failed',
      lastError: expect.stringMatching(/Versand angehalten/),
    });
  });

  test('haelt den Versand an, wenn der Planende deaktiviert oder geloescht wurde', async () => {
    await invoke(IPCChannels.Email.ScheduleDraftSend, { messageId: draftId, sendAt: PAST });
    db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run('agent-1');
    await runDue();
    expect(mockSendSmtp).not.toHaveBeenCalled();
    expect(getScheduledSendDraftState(draftId).status).toBe('failed');

    db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run('agent-1');
    await invoke(IPCChannels.Email.RetryScheduledSendDraft, draftId);
    db.prepare('DELETE FROM users WHERE id = ?').run('agent-1');
    await runDue();
    expect(mockSendSmtp).not.toHaveBeenCalled();
    expect(getScheduledSendDraftState(draftId).status).toBe('failed');
  });

  test('sendet, solange der Planende schreiben darf, und raeumt den Akteur danach auf', async () => {
    await invoke(IPCChannels.Email.ScheduleDraftSend, { messageId: draftId, sendAt: PAST });
    expect(actorKey(draftId)).not.toBeNull();

    await expect(runDue()).resolves.toBe(1);

    expect(mockSendSmtp).toHaveBeenCalledTimes(1);
    expect(getEmailMessageById(draftId)?.folder_kind).toBe('sent');
    expect(actorKey(draftId)).toBeNull();
  });

  test('Retry durch eine andere berechtigte Person ersetzt den Akteur', async () => {
    await invoke(IPCChannels.Email.ScheduleDraftSend, { messageId: draftId, sendAt: PAST });
    grant('agent-1', accountId, 'ro');
    await runDue();
    expect(mockSendSmtp).not.toHaveBeenCalled();

    grant('agent-2', accountId, 'rw');
    as('agent-2');
    await invoke(IPCChannels.Email.RetryScheduledSendDraft, draftId);
    await expect(runDue()).resolves.toBe(1);
    expect(mockSendSmtp).toHaveBeenCalledTimes(1);
  });

  test('Freigabe eines wartenden Entwurfs speichert den Freigebenden als Akteur', async () => {
    setDraftApprovalPending(draftId, 'Bitte pruefen');
    await expect(invoke(IPCChannels.Email.ApproveDraftSend, { draftId })).resolves.toEqual({ success: true });
    expect(JSON.parse(actorKey(draftId) ?? '{}')).toMatchObject({ userId: 'agent-1' });

    grant('agent-1', accountId, 'ro');
    await runDue();
    expect(mockSendSmtp).not.toHaveBeenCalled();
    expect(getScheduledSendDraftState(draftId).status).toBe('failed');
  });

  test('aeltere Planungen ohne gespeicherten Akteur laufen wie bisher', async () => {
    setDraftScheduledSendAt(draftId, PAST);

    await expect(runDue()).resolves.toBe(1);

    expect(mockSendSmtp).toHaveBeenCalledTimes(1);
  });

  test('Abbrechen und Loeschen raeumen den gespeicherten Akteur auf', async () => {
    await invoke(IPCChannels.Email.ScheduleDraftSend, { messageId: draftId, sendAt: '2099-01-01T08:00:00.000Z' });
    expect(actorKey(draftId)).not.toBeNull();
    await invoke(IPCChannels.Email.ScheduleDraftSend, { messageId: draftId, sendAt: null });
    expect(actorKey(draftId)).toBeNull();

    await invoke(IPCChannels.Email.ScheduleDraftSend, { messageId: draftId, sendAt: '2099-01-01T08:00:00.000Z' });
    await expect(invoke(IPCChannels.Email.DeleteComposeDraft, draftId)).resolves.toEqual({ success: true });
    expect(actorKey(draftId)).toBeNull();
  });

  // C-A79 (G5): Der geplante Versand prueft die Eltern-Mail gegen den gespeicherten Akteur.
  test('nutzt beim geplanten Versand die Rechte des Planenden fuer die Eltern-Mail', async () => {
    const salesAccountId = account('vertrieb');
    grant('agent-1', salesAccountId, 'ro');
    const folder = ensureInboxFolderForAccount(salesAccountId);
    const parentId = insertOrUpdateEmailMessage({
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
    await invoke(IPCChannels.Email.UpdateComposeDraft, { messageId: draftId, replyParentMessageId: parentId });
    await invoke(IPCChannels.Email.ScheduleDraftSend, { messageId: draftId, sendAt: PAST });

    await expect(runDue()).resolves.toBe(1);

    const [, message] = mockSendSmtp.mock.calls[0] as [number, { inReplyTo?: string }];
    expect(message.inReplyTo).toBe('<frage@kunde.test>');
    // 'ro' genuegt fuer den Bezug, nicht fuer „erledigt".
    expect(getEmailMessageById(parentId)?.done_local).toBe(0);
  });
});
