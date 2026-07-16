import { createHash } from 'node:crypto';

import {
  createPostgresSmtpRelayAdminPort,
  createPostgresSmtpRelayPort,
} from '../../packages/server/src/db/postgres-relay-port';

// Two real UUIDs — withWorkspaceTransaction validates workspaceId shape.
const WS_A = '11111111-1111-4111-8111-111111111111';
const WS_B = '22222222-2222-4222-8222-222222222222';
// Actor user id must also be a UUID for the session command.
const ACTOR = '33333333-3333-4333-8333-333333333333';

function hash(password: string): string {
  return `sha256:${createHash('sha256').update(password, 'utf8').digest('hex')}`;
}

type Tables = {
  smtp_relays: Record<string, unknown>[];
  smtp_relay_credentials: Record<string, unknown>[];
  smtp_relay_allowed_accounts: Record<string, unknown>[];
  smtp_relay_submissions: Record<string, unknown>[];
  email_accounts: Record<string, unknown>[];
  email_workflows: Record<string, unknown>[];
};

function seedTables(): Tables {
  return {
    smtp_relays: [
      { id: 'relay-a', workspace_id: WS_A, label: 'Relay A', enabled: true, tracking_mode: 'rule', tracking_subject_patterns: 'invoice', allow_header_override: true, max_recipients: 50, max_message_bytes: 10_485_760, rate_limit_per_min: 60, allow_arbitrary_recipients: false, followup_workflow_id: 7, created_at: new Date('2026-01-01T00:00:00.000Z') },
      { id: 'relay-disabled', workspace_id: WS_A, label: 'Relay Disabled', enabled: false, tracking_mode: 'always', tracking_subject_patterns: null, allow_header_override: false, max_recipients: 10, max_message_bytes: 1_000, rate_limit_per_min: 5, allow_arbitrary_recipients: true, followup_workflow_id: null, created_at: new Date('2026-01-02T00:00:00.000Z') },
      { id: 'relay-b', workspace_id: WS_B, label: 'Relay B', enabled: true, tracking_mode: 'off', tracking_subject_patterns: null, allow_header_override: false, max_recipients: 20, max_message_bytes: 2_000, rate_limit_per_min: 10, allow_arbitrary_recipients: false, followup_workflow_id: null, created_at: new Date('2026-01-03T00:00:00.000Z') },
    ],
    smtp_relay_credentials: [
      { id: 'cred-a', workspace_id: WS_A, relay_id: 'relay-a', username: 'relay-a-user', password_hash: hash('secretA'), secret_id: 'sec-a', revoked_at: null, last_used_at: null, created_at: new Date('2026-01-01T01:00:00.000Z') },
      { id: 'cred-revoked', workspace_id: WS_A, relay_id: 'relay-a', username: 'revoked-user', password_hash: hash('secretR'), secret_id: null, revoked_at: new Date('2026-01-01T00:00:00.000Z'), last_used_at: null, created_at: new Date('2026-01-01T02:00:00.000Z') },
      { id: 'cred-disabled', workspace_id: WS_A, relay_id: 'relay-disabled', username: 'disabled-user', password_hash: hash('secretD'), secret_id: null, revoked_at: null, last_used_at: null, created_at: new Date('2026-01-01T03:00:00.000Z') },
      { id: 'cred-b', workspace_id: WS_B, relay_id: 'relay-b', username: 'relay-b-user', password_hash: hash('secretB'), secret_id: null, revoked_at: null, last_used_at: null, created_at: new Date('2026-01-01T04:00:00.000Z') },
    ],
    smtp_relay_allowed_accounts: [
      { id: 'al-1', workspace_id: WS_A, relay_id: 'relay-a', account_id: 100, from_address: null },
      { id: 'al-2', workspace_id: WS_A, relay_id: 'relay-a', account_id: 101, from_address: 'noreply@acme.test' },
    ],
    smtp_relay_submissions: [],
    email_accounts: [
      { id: 100, workspace_id: WS_A, source_sqlite_id: 100, display_name: 'Sales', email_address: 'sales@acme.test', protocol: 'imap', smtp_host: 'smtp.acme.test', smtp_port: 587, smtp_tls: true, smtp_username: 'sales', smtp_use_imap_auth: false, smtp_keytar_account_key: null, smtp_password_secret_id: 'secret-sales', imap_username: 'sales', keytar_account_key: null, imap_password_secret_id: null, oauth_provider: null, oauth_refresh_keytar_key: null, oauth_refresh_secret_id: null },
      { id: 101, workspace_id: WS_A, source_sqlite_id: 101, display_name: 'Support', email_address: 'support@acme.test', protocol: 'imap', smtp_host: 'smtp.acme.test', smtp_port: 465, smtp_tls: true, smtp_username: 'support', smtp_use_imap_auth: true, smtp_keytar_account_key: null, smtp_password_secret_id: 'secret-support', imap_username: 'support', keytar_account_key: null, imap_password_secret_id: null, oauth_provider: null, oauth_refresh_keytar_key: null, oauth_refresh_secret_id: null },
    ],
    email_workflows: [
      { id: 7, workspace_id: WS_A },
    ],
  };
}

// --- Minimal in-memory Kysely fake -----------------------------------------
// Mirrors returns-portal-port.test.ts: a hand-rolled query builder that records
// the base table, joins, wheres, selected columns, ordering, and limits, then
// evaluates them against seeded arrays. Inserts simulate the UNIQUE/FK
// constraints of migration 0030 by throwing pg-shaped errors (code 23505/23503)
// so the admin port's conflict handling is exercised for real.

function parseSpec(spec: string): { table: string; alias: string } {
  const parts = spec.split(/\s+as\s+/i);
  return { table: parts[0]!, alias: (parts[1] ?? parts[0]!) };
}

function parseColumn(col: string, baseAlias: string): { alias: string; column: string } {
  const dot = col.indexOf('.');
  if (dot < 0) return { alias: baseAlias, column: col };
  return { alias: col.slice(0, dot), column: col.slice(dot + 1) };
}

