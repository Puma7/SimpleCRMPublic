/**
 * Rollen-Grenzen der Desktop-Mail-IPC fuer Einstellungen mit Geheimnissen und
 * Kontoverwaltung. Laeuft ueber den echten registerIpcHandler (Session, Rolle,
 * Schema-Validierung), nur Electron, Konto-ACL und Speicher sind ersetzt.
 */
const mockHandlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
const mockSyncInfo = new Map<string, string>();

jest.mock('electron', () => ({
  ipcMain: {
    removeHandler: jest.fn(),
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
      mockHandlers.set(channel, handler);
    },
  },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {},
  shell: {},
  app: { getPath: () => '/tmp', isPackaged: false },
}));

jest.mock('../../electron/auth/auth-store', () => ({
  ...jest.requireActual('../../electron/auth/auth-store'),
  // Konto-ACL erlaubt alles: geprueft wird hier allein die Rollen-Grenze.
  canAccessLocalAccount: jest.fn(() => true),
  canUseSyntheticBootstrapAuthSession: jest.fn(() => false),
}));

jest.mock('../../electron/sqlite-service', () => ({
  ...jest.requireActual('../../electron/sqlite-service'),
  getSyncInfo: (key: string) => mockSyncInfo.get(key) ?? null,
  setSyncInfo: (key: string, value: string) => {
    mockSyncInfo.set(key, value);
  },
}));

jest.mock('../../electron/sync-info-store', () => ({
  readSyncInfo: (key: string) => mockSyncInfo.get(key) ?? null,
  writeSyncInfo: (key: string, value: string) => {
    mockSyncInfo.set(key, value);
  },
}));

// Gespeicherte Konten: 7 meldet SMTP wie IMAP an, 8 mit eigenem SMTP-Passwort,
// 9 ist ein Google-OAuth-Konto. Verbindungstests mit gespeicherten Zugangsdaten
// duerfen nur diese Server ansprechen.
const mockStoredAccount = {
  id: 7,
  keytar_account_key: 'email-7',
  imap_host: 'imap.example.com',
  imap_port: 993,
  imap_tls: 1,
  imap_username: 'support@example.com',
  smtp_host: 'smtp.example.com',
  smtp_port: 587,
  smtp_tls: 1,
  smtp_username: null as string | null,
  smtp_use_imap_auth: 1,
  smtp_keytar_account_key: null as string | null,
  protocol: 'imap',
  pop3_host: 'pop.example.com',
  pop3_port: 995,
  pop3_tls: 1,
  oauth_provider: null as string | null,
  oauth_refresh_keytar_key: null as string | null,
};
const mockStoredAccounts: Record<number, typeof mockStoredAccount> = {
  7: mockStoredAccount,
  8: {
    ...mockStoredAccount,
    id: 8,
    keytar_account_key: 'email-8',
    smtp_username: 'smtp-user',
    smtp_use_imap_auth: 0,
    smtp_keytar_account_key: 'email-smtp-8',
  },
  9: {
    ...mockStoredAccount,
    id: 9,
    keytar_account_key: 'email-9',
    oauth_provider: 'google',
    oauth_refresh_keytar_key: 'email-oauth-9',
  },
};

// Ohne requireActual: email-store haengt zirkulaer an email-message-features.
jest.mock('../../electron/email/email-store', () => ({
  createEmailAccountRecord: jest.fn(() => ({ id: 7 })),
  updateEmailAccountRecord: jest.fn(),
  deleteEmailAccountRecord: jest.fn(async () => undefined),
  getEmailAccountById: jest.fn((id: number) => (mockStoredAccounts[id] ? { ...mockStoredAccounts[id] } : undefined)),
  saveAccountSignature: jest.fn(),
}));

jest.mock('../../electron/email/email-oauth-google', () => ({
  exchangeGoogleAuthCode: jest.fn(async () => undefined),
}));

jest.mock('../../electron/email/email-oauth-microsoft', () => ({
  exchangeMicrosoftAuthCode: jest.fn(async () => undefined),
}));

