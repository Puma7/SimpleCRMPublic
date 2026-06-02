const mockGetMessage = jest.fn();
const mockVerify = jest.fn();
const mockRspamd = jest.fn();
const mockSave = jest.fn();
const mockSpam = jest.fn();
const mockSettings = jest.fn();
const mockMailauth = jest.fn();
const mockRspamdOn = jest.fn();

jest.mock('../../electron/email/email-store', () => ({
  getEmailMessageById: (...a: unknown[]) => mockGetMessage(...a),
}));
jest.mock('../../electron/email/mail-auth-verify', () => ({
  verifyMailAuthentication: (...a: unknown[]) => mockVerify(...a),
}));
jest.mock('../../electron/email/rspamd-client', () => ({
  checkMessageWithRspamd: (...a: unknown[]) => mockRspamd(...a),
}));
jest.mock('../../electron/email/mail-security-store', () => ({
  saveMessageSecurity: (...a: unknown[]) => mockSave(...a),
}));
jest.mock('../../electron/email/email-spam-engine', () => ({
  evaluateAndSaveSpamDecision: (...a: unknown[]) => mockSpam(...a),
}));
jest.mock('../../electron/email/mail-security-settings', () => ({
  getMailSecuritySettings: () => mockSettings(),
  isMailauthEnabled: () => mockMailauth(),
  isRspamdEnabled: () => mockRspamdOn(),
}));

import { runMailSecurityPipeline } from '../../electron/email/mail-security-pipeline';

describe('runMailSecurityPipeline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettings.mockReturnValue({ rspamdUrl: 'http://rspamd', rspamdTimeoutMs: 1000 });
    mockMailauth.mockReturnValue(true);
    mockRspamdOn.mockReturnValue(true);
    mockVerify.mockResolvedValue({ spf: 'pass' });
    mockRspamd.mockResolvedValue({ score: 1 });
    mockSpam.mockReturnValue({ score: 8, status: 'clean', source: 'local', reasons: [], featureKeys: [] });
    mockGetMessage.mockReturnValue({
      id: 1,
      raw_rfc822_b64: 'x',
      raw_headers: 'h',
      body_text: 't',
      body_html: null,
    });
  });

  test('returns empty result when message missing', async () => {
    mockGetMessage.mockReturnValue(undefined);
    const r = await runMailSecurityPipeline(99);
    expect(r.authChecked).toBe(false);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  test('runs mailauth and rspamd and saves', async () => {
    const r = await runMailSecurityPipeline(1);
    expect(r.authChecked).toBe(true);
    expect(r.rspamdChecked).toBe(true);
    expect(mockSave).toHaveBeenCalledWith(1, { spf: 'pass' }, { score: 1 });
    expect(mockSpam).toHaveBeenCalled();
    expect(r.spam?.score).toBe(8);
  });

  test('uses preloaded row without refetch for spam scoring when no checks', async () => {
    mockMailauth.mockReturnValue(false);
    mockRspamdOn.mockReturnValue(false);
    const row = { id: 2, raw_rfc822_b64: null, raw_headers: null, body_text: null, body_html: null };
    const r = await runMailSecurityPipeline(2, row as never);
    expect(r.authChecked).toBe(false);
    expect(mockGetMessage).not.toHaveBeenCalled();
    expect(mockSpam).toHaveBeenCalledWith(2, row);
    expect(r.preWorkflow.skippedWorkflows).toBe(false);
  });
});
