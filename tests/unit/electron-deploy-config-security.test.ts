import { normalizeElectronServerBaseUrl } from '../../electron/setup/deploy-config';

describe('Electron server-client transport security', () => {
  test('requires HTTPS because packaged app origins cannot use cross-site HTTP refresh cookies', () => {
    expect(() => normalizeElectronServerBaseUrl('http://crm.example.test'))
      .toThrow('server.baseUrl must use https');
    expect(normalizeElectronServerBaseUrl('https://crm.example.test/'))
      .toBe('https://crm.example.test');
  });
});