jest.mock('../../electron/email/email-keytar', () => ({
  ...jest.requireActual('../../electron/email/email-keytar'),
  saveEmailPassword: jest.fn(async () => undefined),
  deleteEmailPassword: jest.fn(async () => undefined),
  getEmailPassword: jest.fn(async () => 'gespeichert'),
}));

jest.mock('../../electron/email/email-imap-auth', () => ({
  ...jest.requireActual('../../electron/email/email-imap-auth'),
  resolveImapAuth:jest.fn(async () => ({ accessToken: 'oauth-token' })),
}));

jest.mock('../../electron/email/email-imap-sync', () => ({
  ...jest.requireActual('../../electron/email/email-imap-sync'),
  testImapConnection: jest.fn(async () => ({ ok: true })),
}));

jest.mock('../../electron/email/email-pop3-sync', () => ({
  ...jest.requireActual('../../electron/email/email-pop3-sync'),
  testPop3Connection: jest.fn(async () => ({ ok: true })),
}));

jest.mock('../../electron/email/email-smtp', () => ({
  ...jest.requireActual('../../electron/email/email-smtp'),
  testSmtpConnection: jest.fn(async () => ({ ok: true })),
}));

jest.mock('../../electron/email/email-local-backup', () => ({
  exportLocalMailBackup: jest.fn(async () => ({ ok: true, path: '/tmp/backup.zip' })),
  verifyLocalMailBackup: jest.fn(async () => ({
    ok: true,
    path: '/tmp/backup.zip',
    hasDatabase: true,
    hasAttachments: false,
  })),
}));

jest.mock('../../electron/email/email-local-restore', () => ({
  pickLocalMailBackupZip: jest.fn(async () => ({ ok: true, path: '/tmp/backup.zip' })),
  previewRestoreLocalMailBackup: jest.fn(async () => ({
    ok: true,
    path: '/tmp/backup.zip',
    previewToken: 'token',
    currentSchemaGeneration: 1,
    hasAttachments: false,
    accountEmails: [],
    warnings: [],
  })),
  restoreLocalMailBackup: jest.fn(async () => ({ ok: true })),
}));

jest.mock('../../electron/email/email-gdpr-export', () => ({
  exportEmailGdprPackage: jest.fn(async () => ({ ok: true, path: '/tmp/export.zip' })),
}));

jest.mock('../../electron/email/email-webhook', () => ({
  fireWebhookWorkflows: jest.fn(async () => ({ fired: 1 })),
}));

import { IPCChannels } from '../../shared/ipc/channels';
import { exportLocalMailBackup, verifyLocalMailBackup } from '../../electron/email/email-local-backup';
import {
  pickLocalMailBackupZip,
  previewRestoreLocalMailBackup,
  restoreLocalMailBackup,
} from '../../electron/email/email-local-restore';
import { exportEmailGdprPackage } from '../../electron/email/email-gdpr-export';
import { fireWebhookWorkflows } from '../../electron/email/email-webhook';
import {
  createEmailAccountRecord,
  deleteEmailAccountRecord,
  saveAccountSignature,
  updateEmailAccountRecord,
} from '../../electron/email/email-store';
import { getEmailPassword, saveEmailPassword } from '../../electron/email/email-keytar';
import { resolveImapAuth } from '../../electron/email/email-imap-auth';
import { testImapConnection } from '../../electron/email/email-imap-sync';
import { testPop3Connection } from '../../electron/email/email-pop3-sync';
import { testSmtpConnection } from '../../electron/email/email-smtp';
import { exchangeGoogleAuthCode } from '../../electron/email/email-oauth-google';
import { exchangeMicrosoftAuthCode } from '../../electron/email/email-oauth-microsoft';
import { clearAllSessions, createSession, type SessionRole } from '../../electron/auth/session-store';
import { registerEmailHandlers } from '../../electron/ipc/email';

const quietLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

let nextSenderId = 100;

function eventFor(role: SessionRole) {
  const id = nextSenderId++;
  createSession(id, { id: `user-${role}`, username: role, displayName: role, role, workspaceId: 'w' });
  return { sender: { id } };
}

function invoke(channel: string, event: unknown, payload?: unknown): Promise<any> {
  const handler = mockHandlers.get(channel);
  if (!handler) throw new Error(`kein Handler fuer ${channel}`);
  return payload === undefined ? handler(event) : handler(event, payload);
}

beforeAll(() => {
  registerEmailHandlers({ logger: quietLogger, isDevelopment: false });
});

beforeEach(() => {
  clearAllSessions();
  mockSyncInfo.clear();
  mockSyncInfo.set('email_google_oauth_client_id', 'google-client');
  mockSyncInfo.set('email_google_oauth_client_secret', 'google-geheim');
  mockSyncInfo.set('email_ms_oauth_client_id', 'ms-client');
  mockSyncInfo.set('email_ms_oauth_client_secret', 'ms-geheim');
  mockSyncInfo.set('email_webhook_secret', 'webhook-geheim');
  mockSyncInfo.set('email_max_attachment_mb', '30');
});

describe('OAuth-App- und Webhook-Secrets (E15)', () => {
  const getters = [
    [IPCChannels.Email.GetGoogleOAuthApp, 'google-client', 'google-geheim'],
    [IPCChannels.Email.GetMicrosoftOAuthApp, 'ms-client', 'ms-geheim'],
  ] as const;

  // N-ds-02: Die OAuth-Client-Secrets gingen an jeden angemeldeten Nutzer, auch an Agent und Viewer.
  test.each(getters)('%s liefert Nicht-Admins nur hasSecret', async (channel, clientId) => {
    for (const role of ['agent', 'viewer'] as const) {
      const result = await invoke(channel, eventFor(role));
      expect(result).toEqual({ success: true, clientId, hasSecret: true });
    }
  });

  test.each(getters)('%s liefert Owner und Admin das Secret', async (channel, clientId, clientSecret) => {
    for (const role of ['owner', 'admin'] as const) {
      const result = await invoke(channel, eventFor(role));
      expect(result).toEqual({ success: true, clientId, clientSecret, hasSecret: true });
    }
  });

  test('hasSecret ist false, solange kein Secret gespeichert ist', async () => {
    mockSyncInfo.delete('email_google_oauth_client_secret');
    mockSyncInfo.delete('email_webhook_secret');
    await expect(invoke(IPCChannels.Email.GetGoogleOAuthApp, eventFor('agent')))
      .resolves.toEqual({ success: true, clientId: 'google-client', hasSecret: false });
    await expect(invoke(IPCChannels.Email.GetEmailMiscSettings, eventFor('agent')))
      .resolves.toEqual({ maxAttachmentMb: '30', hasSecret: false });
  });

  // N-ds-02: Das Webhook-Secret der Workflow-Trigger ging an jeden angemeldeten Nutzer.
  test('GetEmailMiscSettings liefert das Webhook-Secret nur an Owner und Admin', async () => {
    await expect(invoke(IPCChannels.Email.GetEmailMiscSettings, eventFor('agent')))
      .resolves.toEqual({ maxAttachmentMb: '30', hasSecret: true });
    await expect(invoke(IPCChannels.Email.GetEmailMiscSettings, eventFor('admin')))
      .resolves.toEqual({ webhookSecret: 'webhook-geheim', maxAttachmentMb: '30', hasSecret: true });
  });

  // N-ds-02: Die Set-Kanaele prueften keine Rolle, jeder Nutzer konnte OAuth-App und Webhook-Secret ueberschreiben.
  test.each([
    [IPCChannels.Email.SetGoogleOAuthApp, { clientId: 'fremd', clientSecret: 'fremd' }],
    [IPCChannels.Email.SetMicrosoftOAuthApp, { clientId: 'fremd', clientSecret: 'fremd' }],
    [IPCChannels.Email.SetEmailMiscSettings, { webhookSecret: 'fremd', maxAttachmentMb: 99 }],
  ] as const)('%s verlangt Owner oder Admin', async (channel, payload) => {
    const before = new Map(mockSyncInfo);
    for (const role of ['agent', 'viewer'] as const) {
      await expect(invoke(channel, eventFor(role), payload)).rejects.toThrow('Keine Berechtigung');
    }
    expect(mockSyncInfo).toEqual(before);

    await expect(invoke(channel, eventFor('admin'), payload)).resolves.toEqual({ success: true });
  });

  // C-A53: email:fire-webhook-workflow lief ohne Rolle; wer das Secret kannte, loeste als Agent/Viewer alle Webhook-Workflows aus.
  test('FireWebhookWorkflow verlangt Owner oder Admin', async () => {
    jest.mocked(fireWebhookWorkflows).mockClear();
    const payload = { secret: 'webhook-geheim', body: { test: true } };
    for (const role of ['agent', 'viewer'] as const) {
      await expect(invoke(IPCChannels.Email.FireWebhookWorkflow, eventFor(role), payload))
        .rejects.toThrow('Keine Berechtigung');
    }
    expect(fireWebhookWorkflows).not.toHaveBeenCalled();

    for (const role of ['owner', 'admin'] as const) {
      await expect(invoke(IPCChannels.Email.FireWebhookWorkflow, eventFor(role), payload))
        .resolves.toEqual({ success: true, fired: 1 });
    }
    expect(fireWebhookWorkflows).toHaveBeenCalledTimes(2);
  });

  test('ein leeres OAuth-Secret-Feld behaelt das gespeicherte Secret, ein leeres Webhook-Secret schaltet den Webhook ab', async () => {
    const admin = eventFor('owner');
    await invoke(IPCChannels.Email.SetGoogleOAuthApp, admin, { clientId: 'google-neu', clientSecret: '' });
    await invoke(IPCChannels.Email.SetMicrosoftOAuthApp, admin, { clientId: 'ms-neu', clientSecret: '  ' });
    await invoke(IPCChannels.Email.SetEmailMiscSettings, admin, { maxAttachmentMb: 40 });

    expect(mockSyncInfo.get('email_google_oauth_client_id')).toBe('google-neu');
    expect(mockSyncInfo.get('email_google_oauth_client_secret')).toBe('google-geheim');
    expect(mockSyncInfo.get('email_ms_oauth_client_id')).toBe('ms-neu');
    expect(mockSyncInfo.get('email_ms_oauth_client_secret')).toBe('ms-geheim');
    expect(mockSyncInfo.get('email_webhook_secret')).toBe('webhook-geheim');
    expect(mockSyncInfo.get('email_max_attachment_mb')).toBe('40');
    await invoke(IPCChannels.Email.SetEmailMiscSettings, admin, { webhookSecret: '', maxAttachmentMb: 40 });
    expect(mockSyncInfo.get('email_webhook_secret')).toBe('');

    await invoke(IPCChannels.Email.SetGoogleOAuthApp, admin, { clientId: 'google-neu', clientSecret: 'google-neu-geheim' });
    expect(mockSyncInfo.get('email_google_oauth_client_secret')).toBe('google-neu-geheim');
  });
});

