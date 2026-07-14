import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { IPCChannels } from '../../shared/ipc/channels';

const handlers = new Map<string, any>();

jest.mock('../../electron/ipc/register', () => ({
  registerIpcHandler: jest.fn((channel: string, handler: unknown) => {
    handlers.set(channel, handler);
    return () => undefined;
  }),
}));

import { registerSetupHandlers } from '../../electron/ipc/setup';

describe('registerSetupHandlers', () => {
  let userDataDir: string;

  beforeEach(() => {
    handlers.clear();
    userDataDir = mkdtempSync(join(tmpdir(), 'simplecrm-setup-ipc-'));
    registerSetupHandlers({
      logger: console,
      getUserDataDir: () => userDataDir,
      now: () => new Date('2026-06-03T12:00:00.000Z'),
    });
  });

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true });
  });

  test('returns missing config before first-start choice is saved', async () => {
    const handler = handlers.get(IPCChannels.Setup.GetDeployConfig);
    await expect(handler({})).resolves.toEqual({ status: 'missing' });
  });

  test('saves and reads a normalized server-client deploy config', async () => {
    const save = handlers.get(IPCChannels.Setup.SaveDeployConfig);
    const read = handlers.get(IPCChannels.Setup.GetDeployConfig);

    await expect(save({}, {
      mode: 'server-client',
      server: {
        baseUrl: ' https://crm.example.com/app/ ',
        lastLoginUsername: ' pascal ',
      },
    })).resolves.toEqual({
      success: true,
      config: {
        version: 1,
        mode: 'server-client',
        selectedAt: '2026-06-03T12:00:00.000Z',
        server: {
          baseUrl: 'https://crm.example.com/app',
          lastLoginUsername: 'pascal',
        },
      },
    });
    await expect(read({})).resolves.toEqual({
      status: 'ok',
      config: {
        version: 1,
        mode: 'server-client',
        selectedAt: '2026-06-03T12:00:00.000Z',
        server: {
          baseUrl: 'https://crm.example.com/app',
          lastLoginUsername: 'pascal',
        },
      },
    });
  });

  test('returns a failure result for invalid mode payloads without throwing', async () => {
    const save = handlers.get(IPCChannels.Setup.SaveDeployConfig);
    const result = await save({}, {
      mode: 'server-client',
      server: { baseUrl: 'file:///tmp/simplecrm' },
    });

    expect(result).toEqual({
      success: false,
      error: 'server.baseUrl must use http or https',
    });
  });

  test('rejects every rewrite after initial setup and preserves the first config', async () => {
    const save = handlers.get(IPCChannels.Setup.SaveDeployConfig);
    const read = handlers.get(IPCChannels.Setup.GetDeployConfig);

    await expect(save({}, { mode: 'standalone' })).resolves.toMatchObject({ success: true });
    await expect(save({}, {
      mode: 'server-client',
      server: { baseUrl: 'https://attacker.example' },
    })).resolves.toEqual({
      success: false,
      error: 'deploy config is already configured; use authenticated maintenance to change it',
    });
    await expect(read({})).resolves.toMatchObject({
      status: 'ok',
      config: { mode: 'standalone' },
    });
  });

  test('serializes concurrent first-write attempts so exactly one wins', async () => {
    const save = handlers.get(IPCChannels.Setup.SaveDeployConfig);
    const results = await Promise.all([
      save({}, { mode: 'standalone' }),
      save({}, {
        mode: 'server-client',
        server: { baseUrl: 'https://crm.example.com' },
      }),
    ]);

    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(results.filter((result) => !result.success)).toEqual([{
      success: false,
      error: 'deploy config is already configured; use authenticated maintenance to change it',
    }]);
  });

  test('registers both setup channels', () => {
    expect(handlers.has(IPCChannels.Setup.GetDeployConfig)).toBe(true);
    expect(handlers.has(IPCChannels.Setup.SaveDeployConfig)).toBe(true);
  });
});