function parseSelectSpec(spec: string): { expr: string; name: string } {
  const parts = spec.split(/\s+as\s+/i);
  const expr = parts[0]!;
  const fallback = expr.includes('.') ? expr.slice(expr.indexOf('.') + 1) : expr;
  return { expr, name: parts[1] ?? fallback };
}

function resolve(row: Record<string, Record<string, unknown>>, col: string, baseAlias: string): unknown {
  const { alias, column } = parseColumn(col, baseAlias);
  return row[alias]?.[column];
}

function whereMatches(
  row: Record<string, Record<string, unknown>>,
  wheres: Array<{ col: string; op: string; val: unknown }>,
  baseAlias: string,
): boolean {
  return wheres.every(({ col, op, val }) => {
    const actual = resolve(row, col, baseAlias);
    if (op === 'is') return val === null ? actual === null || actual === undefined : actual === val;
    return actual === val;
  });
}

function pgError(code: string, constraint: string): Error {
  return Object.assign(new Error(`fake constraint violation: ${constraint}`), { code, constraint });
}

function compareValues(a: unknown, b: unknown): number {
  const left = a instanceof Date ? a.getTime() : a;
  const right = b instanceof Date ? b.getTime() : b;
  if (left === right) return 0;
  if (left === undefined || left === null) return -1;
  if (right === undefined || right === null) return 1;
  return (left as never) < (right as never) ? -1 : 1;
}

function pickColumns(row: Record<string, unknown>, cols: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(cols.map((col) => [col, row[col]]));
}

function makeTrx(tables: Tables) {
  const table = (name: string): Record<string, unknown>[] => (tables as unknown as Record<string, Record<string, unknown>[]>)[name] ?? [];

  const enforceInsertConstraints = (name: string, row: Record<string, unknown>): void => {
    if (name === 'smtp_relays') {
      if (table(name).some((existing) => existing.workspace_id === row.workspace_id && existing.label === row.label)) {
        throw pgError('23505', 'smtp_relays_workspace_id_label_key');
      }
      if (row.followup_workflow_id !== null && row.followup_workflow_id !== undefined
        && !table('email_workflows').some((workflow) => workflow.id === row.followup_workflow_id)) {
        throw pgError('23503', 'smtp_relays_followup_workflow_id_fkey');
      }
    }
    if (name === 'smtp_relay_credentials'
      && table(name).some((existing) => existing.username === row.username)) {
      throw pgError('23505', 'smtp_relay_credentials_username_key');
    }
    if (name === 'smtp_relay_allowed_accounts'
      && table(name).some((existing) => existing.relay_id === row.relay_id && existing.account_id === row.account_id)) {
      throw pgError('23505', 'smtp_relay_allowed_accounts_relay_id_account_id_key');
    }
  };

  const select = (baseSpec: string) => {
    const base = parseSpec(baseSpec);
    const joins: Array<{ table: string; alias: string; conds: Array<[string, string]> }> = [];
    const wheres: Array<{ col: string; op: string; val: unknown }> = [];
    const selected: string[] = [];
    let ordering: { col: string; dir: string } | undefined;
    let limitCount: number | undefined;
    const b: Record<string, unknown> = {};
    b.innerJoin = (spec: string, cb: (j: unknown) => unknown) => {
      const j = parseSpec(spec);
      const conds: Array<[string, string]> = [];
      const jb = { onRef: (l: string, _op: string, r: string) => { conds.push([l, r]); return jb; } };
      cb(jb);
      joins.push({ table: j.table, alias: j.alias, conds });
      return b;
    };
    b.select = (cols: string | readonly string[]) => {
      if (typeof cols === 'string') selected.push(cols);
      else if (Array.isArray(cols)) selected.push(...cols);
      return b;
    };
    b.selectAll = () => b;
    b.where = (col: string, op: string, val: unknown) => { wheres.push({ col, op, val }); return b; };
    b.orderBy = (col: string, dir?: string) => { ordering = { col, dir: dir ?? 'asc' }; return b; };
    b.limit = (count: number) => { limitCount = count; return b; };

    const combined = (): Array<Record<string, Record<string, unknown>>> => {
      let rows: Array<Record<string, Record<string, unknown>>> = table(base.table).map((r) => ({ [base.alias]: r }));
      for (const join of joins) {
        const next: Array<Record<string, Record<string, unknown>>> = [];
        for (const row of rows) {
          for (const candidate of table(join.table)) {
            const tentative = { ...row, [join.alias]: candidate };
            const ok = join.conds.every(([l, r]) => resolve(tentative, l, base.alias) === resolve(tentative, r, base.alias));
            if (ok) next.push(tentative);
          }
        }
        rows = next;
      }
      rows = rows.filter((row) => whereMatches(row, wheres, base.alias));
      if (ordering) {
        const { col, dir } = ordering;
        rows = [...rows].sort((left, right) => {
          const order = compareValues(resolve(left, col, base.alias), resolve(right, col, base.alias));
          return dir === 'desc' ? -order : order;
        });
      }
      if (limitCount !== undefined) rows = rows.slice(0, limitCount);
      return rows;
    };

    const project = (row: Record<string, Record<string, unknown>>): Record<string, unknown> => {
      if (selected.length === 0) return { ...row[base.alias]! };
      const out: Record<string, unknown> = {};
      for (const spec of selected) {
        const { expr, name } = parseSelectSpec(spec);
        out[name] = resolve(row, expr, base.alias);
      }
      return out;
    };

    b.execute = async () => combined().map(project);
    b.executeTakeFirst = async () => combined().map(project)[0];
    b.executeTakeFirstOrThrow = async () => {
      const first = combined().map(project)[0];
      if (!first) throw new Error('no result');
      return first;
    };
    return b;
  };

  const update = (name: string) => {
    let pendingSet: Record<string, unknown> = {};
    const wheres: Array<{ col: string; op: string; val: unknown }> = [];
    const b: Record<string, unknown> = {};
    const apply = (): Record<string, unknown>[] => {
      const updated: Record<string, unknown>[] = [];
      for (const row of table(name)) {
        if (whereMatches({ [name]: row }, wheres, name)) {
          Object.assign(row, pendingSet);
          updated.push(row);
        }
      }
      return updated;
    };
    b.set = (set: Record<string, unknown>) => { pendingSet = set; return b; };
    b.where = (col: string, op: string, val: unknown) => { wheres.push({ col, op, val }); return b; };
    b.execute = async () => { apply(); return []; };
    b.returning = (cols: readonly string[]) => ({
      executeTakeFirst: async () => {
        const first = apply()[0];
        return first ? pickColumns(first, cols) : undefined;
      },
      executeTakeFirstOrThrow: async () => {
        const first = apply()[0];
        if (!first) throw new Error('no result');
        return pickColumns(first, cols);
      },
    });
    return b;
  };

  const insert = (name: string) => {
    let pendingValues: Record<string, unknown> = {};
    const b: Record<string, unknown> = {};
    const apply = (): Record<string, unknown> => {
      const row = { ...pendingValues };
      enforceInsertConstraints(name, row);
      table(name).push(row);
      return row;
    };
    b.values = (values: Record<string, unknown>) => { pendingValues = values; return b; };
    b.execute = async () => { apply(); return []; };
    b.returning = (cols: readonly string[]) => ({
      executeTakeFirst: async () => pickColumns(apply(), cols),
      executeTakeFirstOrThrow: async () => pickColumns(apply(), cols),
    });
    return b;
  };

  const del = (name: string) => {
    const wheres: Array<{ col: string; op: string; val: unknown }> = [];
    const b: Record<string, unknown> = {};
    const apply = (): Record<string, unknown>[] => {
      const rows = table(name);
      const removed: Record<string, unknown>[] = [];
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        const row = rows[index]!;
        if (whereMatches({ [name]: row }, wheres, name)) {
          removed.unshift(row);
          rows.splice(index, 1);
        }
      }
      return removed;
    };
    b.where = (col: string, op: string, val: unknown) => { wheres.push({ col, op, val }); return b; };
    b.execute = async () => { apply(); return []; };
    b.returning = (cols: readonly string[]) => ({
      executeTakeFirst: async () => {
        const first = apply()[0];
        return first ? pickColumns(first, cols) : undefined;
      },
    });
    return b;
  };

  return {
    selectFrom: (spec: string) => select(spec),
    updateTable: (name: string) => update(name),
    insertInto: (name: string) => insert(name),
    deleteFrom: (name: string) => del(name),
  };
}

