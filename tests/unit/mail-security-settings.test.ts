import {
  getMailSecuritySettings,
  rspamdUrlDiffersFromStored,
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

  // C-A51: Nicht-Admins durften die Rspamd-URL aendern; die Pruefung muss eine unveraendert mitgesendete URL erkennen.
  it('erkennt eine geaenderte Rspamd-URL mit derselben Normalisierung wie beim Speichern', () => {
    expect(rspamdUrlDiffersFromStored(' http://127.0.0.1:11333/ ')).toBe(false);
    expect(rspamdUrlDiffersFromStored('')).toBe(false);
    expect(rspamdUrlDiffersFromStored('https://collector.example')).toBe(true);

    getSyncInfoMock.mockReturnValue(null);
    expect(rspamdUrlDiffersFromStored('http://127.0.0.1:11333')).toBe(false);

    saveMailSecuritySettings({ rspamdUrl: ' http://rspamd.intern/ ' });
    expect(setSyncInfo).toHaveBeenCalledWith('mail_security_rspamd_url', 'http://rspamd.intern');
  });
});
