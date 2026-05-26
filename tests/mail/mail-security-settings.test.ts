const syncStore = new Map<string, string>();

jest.mock('../../electron/sqlite-service', () => ({
  getSyncInfo: (key: string) => syncStore.get(key) ?? null,
  setSyncInfo: (key: string, value: string) => {
    syncStore.set(key, value);
  },
}));

import {
  getMailSecuritySettings,
  isMailauthEnabled,
  isRspamdEnabled,
  saveMailSecuritySettings,
} from '../../electron/email/mail-security-settings';

describe('mail-security-settings', () => {
  beforeEach(() => syncStore.clear());

  test('getMailSecuritySettings defaults and clamps', () => {
    const s = getMailSecuritySettings();
    expect(s.mailauthEnabled).toBe(true);
    expect(s.rspamdEnabled).toBe(false);
    expect(s.rspamdUrl).toBe('http://127.0.0.1:11333');
    expect(s.rspamdTimeoutMs).toBe(8000);
    expect(s.spamScoreThreshold).toBe(70);
  });

  test('getMailSecuritySettings reads stored flags and bounds', () => {
    syncStore.set('mail_security_mailauth_enabled', '0');
    syncStore.set('mail_security_rspamd_enabled', 'yes');
    syncStore.set('mail_security_rspamd_url', 'http://rspamd.local/');
    syncStore.set('mail_security_rspamd_timeout_ms', '999999');
    syncStore.set('mail_security_rspamd_spam_score', '200');
    syncStore.set('mail_security_auto_spam_dmarc_fail', 'true');
    syncStore.set('workflow_sender_whitelist', ' a@b.de ');
    syncStore.set('workflow_spam_score_threshold', '0');
    const s = getMailSecuritySettings();
    expect(s.mailauthEnabled).toBe(false);
    expect(s.rspamdEnabled).toBe(true);
    expect(s.rspamdUrl).toBe('http://rspamd.local');
    expect(s.rspamdTimeoutMs).toBe(60_000);
    expect(s.rspamdSpamScore).toBe(100);
    expect(s.autoSpamDmarcFail).toBe(true);
    expect(s.senderWhitelist).toBe(' a@b.de ');
    expect(s.spamScoreThreshold).toBe(1);
  });

  test('saveMailSecuritySettings persists all fields', () => {
    saveMailSecuritySettings({
      mailauthEnabled: false,
      rspamdEnabled: true,
      rspamdUrl: 'http://x/',
      rspamdTimeoutMs: 500,
      rspamdSpamScore: 0.5,
      autoSpamSpfFail: true,
      autoSpamRspamd: true,
      senderBlacklist: 'bad@test.de',
      spamScoreThreshold: 150,
    });
    expect(syncStore.get('mail_security_rspamd_timeout_ms')).toBe('1000');
    expect(syncStore.get('mail_security_rspamd_spam_score')).toBe('1');
    expect(syncStore.get('mail_security_rspamd_url')).toBe('http://x');
    expect(isMailauthEnabled()).toBe(false);
    expect(isRspamdEnabled()).toBe(true);
  });

  test('save empty rspamd url falls back to default', () => {
    saveMailSecuritySettings({ rspamdUrl: '   ' });
    expect(syncStore.get('mail_security_rspamd_url')).toBe('http://127.0.0.1:11333');
  });
});