function makeDb(tables: Tables) {
  const trx = makeTrx(tables);
  return { transaction: () => ({ execute: async (cb: (t: typeof trx) => Promise<unknown>) => cb(trx) }) } as never;
}

function makePort(tables: Tables, now?: () => Date) {
  return createPostgresSmtpRelayPort({ db: makeDb(tables), applyWorkspaceSession: async () => {}, now });
}

type FakeSecretInput = { workspaceId: string; kind: string; name: string; value?: string | Buffer };

function makeSecretsPort() {
  const writes: FakeSecretInput[] = [];
  const deletes: FakeSecretInput[] = [];
  return {
    writes,
    deletes,
    port: {
      async writeSecret(input: FakeSecretInput) {
        writes.push(input);
        return {
          id: `secret-${writes.length}`,
          workspaceId: input.workspaceId,
          kind: input.kind,
          name: input.name,
          keyId: 'key-1',
          algorithm: 'aes-256-gcm',
          updatedAt: '2026-07-15T00:00:00.000Z',
        };
      },
      async deleteSecret(input: FakeSecretInput) {
        deletes.push(input);
        return true;
      },
    },
  };
}

type AdminPortOptions = {
  secrets?: ReturnType<typeof makeSecretsPort>['port'];
  generateId?: () => string;
  generateUsername?: () => string;
  generatePassword?: () => string;
  now?: () => Date;
};

function makeAdminPort(tables: Tables, options: AdminPortOptions = {}) {
  return createPostgresSmtpRelayAdminPort({
    db: makeDb(tables),
    applyWorkspaceSession: async () => {},
    ...options,
  } as never);
}

describe('createPostgresSmtpRelayPort.verifyCredential', () => {
  test('accepts a valid username + password and returns the scoped ids', async () => {
    const tables = seedTables();
    const port = makePort(tables, () => new Date('2026-07-15T12:00:00.000Z'));
    const result = await port.verifyCredential({ username: 'relay-a-user', password: 'secretA' });
    expect(result).toEqual({ workspaceId: WS_A, relayId: 'relay-a', credentialId: 'cred-a' });
    // Best-effort last_used_at bump was applied to the matched credential.
    const cred = tables.smtp_relay_credentials.find((c) => c.id === 'cred-a')!;
    expect(cred.last_used_at).toEqual(new Date('2026-07-15T12:00:00.000Z'));
  });

  test('rejects a wrong password', async () => {
    const port = makePort(seedTables());
    expect(await port.verifyCredential({ username: 'relay-a-user', password: 'wrong' })).toBeNull();
  });

  test('rejects a revoked credential', async () => {
    const port = makePort(seedTables());
    expect(await port.verifyCredential({ username: 'revoked-user', password: 'secretR' })).toBeNull();
  });

  test('rejects a credential whose relay is disabled', async () => {
    const port = makePort(seedTables());
    expect(await port.verifyCredential({ username: 'disabled-user', password: 'secretD' })).toBeNull();
  });

  test('rejects empty username or password before touching the DB', async () => {
    const port = makePort(seedTables());
    expect(await port.verifyCredential({ username: '', password: 'secretA' })).toBeNull();
    expect(await port.verifyCredential({ username: 'relay-a-user', password: '' })).toBeNull();
  });

  test('isolates workspaces: resolves the credential to its own workspace', async () => {
    const port = makePort(seedTables());
    const result = await port.verifyCredential({ username: 'relay-b-user', password: 'secretB' });
    expect(result).toEqual({ workspaceId: WS_B, relayId: 'relay-b', credentialId: 'cred-b' });
  });

  test('does not match a username from one workspace with a password from another', async () => {
    const port = makePort(seedTables());
    expect(await port.verifyCredential({ username: 'relay-a-user', password: 'secretB' })).toBeNull();
  });
});

