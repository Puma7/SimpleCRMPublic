import {
  createServerApi,
  type ServerApiPorts,
} from '../../packages/server/src';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

const releaseCalls: string[] = [];

function makePorts(overrides: Partial<ServerApiPorts> = {}): ServerApiPorts {
  return {
    mailAccess: {
      async assertPermission() {
        return undefined;
      },
      async resolveScope() {
        return { kind: 'all' };
      },
    },
    mailResourceLookup: {
      async resolve(input) {
        if (input.target.kind === 'account') {
          return [{ type: 'account', accountId: String(input.target.id) }];
        }
        return [];
      },
    },
    emailAccounts: {
      async get() {
        return { id: 7, protocol: 'imap', name: 'Inbox' } as any;
      },
      async claimSyncSlot() {
        return {
          claimed: true,
          lastStartedAt: new Date('2026-07-29T12:00:00.000Z'),
          previousStartedAt: null,
        };
      },
      async releaseSyncSlot() {
        releaseCalls.push('released');
      },
      async list() {
        return { items: [] };
      },
    },
    jobQueue: {
      async enqueue() {
        throw new Error('queue unavailable');
      },
    },
    ...overrides,
  } as ServerApiPorts;
}

describe('mail account sync route', () => {
  beforeEach(() => {
    releaseCalls.length = 0;
  });

  test('gibt bei Enqueue-Fehler den Claim frei und meldet 503', async () => {
    const api = createServerApi(makePorts());
    const response = await api.handle({
      method: 'POST',
      path: '/api/v1/email/accounts/7/sync',
      principal: {
        userId: USER,
        workspaceId: WORKSPACE,
        role: 'user',
        capabilities: ['mail.metadata.read'],
      },
    });

    expect(response.status).toBe(503);
    expect((response.body as any).error.code).toBe('mail_sync_enqueue_failed');
    expect(releaseCalls).toEqual(['released']);
  });
});
