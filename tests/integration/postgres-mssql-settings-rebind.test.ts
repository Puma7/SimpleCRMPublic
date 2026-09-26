import type { Kysely } from 'kysely';

import { createServerApi } from '../../packages/server/src/api/server-api';
import type { AuthenticatedPrincipal, ServerApiPorts } from '../../packages/server/src/api/types';
import { createPostgresSecretPort, type PostgresSecretPort } from '../../packages/server/src/db/postgres-secret-port';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { createPostgresMssqlSettingsPort, mssqlPasswordSecretIdentifier } from '../../packages/server/src/mssql-settings';
import { parseBase64MasterKey } from '../../packages/server/src/security/master-key';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000e1';
const ADMIN_ID = '20000000-0000-4000-8000-0000000000e1';

const STORED = {
  server: 'sql.legit.example',
  database: 'eazybusiness',
  user: 'crm',
  port: 1433,
  encrypt: true,
  trustServerCertificate: false,
  forcePort: false,
};

// F-A13A14-11 (E11): PATCH /api/v1/mssql/settings took a new server without a
// password and kept the stored secret, so the next sync or test presented the
// write-only SQL password to the new host (the test route already refused this).
describe('MSSQL settings require the password again when the server changes', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;
  let secrets: PostgresSecretPort;
  let api: ReturnType<typeof createServerApi>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('mssql-settings-rebind');
    await postgres.admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'MSSQL Rebind Test')`, [WORKSPACE_ID]);
    db = postgres.createApplicationDb();
    secrets = createPostgresSecretPort({
      db,
      key: parseBase64MasterKey(Buffer.alloc(32, 5).toString('base64')),
    });
    api = createServerApi({
      auth: {} as ServerApiPorts['auth'],
      locks: {} as ServerApiPorts['locks'],
      mssqlSettings: createPostgresMssqlSettingsPort({ db, secrets }),
    } as unknown as ServerApiPorts);
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  beforeEach(async () => {
    await postgres.admin.query('DELETE FROM sync_info WHERE workspace_id = $1', [WORKSPACE_ID]);
    await postgres.admin.query('DELETE FROM secrets WHERE workspace_id = $1', [WORKSPACE_ID]);
    const seeded = await patch({ ...STORED, password: 'stored-sql-secret' });
    expect(seeded).toMatchObject({ status: 200, body: { data: { success: true } } });
  });

  function admin(): AuthenticatedPrincipal {
    return { userId: ADMIN_ID, workspaceId: WORKSPACE_ID, role: 'owner' };
  }

  async function patch(body: Record<string, unknown>) {
    return api.handle({ method: 'PATCH', path: '/api/v1/mssql/settings', principal: admin(), body });
  }

  async function storedServer(): Promise<string | null> {
    const result = await postgres.admin.query<{ value: string }>(
      `SELECT value FROM sync_info WHERE workspace_id = $1 AND key = 'mssql_settings_v1'`,
      [WORKSPACE_ID],
    );
    const value = result.rows[0]?.value;
    return value ? (JSON.parse(value) as { server: string }).server : null;
  }

  async function storedSecret(): Promise<string | null> {
    const secret = await secrets.readSecret(mssqlPasswordSecretIdentifier(WORKSPACE_ID));
    return secret?.toString('utf8') ?? null;
  }

  test.each([
    ['server', { server: 'sql.attacker.example' }],
    ['port', { port: 14330, forcePort: true }],
    ['instance', { server: 'sql.legit.example\\OTHER' }],
    ['port inside the server field', { server: 'sql.legit.example,1500' }],
  ])('rejects a %s change without a password and keeps everything', async (_label, change) => {
    const response = await patch({ ...STORED, ...change });

    expect(response).toMatchObject({
      status: 400,
      body: {
        error: {
          code: 'mssql_credentials_required',
          message: expect.stringContaining('Zugangsdaten bei Serverwechsel neu eingeben'),
        },
      },
    });
    expect(await storedServer()).toBe('sql.legit.example');
    expect(await storedSecret()).toBe('stored-sql-secret');
  });

  test('accepts a server change together with a new password', async () => {
    const response = await patch({ ...STORED, server: 'sql.new.example', password: 'new-sql-secret' });

    expect(response).toMatchObject({ status: 200, body: { data: { success: true } } });
    expect(await storedServer()).toBe('sql.new.example');
    expect(await storedSecret()).toBe('new-sql-secret');
  });

  test('accepts other changes on the same server without a password', async () => {
    const response = await patch({ ...STORED, server: ' SQL.legit.example ', database: 'andere', kShop: 2 });

    expect(response).toMatchObject({ status: 200, body: { data: { success: true } } });
    expect(await storedSecret()).toBe('stored-sql-secret');
  });

  test('a server change that clears the password needs no new one', async () => {
    const response = await patch({ ...STORED, server: 'sql.new.example', password: '' });

    expect(response).toMatchObject({ status: 200, body: { data: { success: true } } });
    expect(await storedServer()).toBe('sql.new.example');
    expect(await storedSecret()).toBeNull();
  });

  test('without a stored password a server change needs none', async () => {
    await secrets.deleteSecret(mssqlPasswordSecretIdentifier(WORKSPACE_ID));

    const response = await patch({ ...STORED, server: 'sql.new.example' });

    expect(response).toMatchObject({ status: 200, body: { data: { success: true } } });
    expect(await storedServer()).toBe('sql.new.example');
  });
});
