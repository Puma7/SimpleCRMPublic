import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mockAutoUpdater = (() => {
  const { EventEmitter } = require('node:events') as typeof import('node:events');
  return Object.assign(new EventEmitter(), {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    logger: null as unknown,
    checkForUpdates: jest.fn(),
    checkForUpdatesAndNotify: jest.fn(),
    quitAndInstall: jest.fn(),
  });
})();

jest.mock('electron', () => ({}));
jest.mock('electron-log', () => ({ __esModule: true, default: { info: jest.fn(), error: jest.fn() } }));
jest.mock('electron-updater', () => ({ autoUpdater: mockAutoUpdater }));

const updateService = require('../../electron/update-service') as typeof import('../../electron/update-service');

const silentLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

function writeUpdateConfig(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'simplecrm-update-config-'));
  const file = join(dir, 'app-update.yml');
  writeFileSync(file, content);
  return file;
}

const githubConfig = 'owner: Puma7\nrepo: SimpleCRMPublic\nprovider: github\nupdaterCacheDirName: simplecrm-updater\n';

describe('update service platform policy', () => {
  beforeEach(() => {
    mockAutoUpdater.removeAllListeners();
    mockAutoUpdater.autoDownload = true;
    mockAutoUpdater.autoInstallOnAppQuit = true;
    mockAutoUpdater.quitAndInstall.mockReset();
  });

  // F-A7-10: Auf macOS lud und installierte der Updater unsignierte Builds automatisch; nur der sha512 aus demselben Release sicherte sie ab.
  test('macOS only reports a new version and links to the release page', () => {
    const send = jest.fn();
    const win = { isDestroyed: () => false, webContents: { send } };
    updateService.initializeAutoUpdater({
      getMainWindow: () => win as never,
      logger: silentLogger,
      platform: 'darwin',
      updateConfigPath: writeUpdateConfig(githubConfig),
    });

    expect(mockAutoUpdater.autoDownload).toBe(false);
    expect(mockAutoUpdater.autoInstallOnAppQuit).toBe(false);

    const info = { version: '1.2.3' };
    mockAutoUpdater.emit('update-available', info);
    const expected = {
      status: 'available',
      info,
      manualUpdate: { releasePageUrl: 'https://github.com/Puma7/SimpleCRMPublic/releases' },
    };
    expect(updateService.getUpdateStatus()).toEqual(expected);
    expect(send).toHaveBeenLastCalledWith('update:status', expected);

    expect(() => updateService.quitAndInstall()).toThrow(/macOS/);
    expect(mockAutoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  test('Windows keeps downloading and installing updates automatically', () => {
    updateService.initializeAutoUpdater({
      getMainWindow: () => null,
      logger: silentLogger,
      platform: 'win32',
      updateConfigPath: writeUpdateConfig(githubConfig),
    });

    expect(mockAutoUpdater.autoDownload).toBe(true);
    expect(mockAutoUpdater.autoInstallOnAppQuit).toBe(true);

    const info = { version: '1.2.3' };
    mockAutoUpdater.emit('update-available', info);
    expect(updateService.getUpdateStatus()).toEqual({ status: 'available', info });

    updateService.quitAndInstall();
    expect(mockAutoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['a missing app-update.yml', null],
    ['a non-GitHub provider', 'provider: generic\nurl: https://updates.example.com\n'],
    ['an owner that is not a plain GitHub name', 'owner: evil.example/x\nrepo: SimpleCRMPublic\nprovider: github\n'],
  ])('macOS offers no release link for %s', (_label, config) => {
    updateService.initializeAutoUpdater({
      getMainWindow: () => null,
      logger: silentLogger,
      platform: 'darwin',
      updateConfigPath: config === null ? join(tmpdir(), 'simplecrm-missing', 'app-update.yml') : writeUpdateConfig(config),
    });

    mockAutoUpdater.emit('update-available', { version: '1.2.3' });
    expect(updateService.getUpdateStatus().manualUpdate).toEqual({ releasePageUrl: null });
    expect(mockAutoUpdater.autoDownload).toBe(false);
  });
});
