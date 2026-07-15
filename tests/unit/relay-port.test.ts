import { createHash } from 'node:crypto';

import { createPostgresSmtpRelayPort } from '../../packages/server/src/db/postgres-relay-port';

// Two real UUIDs — withWorkspaceTransaction validates workspaceId shape.
const WS_A = '11111111-1111-4111-8111-111111111111';
const WS_B = '22222222-2222-4222-8222-222222222222';

function hash(password: string): string {
  return `sha256:${createHash('sha256').update(password, 'utf8').digest('hex')}`;
}

type Tables = {
  smtp_relays: Record<string, unknown>[];
  smtp_relay_credentials: Record<string, unknown>[];
  smtp_relay_allowed_accounts: Record<string, unknown>[];
  email_accounts: Record<string, unknown>[];
};

function seedTables(): Tables {
  return {
    smtp_relays: [
      { id: 'relay-a', workspace_id: WS_A, enabled: true, tracking_mode: 'rule', tracking_subject_patterns: 'invoice', allow_header_override: true, max_recipients: 50, max_message_bytes: 10_485_760, rate_limit_per_min: 60, allow_arbitrary_recipients: false, followup_workflow_id: 7 },
      { id: 'relay-disabled', workspace_id: WS_A, enabled: false, tracking_mode: 'always', tracking_subject_patterns: null, allow_header_override: false, max_recipients: 10, max_message_bytes: 1_000, rate_limit_per_min: 5, allow_arbitrary_recipients: true, followup_workflow_id: null },
      { id: 'relay-b', workspace_id: WS_B, enabled: true, tracking_mode: 'off', tracking_subject_patterns: null, allow_header_override: false, max_recipients: 20, max_message_bytes: 2_000, rate_limit_per_min: 10, allow_arbitrary_recipients: false, followup_workflow_id: null },
    ],
    smtp_relay_credentials: [
      { id: 'cred-a', workspace_id: WS_A, relay_id: 'relay-a', username: 'relay-a-user', password_hash: hash('secretA'), revoked_at: null, last_used_at: null },
      { id: 'cred-revoked', workspace_id: WS_A, relay_id: 'relay-a', username: 'revoked-user', password_hash: hash('secretR'), revoked_at: new Date('2026-01-01T00:00:00.000Z'), last_used_at: null },
      { id: 'cred-disabled', workspace_id: WS_A, relay_id: 'relay-disabled', username: 'disabled-user', password_hash: hash('secretD'), revoked_at: null, last_used_at: null },
      { id: 'cred-b', workspace_id: WS_B, relay_id: 'relay-b', username: 'relay-b-user', password_hash: hash('secretB'), revoked_at: null, last_used_at: null },
    ],
    smtp_relay_allowed_accounts: [
      { id: 'al-1', workspace_id: WS_A, relay_id: 'relay-a', account_id: 100, from_address: null },
      { id: 'al-2', workspace_id: WS_A, relay_id: 'relay-a', account_id: 101, from_address: 'noreply@acme.test' },
    ],
    email_accounts: [
      { id: 100, workspace_id: WS_A, source_sqlite_id: 100, display_name: 'Sales', email_address: 'sales@acme.test', protocol: 'imap', smtp_host: 'smtp.acme.test', smtp_port: 587, smtp_tls: true, smtp_username: 'sales', smtp_use_imap_auth: false, smtp_keytar_account_key: null, smtp_password_secret_id: 'secret-sales', imap_username: 'sales', keytar_account_key: null, imap_password_secret_id: null, oauth_provider: null, oauth_refresh_keytar_key: null, oauth_refresh_secret_id: null },
      { id: 101, workspace_id: WS_A, source_sqlite_id: 101, display_name: 'Support', email_address: 'support@acme.test', protocol: 'imap', smtp_host: 'smtp.acme.test', smtp_port: 465, smtp_tls: true, smtp_username: 'support', smtp_use_imap_auth: true, smtp_keytar_account_key: null, smtp_password_secret_id: 'secret-support', imap_username: 'support', keytar_account_key: null, imap_password_secret_id: null, oauth_provider: null, oauth_refresh_keytar_key: null, oauth_refresh_secret_id: null },
    ],
  };
}

// --- Minimal in-memory Kysely fake -----------------------------------------
// Mirrors returns-portal-port.test.ts: a hand-rolled query builder that records
// the base table, joins, and wheres, then evaluates them against seeded arrays.

function parseSpec(spec: string): { table: string; alias: string } {
  const parts = spec.split(/\s+as\s+/i);
  return { table: parts[0]!, alias: (parts[1] ?? parts[0]!) };
}

function parseColumn(col: string, baseAlias: string): { alias: string; column: string } {
  const dot = col.indexOf('.');
  if (dot < 0) return { alias: baseAlias, column: col };
  return { alias: col.slice(0, dot), column: col.slice(dot + 1) };
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

function makeTrx(tables: Tables) {
  const table = (name: string): Record<string, unknown>[] => (tables as unknown as Record<string, Record<string, unknown>[]>)[name] ?? [];

  const select = (baseSpec: string) => {
    const base = parseSpec(baseSpec);
    const joins: Array<{ table: string; alias: string; conds: Array<[string, string]> }> = [];
    const wheres: Array<{ col: string; op: string; val: unknown }> = [];
    const b: Record<string, unknown> = {};
    b.innerJoin = (spec: string, cb: (j: unknown) => unknown) => {
      const j = parseSpec(spec);
      const conds: Array<[string, string]> = [];
      const jb = { onRef: (l: string, _op: string, r: string) => { conds.push([l, r]); return jb; } };
      cb(jb);
      joins.push({ table: j.table, alias: j.alias, conds });
      return b;
    };
    b.select = () => b;
    b.selectAll = () => b;
    b.where = (col: string, op: string, val: unknown) => { wheres.push({ col, op, val }); return b; };

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
      return rows.filter((row) => whereMatches(row, wheres, base.alias));
    };

    const project = (row: Record<string, Record<string, unknown>>): Record<string, unknown> => {
      if (base.table === 'smtp_relay_credentials') {
        const cred = row[base.alias]!;
        return { credential_id: cred.id, workspace_id: cred.workspace_id, relay_id: cred.relay_id };
      }
      if (base.table === 'smtp_relay_allowed_accounts') {
        const allowed = row[base.alias]!;
        const acct = row.acct!;
        return { allowed_from_address: allowed.from_address, ...acct };
      }
      return { ...row[base.alias]! };
    };

    b.execute = async () => combined().map(project);
    b.executeTakeFirst = async () => combined().map(project)[0];
    return b;
  };

  const update = (name: string) => {
    let pendingSet: Record<string, unknown> = {};
    const wheres: Array<{ col: string; op: string; val: unknown }> = [];
    const b: Record<string, unknown> = {};
    b.set = (set: Record<string, unknown>) => { pendingSet = set; return b; };
    b.where = (col: string, op: string, val: unknown) => { wheres.push({ col, op, val }); return b; };
    b.execute = async () => {
      for (const row of table(name)) {
        if (whereMatches({ [name]: row }, wheres, name)) Object.assign(row, pendingSet);
      }
      return [];
    };
    return b;
  };

  return {
    selectFrom: (spec: string) => select(spec),
    updateTable: (name: string) => update(name),
  };
}

function makePort(tables: Tables, now?: () => Date) {
  const trx = makeTrx(tables);
  const db = { transaction: () => ({ execute: async (cb: (t: typeof trx) => Promise<unknown>) => cb(trx) }) } as never;
  return createPostgresSmtpRelayPort({ db, applyWorkspaceSession: async () => {}, now });
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
});
