import { createServerApi } from '../../packages/server/src/api/server-api';
import type {
  AuthenticatedPrincipal,
  ServerApiPorts,
  SmtpRelayAdminPort,
  SmtpRelayCredentialRecord,
  SmtpRelayRecord,
  SmtpRelaySubmissionRecord,
} from '../../packages/server/src/api/types';

const RELAY_ID = '11111111-1111-4111-8111-111111111111';
const CRED_ID = '22222222-2222-4222-8222-222222222222';
const PASSWORD = 'wJalrXUtnFEMI_K7MDENG-bPxRfiCYEXAMPLEKEYxx1';

const admin: AuthenticatedPrincipal = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  role: 'admin',
};
const user: AuthenticatedPrincipal = { ...admin, role: 'user' };

const credential: SmtpRelayCredentialRecord = {
  id: CRED_ID,
  username: 'relay-a1b2c3d4',
  lastUsedAt: null,
  revokedAt: null,
  createdAt: '2026-07-01T00:00:00.000Z',
};

const relay: SmtpRelayRecord = {
  id: RELAY_ID,
  label: 'ERP Relay',
  enabled: true,
  trackingMode: 'rule',
  trackingSubjectPatterns: 'invoice',
  allowHeaderOverride: true,
  maxRecipients: 50,
  maxMessageBytes: 26_214_400,
  rateLimitPerMin: 60,
  allowArbitraryRecipients: false,
  followupWorkflowId: 7,
  createdAt: '2026-07-01T00:00:00.000Z',
  allowedAccounts: [
    { accountId: 100, fromAddress: null, emailAddress: 'sales@acme.test', displayName: 'Sales' },
  ],
  credentials: [credential],
};

const submission: SmtpRelaySubmissionRecord = {
  id: '33333333-3333-4333-8333-333333333333',
  status: 'relayed',
  recipientCount: 2,
  trackingApplied: true,
  trackingRuleReason: 'subject_match',
  messageId: 17,
  smtpMessageIdHeader: '<relay-1@acme.test>',
  errorText: null,
  createdAt: '2026-07-15T12:00:00.000Z',
};

function makeRelayPort(overrides: Partial<SmtpRelayAdminPort> = {}): SmtpRelayAdminPort {
  return {
    async listRelays() { return [relay]; },
    async createRelay(input) {
      return { ok: true, relay: { ...relay, label: input.values.label, allowedAccounts: [], credentials: [] } };
    },
    async updateRelay() { return { ok: true, relay }; },
    async deleteRelay() { return { id: RELAY_ID, label: relay.label }; },
    async addAllowedAccount(input) {
      return {
        ok: true,
        account: {
          accountId: input.accountId,
          fromAddress: input.fromAddress ?? null,
          emailAddress: 'sales@acme.test',
          displayName: 'Sales',
        },
      };
    },
    async removeAllowedAccount() { return true; },
    async createCredential() { return { ok: true, credential, password: PASSWORD }; },
    async revokeCredential() {
      return { ok: true, credential: { ...credential, revokedAt: '2026-07-16T00:00:00.000Z' } };
    },
    async listSubmissions() { return [submission]; },
    ...overrides,
  };
}

type AuditEvent = {
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
};

function makeAudit() {
  const events: AuditEvent[] = [];
  return {
    events,
    port: {
      async record(input: AuditEvent) { events.push(input); },
    },
  };
}

function apiFor(port: SmtpRelayAdminPort | undefined, audit?: ReturnType<typeof makeAudit>) {
  return createServerApi({
    auth: {} as never,
    ...(port ? { smtpRelay: port } : {}),
    ...(audit ? { audit: audit.port } : {}),
  } as unknown as ServerApiPorts);
}

