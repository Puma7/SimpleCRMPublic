import { createPostgresWorkflowHttpRequestPort } from '../../packages/server/src/workflow-http-request';

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000000';

// Minimal fake db: `db.transaction().execute(cb)` runs the callback against a
// trx whose allowlist query returns `example.com`. `applyWorkspaceSession` is a
// noop so the real session SQL (which needs kysely `sql`) is never invoked.
function makeDb() {
  const fakeTrx = {
    selectFrom: () => ({
      select: () => ({
        where: () => ({
          where: () => ({ executeTakeFirst: async () => ({ value: 'example.com' }) }),
        }),
      }),
    }),
  };
  return {
    transaction: () => ({ execute: async (cb: (t: unknown) => unknown) => cb(fakeTrx) }),
  } as unknown as never;
}

describe('workflow HTTP request SSRF hardening', () => {
  test('blocks a 302 redirect to the cloud metadata service', async () => {
    const port = createPostgresWorkflowHttpRequestPort({
      db: makeDb(),
      applyWorkspaceSession: async () => {},
      lookup: async () => [{ address: '93.184.216.34' }],
      fetchImpl: async () => ({
        ok: false,
        status: 302,
        headers: {
          get: (name: string) => (name.toLowerCase() === 'location' ? 'http://169.254.169.254/' : null),
        },
        text: async () => '',
      }),
    });

    await expect(
      port.request({
        workspaceId: WORKSPACE_ID,
        method: 'POST',
        url: 'https://api.example.com/hook',
        timeoutMs: 5000,
      }),
    ).rejects.toThrow();
  });

  test('allows a normal allowlisted request', async () => {
    const port = createPostgresWorkflowHttpRequestPort({
      db: makeDb(),
      applyWorkspaceSession: async () => {},
      lookup: async () => [{ address: '93.184.216.34' }],
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => 'ok',
      }),
    });

    await expect(
      port.request({
        workspaceId: WORKSPACE_ID,
        method: 'POST',
        url: 'https://api.example.com/hook',
        body: '{"hello":"world"}',
        timeoutMs: 5000,
      }),
    ).resolves.toBeUndefined();
  });
});
