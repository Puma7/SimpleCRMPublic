import {
  createServerApi,
  type AuthApiPort,
  type ServerApiPorts,
  type UserGroupApiPort,
} from '../../packages/server/src';

describe('server user groups API', () => {
  const admin = { userId: 'user-1', workspaceId: 'ws-1', role: 'owner' as const };
  const member = { userId: 'user-2', workspaceId: 'ws-1', role: 'user' as const };

  test('lists groups for any authenticated user', async () => {
    const userGroups = groupPort();
    const api = createServerApi(ports({ userGroups }));
    const res = await api.handle({ method: 'GET', path: '/api/v1/user-groups', principal: member });
    expect(res.status).toBe(200);
    expect((res.body as any).data.items[0].name).toBe('Support');
  });

  test('creating a group requires admin', async () => {
    const userGroups = groupPort();
    const api = createServerApi(ports({ userGroups }));

    const forbidden = await api.handle({ method: 'POST', path: '/api/v1/user-groups', body: { name: 'Sales' }, principal: member });
    expect(forbidden.status).toBe(403);
    expect(userGroups.create).not.toHaveBeenCalled();

    const created = await api.handle({ method: 'POST', path: '/api/v1/user-groups', body: { name: 'Sales' }, principal: admin });
    expect(created.status).toBe(201);
    expect(userGroups.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Sales', workspaceId: 'ws-1' }));
  });

  test('rejects an empty name and surfaces duplicate names', async () => {
    const userGroups = groupPort();
    userGroups.create.mockResolvedValueOnce({ ok: false, code: 'duplicate_name' });
    const api = createServerApi(ports({ userGroups }));

    const empty = await api.handle({ method: 'POST', path: '/api/v1/user-groups', body: { name: '   ' }, principal: admin });
    expect(empty.status).toBe(400);

    const dupe = await api.handle({ method: 'POST', path: '/api/v1/user-groups', body: { name: 'Support' }, principal: admin });
    expect(dupe.status).toBe(409);
    expect((dupe.body as any).error.code).toBe('user_group_duplicate_name');
  });

  test('adds and removes members (admin only)', async () => {
    const userGroups = groupPort();
    const api = createServerApi(ports({ userGroups }));

    const add = await api.handle({ method: 'POST', path: '/api/v1/user-groups/5/members', body: { userId: 'user-9' }, principal: admin });
    expect(add.status).toBe(201);
    expect(userGroups.addMember).toHaveBeenCalledWith(expect.objectContaining({ groupId: 5, userId: 'user-9' }));

    const remove = await api.handle({ method: 'DELETE', path: '/api/v1/user-groups/5/members/user-9', principal: admin });
    expect(remove.status).toBe(200);
    expect(userGroups.removeMember).toHaveBeenCalledWith(expect.objectContaining({ groupId: 5, userId: 'user-9' }));

    const forbidden = await api.handle({ method: 'POST', path: '/api/v1/user-groups/5/members', body: { userId: 'user-9' }, principal: member });
    expect(forbidden.status).toBe(403);
  });

  test('listing members is available to non-admins and 404s for unknown groups', async () => {
    const userGroups = groupPort();
    userGroups.listMembers.mockResolvedValueOnce(null);
    const api = createServerApi(ports({ userGroups }));

    const res = await api.handle({ method: 'GET', path: '/api/v1/user-groups/77/members', principal: member });
    expect(res.status).toBe(404);
    expect((res.body as any).error.code).toBe('user_group_not_found');
  });

  test('deleting a group invalidates exactly the atomically-captured members', async () => {
    const userGroups = groupPort();
    // The port captures members inside the delete transaction and returns them, so the
    // route invalidates precisely what the committed cascade removed.
    userGroups.delete.mockResolvedValueOnce({
      group: { id: 5, name: 'Support', description: null, memberCount: 2, updatedAt: '2026-06-06T10:00:00.000Z' },
      memberUserIds: ['user-9', 'user-3'],
    });
    const published: Array<{ type: string; payload: unknown }> = [];
    const events = { publish: jest.fn(async (event: { type: string; payload: unknown }) => { published.push(event); }) };
    const api = createServerApi(ports({ userGroups, events } as Partial<ServerApiPorts>));

    const forbidden = await api.handle({ method: 'DELETE', path: '/api/v1/user-groups/5', principal: member });
    expect(forbidden.status).toBe(403);
    expect(userGroups.delete).not.toHaveBeenCalled();

    const res = await api.handle({ method: 'DELETE', path: '/api/v1/user-groups/5', principal: admin });
    expect(res.status).toBe(200);
    expect(userGroups.listMembers).not.toHaveBeenCalled();
    // One deletion invalidation per captured member (deduped + sorted by the route).
    expect(published).toEqual([
      expect.objectContaining({ type: 'email_acl.changed', payload: expect.objectContaining({ targetUserId: 'user-3', state: 'deleted' }) }),
      expect.objectContaining({ type: 'email_acl.changed', payload: expect.objectContaining({ targetUserId: 'user-9', state: 'deleted' }) }),
    ]);
  });

  test('returns 503 when the port is not configured', async () => {
    const api = createServerApi(ports({ userGroups: undefined }));
    const res = await api.handle({ method: 'GET', path: '/api/v1/user-groups', principal: admin });
    expect(res.status).toBe(503);
  });
});

function groupPort(): jest.Mocked<UserGroupApiPort> {
  return {
    list: jest.fn(async () => [
      { id: 5, name: 'Support', description: null, memberCount: 2, updatedAt: '2026-06-06T10:00:00.000Z' },
    ]),
    create: jest.fn(async (input) => ({
      ok: true as const,
      group: { id: 6, name: input.name, description: input.description ?? null, memberCount: 0, updatedAt: '2026-06-06T10:00:00.000Z' },
    })),
    update: jest.fn(async () => ({
      ok: true as const,
      group: { id: 5, name: 'Support', description: null, memberCount: 2, updatedAt: '2026-06-06T10:00:00.000Z' },
    })),
    delete: jest.fn(async () => ({
      group: { id: 5, name: 'Support', description: null, memberCount: 0, updatedAt: '2026-06-06T10:00:00.000Z' },
      memberUserIds: [],
    })),
    listMembers: jest.fn(async () => []),
    addMember: jest.fn(async () => ({ ok: true as const })),
    removeMember: jest.fn(async () => ({ ok: true as const })),
  };
}

function ports(overrides: Partial<ServerApiPorts>): ServerApiPorts {
  return {
    auth: {} as AuthApiPort,
    locks: {} as ServerApiPorts['locks'],
    ...overrides,
  };
}
