import type { Kysely } from 'kysely';

import {
  handlePublicPortalRoute,
  resetPortalRateLimitersForTests,
} from '../../packages/server/src/api/returns-routes';
import type { ApiRequest, ServerApiPorts } from '../../packages/server/src/api/types';
import { createPostgresAuditPort } from '../../packages/server/src/db/postgres-audit-port';
import { createPostgresReturnsPort } from '../../packages/server/src/db/postgres-returns-port';
import { createPostgresReturnsPortalPort } from '../../packages/server/src/db/postgres-returns-portal-port';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000a1';

function loginSecurityWithoutCaptcha(): ServerApiPorts['loginSecurity'] {
  return {
    async getLoginConfig() {
      return {
        captcha: { enabled: false, provider: 'turnstile', siteKey: null },
        pinKeypad: { enabled: false },
        mfa: { enabled: false, methods: [] },
        user: null,
      };
    },
    assertCaptchaChallenge() { return true; },
  } as never;
}

describe('public returns portal against PostgreSQL', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('returns-portal');
    await postgres.admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Portal Test')`, [WORKSPACE_ID]);
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  beforeEach(async () => {
    resetPortalRateLimitersForTests();
    await postgres.admin.query('TRUNCATE returns RESTART IDENTITY CASCADE');
    await postgres.admin.query('DELETE FROM audit_events');
  });

  async function enabledPortalToken(): Promise<string> {
    const settings = await createPostgresReturnsPortalPort({ db }).rotate({ workspaceId: WORKSPACE_ID, enable: true });
    expect(settings.token).toMatch(/^[a-f0-9]{64}$/);
    return settings.token!;
  }

  function portalPorts(overrides: Partial<ServerApiPorts> = {}): ServerApiPorts {
    return {
      auth: {} as never,
      returns: createPostgresReturnsPort({ db }),
      returnsPortalSettings: createPostgresReturnsPortalPort({ db }),
      loginSecurity: loginSecurityWithoutCaptcha(),
      audit: createPostgresAuditPort({ db }),
      ...overrides,
    };
  }

  function createRequest(token: string): ApiRequest {
    return {
      method: 'POST',
      path: `/api/v1/portal/returns/${token}`,
      ip: '203.0.113.7',
      body: { customerEmail: 'kunde@example.test', items: [{ sku: 'SKU-1', quantity: 1 }] },
    };
  }

  // F-A3a-01: the audit row used actor_user_id = 'portal', which is not a uuid.
  test('creates a return and records an anonymous audit event instead of failing with 500', async () => {
    const token = await enabledPortalToken();

    const response = await handlePublicPortalRoute(createRequest(token), portalPorts());

    expect(response?.status).toBe(201);
    const audit = await postgres.admin.query<{ actor_user_id: string | null; action: string; metadata: Record<string, unknown> }>(
      `SELECT actor_user_id, action, metadata FROM audit_events WHERE workspace_id = $1`,
      [WORKSPACE_ID],
    );
    expect(audit.rows).toEqual([
      expect.objectContaining({
        actor_user_id: null,
        action: 'returns.portal.create',
        metadata: expect.objectContaining({ actor: 'portal', captcha: 'not_required' }),
      }),
    ]);
  });

  // F-A3a-08: a unique violation aborts the surrounding transaction, so the
  // retry loop could never insert the second candidate number.
  test('retries a colliding return number inside the same transaction', async () => {
    const token = await enabledPortalToken();
    const numbers = ['R-COLLIDE1', 'R-COLLIDE1', 'R-FRESH002'];
    const returns = createPostgresReturnsPort({ db, generateReturnNumber: () => numbers.shift() ?? 'R-EXHAUSTED' });

    const first = await handlePublicPortalRoute(createRequest(token), portalPorts({ returns }));
    const second = await handlePublicPortalRoute(createRequest(token), portalPorts({ returns }));

    expect(first?.status).toBe(201);
    expect(second?.status).toBe(201);
    expect((second?.body as { data: { returnNumber: string } }).data.returnNumber).toBe('R-FRESH002');
    const stored = await postgres.admin.query(`SELECT return_number FROM returns ORDER BY id`);
    expect(stored.rows.map((row) => row.return_number)).toEqual(['R-COLLIDE1', 'R-FRESH002']);
  });
});
