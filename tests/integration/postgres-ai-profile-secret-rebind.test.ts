import type { Kysely } from 'kysely';

import { createServerApi } from '../../packages/server/src/api/server-api';
import type { AuthenticatedPrincipal, ServerApiPorts } from '../../packages/server/src/api/types';
import { createPostgresSecretPort, type PostgresSecretPort } from '../../packages/server/src/db/postgres-secret-port';
import { createPostgresAiProfileReadPort } from '../../packages/server/src/db/postgres-workflow-read-ports';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { parseBase64MasterKey } from '../../packages/server/src/security/master-key';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000d1';
const USER_ID = '10000000-0000-4000-8000-0000000000d2';

// F-A4-02: a workflows.manage holder could PATCH only baseUrl (or provider) of
// an AI profile; the stored API key stayed attached and every later AI call
// sent it to the new host.
describe('AI profile update requires a new API key when origin or provider change', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;
  let secrets: PostgresSecretPort;
  let aiProfiles: ReturnType<typeof createPostgresAiProfileReadPort>;
  let api: ReturnType<typeof createServerApi>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('ai-profile-rebind');
    await postgres.admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'AI Rebind Test')`, [WORKSPACE_ID]);
    db = postgres.createApplicationDb();
    secrets = createPostgresSecretPort({
      db,
      key: parseBase64MasterKey(Buffer.alloc(32, 9).toString('base64')),
    });
    aiProfiles = createPostgresAiProfileReadPort({ db, secrets });
    api = createServerApi({
      auth: {} as ServerApiPorts['auth'],
      locks: {} as ServerApiPorts['locks'],
      aiProfiles,
    } as unknown as ServerApiPorts);
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  beforeEach(async () => {
    await postgres.admin.query('DELETE FROM email_ai_profiles WHERE workspace_id = $1', [WORKSPACE_ID]);
    await postgres.admin.query('DELETE FROM secrets WHERE workspace_id = $1', [WORKSPACE_ID]);
  });

  function workflowManager(): AuthenticatedPrincipal {
    return { userId: USER_ID, workspaceId: WORKSPACE_ID, role: 'user', capabilities: ['workflows.manage'] };
  }

  async function createProfile(apiKey?: string): Promise<number> {
    const result = await aiProfiles.create!({
      workspaceId: WORKSPACE_ID,
      actorUserId: USER_ID,
      values: {
        label: 'Firmen-Key',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        ...(apiKey === undefined ? {} : { apiKey }),
      },
    });
    if (!result.ok) throw new Error(result.code);
    return result.profile.id;
  }

  async function patch(id: number, body: Record<string, unknown>) {
    return api.handle({ method: 'PATCH', path: `/api/v1/ai/profiles/${id}`, principal: workflowManager(), body });
  }

  async function storedProfile(id: number) {
    const result = await postgres.admin.query<{ base_url: string; provider: string }>(
      'SELECT base_url, provider FROM email_ai_profiles WHERE workspace_id = $1 AND id = $2',
      [WORKSPACE_ID, id],
    );
    return result.rows[0];
  }

  async function storedKey(id: number): Promise<string | null> {
    const secret = await secrets.readSecret({
      workspaceId: WORKSPACE_ID,
      kind: 'email.ai_profile.api_key',
      name: `email_ai_profile:${id}:api_key`,
    });
    return secret?.toString('utf8') ?? null;
  }

  test.each([
    ['a new origin', { baseUrl: 'https://collector.attacker.example/v1' }],
    ['a new port on the same host', { baseUrl: 'https://api.openai.com:8443/v1' }],
    ['a new provider', { provider: 'anthropic' }],
  ])('rejects %s without a new API key and keeps profile and key', async (_label, body) => {
    const id = await createProfile('sk-admin-key');

    const response = await patch(id, body);

    expect(response).toMatchObject({
      status: 400,
      body: {
        error: {
          code: 'ai_profile_api_key_required',
          message: expect.stringContaining('Zugangsdaten bei Serverwechsel neu eingeben'),
          details: { fields: [expect.objectContaining({ field: 'apiKey' })] },
        },
      },
    });
    expect(await storedProfile(id)).toEqual({ base_url: 'https://api.openai.com/v1', provider: 'openai' });
    expect(await storedKey(id)).toBe('sk-admin-key');
  });

  test('allows the move together with a new key or with removing the key', async () => {
    const withNewKey = await createProfile('sk-admin-key');
    const moved = await patch(withNewKey, { baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'or-new-key' });
    expect(moved.status).toBe(200);
    expect((await storedProfile(withNewKey)).base_url).toBe('https://openrouter.ai/api/v1');
    expect(await storedKey(withNewKey)).toBe('or-new-key');

    const withoutKey = await createProfile('sk-admin-key');
    const cleared = await patch(withoutKey, { provider: 'anthropic', apiKey: null });
    expect(cleared.status).toBe(200);
    expect(await storedKey(withoutKey)).toBeNull();
  });

  test('keeps the stored key for same-origin paths and for profiles without a key', async () => {
    const id = await createProfile('sk-admin-key');
    const samePath = await patch(id, {
      provider: ' OpenAI ',
      baseUrl: 'https://API.openai.com:443/v2',
      model: 'gpt-4.1',
    });
    expect(samePath.status).toBe(200);
    expect(await storedKey(id)).toBe('sk-admin-key');

    const keyless = await createProfile();
    const moved = await patch(keyless, { baseUrl: 'https://llm.example.com/v1' });
    expect(moved.status).toBe(200);
  });
});