describe('createPostgresSmtpRelayPort.resolveRoutingAccount', () => {
  test('accepts an allowed From via the account email address (case-insensitive)', async () => {
    const port = makePort(seedTables());
    const account = await port.resolveRoutingAccount({ workspaceId: WS_A, relayId: 'relay-a', fromAddress: 'Sales@ACME.test' });
    expect(account).not.toBeNull();
    expect(account!.id).toBe(100);
    expect(account!.email_address).toBe('sales@acme.test');
    expect(account!.smtp_host).toBe('smtp.acme.test');
    // The join helper column must not leak into the returned account row.
    expect((account as Record<string, unknown>).allowed_from_address).toBeUndefined();
  });

  test('accepts an allowed From via an explicit from_address override', async () => {
    const port = makePort(seedTables());
    const account = await port.resolveRoutingAccount({ workspaceId: WS_A, relayId: 'relay-a', fromAddress: 'noreply@acme.test' });
    expect(account).not.toBeNull();
    expect(account!.id).toBe(101);
    expect(account!.email_address).toBe('support@acme.test');
  });

  test('rejects a From address that is not mapped to the relay', async () => {
    const port = makePort(seedTables());
    expect(await port.resolveRoutingAccount({ workspaceId: WS_A, relayId: 'relay-a', fromAddress: 'stranger@acme.test' })).toBeNull();
  });

  test('does NOT authorise a plus-tagged variant of an allowed address', async () => {
    // Authorization is an EXACT case-insensitive mailbox — plus-tags are NOT
    // folded (unlike normalizeEmailAddress), so allowing sales@acme.test must
    // not also permit sales+anything@acme.test.
    const port = makePort(seedTables());
    expect(await port.resolveRoutingAccount({
      workspaceId: WS_A, relayId: 'relay-a', fromAddress: 'sales+newsletter@acme.test',
    })).toBeNull();
    // The exact address still works (sanity).
    expect(await port.resolveRoutingAccount({
      workspaceId: WS_A, relayId: 'relay-a', fromAddress: 'sales@acme.test',
    })).not.toBeNull();
  });

  test('does not resolve accounts mapped to a different relay/workspace', async () => {
    const port = makePort(seedTables());
    // relay-b belongs to WS_B and has no allowed accounts.
    expect(await port.resolveRoutingAccount({ workspaceId: WS_B, relayId: 'relay-b', fromAddress: 'sales@acme.test' })).toBeNull();
  });
});

describe('createPostgresSmtpRelayPort.loadRelayConfig', () => {
  test('returns the mapped tracking + limit config', async () => {
    const port = makePort(seedTables());
    const config = await port.loadRelayConfig({ workspaceId: WS_A, relayId: 'relay-a' });
    expect(config).toEqual({
      trackingMode: 'rule',
      trackingSubjectPatterns: 'invoice',
      allowHeaderOverride: true,
      maxRecipients: 50,
      maxMessageBytes: 10_485_760,
      rateLimitPerMin: 60,
      allowArbitraryRecipients: false,
      followupWorkflowId: 7,
    });
  });

  test('returns null for an unknown relay', async () => {
    const port = makePort(seedTables());
    expect(await port.loadRelayConfig({ workspaceId: WS_A, relayId: 'nope' })).toBeNull();
  });

  test('returns null for a disabled relay (runtime send path must not act on it)', async () => {
    const port = makePort(seedTables());
    expect(await port.loadRelayConfig({ workspaceId: WS_A, relayId: 'relay-disabled' })).toBeNull();
  });
});

