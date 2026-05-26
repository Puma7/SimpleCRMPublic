import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-diag-'));

jest.mock('electron', () => ({
  app: { getPath: () => tmpUserData },
}));

const syncStore = new Map<string, string>();
const stmt = {
  get: jest.fn(),
  all: jest.fn(),
  run: jest.fn(),
};
const db = { prepare: jest.fn(() => stmt) };

jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => db,
  getSyncInfo: (k: string) => syncStore.get(k) ?? null,
  setSyncInfo: (k: string, v: string) => syncStore.set(k, v),
  deleteSyncInfo: (k: string) => syncStore.delete(k),
}));

jest.mock('../../electron/email/email-store', () => ({
  listEmailAccounts: jest.fn(() => [
    { id: 1, email_address: 'a@test.de', protocol: 'imap' },
  ]),
}));

jest.mock('../../electron/email/email-imap-auth-notice', () => ({
  listImapAuthNotices: jest.fn(() => [{ accountId: 1, message: 'oauth', at: '' }]),
}));

jest.mock('../../electron/email/email-uidvalidity-reset', () => ({
  listUidValidityResetNotices: jest.fn(() => []),
}));

jest.mock('../../electron/email/email-imap-services', () => ({
  getEmailBackgroundSyncSnapshot: jest.fn(() => ({
    cronScheduled: true,
    cronTickInFlight: false,
    syncInFlightAccountIds: [],
    idleImapAccountIds: [1],
  })),
}));

import { collectMailDiagnostics } from '../../electron/email/email-diagnostics';

describe('email-diagnostics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.writeFileSync(path.join(tmpUserData, 'database.sqlite'), 'x');
    stmt.get
      .mockReturnValueOnce({ c: 100 })
      .mockReturnValueOnce({ c: 2 })
      .mockReturnValueOnce({ c: 1 })
      .mockReturnValueOnce({ c: 5 })
      .mockReturnValueOnce({ c: 1 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ last_synced_at: '2026-01-01T00:00:00.000Z' });
    stmt.all
      .mockReturnValueOnce([{ k: 'inbox', c: 90 }])
      .mockReturnValueOnce([{ key: 'imap_auth_notice:1' }]);
  });

  test('collectMailDiagnostics returns structured report', () => {
    const r = collectMailDiagnostics();
    expect(r.messages.total).toBe(100);
    expect(r.notices.imapAuth).toBe(1);
    expect(r.background.idleImapAccountIds).toEqual([1]);
    expect(r.schemaGeneration).toBeGreaterThan(0);
    expect(r.sizes.databaseBytes).toBeGreaterThan(0);
  });
});
