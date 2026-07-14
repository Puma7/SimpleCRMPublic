import {
  AUTH_SECURITY_SYNC_KEYS,
  DEFAULT_AUTH_SECURITY_WORKSPACE_SETTINGS,
} from '@simplecrm/core';
import type { Kysely } from 'kysely';

import {
  createPostgresPublicAuthSecuritySettingsReader,
} from '../../packages/server/src/db/postgres-sync-info-port';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import type { WorkspaceSessionCommand } from '../../packages/server/src/db/workspace-context';

const WORKSPACE_A_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_B_ID = '22222222-2222-4222-8222-222222222222';

describe('PostgreSQL public auth-security settings reader', () => {
  test('loads and groups every workspace in one cross-workspace query', async () => {
    const execute = jest.fn(async () => ([
      {
        workspace_id: WORKSPACE_A_ID,
        key: AUTH_SECURITY_SYNC_KEYS.captchaEnabled,
        value: 'true',
      },
      {
        workspace_id: WORKSPACE_A_ID,
        key: AUTH_SECURITY_SYNC_KEYS.mfaEnabled,
        value: 'true',
      },
      {
        workspace_id: WORKSPACE_B_ID,
        key: AUTH_SECURITY_SYNC_KEYS.pinKeypadEnabled,
        value: 'true',
      },
    ]));
    const where = jest.fn(() => ({ execute }));
    const select = jest.fn(() => ({ where }));
    const selectFrom = jest.fn(() => ({ select }));
    const transactionExecute = jest.fn(async (operation: (trx: unknown) => Promise<unknown>) => (
      operation({ selectFrom })
    ));
    const db = {
      transaction: () => ({ execute: transactionExecute }),
    } as unknown as Kysely<ServerDatabase>;
    const sessionCommands: WorkspaceSessionCommand[] = [];
    const read = createPostgresPublicAuthSecuritySettingsReader({
      db,
      applyWorkspaceSession: async (_trx, command) => {
        sessionCommands.push(command);
      },
    });

    await expect(read()).resolves.toEqual([
      {
        ...DEFAULT_AUTH_SECURITY_WORKSPACE_SETTINGS,
        captchaEnabled: true,
        mfaEnabled: true,
      },
      {
        ...DEFAULT_AUTH_SECURITY_WORKSPACE_SETTINGS,
        pinKeypadEnabled: true,
      },
    ]);
    expect(transactionExecute).toHaveBeenCalledTimes(1);
    expect(selectFrom).toHaveBeenCalledTimes(1);
    expect(selectFrom).toHaveBeenCalledWith('sync_info');
    expect(select).toHaveBeenCalledWith(['workspace_id', 'key', 'value']);
    expect(where).toHaveBeenCalledWith(
      'key',
      'in',
      Object.values(AUTH_SECURITY_SYNC_KEYS),
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(sessionCommands).toHaveLength(1);
    expect(sessionCommands[0]?.params[2]).toBe('system');
    expect(sessionCommands[0]?.params[3]).toBe('on');
  });

  test('returns the secure defaults when no workspace has overrides', async () => {
    const execute = jest.fn(async () => []);
    const trx = {
      selectFrom: () => ({
        select: () => ({
          where: () => ({ execute }),
        }),
      }),
    };
    const db = {
      transaction: () => ({
        execute: async (operation: (value: typeof trx) => Promise<unknown>) => operation(trx),
      }),
    } as unknown as Kysely<ServerDatabase>;
    const read = createPostgresPublicAuthSecuritySettingsReader({
      db,
      applyWorkspaceSession: async () => undefined,
    });

    await expect(read()).resolves.toEqual([DEFAULT_AUTH_SECURITY_WORKSPACE_SETTINGS]);
  });
});
