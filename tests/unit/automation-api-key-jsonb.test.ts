import { createPostgresAutomationApiKeyReadPort } from '../../packages/server/src';

// Regression for "invalid input syntax for type json (22P02) POST
// /automation/api-keys": automation_api_keys.scopes is jsonb, but the insert
// passed a JS array, which node-postgres serialises as a Postgres array literal
// ({...}) that jsonb rejects. The fix stringifies the array. This drives the
// real create() through a query-capturing fake db and asserts the bound value.
const WS = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

describe('automation api-key create binds scopes as jsonb-safe JSON', () => {
  test('scopes is bound as a JSON string, not a JS array', async () => {
    const captured: Array<{ table: string; values: Record<string, unknown> }> = [];
    const trx = {
      insertInto: (table: string) => ({
        values: (values: Record<string, unknown>) => {
          captured.push({ table, values });
          return {
            returning: () => ({
              executeTakeFirstOrThrow: async () => ({
                id: 'key-1',
                label: values.label,
                scopes: ['webhook:fire', 'mail:read'],
                secret_id: values.secret_id ?? 'secret-1',
                last_used_at: null,
                revoked_at: null,
                created_by_user_id: USER,
                created_at: new Date('2026-06-06T00:00:00.000Z'),
                updated_at: new Date('2026-06-06T00:00:00.000Z'),
              }),
            }),
          };
        },
      }),
    };
    const db = {
      transaction: () => ({ execute: async (cb: (t: typeof trx) => Promise<unknown>) => cb(trx) }),
    } as never;

    const port = createPostgresAutomationApiKeyReadPort({
      db,
      applyWorkspaceSession: async () => {},
      now: () => new Date('2026-06-06T00:00:00.000Z'),
      generateId: () => 'key-1',
      generateKey: () => 'scrm_test_key',
      secrets: { writeSecret: async () => ({ id: 'secret-1' }) } as never,
    });

    const result = await port.create({
      workspaceId: WS,
      actorUserId: USER,
      values: { label: 'Import webhook', scopes: ['webhook:fire', 'mail:read'] },
    });

    expect(result.ok).toBe(true);
    const insert = captured.find((c) => c.table === 'automation_api_keys');
    expect(insert).toBeDefined();
    expect(typeof insert!.values.scopes).toBe('string');
    expect(JSON.parse(insert!.values.scopes as string)).toEqual(['webhook:fire', 'mail:read']);
  });
});