describe('smtp relay routes', () => {
  test('requires authentication on every relay route', async () => {
    const api = apiFor(makeRelayPort());
    const list = await api.handle({ method: 'GET', path: '/api/v1/email/relays' });
    const create = await api.handle({ method: 'POST', path: '/api/v1/email/relays', body: { label: 'x' } });
    expect(list.status).toBe(401);
    expect(create.status).toBe(401);
  });

  test('returns 503 when the smtpRelay port is not configured', async () => {
    const response = await apiFor(undefined).handle({
      method: 'GET',
      path: '/api/v1/email/relays',
      principal: admin,
    });
    expect(response.status).toBe(503);
    expect((response.body as { error: { code: string } }).error.code).toBe('smtp_relay_unavailable');
  });

  test('restricts the relay list to admins and never exposes credential secrets', async () => {
    // Reads expose allowed sender routes + SMTP AUTH usernames, so ordinary
    // workspace users must not see them.
    const denied = await apiFor(makeRelayPort()).handle({
      method: 'GET',
      path: '/api/v1/email/relays',
      principal: user,
    });
    expect(denied.status).toBe(403);

    const response = await apiFor(makeRelayPort()).handle({
      method: 'GET',
      path: '/api/v1/email/relays',
      principal: admin,
    });
    expect(response.status).toBe(200);
    const items = (response.body as { data: { items: SmtpRelayRecord[] } }).data.items;
    expect(items).toHaveLength(1);
    expect(items[0]!.credentials[0]).toEqual({
      id: CRED_ID,
      username: 'relay-a1b2c3d4',
      lastUsedAt: null,
      revokedAt: null,
      createdAt: '2026-07-01T00:00:00.000Z',
    });
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('secret');
  });

  test('rejects mutations for non-admin principals without touching the port', async () => {
    const calls: string[] = [];
    const port = makeRelayPort({
      async createRelay() { calls.push('create'); throw new Error('unreachable'); },
      async updateRelay() { calls.push('update'); throw new Error('unreachable'); },
      async deleteRelay() { calls.push('delete'); throw new Error('unreachable'); },
      async addAllowedAccount() { calls.push('addAccount'); throw new Error('unreachable'); },
      async removeAllowedAccount() { calls.push('removeAccount'); throw new Error('unreachable'); },
      async createCredential() { calls.push('createCredential'); throw new Error('unreachable'); },
      async revokeCredential() { calls.push('revokeCredential'); throw new Error('unreachable'); },
    });
    const api = apiFor(port);

    const attempts = [
      api.handle({ method: 'POST', path: '/api/v1/email/relays', principal: user, body: { label: 'x' } }),
      api.handle({ method: 'PATCH', path: `/api/v1/email/relays/${RELAY_ID}`, principal: user, body: {} }),
      api.handle({ method: 'DELETE', path: `/api/v1/email/relays/${RELAY_ID}`, principal: user }),
      api.handle({ method: 'POST', path: `/api/v1/email/relays/${RELAY_ID}/accounts`, principal: user, body: { accountId: 100 } }),
      api.handle({ method: 'DELETE', path: `/api/v1/email/relays/${RELAY_ID}/accounts/100`, principal: user }),
      api.handle({ method: 'POST', path: `/api/v1/email/relays/${RELAY_ID}/credentials`, principal: user }),
      api.handle({ method: 'POST', path: `/api/v1/email/relays/${RELAY_ID}/credentials/${CRED_ID}/revoke`, principal: user }),
    ];
    for (const response of await Promise.all(attempts)) {
      expect(response.status).toBe(403);
    }
    expect(calls).toEqual([]);
  });

  test('creates a relay and records the audit event', async () => {
    const audit = makeAudit();
    const response = await apiFor(makeRelayPort(), audit).handle({
      method: 'POST',
      path: '/api/v1/email/relays',
      principal: admin,
      body: { label: 'ERP Relay', trackingMode: 'always', maxRecipients: 10 },
    });
    expect(response.status).toBe(201);
    const created = (response.body as { data: { relay: SmtpRelayRecord } }).data.relay;
    expect(created.label).toBe('ERP Relay');
    expect(audit.events).toEqual([
      expect.objectContaining({
        action: 'smtp_relay.created',
        entityType: 'smtp_relay',
        entityId: RELAY_ID,
        actorUserId: 'user-1',
      }),
    ]);
  });

  test('maps duplicate labels to 409', async () => {
    const response = await apiFor(makeRelayPort({
      async createRelay() { return { ok: false, code: 'duplicate_label' }; },
    })).handle({
      method: 'POST',
      path: '/api/v1/email/relays',
      principal: admin,
      body: { label: 'ERP Relay' },
    });
    expect(response.status).toBe(409);
    expect((response.body as { error: { code: string } }).error.code).toBe('duplicate_relay_label');
  });

  test('validates mutation payloads against the DB constraints', async () => {
    const calls: unknown[] = [];
    const api = apiFor(makeRelayPort({
      async updateRelay(input) { calls.push(input); return { ok: true, relay }; },
    }));
    const patch = (body: unknown) => api.handle({
      method: 'PATCH',
      path: `/api/v1/email/relays/${RELAY_ID}`,
      principal: admin,
      body,
    });

    expect((await patch({ trackingMode: 'sometimes' })).status).toBe(400);
    expect((await patch({ maxRecipients: 0 })).status).toBe(400);
    expect((await patch({ maxRecipients: 1001 })).status).toBe(400);
    expect((await patch({ maxRecipients: 12.5 })).status).toBe(400);
    expect((await patch({ rateLimitPerMin: 0 })).status).toBe(400);
    expect((await patch({ enabled: 'yes' })).status).toBe(400);
    expect((await patch({ label: '' })).status).toBe(400);
    expect((await patch({ unknownField: true })).status).toBe(400);
    expect(calls).toEqual([]);

    const valid = await patch({ trackingMode: 'off', maxRecipients: 1000 });
    expect(valid.status).toBe(200);
    expect(calls).toEqual([
      expect.objectContaining({
        workspaceId: 'workspace-1',
        relayId: RELAY_ID,
        values: { trackingMode: 'off', maxRecipients: 1000 },
      }),
    ]);
  });

  test('requires a label when creating a relay', async () => {
    const response = await apiFor(makeRelayPort()).handle({
      method: 'POST',
      path: '/api/v1/email/relays',
      principal: admin,
      body: { enabled: true },
    });
    expect(response.status).toBe(400);
  });

  test('returns 404 for unknown relays on update/delete', async () => {
    const api = apiFor(makeRelayPort({
      async updateRelay() { return null; },
      async deleteRelay() { return null; },
    }));
    expect((await api.handle({
      method: 'PATCH', path: `/api/v1/email/relays/${RELAY_ID}`, principal: admin, body: {},
    })).status).toBe(404);
    expect((await api.handle({
      method: 'DELETE', path: `/api/v1/email/relays/${RELAY_ID}`, principal: admin,
    })).status).toBe(404);
  });

  test('rejects malformed relay ids in the path', async () => {
    const response = await apiFor(makeRelayPort()).handle({
      method: 'PATCH',
      path: '/api/v1/email/relays/not-a-uuid',
      principal: admin,
      body: {},
    });
    expect(response.status).toBe(400);
    expect((response.body as { error: { code: string } }).error.code).toBe('invalid_relay_id');
  });

  test('deletes a relay and records the audit event with its label', async () => {
    const audit = makeAudit();
    const response = await apiFor(makeRelayPort(), audit).handle({
      method: 'DELETE',
      path: `/api/v1/email/relays/${RELAY_ID}`,
      principal: admin,
    });
    expect(response.status).toBe(200);
    expect((response.body as { data: { deleted: boolean } }).data.deleted).toBe(true);
    expect(audit.events).toEqual([
      expect.objectContaining({
        action: 'smtp_relay.deleted',
        entityId: RELAY_ID,
        metadata: expect.objectContaining({ label: 'ERP Relay' }),
      }),
    ]);
  });

  test('adds and removes allowed accounts, recording an audit event for each', async () => {
    const audit = makeAudit();
    const api = apiFor(makeRelayPort(), audit);
    const added = await api.handle({
      method: 'POST',
      path: `/api/v1/email/relays/${RELAY_ID}/accounts`,
      principal: admin,
      body: { accountId: 100, fromAddress: 'noreply@acme.test' },
    });
    expect(added.status).toBe(201);
    expect((added.body as { data: { account: unknown } }).data.account).toEqual({
      accountId: 100,
      fromAddress: 'noreply@acme.test',
      emailAddress: 'sales@acme.test',
      displayName: 'Sales',
    });

    const removed = await api.handle({
      method: 'DELETE',
      path: `/api/v1/email/relays/${RELAY_ID}/accounts/100`,
      principal: admin,
    });
    expect(removed.status).toBe(200);

    // The allowlist governs which From addresses may send through the relay, so
    // add + remove must both leave an audit trail with the relay + account ids.
    expect(audit.events).toEqual([
      expect.objectContaining({
        action: 'smtp_relay_account.added',
        entityType: 'smtp_relay',
        entityId: RELAY_ID,
        metadata: expect.objectContaining({ accountId: 100, fromAddress: 'noreply@acme.test' }),
      }),
      expect.objectContaining({
        action: 'smtp_relay_account.removed',
        entityType: 'smtp_relay',
        entityId: RELAY_ID,
        metadata: expect.objectContaining({ accountId: 100 }),
      }),
    ]);

    const duplicate = await apiFor(makeRelayPort({
      async addAllowedAccount() { return { ok: false, code: 'duplicate_account' }; },
    })).handle({
      method: 'POST',
      path: `/api/v1/email/relays/${RELAY_ID}/accounts`,
      principal: admin,
      body: { accountId: 100 },
    });
    expect(duplicate.status).toBe(409);

    const badFrom = await api.handle({
      method: 'POST',
      path: `/api/v1/email/relays/${RELAY_ID}/accounts`,
      principal: admin,
      body: { accountId: 100, fromAddress: 'not-an-address' },
    });
    expect(badFrom.status).toBe(400);
  });

  test('credential creation reveals the password exactly once and never via the list', async () => {
    const audit = makeAudit();
    const api = apiFor(makeRelayPort(), audit);

    const created = await api.handle({
      method: 'POST',
      path: `/api/v1/email/relays/${RELAY_ID}/credentials`,
      principal: admin,
    });
    expect(created.status).toBe(201);
    expect((created.body as { data: unknown }).data).toEqual({
      id: CRED_ID,
      username: 'relay-a1b2c3d4',
      password: PASSWORD,
    });
    expect(audit.events).toEqual([
      expect.objectContaining({
        action: 'smtp_relay_credential.created',
        entityType: 'smtp_relay_credential',
        entityId: CRED_ID,
      }),
    ]);
    // The audit trail must never contain the plaintext either.
    expect(JSON.stringify(audit.events)).not.toContain(PASSWORD);

    const list = await api.handle({ method: 'GET', path: '/api/v1/email/relays', principal: admin });
    expect(JSON.stringify(list.body)).not.toContain(PASSWORD);
  });

  test('maps missing secret storage to 503 on credential creation', async () => {
    const response = await apiFor(makeRelayPort({
      async createCredential() { return { ok: false, code: 'secret_port_unavailable' }; },
    })).handle({
      method: 'POST',
      path: `/api/v1/email/relays/${RELAY_ID}/credentials`,
      principal: admin,
    });
    expect(response.status).toBe(503);
    expect((response.body as { error: { code: string } }).error.code).toBe('smtp_relay_secret_unavailable');
  });

  test('revokes credentials and records the audit event', async () => {
    const audit = makeAudit();
    const response = await apiFor(makeRelayPort(), audit).handle({
      method: 'POST',
      path: `/api/v1/email/relays/${RELAY_ID}/credentials/${CRED_ID}/revoke`,
      principal: admin,
    });
    expect(response.status).toBe(200);
    const body = response.body as { data: { revoked: boolean; credential: SmtpRelayCredentialRecord } };
    expect(body.data.revoked).toBe(true);
    expect(body.data.credential.revokedAt).toBe('2026-07-16T00:00:00.000Z');
    expect(audit.events).toEqual([
      expect.objectContaining({ action: 'smtp_relay_credential.revoked', entityId: CRED_ID }),
    ]);

    const missing = await apiFor(makeRelayPort({
      async revokeCredential() { return null; },
    })).handle({
      method: 'POST',
      path: `/api/v1/email/relays/${RELAY_ID}/credentials/${CRED_ID}/revoke`,
      principal: admin,
    });
    expect(missing.status).toBe(404);
  });

  test('lists submissions with a validated limit query (admin only)', async () => {
    const calls: unknown[] = [];
    const api = apiFor(makeRelayPort({
      async listSubmissions(input) { calls.push(input); return [submission]; },
    }));

    // Submissions expose per-message provenance — non-admins are refused.
    const denied = await api.handle({
      method: 'GET',
      path: `/api/v1/email/relays/${RELAY_ID}/submissions`,
      principal: user,
    });
    expect(denied.status).toBe(403);
    expect(calls).toHaveLength(0);

    const withDefault = await api.handle({
      method: 'GET',
      path: `/api/v1/email/relays/${RELAY_ID}/submissions`,
      principal: admin,
    });
    expect(withDefault.status).toBe(200);
    expect((withDefault.body as { data: { items: unknown[] } }).data.items).toEqual([submission]);

    await api.handle({
      method: 'GET',
      path: `/api/v1/email/relays/${RELAY_ID}/submissions`,
      query: { limit: '5' },
      principal: admin,
    });
    expect(calls).toEqual([
      expect.objectContaining({ limit: 50 }),
      expect.objectContaining({ limit: 5 }),
    ]);

    const invalid = await api.handle({
      method: 'GET',
      path: `/api/v1/email/relays/${RELAY_ID}/submissions`,
      query: { limit: '0' },
      principal: admin,
    });
    expect(invalid.status).toBe(400);

    const unknownRelay = await apiFor(makeRelayPort({
      async listSubmissions() { return null; },
    })).handle({
      method: 'GET',
      path: `/api/v1/email/relays/${RELAY_ID}/submissions`,
      principal: admin,
    });
    expect(unknownRelay.status).toBe(404);
  });

  test('rejects unsupported methods on relay routes', async () => {
    const api = apiFor(makeRelayPort());
    expect((await api.handle({
      method: 'PATCH', path: '/api/v1/email/relays', principal: admin, body: {},
    })).status).toBe(405);
    expect((await api.handle({
      method: 'GET', path: `/api/v1/email/relays/${RELAY_ID}/credentials`, principal: admin,
    })).status).toBe(405);
  });
});
