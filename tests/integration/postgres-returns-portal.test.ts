import type { Kysely } from 'kysely';

import { createServerApi } from '../../packages/server/src';
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
const FOREIGN_WORKSPACE_ID = '10000000-0000-4000-8000-0000000000b2';

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
    await postgres.admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Fremder Mandant')`, [FOREIGN_WORKSPACE_ID]);
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

  async function insertProduct(workspaceId: string, sourceId: number): Promise<number> {
    const result = await postgres.admin.query<{ id: string }>(
      `INSERT INTO products (workspace_id, source_sqlite_id, name) VALUES ($1, $2, 'Artikel') RETURNING id`,
      [workspaceId, sourceId],
    );
    return Number(result.rows[0]!.id);
  }

  async function insertReason(workspaceId: string, code: string): Promise<number> {
    const result = await postgres.admin.query<{ id: string }>(
      `INSERT INTO return_reasons (workspace_id, code, label) VALUES ($1, $2, 'Grund') RETURNING id`,
      [workspaceId, code],
    );
    return Number(result.rows[0]!.id);
  }

  function itemRequest(token: string, item: Record<string, unknown>): ApiRequest {
    return {
      method: 'POST',
      path: `/api/v1/portal/returns/${token}`,
      ip: '203.0.113.7',
      body: { items: [{ quantity: 1, ...item }] },
    };
  }

  // F-A3a-06: portal items stored productId/reasonId of other workspaces (global FKs bypass RLS)
  // and unknown ids surfaced as a 500 existence oracle.
  test('rejects product and reason ids that do not belong to the portal workspace', async () => {
    const token = await enabledPortalToken();
    const foreignProduct = await insertProduct(FOREIGN_WORKSPACE_ID, 9_001);
    const foreignReason = await insertReason(FOREIGN_WORKSPACE_ID, 'fremd-9001');

    for (const item of [
      { productId: foreignProduct },
      { reasonId: foreignReason },
      { productId: 999_999_999 },
      { reasonId: 999_999_999 },
    ]) {
      const response = await handlePublicPortalRoute(itemRequest(token, item), portalPorts());
      expect([item, response?.status]).toEqual([item, 400]);
      expect((response?.body as { error: { code: string } }).error.code).toBe('create_failed');
    }
    const stored = await postgres.admin.query(`SELECT count(*)::int AS count FROM return_items`);
    expect(stored.rows[0].count).toBe(0);
    const headers = await postgres.admin.query(`SELECT count(*)::int AS count FROM returns`);
    expect(headers.rows[0].count).toBe(0);
  });

  test('keeps product and reason ids of the portal workspace', async () => {
    const token = await enabledPortalToken();
    const ownProduct = await insertProduct(WORKSPACE_ID, 9_002);
    const ownReason = await insertReason(WORKSPACE_ID, 'eigen-9002');

    const response = await handlePublicPortalRoute(
      itemRequest(token, { productId: ownProduct, reasonId: ownReason }),
      portalPorts(),
    );

    expect(response?.status).toBe(201);
    const stored = await postgres.admin.query<{ product_id: string; reason_id: string }>(
      `SELECT product_id, reason_id FROM return_items`,
    );
    expect(stored.rows.map((row) => [Number(row.product_id), Number(row.reason_id)])).toEqual([[ownProduct, ownReason]]);
  });

  async function insertCustomer(workspaceId: string, sourceId: number): Promise<number> {
    const result = await postgres.admin.query<{ id: string }>(
      `INSERT INTO customers (workspace_id, source_sqlite_id, name) VALUES ($1, $2, 'Kunde') RETURNING id`,
      [workspaceId, sourceId],
    );
    return Number(result.rows[0]!.id);
  }

  async function insertEmailMessage(workspaceId: string, sourceId: number): Promise<number> {
    const account = await postgres.admin.query<{ id: string }>(
      `INSERT INTO email_accounts (
        workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username,
        smtp_host, smtp_port, smtp_tls, smtp_username, smtp_use_imap_auth
      ) VALUES ($1, $2, 'Service', 'service@example.test', 'imap.example.test', 'service',
        'smtp.example.test', 587, true, 'service', false) RETURNING id`,
      [workspaceId, sourceId],
    );
    const accountId = Number(account.rows[0]!.id);
    const folder = await postgres.admin.query<{ id: string }>(
      `INSERT INTO email_folders (workspace_id, source_sqlite_id, account_source_sqlite_id, account_id, path)
       VALUES ($1, $2, $2, $3, 'INBOX') RETURNING id`,
      [workspaceId, sourceId, accountId],
    );
    const folderId = Number(folder.rows[0]!.id);
    const message = await postgres.admin.query<{ id: string }>(
      `INSERT INTO email_messages (
        workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
        account_id, folder_id, uid, subject, body_text, folder_kind
      ) VALUES ($1, $2, $2, $2, $3, $4, 1, 'Retoure', 'Bitte zurueck', 'inbox') RETURNING id`,
      [workspaceId, sourceId, accountId, folderId],
    );
    return Number(message.rows[0]!.id);
  }

  function authenticatedCreate(body: Record<string, unknown>) {
    const api = createServerApi({ auth: {} as never, locks: {} as never, returns: createPostgresReturnsPort({ db }) });
    return api.handle({
      method: 'POST',
      path: '/api/v1/returns',
      principal: { userId: '20000000-0000-4000-8000-0000000000a1', workspaceId: WORKSPACE_ID, role: 'owner' },
      body: { items: [{ sku: 'SKU-1', quantity: 1 }], ...body },
    });
  }

  // F-A3a-06: POST /returns uebernahm customerId/emailMessageId ungeprueft; fremde IDs landeten
  // wegen der globalen FKs im eigenen Workspace, unbekannte endeten als 23503/500.
  test('authenticated create rejects customer and email message ids outside the workspace', async () => {
    const foreignCustomer = await insertCustomer(FOREIGN_WORKSPACE_ID, 9_101);
    const foreignMessage = await insertEmailMessage(FOREIGN_WORKSPACE_ID, 9_102);

    for (const body of [
      { customerId: foreignCustomer },
      { emailMessageId: foreignMessage },
      { customerId: 999_999_999 },
      { emailMessageId: 999_999_999 },
    ]) {
      const response = await authenticatedCreate(body);
      expect([body, response.status]).toEqual([body, 400]);
      expect((response.body as { error: { code: string } }).error.code).toBe('create_failed');
    }
    const headers = await postgres.admin.query(`SELECT count(*)::int AS count FROM returns`);
    expect(headers.rows[0].count).toBe(0);
  });

  test('authenticated create keeps customer and email message ids of the own workspace', async () => {
    const ownCustomer = await insertCustomer(WORKSPACE_ID, 9_103);
    const ownMessage = await insertEmailMessage(WORKSPACE_ID, 9_104);

    const response = await authenticatedCreate({ customerId: ownCustomer, emailMessageId: ownMessage });

    expect(response.status).toBe(201);
    const stored = await postgres.admin.query<{ customer_id: string; email_message_id: string }>(
      `SELECT customer_id, email_message_id FROM returns`,
    );
    expect(stored.rows.map((row) => [Number(row.customer_id), Number(row.email_message_id)]))
      .toEqual([[ownCustomer, ownMessage]]);
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
