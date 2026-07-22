import type { MailPermission, MailResource } from '../../packages/core/src/email/mail-permissions';
import { createPostgresMailAccessPort } from '../../packages/server/src/mail-access/postgres-mail-access-port';
import {
  MailAccessDeniedError,
  MailAccessService,
} from '../../packages/server/src/mail-access/service';
import type {
  MailAccessGrant,
  MailAccessPort,
} from '../../packages/server/src/mail-access/types';

const WORKSPACE_A = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_B = '22222222-2222-4222-8222-222222222222';
const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const USER_ACTOR = Object.freeze({
  workspaceId: WORKSPACE_A,
  userId: USER_A,
  isOwner: false,
  isAdmin: false,
});

type Equal<Left, Right> = (
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false
);

type Assert<Value extends true> = Value;

const grantTypeAssertion: Assert<Equal<MailAccessGrant,
  | Readonly<{ resourceType: 'account'; accountId: number; folderId: null; messageId: null }>
  | Readonly<{ resourceType: 'folder'; accountId: number; folderId: number; messageId: null }>
  | Readonly<{ resourceType: 'message'; accountId: number; folderId: number; messageId: number }>
>> = true;

type GrantFixture = Readonly<{
  workspaceId: string;
  userId: string;
  permission: MailPermission;
  grant: MailAccessGrant;
}>;

function createFixturePort(fixtures: readonly GrantFixture[]): MailAccessPort & {
  resolveGrants: jest.MockedFunction<MailAccessPort['resolveGrants']>;
} {
  return {
    resolveGrants: jest.fn(async (input) => fixtures
      .filter((fixture) => (
        fixture.workspaceId === input.workspaceId
        && fixture.userId === input.userId
        && fixture.permission === input.permission
      ))
      .map((fixture) => fixture.grant)),
  };
}

function fixture(
  permission: MailPermission,
  grant: MailAccessGrant,
  overrides: Partial<Omit<GrantFixture, 'permission' | 'grant'>> = {},
): GrantFixture {
  return {
    workspaceId: WORKSPACE_A,
    userId: USER_A,
    permission,
    grant,
    ...overrides,
  };
}

const accountGrant = (accountId: number): MailAccessGrant => ({
  resourceType: 'account',
  accountId,
  folderId: null,
  messageId: null,
});

const folderGrant = (accountId: number, folderId: number): MailAccessGrant => ({
  resourceType: 'folder',
  accountId,
  folderId,
  messageId: null,
});

const messageGrant = (
  accountId: number,
  folderId: number,
  messageId: number,
): MailAccessGrant => ({
  resourceType: 'message',
  accountId,
  folderId,
  messageId,
});

