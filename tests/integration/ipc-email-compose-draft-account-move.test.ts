/**
 * @jest-environment node
 */
const mockHandlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
const mockSession: { current: Record<string, unknown> | null } = { current: null };
const mockAccessibleAccounts = new Set<number>();

jest.mock('electron', () => ({
  app: {
    getPath: () => `${process.cwd()}/.tmp-tests/simplecrm-compose-draft-account-move`,
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

jest.mock('../../electron/auth/auth-store', () => ({
  ...jest.requireActual('../../electron/auth/auth-store'),
  canAccessLocalAccount: (input: { accountId: number; role: string }) =>
    input.role === 'owner' || mockAccessibleAccounts.has(input.accountId),
}));

import Database from 'better-sqlite3';
import { IPCChannels } from '../../shared/ipc/channels';
import { bootstrapFreshDatabaseSchema, closeDatabase } from '../../electron/sqlite-service';
import {
  createComposeDraft,
  createEmailAccountRecord,
  getEmailMessageById,
  getFolderById,
  updateComposeDraft,
} from '../../electron/email/email-store';
import { registerEmailHandlers } from '../../electron/ipc/email';

const event = { sender: { id: 1 } };

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

// F-A11a-04: Ein Kontowechsel im Verfasser legte einen neuen, leeren Entwurf an; der alte blieb mit
// allen Eingaben im alten Konto. UpdateComposeDraft haengt den Entwurf jetzt per accountId um.
describe('Email.UpdateComposeDraft moves a local draft to another account', () => {
  let db: Database.Database;
  let dispose: () => void;
  let serviceAccountId: number;
  let salesAccountId: number;
  let draftId: number;

  beforeEach(() => {
    db = new Database(':memory:');
    bootstrapFreshDatabaseSchema(db, { keepDbAssigned: true });
    serviceAccountId = createEmailAccountRecord({
      displayName: 'Service',
      emailAddress: 'service@firma.de',
      imapHost: 'imap.firma.de',
      imapPort: 993,
      imapTls: true,
      imapUsername: 'service@firma.de',
    }).id;
    salesAccountId = createEmailAccountRecord({
      displayName: 'Vertrieb',
      emailAddress: 'vertrieb@firma.de',
      imapHost: 'imap.firma.de',
      imapPort: 993,
      imapTls: true,
      imapUsername: 'vertrieb@firma.de',
    }).id;
    draftId = createComposeDraft({ accountId: serviceAccountId });
    updateComposeDraft(draftId, {
      subject: 'Angebot Mai',
      bodyText: 'Hallo Frau Muster',
      toJson: JSON.stringify({ value: [{ address: 'kunde@example.test' }] }),
      draftAttachmentPaths: ['/tmp/angebot.pdf'],
    });
    mockHandlers.clear();
    mockAccessibleAccounts.clear();
    mockSession.current = agentSession();
    dispose = registerEmailHandlers({ logger: { debug() {}, info() {}, warn() {}, error() {} }, isDevelopment: false });
  });

  afterEach(() => {
    dispose();
    closeDatabase();
  });

  function invokeUpdate(payload: Record<string, unknown>) {
    const handler = mockHandlers.get(IPCChannels.Email.UpdateComposeDraft);
    if (!handler) throw new Error('UpdateComposeDraft handler not registered');
    return handler(event, payload);
  }

  test('keeps id, content and attachments and switches account, folder and sender', async () => {
    mockAccessibleAccounts.add(serviceAccountId);
    mockAccessibleAccounts.add(salesAccountId);

    await expect(invokeUpdate({ messageId: draftId, accountId: salesAccountId })).resolves.toEqual({ success: true });

    const row = getEmailMessageById(draftId)!;
    expect(row.account_id).toBe(salesAccountId);
    expect(getFolderById(row.folder_id)?.account_id).toBe(salesAccountId);
    expect(row.uid).toBeLessThan(0);
    expect(row.folder_kind).toBe('draft');
    expect(JSON.parse(row.from_json ?? '{}').value[0].address).toBe('vertrieb@firma.de');
    expect(row.subject).toBe('Angebot Mai');
    expect(row.body_text).toBe('Hallo Frau Muster');
    expect(row.to_json).toContain('kunde@example.test');
    expect(row.draft_attachment_paths_json).toContain('/tmp/angebot.pdf');
    const leftovers = db
      .prepare(`SELECT id FROM email_messages WHERE account_id = ? AND folder_kind = 'draft'`)
      .all(serviceAccountId);
    expect(leftovers).toEqual([]);
  });

  test('rejects a target account the user may not use and leaves the draft untouched', async () => {
    mockAccessibleAccounts.add(serviceAccountId);

    await expect(invokeUpdate({ messageId: draftId, accountId: salesAccountId })).rejects.toThrow(/Kein Zugriff/);
    expect(getEmailMessageById(draftId)?.account_id).toBe(serviceAccountId);
  });

  test('still requires access to the account the draft currently belongs to', async () => {
    mockAccessibleAccounts.add(salesAccountId);

    await expect(invokeUpdate({ messageId: draftId, accountId: salesAccountId })).rejects.toThrow(/Kein Zugriff/);
    expect(getEmailMessageById(draftId)?.account_id).toBe(serviceAccountId);
  });
});