describe('createPostgresSmtpRelayPort.revalidateSession', () => {
  test('returns config while the relay is enabled and the credential un-revoked', async () => {
    const port = makePort(seedTables());
    const config = await port.revalidateSession({
      workspaceId: WS_A, relayId: 'relay-a', credentialId: 'cred-a',
    });
    expect(config).toMatchObject({ trackingMode: 'rule', rateLimitPerMin: 60 });
  });

  test('returns null once the credential is revoked (mid-session revocation)', async () => {
    const port = makePort(seedTables());
    expect(await port.revalidateSession({
      workspaceId: WS_A, relayId: 'relay-a', credentialId: 'cred-revoked',
    })).toBeNull();
  });

  test('returns null once the relay is disabled (mid-session disable)', async () => {
    const port = makePort(seedTables());
    expect(await port.revalidateSession({
      workspaceId: WS_A, relayId: 'relay-disabled', credentialId: 'cred-disabled',
    })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Admin port (management API surface)
// ---------------------------------------------------------------------------

describe('createPostgresSmtpRelayAdminPort.listRelays', () => {
  test('returns workspace relays with joined allowed accounts and credentials sans secrets', async () => {
    const port = makeAdminPort(seedTables());
    const relays = await port.listRelays({ workspaceId: WS_A });

    expect(relays.map((relay) => relay.id)).toEqual(['relay-a', 'relay-disabled']);
    const relayA = relays[0]!;
    expect(relayA).toMatchObject({
      label: 'Relay A',
      enabled: true,
      trackingMode: 'rule',
      trackingSubjectPatterns: 'invoice',
      allowHeaderOverride: true,
      maxRecipients: 50,
      maxMessageBytes: 10_485_760,
      rateLimitPerMin: 60,
      allowArbitraryRecipients: false,
      followupWorkflowId: 7,
    });
    expect(relayA.allowedAccounts).toEqual([
      { accountId: 100, fromAddress: null, emailAddress: 'sales@acme.test', displayName: 'Sales' },
      { accountId: 101, fromAddress: 'noreply@acme.test', emailAddress: 'support@acme.test', displayName: 'Support' },
    ]);
    expect(relayA.credentials.map((credential) => credential.username)).toEqual(['relay-a-user', 'revoked-user']);
    // The sanitized credential shape must not leak the hash or secret pointer.
    for (const credential of relayA.credentials) {
      expect(Object.keys(credential).sort()).toEqual(['createdAt', 'id', 'lastUsedAt', 'revokedAt', 'username']);
    }
    expect(relays[1]!.credentials.map((credential) => credential.id)).toEqual(['cred-disabled']);
  });

  test('does not return relays of other workspaces', async () => {
    const port = makeAdminPort(seedTables());
    const relays = await port.listRelays({ workspaceId: WS_B });
    expect(relays.map((relay) => relay.id)).toEqual(['relay-b']);
  });
});

describe('createPostgresSmtpRelayAdminPort.createRelay', () => {
  test('inserts with defaults and returns the mapped record', async () => {
    const tables = seedTables();
    const port = makeAdminPort(tables, {
      generateId: () => 'relay-new',
      now: () => new Date('2026-07-16T08:00:00.000Z'),
    });
    const result = await port.createRelay({
      workspaceId: WS_A,
      actorUserId: ACTOR,
      values: { label: '  ERP Relay  ' },
    });

    expect(result).toEqual({
      ok: true,
      relay: {
        id: 'relay-new',
        label: 'ERP Relay',
        enabled: true,
        trackingMode: 'rule',
        trackingSubjectPatterns: null,
        allowHeaderOverride: true,
        maxRecipients: 50,
        maxMessageBytes: 26_214_400,
        rateLimitPerMin: 60,
        allowArbitraryRecipients: false,
        followupWorkflowId: null,
        createdAt: '2026-07-16T08:00:00.000Z',
        allowedAccounts: [],
        credentials: [],
      },
    });
    const row = tables.smtp_relays.find((relay) => relay.id === 'relay-new')!;
    expect(row.created_by_user_id).toBe(ACTOR);
    expect(row.workspace_id).toBe(WS_A);
  });

  test('maps a duplicate workspace label to duplicate_label', async () => {
    const port = makeAdminPort(seedTables());
    const result = await port.createRelay({
      workspaceId: WS_A,
      actorUserId: ACTOR,
      values: { label: 'Relay A' },
    });
    expect(result).toEqual({ ok: false, code: 'duplicate_label' });
  });

  test('maps an unknown followup workflow to followup_workflow_not_found', async () => {
    const port = makeAdminPort(seedTables());
    const result = await port.createRelay({
      workspaceId: WS_A,
      actorUserId: ACTOR,
      values: { label: 'New Relay', followupWorkflowId: 999 },
    });
    expect(result).toEqual({ ok: false, code: 'followup_workflow_not_found' });
  });
});

describe('createPostgresSmtpRelayAdminPort.updateRelay', () => {
  test('updates only the provided fields and returns the full record', async () => {
    const tables = seedTables();
    const port = makeAdminPort(tables, { now: () => new Date('2026-07-16T09:00:00.000Z') });
    const result = await port.updateRelay({
      workspaceId: WS_A,
      actorUserId: ACTOR,
      relayId: 'relay-a',
      values: { trackingMode: 'always', maxRecipients: 5, enabled: false },
    });

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    const relay = (result as { ok: true; relay: Record<string, unknown> }).relay;
    expect(relay).toMatchObject({
      id: 'relay-a',
      label: 'Relay A',
      enabled: false,
      trackingMode: 'always',
      maxRecipients: 5,
      // untouched fields survive
      trackingSubjectPatterns: 'invoice',
      followupWorkflowId: 7,
    });
    expect((relay.allowedAccounts as unknown[]).length).toBe(2);
    expect((relay.credentials as unknown[]).length).toBe(2);
    const row = tables.smtp_relays.find((candidate) => candidate.id === 'relay-a')!;
    expect(row.updated_at).toEqual(new Date('2026-07-16T09:00:00.000Z'));
  });

  test('returns null for an unknown relay and does not cross workspaces', async () => {
    const port = makeAdminPort(seedTables());
    expect(await port.updateRelay({
      workspaceId: WS_A, actorUserId: ACTOR, relayId: 'relay-b', values: { enabled: false },
    })).toBeNull();
  });
});

describe('createPostgresSmtpRelayAdminPort.deleteRelay', () => {
  test('deletes the relay and removes the credential secrets', async () => {
    const tables = seedTables();
    const secrets = makeSecretsPort();
    const port = makeAdminPort(tables, { secrets: secrets.port });
    const result = await port.deleteRelay({ workspaceId: WS_A, actorUserId: ACTOR, relayId: 'relay-a' });

    expect(result).toEqual({ id: 'relay-a', label: 'Relay A' });
    expect(tables.smtp_relays.some((relay) => relay.id === 'relay-a')).toBe(false);
    // Every credential's secret is deleted by its deterministic name (relay-a
    // has cred-a and cred-revoked), regardless of the row's secret_id pointer.
    expect(secrets.deletes).toEqual(expect.arrayContaining([
      { workspaceId: WS_A, kind: 'smtp_relay.credential', name: 'smtp_relay_credential:cred-a:password' },
      { workspaceId: WS_A, kind: 'smtp_relay.credential', name: 'smtp_relay_credential:cred-revoked:password' },
    ]));
    expect(secrets.deletes).toHaveLength(2);
  });

  test('does NOT delete the relay when a credential secret deletion fails (retryable)', async () => {
    // The secret store is down: deleteSecret throws. The relay row must survive
    // so a retry can rediscover the credential ids and clean up the secrets —
    // otherwise the reveal-once plaintexts would be orphaned forever.
    const tables = seedTables();
    const throwingSecrets = {
      async writeSecret() { throw new Error('unused'); },
      async deleteSecret() { throw new Error('secret store unavailable'); },
    };
    const port = makeAdminPort(tables, { secrets: throwingSecrets as never });
    await expect(port.deleteRelay({ workspaceId: WS_A, actorUserId: ACTOR, relayId: 'relay-a' }))
      .rejects.toThrow('secret store unavailable');
    // Relay (and its credentials) still there for the retry.
    expect(tables.smtp_relays.some((relay) => relay.id === 'relay-a')).toBe(true);
  });

  test('returns null for an unknown relay', async () => {
    const port = makeAdminPort(seedTables());
    expect(await port.deleteRelay({ workspaceId: WS_A, actorUserId: ACTOR, relayId: 'nope' })).toBeNull();
  });
});

describe('createPostgresSmtpRelayAdminPort.addAllowedAccount / removeAllowedAccount', () => {
  test('adds an account mapping and returns the joined record', async () => {
    const tables = seedTables();
    const port = makeAdminPort(tables, { generateId: () => 'al-new' });
    const result = await port.addAllowedAccount({
      workspaceId: WS_A,
      actorUserId: ACTOR,
      relayId: 'relay-disabled',
      accountId: 100,
      fromAddress: '  billing@acme.test  ',
    });
    expect(result).toEqual({
      ok: true,
      account: {
        accountId: 100,
        fromAddress: 'billing@acme.test',
        emailAddress: 'sales@acme.test',
        displayName: 'Sales',
      },
    });
    expect(tables.smtp_relay_allowed_accounts.find((row) => row.id === 'al-new')).toMatchObject({
      workspace_id: WS_A,
      relay_id: 'relay-disabled',
      account_id: 100,
      from_address: 'billing@acme.test',
    });
  });

  test('reports relay_not_found, account_not_found, and duplicate_account', async () => {
    const port = makeAdminPort(seedTables());
    expect(await port.addAllowedAccount({
      workspaceId: WS_A, actorUserId: ACTOR, relayId: 'nope', accountId: 100,
    })).toEqual({ ok: false, code: 'relay_not_found' });
    expect(await port.addAllowedAccount({
      workspaceId: WS_A, actorUserId: ACTOR, relayId: 'relay-a', accountId: 999,
    })).toEqual({ ok: false, code: 'account_not_found' });
    expect(await port.addAllowedAccount({
      workspaceId: WS_A, actorUserId: ACTOR, relayId: 'relay-a', accountId: 100,
    })).toEqual({ ok: false, code: 'duplicate_account' });
  });

  test('rejects a From override that collides with a sibling account address (not just its override)', async () => {
    // al-2 maps account 101 (support@acme.test) with override noreply@acme.test,
    // so it CLAIMS both support@acme.test and noreply@acme.test for routing.
    // Adding a different account whose override is support@acme.test must be
    // rejected: resolveRoutingAccount would then match From: support@acme.test
    // to whichever row comes back first. The old check compared only each
    // mapping's single effective address (override ?? email), so support (new
    // override) vs noreply (al-2 override) looked distinct and slipped through.
    const tables = seedTables();
    tables.email_accounts.push({
      id: 102, workspace_id: WS_A, source_sqlite_id: 102, display_name: 'Ops',
      email_address: 'ops@acme.test', protocol: 'imap', smtp_host: 'smtp.acme.test',
      smtp_port: 587, smtp_tls: true, smtp_username: 'ops', smtp_use_imap_auth: false,
      smtp_keytar_account_key: null, smtp_password_secret_id: 'secret-ops', imap_username: 'ops',
      keytar_account_key: null, imap_password_secret_id: null, oauth_provider: null,
      oauth_refresh_keytar_key: null, oauth_refresh_secret_id: null,
    } as (typeof tables.email_accounts)[number]);
    const port = makeAdminPort(tables, { generateId: () => 'al-collide' });

    const collides = await port.addAllowedAccount({
      workspaceId: WS_A, actorUserId: ACTOR, relayId: 'relay-a', accountId: 102,
      fromAddress: 'support@acme.test',
    });
    expect(collides).toEqual({ ok: false, code: 'duplicate_from_address' });
    expect(tables.smtp_relay_allowed_accounts.some((row) => row.id === 'al-collide')).toBe(false);

    // A genuinely distinct override for the same new account is still accepted.
    const ok = await port.addAllowedAccount({
      workspaceId: WS_A, actorUserId: ACTOR, relayId: 'relay-a', accountId: 102,
      fromAddress: 'unique@acme.test',
    });
    expect(ok).toMatchObject({ ok: true });
  });

  test('resolves the allowed account by its public source id (imported/server-created)', async () => {
    // In server-client mode ListAccounts exposes source_sqlite_id as the public
    // account id; addAllowedAccount must resolve that to the real DB id.
    const tables = seedTables();
    tables.email_accounts.push({
      id: 300, workspace_id: WS_A, source_sqlite_id: -700, display_name: 'Imported',
      email_address: 'imported@acme.test', protocol: 'imap', smtp_host: 'smtp.acme.test',
      smtp_port: 587, smtp_tls: true, smtp_username: 'imp', smtp_use_imap_auth: false,
      smtp_keytar_account_key: null, smtp_password_secret_id: 'secret-imp', imap_username: 'imp',
      keytar_account_key: null, imap_password_secret_id: null, oauth_provider: null,
      oauth_refresh_keytar_key: null, oauth_refresh_secret_id: null,
    } as (typeof tables.email_accounts)[number]);
    const port = makeAdminPort(tables, { generateId: () => 'al-src' });

    const result = await port.addAllowedAccount({
      workspaceId: WS_A, actorUserId: ACTOR, relayId: 'relay-a', accountId: -700,
    });
    expect(result).toMatchObject({ ok: true });
    // The stored FK is the real email_accounts.id, not the source id.
    const row = tables.smtp_relay_allowed_accounts.find((r) => r.id === 'al-src')!;
    expect(row.account_id).toBe(300);
  });

  test('refuses an ambiguous account reference (source id equals another account db id)', async () => {
    // Account P has db id 600 (source id -600); account Q's source_sqlite_id is
    // ALSO 600. The public reference "600" then matches P by id AND Q by source
    // -> ambiguous -> refuse rather than authorize the wrong SMTP account.
    const tables = seedTables();
    const mkAccount = (id: number, source: number, email: string) => ({
      id, workspace_id: WS_A, source_sqlite_id: source, display_name: 'X', email_address: email,
      protocol: 'imap', smtp_host: 'smtp.acme.test', smtp_port: 587, smtp_tls: true, smtp_username: 'x',
      smtp_use_imap_auth: false, smtp_keytar_account_key: null, smtp_password_secret_id: 'secret-x',
      imap_username: 'x', keytar_account_key: null, imap_password_secret_id: null, oauth_provider: null,
      oauth_refresh_keytar_key: null, oauth_refresh_secret_id: null,
    } as (typeof tables.email_accounts)[number]);
    tables.email_accounts.push(mkAccount(600, -600, 'p@acme.test'));
    tables.email_accounts.push(mkAccount(601, 600, 'q@acme.test'));
    const port = makeAdminPort(tables);
    expect(await port.addAllowedAccount({
      workspaceId: WS_A, actorUserId: ACTOR, relayId: 'relay-a', accountId: 600,
    })).toEqual({ ok: false, code: 'account_not_found' });
  });

  test('removes an existing mapping and reports a missing one', async () => {
    const tables = seedTables();
    const port = makeAdminPort(tables);
    expect(await port.removeAllowedAccount({
      workspaceId: WS_A, actorUserId: ACTOR, relayId: 'relay-a', accountId: 100,
    })).toBe(true);
    expect(tables.smtp_relay_allowed_accounts.some((row) => row.id === 'al-1')).toBe(false);
    expect(await port.removeAllowedAccount({
      workspaceId: WS_A, actorUserId: ACTOR, relayId: 'relay-a', accountId: 100,
    })).toBe(false);
  });
});

describe('createPostgresSmtpRelayAdminPort.createCredential', () => {
  test('stores hash + secret, retries on username conflicts, and reveals the password once', async () => {
    const tables = seedTables();
    const secrets = makeSecretsPort();
    const usernames = ['relay-a-user', 'relay-fresh001'];
    const port = makeAdminPort(tables, {
      secrets: secrets.port,
      generateId: () => 'cred-new',
      generateUsername: () => usernames.shift()!,
      generatePassword: () => 'test-password-that-is-long-enough-000000001',
      now: () => new Date('2026-07-16T10:00:00.000Z'),
    });

    const result = await port.createCredential({ workspaceId: WS_A, actorUserId: ACTOR, relayId: 'relay-a' });
    expect(result).toEqual({
      ok: true,
      credential: {
        id: 'cred-new',
        // First generated username collided with the seeded credential -> retried.
        username: 'relay-fresh001',
        lastUsedAt: null,
        revokedAt: null,
        createdAt: '2026-07-16T10:00:00.000Z',
      },
      password: 'test-password-that-is-long-enough-000000001',
    });

    const row = tables.smtp_relay_credentials.find((credential) => credential.id === 'cred-new')!;
    expect(row.password_hash).toBe(hash('test-password-that-is-long-enough-000000001'));
    expect(row.secret_id).toBe('secret-1');
    expect(secrets.writes).toEqual([
      {
        workspaceId: WS_A,
        kind: 'smtp_relay.credential',
        name: 'smtp_relay_credential:cred-new:password',
        value: 'test-password-that-is-long-enough-000000001',
      },
    ]);
    expect(secrets.deletes).toEqual([]);
  });

  test('generates relay-<8 hex> usernames and 32+ char base64url passwords by default', async () => {
    const secrets = makeSecretsPort();
    const port = makeAdminPort(seedTables(), { secrets: secrets.port });
    const result = await port.createCredential({ workspaceId: WS_A, actorUserId: ACTOR, relayId: 'relay-a' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.credential.username).toMatch(/^relay-[0-9a-f]{8}$/);
    expect(result.password.length).toBeGreaterThanOrEqual(32);
    expect(result.password).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test('fails closed without a secret port and for unknown relays', async () => {
    const secrets = makeSecretsPort();
    expect(await makeAdminPort(seedTables()).createCredential({
      workspaceId: WS_A, actorUserId: ACTOR, relayId: 'relay-a',
    })).toEqual({ ok: false, code: 'secret_port_unavailable' });
    expect(await makeAdminPort(seedTables(), { secrets: secrets.port }).createCredential({
      workspaceId: WS_A, actorUserId: ACTOR, relayId: 'nope',
    })).toEqual({ ok: false, code: 'relay_not_found' });
    // No orphan secret is left behind when the relay lookup fails.
    expect(secrets.writes).toEqual([]);
  });

  test('deletes the written secret when every username attempt collides', async () => {
    const secrets = makeSecretsPort();
    const port = makeAdminPort(seedTables(), {
      secrets: secrets.port,
      generateUsername: () => 'relay-a-user',
    });
    await expect(port.createCredential({
      workspaceId: WS_A, actorUserId: ACTOR, relayId: 'relay-a',
    })).rejects.toMatchObject({ code: '23505' });
    expect(secrets.writes).toHaveLength(1);
    expect(secrets.deletes).toHaveLength(1);
  });

  test('a created credential authenticates via the runtime verification port', async () => {
    const tables = seedTables();
    const secrets = makeSecretsPort();
    const adminPort = makeAdminPort(tables, { secrets: secrets.port });
    const created = await adminPort.createCredential({ workspaceId: WS_A, actorUserId: ACTOR, relayId: 'relay-a' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const runtimePort = makePort(tables);
    const match = await runtimePort.verifyCredential({
      username: created.credential.username,
      password: created.password,
    });
    expect(match).toEqual({
      workspaceId: WS_A,
      relayId: 'relay-a',
      credentialId: created.credential.id,
    });
  });
});

describe('createPostgresSmtpRelayAdminPort.revokeCredential', () => {
  test('sets revoked_at, clears the secret pointer, and deletes the stored secret', async () => {
    const tables = seedTables();
    const secrets = makeSecretsPort();
    const port = makeAdminPort(tables, {
      secrets: secrets.port,
      now: () => new Date('2026-07-16T11:00:00.000Z'),
    });
    const result = await port.revokeCredential({
      workspaceId: WS_A, actorUserId: ACTOR, relayId: 'relay-a', credentialId: 'cred-a',
    });

    expect(result).toEqual({
      ok: true,
      credential: expect.objectContaining({
        id: 'cred-a',
        username: 'relay-a-user',
        revokedAt: '2026-07-16T11:00:00.000Z',
      }),
    });
    const row = tables.smtp_relay_credentials.find((credential) => credential.id === 'cred-a')!;
    expect(row.secret_id).toBeNull();
    expect(row.revoked_at).toEqual(new Date('2026-07-16T11:00:00.000Z'));
    expect(secrets.deletes).toEqual([
      {
        workspaceId: WS_A,
        kind: 'smtp_relay.credential',
        name: 'smtp_relay_credential:cred-a:password',
      },
    ]);
  });

  test('keeps the original revoked_at on repeated revocation', async () => {
    const tables = seedTables();
    const secrets = makeSecretsPort();
    const first = makeAdminPort(tables, { secrets: secrets.port, now: () => new Date('2026-07-16T11:00:00.000Z') });
    await first.revokeCredential({ workspaceId: WS_A, actorUserId: ACTOR, relayId: 'relay-a', credentialId: 'cred-a' });
    const second = makeAdminPort(tables, { secrets: secrets.port, now: () => new Date('2026-07-17T11:00:00.000Z') });
    const result = await second.revokeCredential({ workspaceId: WS_A, actorUserId: ACTOR, relayId: 'relay-a', credentialId: 'cred-a' });
    expect(result).toEqual({
      ok: true,
      credential: expect.objectContaining({ revokedAt: '2026-07-16T11:00:00.000Z' }),
    });
  });

  test('deletes the secret by deterministic name even when the pointer was already cleared', async () => {
    // Orphan cleanup: a prior revoke that nulled secret_id but failed to delete
    // must still be cleaned up on re-revoke — deletion is by the deterministic
    // credential secret name, not gated on the row's (now null) secret_id.
    const tables = seedTables();
    const secrets = makeSecretsPort();
    const port = makeAdminPort(tables, { secrets: secrets.port, now: () => new Date('2026-07-16T11:00:00.000Z') });
    // cred-revoked already has secret_id = null.
    const result = await port.revokeCredential({
      workspaceId: WS_A, actorUserId: ACTOR, relayId: 'relay-a', credentialId: 'cred-revoked',
    });
    expect(result).toMatchObject({ ok: true });
    expect(secrets.deletes).toEqual([
      { workspaceId: WS_A, kind: 'smtp_relay.credential', name: 'smtp_relay_credential:cred-revoked:password' },
    ]);
  });

  test('returns null for unknown credentials and wrong relay scoping', async () => {
    const port = makeAdminPort(seedTables(), { secrets: makeSecretsPort().port });
    expect(await port.revokeCredential({
      workspaceId: WS_A, actorUserId: ACTOR, relayId: 'relay-a', credentialId: 'nope',
    })).toBeNull();
    // cred-disabled belongs to relay-disabled, not relay-a.
    expect(await port.revokeCredential({
      workspaceId: WS_A, actorUserId: ACTOR, relayId: 'relay-a', credentialId: 'cred-disabled',
    })).toBeNull();
  });

  test('fails closed when a secret pointer exists but no secret port is configured', async () => {
    const port = makeAdminPort(seedTables());
    expect(await port.revokeCredential({
      workspaceId: WS_A, actorUserId: ACTOR, relayId: 'relay-a', credentialId: 'cred-a',
    })).toEqual({ ok: false, code: 'secret_port_unavailable' });
  });
});

describe('createPostgresSmtpRelayAdminPort.listSubmissions', () => {
  test('returns the most recent submissions first, capped by limit', async () => {
    const tables = seedTables();
    tables.smtp_relay_submissions = [
      { id: 'sub-1', workspace_id: WS_A, relay_id: 'relay-a', status: 'relayed', recipient_count: 1, tracking_applied: true, tracking_rule_reason: 'subject_match', message_id: 11, smtp_message_id_header: '<m1@acme.test>', error_text: null, created_at: new Date('2026-07-10T00:00:00.000Z') },
      { id: 'sub-2', workspace_id: WS_A, relay_id: 'relay-a', status: 'failed', recipient_count: 2, tracking_applied: false, tracking_rule_reason: null, message_id: null, smtp_message_id_header: '<m2@acme.test>', error_text: 'smtp 550', created_at: new Date('2026-07-12T00:00:00.000Z') },
      { id: 'sub-3', workspace_id: WS_A, relay_id: 'relay-a', status: 'relayed', recipient_count: 3, tracking_applied: false, tracking_rule_reason: null, message_id: 13, smtp_message_id_header: '<m3@acme.test>', error_text: null, created_at: new Date('2026-07-14T00:00:00.000Z') },
      { id: 'sub-other', workspace_id: WS_A, relay_id: 'relay-disabled', status: 'received', recipient_count: 1, tracking_applied: false, tracking_rule_reason: null, message_id: null, smtp_message_id_header: null, error_text: null, created_at: new Date('2026-07-15T00:00:00.000Z') },
    ];
    const port = makeAdminPort(tables);
    const items = await port.listSubmissions({ workspaceId: WS_A, relayId: 'relay-a', limit: 2 });

    expect(items).toEqual([
      {
        id: 'sub-3',
        status: 'relayed',
        recipientCount: 3,
        trackingApplied: false,
        trackingRuleReason: null,
        messageId: 13,
        smtpMessageIdHeader: '<m3@acme.test>',
        errorText: null,
        createdAt: '2026-07-14T00:00:00.000Z',
      },
      {
        id: 'sub-2',
        status: 'failed',
        recipientCount: 2,
        trackingApplied: false,
        trackingRuleReason: null,
        messageId: null,
        smtpMessageIdHeader: '<m2@acme.test>',
        errorText: 'smtp 550',
        createdAt: '2026-07-12T00:00:00.000Z',
      },
    ]);
  });

  test('returns null for an unknown relay', async () => {
    const port = makeAdminPort(seedTables());
    expect(await port.listSubmissions({ workspaceId: WS_A, relayId: 'nope', limit: 50 })).toBeNull();
  });
});
