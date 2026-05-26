jest.mock('../../electron/email/email-store', () => ({
  getEmailMessageById: jest.fn(),
  setMessageSpam: jest.fn(),
  addMessageTag: jest.fn(),
}));

jest.mock('../../electron/email/mail-security-settings', () => ({
  getMailSecuritySettings: jest.fn(() => ({
    autoSpamDmarcFail: true,
    autoSpamSpfFail: false,
    autoSpamRspamd: true,
    rspamdSpamScore: 10,
  })),
}));

jest.mock('../../electron/workflow/sender-filter', () => ({
  classifySenderForMessage: jest.fn(() => 'ok'),
}));

import { getEmailMessageById, setMessageSpam, addMessageTag } from '../../electron/email/email-store';
import { classifySenderForMessage } from '../../electron/workflow/sender-filter';
import { applyPreWorkflowMailSecurity } from '../../electron/email/mail-security-static';

describe('mail-security-static', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns early when message missing', () => {
    (getEmailMessageById as jest.Mock).mockReturnValue(undefined);
    expect(applyPreWorkflowMailSecurity(1)).toEqual({ skippedWorkflows: false, tags: [] });
  });

  test('blacklist skips workflows', () => {
    (getEmailMessageById as jest.Mock).mockReturnValue({ id: 1 });
    (classifySenderForMessage as jest.Mock).mockReturnValue('blacklist');
    const r = applyPreWorkflowMailSecurity(1);
    expect(r.skippedWorkflows).toBe(true);
    expect(setMessageSpam).toHaveBeenCalledWith(1, true);
  });

  test('dmarc fail tags spam', () => {
    (classifySenderForMessage as jest.Mock).mockReturnValue('ok');
    (getEmailMessageById as jest.Mock).mockReturnValue({ id: 2, auth_dmarc: 'fail', auth_spf: 'pass' });
    const r = applyPreWorkflowMailSecurity(2);
    expect(r.tags).toContain('auth-dmarc-fail');
    expect(addMessageTag).toHaveBeenCalled();
  });

  test('high rspamd score when auth passes', () => {
    (classifySenderForMessage as jest.Mock).mockReturnValue('ok');
    (getEmailMessageById as jest.Mock).mockReturnValue({
      id: 3,
      auth_dmarc: 'pass',
      auth_spf: 'pass',
      rspamd_score: 15,
    });
    const r = applyPreWorkflowMailSecurity(3);
    expect(r.tags).toContain('rspamd-high');
  });
});
