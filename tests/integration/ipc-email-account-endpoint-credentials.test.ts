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
 * Bei OAuth-Konten ersetzt das neue IMAP-Passwort dann die OAuth-Verknuepfung,
 * weil auf dem Desktop sonst das Token Vorrang haette.
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

// Kein Netz: IMAP-/POP3-Clients merken sich nur, womit sie sich anmelden wuerden.
const mockImapOptions: Array<Record<string, any>> = [];
jest.mock('imapflow', () => ({
  ImapFlow: class {
    constructor(options: Record<string, any>) {
      mockImapOptions.push(options);
    }
    connect = async () => {
      throw new Error('offline (Test)');
    };
    logout = async () => undefined;
  },
}));
const mockPop3Options: Array<Record<string, any>> = [];
jest.mock('node-pop3', () => class {
  constructor(options: Record<string, any>) {
    mockPop3Options.push(options);
  }
  UIDL = async () => {
    throw new Error('offline (Test)');
  };
  QUIT = async () => undefined;
});
jest.mock('../../electron/email/email-oauth-google', () => ({
  ...jest.requireActual('../../electron/email/email-oauth-google'),
  getGoogleAccessTokenForImap: jest.fn(async () => 'google-access-token'),
}));

import Database from 'better-sqlite3';
import { IPCChannels } from '../../shared/ipc/channels';
import { bootstrapFreshDatabaseSchema, closeDatabase, setSyncInfo } from '../../electron/sqlite-service';
import {
  createEmailAccountRecord,
  getEmailAccountById,
  updateEmailAccountRecord,
} from '../../electron/email/email-store';
import { deleteEmailPassword, saveEmailPassword } from '../../electron/email/email-keytar';
import { getGoogleAccessTokenForImap } from '../../electron/email/email-oauth-google';
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
      oauth_provider: row.oauth_provider,
      oauth_refresh_keytar_key: row.oauth_refresh_keytar_key,
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
    setSyncInfo('email_google_oauth_client_id', 'google-client');
    setSyncInfo('email_google_oauth_client_secret', 'google-geheim');
    noSmtpId = account({ name: 'neu' });

    jest.mocked(saveEmailPassword).mockClear();
    jest.mocked(deleteEmailPassword).mockClear();
    jest.mocked(getGoogleAccessTokenForImap).mockClear();
    mockImapOptions.length = 0;
    mockPop3Options.length = 0;
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
  test('OAuth-Konto: neuer IMAP-Host ohne Passwort wird abgelehnt, die Verknuepfung bleibt', async () => {
    await expectRejected({ id: oauthId, displayName: 'Geaendert', imapHost: 'imap.fremd.example' },
      'IMAP-Passwort erforderlich (IMAP-Server, POP3-Server geaendert)');
    expect(getEmailAccountById(oauthId)).toMatchObject({
      oauth_provider: 'google',
      oauth_refresh_keytar_key: 'email-oauth-gmail',
    });
    expect(deleteEmailPassword).not.toHaveBeenCalled();
  });

  describe('OAuth-Konto: neues Passwort ersetzt die Verknuepfung (PR-Review #193, A2a-01)', () => {
    const lastImapLogin = () => mockImapOptions[mockImapOptions.length - 1];

    // PR-Review #193: Auf dem Desktop hat das OAuth-Token Vorrang vor dem IMAP-Passwort; ein Hostwechsel mit beliebigem Passwort schickte das Token an den neuen Server.
    test('Hostwechsel mit neuem Passwort entfernt die Verknuepfung, der Abruf meldet sich mit dem Passwort an', async () => {
      // Gegenprobe: vorher holt der Abruf das OAuth-Token.
      await invoke(IPCChannels.Email.SyncAccount, oauthId);
      expect(getGoogleAccessTokenForImap).toHaveBeenCalledTimes(1);
      expect(lastImapLogin()).toMatchObject({ host: 'imap.firma.de', auth: { accessToken: 'google-access-token' } });

      jest.mocked(getGoogleAccessTokenForImap).mockClear();
      await expect(invoke(IPCChannels.Email.UpdateAccount, {
        id: oauthId,
        imapHost: 'imap.neu.example',
        imapPassword: 'neu-imap',
      })).resolves.toEqual({ success: true });

      expect(getEmailAccountById(oauthId)).toMatchObject({
        imap_host: 'imap.neu.example',
        oauth_provider: null,
        oauth_refresh_keytar_key: null,
      });
      expect(deleteEmailPassword).toHaveBeenCalledWith('email-oauth-gmail');
      expect(mockKeychain.has('email-oauth-gmail')).toBe(false);
      expect(mockKeychain.get('email-gmail')).toBe('neu-imap');

      await invoke(IPCChannels.Email.SyncAccount, oauthId);
      expect(getGoogleAccessTokenForImap).not.toHaveBeenCalled();
      expect(lastImapLogin()).toMatchObject({ host: 'imap.neu.example', auth: { user: 'gmail@firma.de', pass: 'neu-imap' } });
      expect(lastImapLogin().auth).not.toHaveProperty('accessToken');
    });

    test.each([
      ['neuer SMTP-Host', false, { smtpHost: 'smtp.neu.example' }],
      ['"wie IMAP" eingeschaltet', true, { smtpUseImapAuth: true }],
    ])('SMTP wie IMAP: %s mit IMAP-Passwort entfernt die Verknuepfung ebenso', async (_label, ownSmtpBefore, change) => {
      if (ownSmtpBefore) updateEmailAccountRecord(oauthId, { smtpUseImapAuth: false });
      await expect(invoke(IPCChannels.Email.UpdateAccount, {
        id: oauthId,
        ...change,
        imapPassword: 'neu-imap',
      })).resolves.toEqual({ success: true });
      expect(getEmailAccountById(oauthId)).toMatchObject({ oauth_provider: null, oauth_refresh_keytar_key: null });
      expect(deleteEmailPassword).toHaveBeenCalledWith('email-oauth-gmail');
    });

    test.each([
      ['gleicher Server, neues Passwort', { imapHost: 'imap.firma.de', imapPassword: 'neu-imap' }],
      ['nur Anzeigename', { displayName: 'Gmail' }],
    ])('%s: die Verknuepfung bleibt', async (_label, change) => {
      await expect(invoke(IPCChannels.Email.UpdateAccount, { id: oauthId, ...change }))
        .resolves.toEqual({ success: true });
      expect(getEmailAccountById(oauthId)).toMatchObject({
        oauth_provider: 'google',
        oauth_refresh_keytar_key: 'email-oauth-gmail',
      });
      expect(deleteEmailPassword).not.toHaveBeenCalled();
      expect(mockKeychain.get('email-oauth-gmail')).toBe('refresh-token');
    });

    test('SMTP mit eigenem Passwort: SMTP-Hostwechsel mit SMTP-Passwort laesst die Verknuepfung', async () => {
      updateEmailAccountRecord(oauthId, { smtpUseImapAuth: false, smtpKeytarAccountKey: 'email-smtp-gmail' });
      await expect(invoke(IPCChannels.Email.UpdateAccount, {
        id: oauthId,
        smtpHost: 'smtp.neu.example',
        smtpPassword: 'neu-smtp',
      })).resolves.toEqual({ success: true });
      expect(getEmailAccountById(oauthId)).toMatchObject({ oauth_provider: 'google' });
      expect(deleteEmailPassword).not.toHaveBeenCalled();
    });

    // PR-Review #193: Verbindungstests mit neuem Passwort duerfen bei OAuth-Konten nicht doch das Token an den fremden Host schicken.
    test('IMAP- und POP3-Test mit neuem Passwort nutzen bei OAuth-Konten das Passwort, nicht das Token', async () => {
      await expect(invoke(IPCChannels.Email.TestImap, {
        accountId: oauthId,
        imapHost: 'imap.fremd.example',
        imapPort: 993,
        imapTls: true,
        imapUsername: 'gmail@firma.de',
        imapPassword: 'neu',
      })).resolves.toMatchObject({ success: false });
      expect(lastImapLogin()).toMatchObject({ host: 'imap.fremd.example', auth: { user: 'gmail@firma.de', pass: 'neu' } });
      expect(lastImapLogin().auth).not.toHaveProperty('accessToken');

      await expect(invoke(IPCChannels.Email.TestPop3, {
        accountId: oauthId,
        host: 'pop.fremd.example',
        port: 995,
        tls: true,
        user: 'gmail@firma.de',
        password: 'neu',
      })).resolves.toMatchObject({ success: false });
      expect(mockPop3Options[mockPop3Options.length - 1]).toMatchObject({ host: 'pop.fremd.example', password: 'neu' });

      expect(getGoogleAccessTokenForImap).not.toHaveBeenCalled();
      expect(getEmailAccountById(oauthId)).toMatchObject({ oauth_provider: 'google' });
    });
  });

  test('fehlen beide Passwoerter, nennt die Meldung beide', async () => {
    await expectRejected(
      { id: smtpOwnId, displayName: 'Geaendert', imapHost: 'imap.fremd.example', smtpHost: 'smtp.fremd.example' },
      'IMAP-Passwort erforderlich (IMAP-Server, POP3-Server geaendert); SMTP-Passwort erforderlich (SMTP-Server geaendert)',
    );
  });
});
