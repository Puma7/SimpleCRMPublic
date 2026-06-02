const mockGetEmailMessageById = jest.fn();
const mockEvaluateSpamListMatch = jest.fn();
const mockLoadSpamFeatureStats = jest.fn(() => new Map());
const mockSaveSpamDecision = jest.fn();

let mockSettings = {
  mailauthEnabled: true,
  rspamdEnabled: false,
  rspamdUrl: 'http://127.0.0.1:11333',
  rspamdTimeoutMs: 8000,
  rspamdSpamScore: 15,
  autoSpamSpfFail: false,
  autoSpamDkimFail: false,
  autoSpamDmarcFail: false,
  autoSpamRspamd: false,
  senderWhitelist: '',
  senderBlacklist: '',
  spamScoreThreshold: 70,
  spamEngineEnabled: true,
  spamReviewThreshold: 45,
  spamSpamThreshold: 75,
  localLearningEnabled: true,
  rspamdContributionEnabled: false,
  rspamdLearningEnabled: false,
  aiSpamWorkflowEnabled: false,
};

jest.mock('../../electron/email/email-store', () => ({
  getEmailMessageById: (...args: unknown[]) => mockGetEmailMessageById(...args),
}));

jest.mock('../../electron/email/mail-security-settings', () => ({
  getMailSecuritySettings: () => mockSettings,
}));

jest.mock('../../electron/email/email-spam-store', () => ({
  evaluateSpamListMatch: (...args: unknown[]) => mockEvaluateSpamListMatch(...args),
  loadSpamFeatureStats: (...args: unknown[]) => mockLoadSpamFeatureStats(...args),
  saveSpamDecision: (...args: unknown[]) => mockSaveSpamDecision(...args),
}));

import { buildSpamDecision, evaluateAndSaveSpamDecision } from '../../electron/email/email-spam-engine';

function message(overrides: Record<string, unknown> = {}): never {
  return {
    id: 7,
    account_id: 1,
    from_json: JSON.stringify({ value: [{ address: 'sender@example.com' }] }),
    subject: 'Hallo',
    snippet: '',
    body_text: '',
    body_html: null,
    auth_spf: null,
    auth_dkim: null,
    auth_dmarc: null,
    auth_arc: null,
    rspamd_score: null,
    rspamd_action: null,
    attachments_json: null,
    has_attachments: 0,
    ...overrides,
  } as never;
}

describe('email spam decision engine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettings = {
      ...mockSettings,
      spamEngineEnabled: true,
      spamReviewThreshold: 45,
      spamSpamThreshold: 75,
      localLearningEnabled: true,
      rspamdContributionEnabled: false,
    };
    mockEvaluateSpamListMatch.mockReturnValue(null);
    mockLoadSpamFeatureStats.mockReturnValue(new Map());
  });

  test('returns clean when the engine is disabled', () => {
    mockSettings.spamEngineEnabled = false;

    expect(buildSpamDecision(message({ auth_dmarc: 'fail' }))).toMatchObject({
      score: 0,
      status: 'clean',
      source: 'disabled',
    });
  });

  test('allowlist forces a clean decision before scoring', () => {
    mockEvaluateSpamListMatch.mockReturnValue({
      listType: 'allow',
      patternType: 'domain',
      pattern: 'example.com',
      specificity: 80,
    });

    const decision = buildSpamDecision(
      message({ auth_dmarc: 'fail', subject: 'urgent crypto password' }),
    );

    expect(decision).toMatchObject({ score: 0, status: 'clean', source: 'allowlist' });
    expect(decision.reasons[0]).toMatchObject({ code: 'list.allow', points: -100 });
  });

  test('blocklist produces a hard spam score while keeping the source explainable', () => {
    mockEvaluateSpamListMatch.mockReturnValue({
      listType: 'block',
      patternType: 'email',
      pattern: 'sender@example.com',
      specificity: 100,
    });

    expect(buildSpamDecision(message())).toMatchObject({
      score: 100,
      status: 'spam',
      source: 'blocklist',
    });
  });

  test('combines auth and content signals and clamps the score to 0-100', () => {
    mockSettings.rspamdContributionEnabled = true;
    const decision = buildSpamDecision(
      message({
        auth_spf: 'fail',
        auth_dkim: 'fail',
        auth_dmarc: 'fail',
        auth_arc: 'fail',
        rspamd_score: 40,
        rspamd_action: 'reject',
        subject: 'Urgent bitcoin password',
        body_text: Array.from({ length: 8 }, (_, i) => `https://bad.example/${i}`).join(' '),
        body_html: '<script>bad()</script><form action="https://bad.example"></form>',
        has_attachments: 1,
        attachments_json: JSON.stringify([{ filename: 'invoice.exe', contentType: 'application/x-msdownload' }]),
      }),
    );

    expect(decision.score).toBe(100);
    expect(decision.status).toBe('spam');
    expect(decision.reasons.map((r) => r.code)).toEqual(
      expect.arrayContaining(['auth.dmarc.fail', 'rspamd.score', 'html.script']),
    );
  });

  test('uses local learning stats in the explainable score', () => {
    mockLoadSpamFeatureStats.mockImplementation((featureKeys: string[]) => {
      const stats = new Map();
      for (const key of featureKeys) {
        if (
          key === 'sender:domain:spammy.test' ||
          key === 'content:suspicious_terms' ||
          key === 'content:has_url'
        ) {
          stats.set(key, { feature_key: key, spam_count: 10, ham_count: 0 });
        }
      }
      return stats;
    });

    const decision = buildSpamDecision(
      message({
        from_json: JSON.stringify({ value: [{ address: 'offer@spammy.test' }] }),
        subject: 'Urgent crypto',
        body_text: 'Bitte sofort https://spammy.test klicken',
      }),
    );

    expect(decision.status).toBe('review');
    expect(decision.reasons.some((r) => r.code.startsWith('learning.'))).toBe(true);
  });

  test('persists the decision when evaluating by message id', () => {
    const row = message({ id: 99 });
    mockGetEmailMessageById.mockReturnValue(row);

    const decision = evaluateAndSaveSpamDecision(99);

    expect(decision).not.toBeNull();
    expect(mockSaveSpamDecision).toHaveBeenCalledWith(99, row, decision);
  });
});
