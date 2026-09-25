/**
 * @jest-environment node
 */
/**
 * Anhangpfade im Verfasser ueber den echten registerIpcHandler: Nur Dateien aus
 * dem Datei-Picker, per Drag-and-drop ueber den Preload freigegebene Dateien,
 * Pfade aus dem gespeicherten Entwurf und Anhaenge lesbarer Nachrichten
 * (Weiterleiten) duerfen angehaengt werden. Echte SQLite mit Konto-ACL; ersetzt
 * sind nur Electron (Dialog), die Sitzung sowie SMTP und die IMAP-Ablage.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const mockHandlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
const mockSession: { current: Record<string, unknown> | null } = { current: null };
const mockSendSmtp = jest.fn();
const mockPickedPaths: { current: string[] } = { current: [] };

jest.mock('electron', () => ({
  app: {
    getPath: () => `${process.cwd()}/.tmp-tests/simplecrm-compose-attachment-grant`,
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
  dialog: {
    showOpenDialog: jest.fn(async () => ({ canceled: false, filePaths: mockPickedPaths.current })),
  },
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
  getEmailMessageById,
  updateComposeDraft,
} from '../../electron/email/email-store';
import {
  listAttachmentsForMessage,
  persistLocalComposeAttachments,
} from '../../electron/email/email-message-attachments-store';
import { registerEmailHandlers } from '../../electron/ipc/email';
import { registerAuthHandlers } from '../../electron/ipc/auth';

const quietLogger = { debug() {}, info() {}, warn() {}, error() {} };
const userDataDir = `${process.cwd()}/.tmp-tests/simplecrm-compose-attachment-grant`;

function session(sessionId = 's1') {
  return {
    sessionId,
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

describe('Verfasser: Anhaenge nur aus freigegebenen Pfaden', () => {
  let db: Database.Database;
  let disposers: Array<() => void>;
  let tmp: string;
  let secret: string;
  let accountId: number;
  let draftId: number;

  const window1 = { sender: { id: 1 } };
  const window2 = { sender: { id: 2 } };

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

  function file(name: string): string {
    const p = path.join(tmp, name);
    fs.writeFileSync(p, `Inhalt ${name}`);
    return p;
  }

  function invoke(channel: string, payload?: unknown, event: { sender: { id: number } } = window1) {
    const handler = mockHandlers.get(channel);
    if (!handler) throw new Error(`${channel} handler not registered`);
    return payload === undefined ? handler(event) : handler(event, payload);
  }

  const saveAttachments = (paths: string[], event = window1) =>
    invoke(IPCChannels.Email.UpdateComposeDraft, { messageId: draftId, draftAttachmentPaths: paths }, event);

  const send = (paths: string[], event = window1) =>
    invoke(
      IPCChannels.Email.SendCompose,
      {
        accountId,
        draftMessageId: draftId,
        subject: 'Angebot',
        bodyText: 'Anbei',
        to: 'kunde@kunde.test',
        attachmentPaths: paths,
      },
      event,
    );

  const storedPaths = () => getEmailMessageById(draftId)?.draft_attachment_paths_json ?? null;

  beforeEach(() => {
    mockSendSmtp.mockReset().mockResolvedValue(undefined);
    mockPickedPaths.current = [];
    fs.rmSync(userDataDir, { recursive: true, force: true });
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-grant-'));
    secret = file('geheim.txt');
    db = new Database(':memory:');
    bootstrapFreshDatabaseSchema(db, { keepDbAssigned: true });
    db.prepare(
      `INSERT INTO users (id, username, display_name, role, password_hash, password_updated_at)
       VALUES ('agent-1', 'agent', 'Agent', 'agent', 'x', ?)`,
    ).run(new Date().toISOString());
    accountId = account('service');
    db.prepare(
      "INSERT INTO user_account_access (user_id, account_id, access_level) VALUES ('agent-1', ?, 'rw')",
    ).run(accountId);
    draftId = createComposeDraft({ accountId });
    mockHandlers.clear();
    mockSession.current = session();
    disposers = [
      registerEmailHandlers({ logger: quietLogger, isDevelopment: false }),
      registerAuthHandlers({ logger: quietLogger }),
    ];
  });

  afterEach(() => {
    for (const dispose of disposers) dispose();
    closeDatabase();
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  // C-A30: SendCompose und UpdateComposeDraft haengten jeden lesbaren Host-Pfad an, den der Renderer nannte.
  test('lehnt einen nicht freigegebenen Host-Pfad ab', async () => {
    await expect(saveAttachments([secret])).rejects.toThrow(/nicht freigegeben/);
    expect(storedPaths()).toBeNull();

    await expect(send([secret])).resolves.toMatchObject({
      success: false,
      error: expect.stringMatching(/nicht freigegeben: geheim\.txt/),
    });
    expect(mockSendSmtp).not.toHaveBeenCalled();
  });

  test('erlaubt Dateien aus dem Datei-Picker, aber nur im selben Fenster und derselben Sitzung', async () => {
    mockPickedPaths.current = [secret];
    await expect(invoke(IPCChannels.Email.PickComposeAttachments)).resolves.toEqual({
      success: true,
      paths: [secret],
    });

    await expect(saveAttachments([secret], window2)).rejects.toThrow(/nicht freigegeben/);
    await expect(saveAttachments([secret])).resolves.toEqual({ success: true });
    await expect(send([secret])).resolves.toEqual({ success: true });
    const [, message] = mockSendSmtp.mock.calls[0] as [number, { attachments?: { path: string }[] }];
    expect(message.attachments?.map((a) => a.path)).toEqual([secret]);

    const other = file('anderes.txt');
    mockPickedPaths.current = [other];
    await invoke(IPCChannels.Email.PickComposeAttachments);
    mockSession.current = session('s2');
    draftId = createComposeDraft({ accountId });
    await expect(saveAttachments([other])).rejects.toThrow(/nicht freigegeben/);
  });

  test('erlaubt per Drag-and-drop freigegebene Dateien; Ordner und fehlende Dateien nicht', async () => {
    const dropped = file('drop.pdf');
    const folder = path.join(tmp, 'ordner');
    fs.mkdirSync(folder);

    await expect(
      invoke(IPCChannels.Email.RegisterDroppedComposeAttachments, {
        paths: [dropped, folder, path.join(tmp, 'fehlt.pdf')],
      }),
    ).resolves.toEqual({ success: true, paths: [dropped] });

    await expect(saveAttachments([dropped])).resolves.toEqual({ success: true });
    await expect(saveAttachments([dropped, folder])).rejects.toThrow(/nicht freigegeben: ordner/);
  });

  test('Pfade aus dem gespeicherten Entwurf bleiben nutzbar (Entwurf wiederherstellen)', async () => {
    updateComposeDraft(draftId, { draftAttachmentPaths: [secret] });

    await expect(saveAttachments([secret])).resolves.toEqual({ success: true });
    await expect(send([secret])).resolves.toEqual({ success: true });
    expect(mockSendSmtp).toHaveBeenCalledTimes(1);
  });

  test('Weiterleiten: Anhaenge von Nachrichten aus lesbaren Konten, nicht aus fremden', async () => {
    const foreignAccountId = account('vertrieb');
    const own = createComposeDraft({ accountId });
    const foreign = createComposeDraft({ accountId: foreignAccountId });
    persistLocalComposeAttachments(own, [{ filename: 'rechnung.pdf', path: file('rechnung.pdf') }]);
    persistLocalComposeAttachments(foreign, [{ filename: 'vertrag.pdf', path: file('vertrag.pdf') }]);
    const ownStored = listAttachmentsForMessage(own)[0]!.storage_path;
    const foreignStored = listAttachmentsForMessage(foreign)[0]!.storage_path;

    await expect(saveAttachments([ownStored])).resolves.toEqual({ success: true });
    await expect(saveAttachments([ownStored, foreignStored])).rejects.toThrow(/nicht freigegeben: vertrag\.pdf/);
  });

  test('Freigaben verfallen beim Logout', async () => {
    mockPickedPaths.current = [secret];
    await invoke(IPCChannels.Email.PickComposeAttachments);

    await invoke(IPCChannels.Auth.Logout);

    await expect(saveAttachments([secret])).rejects.toThrow(/nicht freigegeben/);
  });
});
