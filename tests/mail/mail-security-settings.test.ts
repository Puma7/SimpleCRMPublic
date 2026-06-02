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
    expect(s.spamEngineEnabled).toBe(true);
    expect(s.spamReviewThreshold).toBe(45);
    expect(s.spamSpamThreshold).toBe(75);
    expect(s.localLearningEnabled).toBe(true);
    expect(s.rspamdContributionEnabled).toBe(false);
    expect(s.rspamdLearningEnabled).toBe(false);
    expect(s.aiSpamWorkflowEnabled).toBe(false);
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
    syncStore.set('mail_security_spam_engine_enabled', '0');
    syncStore.set('mail_security_spam_review_threshold', '95');
    syncStore.set('mail_security_spam_spam_threshold', '40');
    syncStore.set('mail_security_spam_local_learning_enabled', 'false');
    syncStore.set('mail_security_spam_rspamd_contribution_enabled', 'yes');
    syncStore.set('mail_security_spam_rspamd_learning_enabled', '1');
    syncStore.set('mail_security_spam_ai_workflow_enabled', 'true');
    const s = getMailSecuritySettings();
    expect(s.mailauthEnabled).toBe(false);
    expect(s.rspamdEnabled).toBe(true);
    expect(s.rspamdUrl).toBe('http://rspamd.local');
    expect(s.rspamdTimeoutMs).toBe(60_000);
    expect(s.rspamdSpamScore).toBe(100);
    expect(s.autoSpamDmarcFail).toBe(true);
    expect(s.senderWhitelist).toBe(' a@b.de ');
    expect(s.spamScoreThreshold).toBe(1);
    expect(s.spamEngineEnabled).toBe(false);
    expect(s.spamReviewThreshold).toBe(95);
    expect(s.spamSpamThreshold).toBe(95);
    expect(s.localLearningEnabled).toBe(false);
    expect(s.rspamdContributionEnabled).toBe(true);
    expect(s.rspamdLearningEnabled).toBe(true);
    expect(s.aiSpamWorkflowEnabled).toBe(true);
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
      spamEngineEnabled: false,
      spamReviewThreshold: -10,
      spamSpamThreshold: 120,
      localLearningEnabled: false,
      rspamdContributionEnabled: true,
      rspamdLearningEnabled: true,
      aiSpamWorkflowEnabled: true,
    });
    expect(syncStore.get('mail_security_rspamd_timeout_ms')).toBe('1000');
    expect(syncStore.get('mail_security_rspamd_spam_score')).toBe('1');
    expect(syncStore.get('mail_security_rspamd_url')).toBe('http://x');
    expect(syncStore.get('mail_security_spam_engine_enabled')).toBe('0');
    expect(syncStore.get('mail_security_spam_review_threshold')).toBe('0');
    expect(syncStore.get('mail_security_spam_spam_threshold')).toBe('100');
    expect(syncStore.get('mail_security_spam_local_learning_enabled')).toBe('0');
    expect(syncStore.get('mail_security_spam_rspamd_contribution_enabled')).toBe('1');
    expect(syncStore.get('mail_security_spam_rspamd_learning_enabled')).toBe('1');
    expect(syncStore.get('mail_security_spam_ai_workflow_enabled')).toBe('1');
    expect(isMailauthEnabled()).toBe(false);
    expect(isRspamdEnabled()).toBe(true);
  });

  test('save empty rspamd url falls back to default', () => {
    saveMailSecuritySettings({ rspamdUrl: '   ' });
    expect(syncStore.get('mail_security_rspamd_url')).toBe('http://127.0.0.1:11333');
  });
});
