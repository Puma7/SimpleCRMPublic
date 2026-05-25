import {
  getMailSecuritySettings,
  saveMailSecuritySettings,
} from '../../electron/email/mail-security-settings';
import { getSyncInfo, setSyncInfo } from '../../electron/sqlite-service';

jest.mock('../../electron/sqlite-service', () => ({
  getSyncInfo: jest.fn(),
  setSyncInfo: jest.fn(),
}));

const getSyncInfoMock = getSyncInfo as jest.MockedFunction<typeof getSyncInfo>;

describe('mail-security-settings', () => {
  beforeEach(() => {
    getSyncInfoMock.mockImplementation((key: string) => {
      const map: Record<string, string> = {
        mail_security_mailauth_enabled: '1',
        mail_security_rspamd_enabled: '0',
        mail_security_rspamd_url: 'http://127.0.0.1:11333',
      };
      return map[key] ?? null;
    });
  });

  it('defaults mailauth on and rspamd off', () => {
    const s = getMailSecuritySettings();
    expect(s.mailauthEnabled).toBe(true);
    expect(s.rspamdEnabled).toBe(false);
    expect(s.rspamdUrl).toBe('http://127.0.0.1:11333');
  });
});