describe('Konto anlegen, bearbeiten, loeschen (E16)', () => {
  const createPayload = {
    displayName: 'Support',
    emailAddress: 'support@example.com',
    imapHost: 'imap.example.com',
    imapPort: 993,
    imapTls: true,
    imapUsername: 'support@example.com',
    imapPassword: 'geheim',
  };
  const accountCalls = [
    [IPCChannels.Email.CreateAccount, createPayload],
    [IPCChannels.Email.UpdateAccount, { id: 7, displayName: 'Umbenannt', imapPassword: 'neu' }],
    [IPCChannels.Email.DeleteAccount, 7],
    // C-B17: Der OAuth-Abschluss ersetzte mit einer blossen Konto-Freigabe den Refresh-Token des Kontos.
    [IPCChannels.Email.FinishGoogleOAuth, { accountId: 7, redirectUri: 'http://127.0.0.1/cb', code: 'code' }],
    [IPCChannels.Email.FinishMicrosoftOAuth, { accountId: 7, redirectUri: 'http://127.0.0.1/cb', code: 'code' }],
    // C-B17: Konto-Signaturen sind Kontoverwaltung (Server: mail.account.manage).
    [IPCChannels.Email.SaveAccountSignature, { accountId: 7, signatureHtml: '<p>Gruss</p>' }],
  ] as const;

  beforeEach(() => {
    jest.mocked(createEmailAccountRecord).mockClear();
    jest.mocked(updateEmailAccountRecord).mockClear();
    jest.mocked(deleteEmailAccountRecord).mockClear();
    jest.mocked(saveEmailPassword).mockClear();
    jest.mocked(saveAccountSignature).mockClear();
    jest.mocked(exchangeGoogleAuthCode).mockClear();
    jest.mocked(exchangeMicrosoftAuthCode).mockClear();
  });

  // F-A7-03: Konto bearbeiten und loeschen liefen mit Stufe "ro"; wer ein Postfach nur lesen durfte, konnte es loeschen.
  test.each(accountCalls)('%s verlangt Owner oder Admin, auch mit Konto-Freigabe', async (channel, payload) => {
    for (const role of ['agent', 'viewer'] as const) {
      await expect(invoke(channel, eventFor(role), payload)).rejects.toThrow('Keine Berechtigung');
    }
    expect(createEmailAccountRecord).not.toHaveBeenCalled();
    expect(updateEmailAccountRecord).not.toHaveBeenCalled();
    expect(deleteEmailAccountRecord).not.toHaveBeenCalled();
    expect(saveEmailPassword).not.toHaveBeenCalled();
    expect(saveAccountSignature).not.toHaveBeenCalled();
    expect(exchangeGoogleAuthCode).not.toHaveBeenCalled();
    expect(exchangeMicrosoftAuthCode).not.toHaveBeenCalled();
  });

  test.each(accountCalls)('%s bleibt fuer Owner und Admin moeglich', async (channel, payload) => {
    for (const role of ['owner', 'admin'] as const) {
      await expect(invoke(channel, eventFor(role), payload)).resolves.toMatchObject({ success: true });
    }
  });

  // Gespeicherte Zugangsdaten gehen nur an den gespeicherten Server (siehe unten);
  // die Rollenpruefung laeuft daher mit den gespeicherten Werten.
  const storedImap = {
    accountId: 7,
    imapHost: 'imap.example.com',
    imapPort: 993,
    imapTls: true,
    imapUsername: 'support@example.com',
    imapPassword: '',
  };
  const storedSmtp = {
    accountId: 7,
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    tls: true,
    user: 'support@example.com',
    smtpUseImapAuth: true,
  };
  const storedPop3 = { accountId: 7, host: 'pop.example.com', port: 995, tls: true, user: 'support@example.com', password: '' };
  const connectionTests = [
    ['IMAP mit gespeichertem Passwort', IPCChannels.Email.TestImap, storedImap, testImapConnection],
    ['SMTP mit OAuth ueber die IMAP-Anmeldung', IPCChannels.Email.TestSmtp, storedSmtp, testSmtpConnection],
    [
      'SMTP mit gespeichertem Passwort',
      IPCChannels.Email.TestSmtp,
      { ...storedSmtp, accountId: 8, user: 'smtp-user', smtpUseImapAuth: false },
      testSmtpConnection,
    ],
    ['POP3 mit gespeichertem Passwort', IPCChannels.Email.TestPop3, storedPop3, testPop3Connection],
    [
      'IMAP fuer ein neues Konto',
      IPCChannels.Email.TestImap,
      { ...storedImap, accountId: undefined, imapHost: 'imap.neu.example', imapPassword: 'neu' },
      testImapConnection,
    ],
    [
      'SMTP fuer ein neues Konto',
      IPCChannels.Email.TestSmtp,
      { ...storedSmtp, accountId: undefined, host: 'smtp.neu.example', password: 'neu' },
      testSmtpConnection,
    ],
    [
      'POP3 fuer ein neues Konto',
      IPCChannels.Email.TestPop3,
      { ...storedPop3, accountId: undefined, host: 'pop.neu.example', password: 'neu' },
      testPop3Connection,
    ],
  ] as const;

  // C-A12, C-B2: Die Verbindungstests liefen ohne Rolle und schickten gespeicherte Passwoerter oder OAuth-Tokens an den eingegebenen Host.
  test.each(connectionTests)('Verbindungstest %s verlangt Owner oder Admin', async (_label, channel, payload, connect) => {
    jest.mocked(getEmailPassword).mockClear();
    jest.mocked(resolveImapAuth).mockClear();
    jest.mocked(connect).mockClear();

    for (const role of ['agent', 'viewer'] as const) {
      await expect(invoke(channel, eventFor(role), payload)).rejects.toThrow('Keine Berechtigung');
    }
    expect(getEmailPassword).not.toHaveBeenCalled();
    expect(resolveImapAuth).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();

    for (const role of ['owner', 'admin'] as const) {
      await expect(invoke(channel, eventFor(role), payload)).resolves.toEqual({ success: true });
    }
    expect(connect).toHaveBeenCalledTimes(2);
  });

  describe('gespeicherte Zugangsdaten nur fuer den gespeicherten Server (PR-Review #193, useStored)', () => {
    const rejected = { success: false, error: 'Host oder Zugang geändert: bitte Passwort erneut eingeben' };

    beforeEach(() => {
      jest.mocked(getEmailPassword).mockClear();
      jest.mocked(resolveImapAuth).mockClear();
      jest.mocked(testImapConnection).mockClear();
      jest.mocked(testPop3Connection).mockClear();
      jest.mocked(testSmtpConnection).mockClear();
    });

    // PR-Review #193: Mit accountId und leerem Passwort schickte der IMAP-Test das gespeicherte Passwort an jeden eingegebenen Host.
    test.each([
      ['fremdem Host', { imapHost: 'evil.example' }],
      ['anderem Port', { imapPort: 143 }],
      ['ohne TLS', { imapTls: false }],
      ['anderem Benutzer', { imapUsername: 'opfer@example.com' }],
    ])('IMAP-Test mit gespeichertem Passwort und %s wird ohne Verbindung abgelehnt', async (_label, change) => {
      await expect(invoke(IPCChannels.Email.TestImap, eventFor('owner'), { ...storedImap, ...change }))
        .resolves.toEqual(rejected);
      expect(getEmailPassword).not.toHaveBeenCalled();
      expect(testImapConnection).not.toHaveBeenCalled();
    });

    test('IMAP-Test mit gespeichertem Passwort und gespeichertem Server laeuft', async () => {
      await expect(invoke(IPCChannels.Email.TestImap, eventFor('owner'), { ...storedImap, imapHost: ' IMAP.example.com ' }))
        .resolves.toEqual({ success: true });
      expect(getEmailPassword).toHaveBeenCalledWith('email-7');
      expect(testImapConnection).toHaveBeenCalledWith(
        expect.objectContaining({ imap_host: 'IMAP.example.com', imap_port: 993, imap_tls: 1 }),
        'gespeichert',
      );
    });

    test('IMAP-Test mit neuem Passwort darf einen anderen Server pruefen', async () => {
      await expect(invoke(IPCChannels.Email.TestImap, eventFor('owner'), {
        ...storedImap,
        imapHost: 'imap.neu.example',
        imapPassword: 'neu',
      })).resolves.toEqual({ success: true });
      expect(getEmailPassword).not.toHaveBeenCalled();
      expect(testImapConnection).toHaveBeenCalledWith(expect.objectContaining({ imap_host: 'imap.neu.example' }), 'neu');
    });

    // PR-Review #193: Der POP3-Test schickte das gespeicherte Passwort ebenso an jeden eingegebenen Host.
    test.each([
      ['fremdem Host', { host: 'evil.example' }],
      ['anderem Port', { port: 110 }],
      ['ohne TLS', { tls: false }],
      ['anderem Benutzer', { user: 'opfer@example.com' }],
    ])('POP3-Test mit gespeichertem Passwort und %s wird ohne Verbindung abgelehnt', async (_label, change) => {
      await expect(invoke(IPCChannels.Email.TestPop3, eventFor('owner'), { ...storedPop3, ...change }))
        .resolves.toEqual(rejected);
      expect(getEmailPassword).not.toHaveBeenCalled();
      expect(testPop3Connection).not.toHaveBeenCalled();
    });

    test('POP3-Test: gespeicherter Server laeuft, neues Passwort darf einen anderen Server pruefen', async () => {
      await expect(invoke(IPCChannels.Email.TestPop3, eventFor('owner'), storedPop3)).resolves.toEqual({ success: true });
      expect(testPop3Connection).toHaveBeenLastCalledWith(expect.objectContaining({ pop3_host: 'pop.example.com' }), 'gespeichert');

      jest.mocked(getEmailPassword).mockClear();
      await expect(invoke(IPCChannels.Email.TestPop3, eventFor('owner'), {
        ...storedPop3,
        host: 'pop.neu.example',
        password: 'neu',
      })).resolves.toEqual({ success: true });
      expect(getEmailPassword).not.toHaveBeenCalled();
      expect(testPop3Connection).toHaveBeenLastCalledWith(expect.objectContaining({ pop3_host: 'pop.neu.example' }), 'neu');
    });

    // PR-Review #193: Der SMTP-Test schickte gespeichertes SMTP-/IMAP-Passwort oder OAuth-Token an jeden eingegebenen Host.
    test.each([
      ['fremdem Host (Anmeldung wie IMAP)', { host: 'evil.example' }],
      ['fremdem Host (eigenes SMTP-Passwort)', { accountId: 8, user: 'smtp-user', smtpUseImapAuth: false, host: 'evil.example' }],
      ['anderem Port', { port: 2525 }],
      ['ohne TLS', { tls: false }],
      ['implizitem TLS statt STARTTLS', { secure: true }],
      ['anderem Benutzer', { user: 'opfer@example.com' }],
      ['umgeschalteter Anmeldung (nicht mehr wie IMAP)', { smtpUseImapAuth: false }],
      ['umgeschalteter Anmeldung (jetzt wie IMAP)', { accountId: 8, user: 'support@example.com', smtpUseImapAuth: true }],
      ['OAuth-Token trotz mitgeschicktem Passwort', { accountId: 9, host: 'evil.example', password: 'egal' }],
    ])('SMTP-Test mit gespeicherten Zugangsdaten und %s wird ohne Verbindung abgelehnt', async (_label, change) => {
      await expect(invoke(IPCChannels.Email.TestSmtp, eventFor('owner'), { ...storedSmtp, ...change }))
        .resolves.toEqual(rejected);
      expect(getEmailPassword).not.toHaveBeenCalled();
      expect(resolveImapAuth).not.toHaveBeenCalled();
      expect(testSmtpConnection).not.toHaveBeenCalled();
    });

    test('SMTP-Test mit gespeicherten Zugangsdaten und gespeichertem Server laeuft', async () => {
      await expect(invoke(IPCChannels.Email.TestSmtp, eventFor('owner'), {
        ...storedSmtp,
        accountId: 8,
        user: 'smtp-user',
        smtpUseImapAuth: false,
      })).resolves.toEqual({ success: true });
      expect(getEmailPassword).toHaveBeenCalledWith('email-smtp-8');
      expect(testSmtpConnection).toHaveBeenLastCalledWith(expect.objectContaining({
        host: 'smtp.example.com',
        user: 'smtp-user',
        pass: 'gespeichert',
      }));

      await expect(invoke(IPCChannels.Email.TestSmtp, eventFor('owner'), { ...storedSmtp, accountId: 9, password: 'egal' }))
        .resolves.toEqual({ success: true });
      expect(testSmtpConnection).toHaveBeenLastCalledWith(expect.objectContaining({
        host: 'smtp.example.com',
        accessToken: 'oauth-token',
      }));
    });

    test('SMTP-Test mit neuem Passwort darf einen anderen Server pruefen', async () => {
      await expect(invoke(IPCChannels.Email.TestSmtp, eventFor('owner'), {
        ...storedSmtp,
        accountId: 8,
        host: 'smtp.neu.example',
        user: 'neu@example.com',
        smtpUseImapAuth: false,
        password: 'neu',
      })).resolves.toEqual({ success: true });
      expect(getEmailPassword).not.toHaveBeenCalled();
      expect(testSmtpConnection).toHaveBeenCalledWith(expect.objectContaining({
        host: 'smtp.neu.example',
        user: 'neu@example.com',
        pass: 'neu',
        accessToken: undefined,
      }));
    });
  });
});

