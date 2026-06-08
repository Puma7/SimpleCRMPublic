import { createAppLogStore, redactSecrets, resetAppLogStoreForTests } from '../../electron/diagnostics/app-log-store';
import { installAppLogCapture } from '../../electron/diagnostics/app-log-capture';

describe('app-log-store', () => {
  afterEach(() => {
    resetAppLogStoreForTests();
  });

  test('captures warn and error entries', () => {
    const store = createAppLogStore();
    store.capture({ level: 'warn', message: 'sync failed', source: 'test' });
    store.capture({ level: 'error', message: 'smtp down', source: 'test' });
    const recent = store.recent({ level: 'warn', limit: 10 });
    expect(recent).toHaveLength(2);
    expect(recent[0]?.message).toBe('sync failed');
  });

  test('redacts secrets in messages', () => {
    expect(redactSecrets('token=abc123')).toContain('[redacted]');
  });

  test('console capture tees warn/error into store', () => {
    const store = createAppLogStore();
    const fakeConsole = {
      warn: jest.fn(),
      error: jest.fn(),
    };
    installAppLogCapture(store, fakeConsole);
    fakeConsole.warn('background sync issue');
    fakeConsole.error(new Error('workflow crash'));
    expect(store.recent({ level: 'warn' }).map((e) => e.message)).toEqual(
      expect.arrayContaining(['background sync issue', 'workflow crash']),
    );
  });
});
