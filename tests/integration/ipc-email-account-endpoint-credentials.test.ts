/**
 * @jest-environment node
 */
/**
 * Konto bearbeiten auf dem Desktop (email:update-account): Wer Host, Port oder
 * TLS eines Protokolls aendert oder die SMTP-Anmeldung "wie IMAP" umschaltet,
 * muss das Passwort mitschicken, mit dem sich das Protokoll anmeldet. Sonst
 * schickt der naechste Abruf oder Versand das gespeicherte Passwort (oder das
 * OAuth-Token) an den neuen Server. Paritaet zu A2a-01/E2 der Server-Edition
 * (missingCredentialsForEndpointChange in packages/server/src/api/mail-routes.ts).
 * Echte SQLite, echte Stores und echter registerIpcHandler; ersetzt sind nur
 * Electron, die Session (Owner) und der Schluesselbund.
 */
const mockHandlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
const mockKeychain = new Map<string, string>();

jest.mock('electron', () => ({
  app: {
    getPath: () => `${process.cwd()}/.tmp-tests/simplecrm-account-endpoint-credentials`,
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
  getSessionFromEvent: () => ({
    sessionId: 's-owner',
    userId: 'owner-1',
    username: 'owner',
    displayName: 'Owner',
    role: 'owner',
    workspaceId: 'local',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    lastActivityAt: new Date().toISOString(),
  }),
  touchSessionActivity: () => undefined,
}));

jest.mock('../../electron/email/email-keytar', () => ({
  ...jest.requireActual('../../electron/email/email-keytar'),
  saveEmailPassword: jest.fn(async (key: string, value: string) => {
    mockKeychain.set(key, value);
  }),
  getEmailPassword: jest.fn(async (key: string) => mockKeychain.get(key) ?? null),
  deleteEmailPassword: jest.fn(async (key: string) => mockKeychain.delete(key)),
}));

import Database from 'better-sqlite3';
import { IPCChannels } from '../../shared/ipc/channels';
import { bootstrapFreshDatabaseSchema, closeDatabase } from '../../electron/sqlite-service';
import {
  createEmailAccountRecord,
  getEmailAccountById,
  updateEmailAccountRecord,
} from '../../electron/email/email-store';
import { saveEmailPassword } from '../../electron/email/email-keytar';
import { registerEmailHandlers } from '../../electron/ipc/email';

const event = { sender: { id: 1 } };
const quietLogger = { debug() {}, info() {}, warn() {}, error() {} };
const PREFIX = 'Zugangsdaten bei Serverwechsel neu eingeben: ';

function invoke(channel: string, payload?: unknown): Promise<any> {
  const handler = mockHandlers.get(channel);
  if (!handler) throw new Error(`kein Handler fuer ${channel}`);
  return payload === undefined ? handler(event) : handler(event, payload);
}

describe('Konto bearbeiten: Serverwechsel verlangt neue Zugangsdaten (A2a-01, E2)', () => {
  let dispose: () => void;
  /** IMAP, SMTP wie IMAP. */
  let imapId: number;
  /** POP3 mit eigenem POP3-Host. */
  let pop3Id: number;
  /** IMAP, SMTP mit eigenem SMTP-Passwort. */
  let smtpOwnId: number;
  /** Google-OAuth-Konto. */
  let oauthId: number;
  /** Noch kein SMTP-Host eingetragen. */
  let noSmtpId: number;

  function account(input: { name: string; protocol?: 'imap' | 'pop3'; pop3Host?: string }): number {
    const { id } = createEmailAccountRecord({
      displayName: input.name,
      emailAddress: `${input.name}@firma.de`,
      imapHost: 'imap.firma.de',
      imapPort: 993,
      imapTls: true,
      imapUsername: `${input.name}@firma.de`,
      keytarAccountKey: `email-${input.name}`,
      protocol: input.protocol,
      pop3Host: input.pop3Host,
    });
    mockKeychain.set(`email-${input.name}`, `alt-${input.name}`);
    return id;
  }

  const endpointColumns = (id: number) => {
    const row = getEmailAccountById(id)!;
    return {
      imap_host: row.imap_host,
      imap_port: row.imap_port,
      imap_tls: row.imap_tls,
      smtp_host: row.smtp_host,
      smtp_port: row.smtp_port,
      smtp_tls: row.smtp_tls,
      smtp_use_imap_auth: row.smtp_use_imap_auth,
      smtp_keytar_account_key: row.smtp_keytar_account_key,
      pop3_host: row.pop3_host,
      pop3_port: row.pop3_port,
      pop3_tls: row.pop3_tls,
    };
  };

  beforeEach(() => {
    mockKeychain.clear();
    const db = new Database(':memory:');
    bootstrapFreshDatabaseSchema(db, { keepDbAssigned: true });

    imapId = account({ name: 'support' });
    updateEmailAccountRecord(imapId, { smtpHost: 'smtp.firma.de', smtpPort: 587, smtpTls: true, smtpUseImapAuth: true });
    pop3Id = account({ name: 'pop', protocol: 'pop3', pop3Host: 'pop.firma.de' });
    smtpOwnId = account({ name: 'versand' });
    updateEmailAccountRecord(smtpOwnId, {
      smtpHost: 'smtp.firma.de',
      smtpPort: 587,
      smtpTls: true,
      smtpUsername: 'versand-smtp@firma.de',
      smtpUseImapAuth: false,
      smtpKeytarAccountKey: 'email-smtp-versand',
    });
    mockKeychain.set('email-smtp-versand', 'alt-smtp');
    oauthId = account({ name: 'gmail' });
    updateEmailAccountRecord(oauthId, {
      smtpHost: 'smtp.firma.de',
      oauthProvider: 'google',
      oauthRefreshKeytarKey: 'email-oauth-gmail',
    });
    mockKeychain.set('email-oauth-gmail', 'refresh-token');
    noSmtpId = account({ name: 'neu' });

    jest.mocked(saveEmailPassword).mockClear();
    mockHandlers.clear();
    dispose = registerEmailHandlers({ logger: quietLogger, isDevelopment: false });
  });

  afterEach(() => {
    dispose();
    closeDatabase();
  });

  async function expectRejected(payload: Record<string, unknown>, message: string) {
    const id = payload.id as number;
    const before = endpointColumns(id);
    const keychainBefore = new Map(mockKeychain);
    await expect(invoke(IPCChannels.Email.UpdateAccount, payload))
      .resolves.toEqual({ success: false, error: `${PREFIX}${message}` });
    expect(endpointColumns(id)).toEqual(before);
    expect(getEmailAccountById(id)!.display_name).not.toBe('Geaendert');
    expect(mockKeychain).toEqual(keychainBefore);
    expect(saveEmailPassword).not.toHaveBeenCalled();
  }

  // A2a-01, E2: UpdateAccount stellte IMAP-Host, -Port oder -TLS ohne Passwort um; der naechste Abruf schickte das gespeicherte Passwort an den neuen Server.
  test.each([
    ['Host', { imapHost: 'imap.fremd.example' }, 'IMAP-Passwort erforderlich (IMAP-Server, POP3-Server geaendert)'],
    ['Port', { imapPort: 143 }, 'IMAP-Passwort erforderlich (IMAP-Server geaendert)'],
    ['TLS', { imapTls: false }, 'IMAP-Passwort erforderlich (IMAP-Server geaendert)'],
  ])('IMAP-%s ohne Passwort wird abgelehnt, Konto und Schluesselbund bleiben', async (_label, change, message) => {
    await expectRejected({ id: imapId, displayName: 'Geaendert', ...change }, message);
  });

  test('IMAP-Host mit neuem Passwort wird gespeichert', async () => {
    await expect(invoke(IPCChannels.Email.UpdateAccount, {
      id: imapId,
      imapHost: 'imap.neu.example',
      imapPassword: 'neu-imap',
    })).resolves.toEqual({ success: true });
    expect(getEmailAccountById(imapId)!.imap_host).toBe('imap.neu.example');
    expect(mockKeychain.get('email-support')).toBe('neu-imap');
  });

  test('das komplette Formular mit unveraenderten Servern braucht kein Passwort', async () => {
    await expect(invoke(IPCChannels.Email.UpdateAccount, {
      id: imapId,
      displayName: 'Geaendert',
      emailAddress: 'support@firma.de',
      imapHost: ' IMAP.Firma.de ',
      imapPort: 993,
      imapTls: true,
      imapUsername: 'support@firma.de',
      protocol: 'imap',
      pop3Host: null,
      pop3Port: 995,
      pop3Tls: true,
      smtpHost: 'smtp.firma.de',
      smtpPort: 587,
      smtpTls: true,
      smtpUseImapAuth: true,
    })).resolves.toEqual({ success: true });
    expect(getEmailAccountById(imapId)!.display_name).toBe('Geaendert');
    expect(saveEmailPassword).not.toHaveBeenCalled();
  });

  // A2a-01, E2: Auch der POP3-Abruf schickte das gespeicherte Passwort an einen neuen POP3-Server.
  test('POP3-Host ohne Passwort wird abgelehnt, mit Passwort gespeichert', async () => {
    await expectRejected({ id: pop3Id, displayName: 'Geaendert', pop3Host: 'pop.fremd.example' },
      'IMAP-Passwort erforderlich (POP3-Server geaendert)');

    await expect(invoke(IPCChannels.Email.UpdateAccount, {
      id: pop3Id,
      pop3Host: 'pop.fremd.example',
      imapPassword: 'neu-pop',
    })).resolves.toEqual({ success: true });
    expect(getEmailAccountById(pop3Id)!.pop3_host).toBe('pop.fremd.example');
  });

  // A2a-01, E2: Mit "wie IMAP" ging das IMAP-Passwort (oder OAuth-Token) an einen neuen SMTP-Server; ein SMTP-Passwort deckt das nicht ab.
  test('SMTP wie IMAP: neuer SMTP-Host verlangt das IMAP-Passwort', async () => {
    await expectRejected({ id: imapId, displayName: 'Geaendert', smtpHost: 'smtp.fremd.example', smtpPassword: 'egal' },
      'IMAP-Passwort erforderlich (SMTP-Server geaendert)');

    await expect(invoke(IPCChannels.Email.UpdateAccount, {
      id: imapId,
      smtpHost: 'smtp.fremd.example',
      imapPassword: 'neu-imap',
    })).resolves.toEqual({ success: true });
    expect(getEmailAccountById(imapId)!.smtp_host).toBe('smtp.fremd.example');
  });

  test.each([
    ['Host', { smtpHost: 'smtp.fremd.example' }],
    ['Port', { smtpPort: 465 }],
    ['TLS', { smtpTls: false }],
  ])('SMTP mit eigenem Passwort: %s verlangt das SMTP-Passwort', async (_label, change) => {
    await expectRejected({ id: smtpOwnId, displayName: 'Geaendert', ...change, imapPassword: 'egal' },
      'SMTP-Passwort erforderlich (SMTP-Server geaendert)');

    await expect(invoke(IPCChannels.Email.UpdateAccount, { id: smtpOwnId, ...change, smtpPassword: 'neu-smtp' }))
      .resolves.toEqual({ success: true });
    expect(mockKeychain.get('email-smtp-versand')).toBe('neu-smtp');
  });

  // A2a-01, E2: Das Umschalten von "wie IMAP" wechselt, welches gespeicherte Passwort an den SMTP-Server geht.
  test.each([
    ['einschalten', () => smtpOwnId, true, 'IMAP-Passwort erforderlich (SMTP-Server geaendert)'],
    ['ausschalten', () => imapId, false, 'SMTP-Passwort erforderlich (SMTP-Server geaendert)'],
  ])('"wie IMAP" %s ohne Passwort der neuen Quelle wird abgelehnt', async (_label, id, smtpUseImapAuth, message) => {
    await expectRejected({ id: id(), displayName: 'Geaendert', smtpUseImapAuth }, message);
  });

  test('ein erstmals eingetragener SMTP-Host verlangt das Passwort wie auf dem Server', async () => {
    await expectRejected({ id: noSmtpId, displayName: 'Geaendert', smtpHost: 'smtp.firma.de' },
      'IMAP-Passwort erforderlich (SMTP-Server geaendert)');
  });

  test('ein geleerter SMTP-Host braucht kein Passwort', async () => {
    await expect(invoke(IPCChannels.Email.UpdateAccount, { id: imapId, smtpHost: null }))
      .resolves.toEqual({ success: true });
    expect(getEmailAccountById(imapId)!.smtp_host).toBeNull();
  });

  // A2a-01, E2: Bei OAuth-Konten ging das Access-Token an einen neuen IMAP-Server.
  test('OAuth-Konto: neuer IMAP-Host ohne Passwort wird abgelehnt', async () => {
    await expectRejected({ id: oauthId, displayName: 'Geaendert', imapHost: 'imap.fremd.example' },
      'IMAP-Passwort erforderlich (IMAP-Server, POP3-Server geaendert)');
  });

  test('fehlen beide Passwoerter, nennt die Meldung beide', async () => {
    await expectRejected(
      { id: smtpOwnId, displayName: 'Geaendert', imapHost: 'imap.fremd.example', smtpHost: 'smtp.fremd.example' },
      'IMAP-Passwort erforderlich (IMAP-Server, POP3-Server geaendert); SMTP-Passwort erforderlich (SMTP-Server geaendert)',
    );
  });
});
