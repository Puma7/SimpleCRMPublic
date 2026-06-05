import {
  evaluatePreWorkflowMailSecurity,
  isMailSecurityAuthFailure,
} from '../../packages/core/src/email';

describe('core mail-security static rules', () => {
  test('classifies auth failures and ignores non-fail labels', () => {
    expect(isMailSecurityAuthFailure('fail')).toBe(true);
    expect(isMailSecurityAuthFailure('permerror')).toBe(true);
    expect(isMailSecurityAuthFailure('softfail')).toBe(false);
    expect(isMailSecurityAuthFailure('pass')).toBe(false);
  });

  test('blacklist marks spam and skips workflows', () => {
    expect(evaluatePreWorkflowMailSecurity({
      senderClass: 'blacklist',
      message: { authDmarc: 'pass', rspamdScore: 0 },
      settings: {
        autoSpamDmarcFail: true,
        autoSpamSpfFail: true,
        autoSpamRspamd: true,
        rspamdSpamScore: 10,
      },
    })).toEqual({
      skippedWorkflows: true,
      tags: ['blacklist'],
      spamStatus: 'spam',
    });
  });

  test('applies configured auth and rspamd auto-spam rules', () => {
    const settings = {
      autoSpamDmarcFail: true,
      autoSpamSpfFail: true,
      autoSpamRspamd: true,
      rspamdSpamScore: 10,
    };

    expect(evaluatePreWorkflowMailSecurity({
      senderClass: 'default',
      message: { authDmarc: 'permerror', authSpf: 'pass', rspamdScore: 0 },
      settings,
    }).tags).toEqual(['auth-dmarc-fail']);
    expect(evaluatePreWorkflowMailSecurity({
      senderClass: 'default',
      message: { authDmarc: 'pass', authSpf: 'fail', rspamdScore: 0 },
      settings,
    }).tags).toEqual(['auth-spf-fail']);
    expect(evaluatePreWorkflowMailSecurity({
      senderClass: 'default',
      message: { authDmarc: 'pass', authSpf: 'pass', rspamdScore: 12 },
      settings,
    }).tags).toEqual(['rspamd-high']);
  });
});
