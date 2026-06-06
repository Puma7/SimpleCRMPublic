import {
  BROWSER_DEPLOY_CONFIG_STORAGE_KEY,
  getBrowserDeployConfig,
} from '../../src/services/transport/browser-deploy-config';

// The server web-only build inlines `__SIMPLECRM_FORCE_SAME_ORIGIN__ = true`
// (Vite `define`). In dev/tests the identifier is absent. Here we drive it via a
// global to exercise both paths without a real Vite build.
describe('getBrowserDeployConfig same-origin server default', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__SIMPLECRM_FORCE_SAME_ORIGIN__;
    window.localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  test('without the web-only flag, an unconfigured browser stays "missing"', () => {
    window.localStorage.clear();
    window.history.replaceState({}, '', '/');

    expect(getBrowserDeployConfig().status).toBe('missing');
  });

  test('with the web-only flag, defaults to a same-origin server-client config', () => {
    (globalThis as Record<string, unknown>).__SIMPLECRM_FORCE_SAME_ORIGIN__ = true;
    window.localStorage.clear();
    window.history.replaceState({}, '', '/');

    const result = getBrowserDeployConfig();

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.config.mode).toBe('server-client');
    expect(result.config.server?.baseUrl).toBe(window.location.origin);
  });

  test('an explicit ?serverUrl= still wins over the same-origin default', () => {
    (globalThis as Record<string, unknown>).__SIMPLECRM_FORCE_SAME_ORIGIN__ = true;
    window.localStorage.clear();
    window.history.replaceState({}, '', '/?serverUrl=https%3A%2F%2Fother.example.com');

    const result = getBrowserDeployConfig();

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.config.server?.baseUrl).toBe('https://other.example.com');
  });

  test('the same-origin default is not persisted to storage', () => {
    (globalThis as Record<string, unknown>).__SIMPLECRM_FORCE_SAME_ORIGIN__ = true;
    window.localStorage.clear();
    window.history.replaceState({}, '', '/');

    getBrowserDeployConfig();

    expect(window.localStorage.getItem(BROWSER_DEPLOY_CONFIG_STORAGE_KEY)).toBeNull();
  });
});
