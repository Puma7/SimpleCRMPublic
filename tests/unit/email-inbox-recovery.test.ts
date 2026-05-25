import {
  previewInboxArchiveRecovery,
  restoreInboxMessagesFromArchiveSafe,
} from '../../electron/email/email-inbox-recovery';

const account = {
  id: 7,
  display_name: 'Shop',
  email_address: 'shop@example.com',
};

let mockCount = 2;

jest.mock('../../electron/email/email-store', () => ({
  getEmailAccountById: (id: number) => (id === 7 ? account : undefined),
}));

jest.mock('electron-log', () => ({
  warn: jest.fn(),
}));

jest.mock('../../electron/sqlite-service', () => {
  const prepare = jest.fn((sql: string) => ({
    get: () => (sql.includes('COUNT') ? { c: mockCount } : undefined),
    run: () => ({ changes: mockCount }),
  }));
  return { getDb: () => ({ prepare }) };
});

describe('email-inbox-recovery', () => {
  beforeEach(() => {
    mockCount = 2;
  });

  it('preview returns count and account metadata', () => {
    const p = previewInboxArchiveRecovery(7);
    expect(p).toEqual({
      accountId: 7,
      count: 2,
      accountEmail: 'shop@example.com',
      accountLabel: 'Shop',
    });
  });

  it('restore rejects wrong confirmation phrase', () => {
    const r = restoreInboxMessagesFromArchiveSafe({
      accountId: 7,
      expectedCount: 2,
      confirmPhrase: 'wrong@example.com',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Bestätigung/);
  });

  it('restore rejects stale expected count', () => {
    const r = restoreInboxMessagesFromArchiveSafe({
      accountId: 7,
      expectedCount: 99,
      confirmPhrase: 'shop@example.com',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Vorschau/);
  });

  it('restore succeeds with matching preview and phrase', () => {
    const r = restoreInboxMessagesFromArchiveSafe({
      accountId: 7,
      expectedCount: 2,
      confirmPhrase: 'shop@example.com',
    });
    expect(r).toEqual({ ok: true, restored: 2 });
  });
});