describe('Backup, Restore und DSGVO-Export (E17)', () => {
  const restoreCalls = [
    [IPCChannels.Email.PickLocalMailBackupZip, undefined, pickLocalMailBackupZip],
    [IPCChannels.Email.PreviewRestoreLocalMailBackup, { zipPath: '/tmp/backup.zip' }, previewRestoreLocalMailBackup],
    [
      IPCChannels.Email.RestoreLocalMailBackup,
      { zipPath: '/tmp/backup.zip', previewToken: 'token', confirmPhrase: 'WIEDERHERSTELLEN', createPreBackup: true },
      restoreLocalMailBackup,
    ],
  ] as const;
  const exportCalls = [
    [IPCChannels.Email.ExportLocalMailBackup, undefined, exportLocalMailBackup],
    [IPCChannels.Email.VerifyLocalMailBackup, undefined, verifyLocalMailBackup],
    [IPCChannels.Email.EmailGdprExport, { skipAttachments: true }, exportEmailGdprPackage],
  ] as const;

  beforeEach(() => {
    for (const [, , impl] of [...restoreCalls, ...exportCalls]) jest.mocked(impl).mockClear();
  });

  // F-A7b-01: Ein Restore ersetzte ohne Rollenpruefung die komplette Datenbank samt Benutzertabelle, auch fuer Agent und Viewer.
  test.each(restoreCalls)('%s ist nur fuer den Owner', async (channel, payload, impl) => {
    for (const role of ['admin', 'agent', 'viewer'] as const) {
      await expect(invoke(channel, eventFor(role), payload)).rejects.toThrow('Keine Berechtigung');
    }
    expect(impl).not.toHaveBeenCalled();

    await expect(invoke(channel, eventFor('owner'), payload)).resolves.toMatchObject({ ok: true });
    expect(impl).toHaveBeenCalledTimes(1);
  });

  // F-A7b-01: Vollbackup und DSGVO-Export gaben jedem angemeldeten Nutzer alle Mails aller Konten und die Passwort-Hashes.
  test.each(exportCalls)('%s ist nur fuer Owner und Admin', async (channel, payload, impl) => {
    for (const role of ['agent', 'viewer'] as const) {
      await expect(invoke(channel, eventFor(role), payload)).rejects.toThrow('Keine Berechtigung');
    }
    expect(impl).not.toHaveBeenCalled();

    for (const role of ['owner', 'admin'] as const) {
      await expect(invoke(channel, eventFor(role), payload)).resolves.toMatchObject({ ok: true });
    }
    expect(impl).toHaveBeenCalledTimes(2);
  });
});
