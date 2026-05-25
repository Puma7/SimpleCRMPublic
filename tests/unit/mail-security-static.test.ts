import { applyPreWorkflowMailSecurity } from '../../electron/email/mail-security-static';

const sync = new Map<string, string>([
  ['workflow_sender_blacklist', 'evil.com'],
  ['mail_security_auto_blacklist', '1'],
]);

jest.mock('../../electron/sqlite-service', () => ({
  getSyncInfo: (key: string) => sync.get(key) ?? null,
  setSyncInfo: jest.fn(),
}));

jest.mock('electron-log', () => ({ info: jest.fn() }));

let spam = false;
const message = {
  id: 42,
  from_json: JSON.stringify({ value: [{ address: 'user@evil.com' }] }),
  is_spam: 0,
};

jest.mock('../../electron/email/email-store', () => ({
  getEmailMessageById: (id: number) => (id === 42 ? { ...message, is_spam: spam ? 1 : 0 } : undefined),
  setMessageSpam: (_id: number, v: boolean) => {
    spam = v;
  },
  addMessageTag: jest.fn(),
}));

describe('mail-security-static', () => {
  beforeEach(() => {
    spam = false;
  });

  it('marks blacklist sender as spam before workflows', async () => {
    const r = await applyPreWorkflowMailSecurity(42);
    expect(r.senderFilter).toBe('blacklist');
    expect(r.appliedAutoSpam).toBe(true);
    expect(spam).toBe(true);
  });
});