describe('MailAccessService', () => {
  it('defines exact grant resource shapes', () => {
    expect(grantTypeAssertion).toBe(true);
  });

  it.each([
    ['Owner', { workspaceId: WORKSPACE_A, userId: USER_A, isOwner: true, isAdmin: false }],
    ['Admin', { workspaceId: WORKSPACE_A, userId: USER_A, isOwner: false, isAdmin: true }],
  ])('gives %s an explicit bypass', async (_label, actor) => {
    const port = createFixturePort([]);
    const service = new MailAccessService(port);
    const input = {
      workspaceId: WORKSPACE_A,
      actor,
      permission: 'mail.content.read' as const,
    };

    await expect(service.assertPermission({
      ...input,
      resource: { type: 'message', accountId: '10', folderId: '20', messageId: '30' },
    })).resolves.toBeUndefined();
    await expect(service.resolveScope(input)).resolves.toEqual({ kind: 'all' });
    expect(port.resolveGrants).not.toHaveBeenCalled();
  });

  it.each([
    ['Owner', { workspaceId: WORKSPACE_B, userId: USER_B, isOwner: true, isAdmin: false }],
    ['Admin', { workspaceId: WORKSPACE_B, userId: USER_B, isOwner: false, isAdmin: true }],
    ['User', { workspaceId: WORKSPACE_B, userId: USER_B, isOwner: false, isAdmin: false }],
  ])('denies a %s whose authenticated workspace differs from the input', async (_label, actor) => {
    const port = createFixturePort([
      fixture('mail.content.read', accountGrant(10), { userId: USER_B }),
    ]);
    const service = new MailAccessService(port);
    const input = {
      workspaceId: WORKSPACE_A,
      actor,
      permission: 'mail.content.read' as const,
    };

    await expect(service.assertPermission({
      ...input,
      resource: { type: 'account', accountId: '10' },
    })).rejects.toBeInstanceOf(MailAccessDeniedError);
    await expect(service.resolveScope(input)).resolves.toEqual({ kind: 'none' });
    expect(port.resolveGrants).not.toHaveBeenCalled();
  });

  it.each<{
    name: string;
    grants: readonly GrantFixture[];
    permission: MailPermission;
    resource: MailResource;
    allowed: boolean;
  }>([
    {
      name: 'allows a direct user account grant',
      grants: [fixture('mail.content.read', accountGrant(10))],
      permission: 'mail.content.read',
      resource: { type: 'account', accountId: '10' },
      allowed: true,
    },
    {
      name: 'allows a grant resolved from a current group membership',
      grants: [fixture('mail.content.read', folderGrant(10, 20))],
      permission: 'mail.content.read',
      resource: { type: 'folder', accountId: '10', folderId: '20' },
      allowed: true,
    },
    {
      name: 'inherits an account grant to every child message',
      grants: [fixture('mail.content.read', accountGrant(10))],
      permission: 'mail.content.read',
      resource: { type: 'message', accountId: '10', folderId: '99', messageId: '100' },
      allowed: true,
    },
    {
      name: 'inherits a folder grant only to messages in that folder',
      grants: [fixture('mail.content.read', folderGrant(10, 20))],
      permission: 'mail.content.read',
      resource: { type: 'message', accountId: '10', folderId: '20', messageId: '30' },
      allowed: true,
    },
    {
      name: 'isolates a folder grant from sibling folders',
      grants: [fixture('mail.content.read', folderGrant(10, 20))],
      permission: 'mail.content.read',
      resource: { type: 'message', accountId: '10', folderId: '21', messageId: '30' },
      allowed: false,
    },
    {
      name: 'does not let a message grant authorize its parent folder',
      grants: [fixture('mail.content.read', messageGrant(10, 20, 30))],
      permission: 'mail.content.read',
      resource: { type: 'folder', accountId: '10', folderId: '20' },
      allowed: false,
    },
    {
      name: 'denies by default when no grant exists',
      grants: [],
      permission: 'mail.content.read',
      resource: { type: 'account', accountId: '10' },
      allowed: false,
    },
    {
      name: 'does not reuse a grant from another workspace',
      grants: [fixture('mail.content.read', accountGrant(10), { workspaceId: WORKSPACE_B })],
      permission: 'mail.content.read',
      resource: { type: 'account', accountId: '10' },
      allowed: false,
    },
  ])('$name', async ({ grants, permission, resource, allowed }) => {
    const service = new MailAccessService(createFixturePort(grants));
    const assertion = service.assertPermission({
      workspaceId: WORKSPACE_A,
      actor: USER_ACTOR,
      permission,
      resource,
    });

    if (allowed) await expect(assertion).resolves.toBeUndefined();
    else await expect(assertion).rejects.toBeInstanceOf(MailAccessDeniedError);
  });

  it.each([
    ['mail.content.read', 'mail.attachment.read'],
    ['mail.send', 'mail.send_as'],
  ] as const)('does not let %s imply %s', async (grantedPermission, requestedPermission) => {
    const service = new MailAccessService(createFixturePort([
      fixture(grantedPermission, accountGrant(10)),
    ]));

    await expect(service.assertPermission({
      workspaceId: WORKSPACE_A,
      actor: USER_ACTOR,
      permission: requestedPermission,
      resource: { type: 'account', accountId: '10' },
    })).rejects.toBeInstanceOf(MailAccessDeniedError);
  });

  it('returns a normalized restricted SQL scope with account, folder, and message exceptions', async () => {
    const service = new MailAccessService(createFixturePort([
      fixture('mail.content.read', messageGrant(11, 21, 32)),
      fixture('mail.content.read', accountGrant(10)),
      fixture('mail.content.read', folderGrant(11, 20)),
      fixture('mail.content.read', messageGrant(11, 20, 31)),
      fixture('mail.content.read', folderGrant(10, 22)),
      fixture('mail.content.read', accountGrant(10)),
    ]));

    await expect(service.resolveScope({
      workspaceId: WORKSPACE_A,
      actor: USER_ACTOR,
      permission: 'mail.content.read',
    })).resolves.toEqual({
      kind: 'restricted',
      accountIds: [10],
      folderIds: [20],
      messageIds: [32],
    });
  });

  it('returns none when a normal user has no grants', async () => {
    const service = new MailAccessService(createFixturePort([]));

    await expect(service.resolveScope({
      workspaceId: WORKSPACE_A,
      actor: USER_ACTOR,
      permission: 'mail.content.read',
    })).resolves.toEqual({ kind: 'none' });
  });

  it.each(['01', '1.0', '1e3', '0', '-1', '9007199254740992', 'not-an-id']) (
    'rejects the non-canonical or unsafe resource ID %s without querying grants',
    async (accountId) => {
      const port = createFixturePort([fixture('mail.content.read', accountGrant(1))]);
      const service = new MailAccessService(port);

      await expect(service.assertPermission({
        workspaceId: WORKSPACE_A,
        actor: USER_ACTOR,
        permission: 'mail.content.read',
        resource: { type: 'account', accountId },
      })).rejects.toBeInstanceOf(MailAccessDeniedError);
      expect(port.resolveGrants).not.toHaveBeenCalled();
    },
  );

  it('uses a resource-neutral public denial message', async () => {
    const service = new MailAccessService(createFixturePort([]));

    const error = await service.assertPermission({
      workspaceId: WORKSPACE_A,
      actor: USER_ACTOR,
      permission: 'mail.content.read',
      resource: { type: 'message', accountId: '10', folderId: '20', messageId: '987654' },
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MailAccessDeniedError);
    expect(error).toMatchObject({ code: 'mail_access_denied' });
    expect((error as Error).message).toBe('Keine Berechtigung fuer diese E-Mail-Aktion.');
    expect((error as Error).message).not.toContain('message');
    expect((error as Error).message).not.toContain('987654');
  });
});

describe('createPostgresMailAccessPort', () => {
  it('keeps workspace and user identity in the transaction and query parameters', async () => {
    const queryParameters: unknown[][] = [];
    const contexts: unknown[] = [];
    const trx = {
      getExecutor: () => ({
        executeQuery: async (compiled: { parameters: readonly unknown[] }) => {
          queryParameters.push([...compiled.parameters]);
          return { rows: [] };
        },
      }),
    };
    const db = {
      transaction: () => ({ execute: async (operation: (transaction: typeof trx) => unknown) => operation(trx) }),
    };
    const port = createPostgresMailAccessPort({
      db: db as never,
      applyWorkspaceSession: async (_trx, command) => {
        contexts.push(command.params);
      },
    });

    await port.resolveGrants({
      workspaceId: WORKSPACE_B,
      userId: USER_B,
      permission: 'mail.send_as',
    });

    expect(contexts).toEqual([[WORKSPACE_B, USER_B, 'user', 'off']]);
    expect(queryParameters).toHaveLength(1);
    expect(queryParameters[0]).toContain(WORKSPACE_B);
    expect(queryParameters[0]).toContain(USER_B);
    expect(queryParameters[0]).toContain('mail.send_as');
    expect(queryParameters[0]).not.toContain(WORKSPACE_A);
    expect(queryParameters[0]).not.toContain(USER_A);
  });
});
