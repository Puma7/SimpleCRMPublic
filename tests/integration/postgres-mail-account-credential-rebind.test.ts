import type { Kysely } from 'kysely';

import { createServerApi } from '../../packages/server/src/api/server-api';
import type { AuthenticatedPrincipal, ServerApiPorts } from '../../packages/server/src/api/types';
import { createPostgresEmailAccountReadPort } from '../../packages/server/src/db/postgres-mail-read-ports';
import { createPostgresSecretPort, type PostgresSecretPort } from '../../packages/server/src/db/postgres-secret-port';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { createPostgresMailResourceLookupPort } from '../../packages/server/src/mail-access/postgres-mail-resource-lookup';
import { MailAccessService } from '../../packages/server/src/mail-access/service';
import { parseBase64MasterKey } from '../../packages/server/src/security/master-key';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000c4';
const DELEGATE_USER_ID = '10000000-0000-4000-8000-0000000000c5';
const PASSWORD_ACCOUNT = 4101;
const SEPARATE_SMTP_ACCOUNT = 4102;
const OAUTH_ACCOUNT = 4103;
const IMPORTED_ACCOUNT = 4104;
const MANAGED_ACCOUNTS = [PASSWORD_ACCOUNT, SEPARATE_SMTP_ACCOUNT, OAUTH_ACCOUNT, IMPORTED_ACCOUNT];

// F-A2a-01 / F-A4-01: the stored IMAP/SMTP secret (or OAuth token) is bound
// only to the account id. A delegated account manager (mail.account.manage)
// could PATCH imapHost/smtpHost/pop3Host without re-entering the password, and
// the next sync or send presented the stored secret to the new host.
describe('email account update requires fresh credentials when an endpoint changes', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;
  let secrets: PostgresSecretPort;
  let api: ReturnType<typeof createServerApi>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('mail-credential-rebind');
    await postgres.admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Credential Rebind Test')`, [WORKSPACE_ID]);
    db = postgres.createApplicationDb();
    secrets = createPostgresSecretPort({
      db,
      key: parseBase64MasterKey(Buffer.alloc(32, 7).toString('base64')),
    });
    const mailAccess = new MailAccessService({
      async resolveGrants(request) {
        if (request.permission !== 'mail.account.manage') return [];
        return MANAGED_ACCOUNTS.map((accountId) => ({
          resourceType: 'account' as const,
          accountId,
          folderId: null,
          messageId: null,
        }));
      },
    });
    api = createServerApi({
      auth: {} as ServerApiPorts['auth'],
      locks: {} as ServerApiPorts['locks'],
      mailAccess,
      mailResourceLookup: createPostgresMailResourceLookupPort({ db }),
      emailAccounts: createPostgresEmailAccountReadPort({ db, secrets }),
    } as unknown as ServerApiPorts);
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  beforeEach(async () => {
    await postgres.admin.query('DELETE FROM email_accounts WHERE workspace_id = $1', [WORKSPACE_ID]);
    await postgres.admin.query('DELETE FROM secrets WHERE workspace_id = $1', [WORKSPACE_ID]);
    await seedAccount(PASSWORD_ACCOUNT, { imapSecret: 'stored-imap-secret' });
    await seedAccount(SEPARATE_SMTP_ACCOUNT, {
      imapSecret: 'stored-imap-secret',
      smtpSecret: 'stored-smtp-secret',
      smtpUseImapAuth: false,
    });
    await seedAccount(OAUTH_ACCOUNT, { oauthRefreshToken: 'stored-refresh-token' });
    await seedAccount(IMPORTED_ACCOUNT, { imapSecret: 'stored-imap-secret', nullPorts: true });
  });

  function delegate(): AuthenticatedPrincipal {
    return { userId: DELEGATE_USER_ID, workspaceId: WORKSPACE_ID, role: 'user' };
  }

  async function patch(accountId: number, body: Record<string, unknown>) {
    return api.handle({
      method: 'PATCH',
      path: `/api/v1/email/accounts/${accountId}`,
      principal: delegate(),
      body,
    });
  }

  async function storedEndpoints(accountId: number) {
    const result = await postgres.admin.query<{
      imap_host: string;
      imap_port: number;
      imap_tls: boolean;
      smtp_host: string | null;
      smtp_port: number | null;
      pop3_host: string | null;
    }>(
      `SELECT imap_host, imap_port, imap_tls, smtp_host, smtp_port, pop3_host
         FROM email_accounts WHERE workspace_id = $1 AND id = $2`,
      [WORKSPACE_ID, accountId],
    );
    return result.rows[0];
  }

  async function readStoredSecret(accountId: number, kind: 'imap' | 'smtp'): Promise<string | null> {
    const secret = await secrets.readSecret({
      workspaceId: WORKSPACE_ID,
      kind: kind === 'imap' ? 'email.account.imap_password' : 'email.account.smtp_password',
      name: `email_account:${accountId}:${kind}`,
    });
    return secret?.toString('utf8') ?? null;
  }

  async function seedAccount(
    accountId: number,
    options: Readonly<{
      imapSecret?: string;
      smtpSecret?: string;
      oauthRefreshToken?: string;
      smtpUseImapAuth?: boolean;
      nullPorts?: boolean;
    }>,
  ): Promise<void> {
    await postgres.admin.query(`
      INSERT INTO email_accounts (
        id, workspace_id, source_sqlite_id, display_name, email_address,
        imap_host, imap_port, imap_tls, imap_username,
        smtp_host, smtp_port, smtp_tls, smtp_username, smtp_use_imap_auth,
        protocol, pop3_host, pop3_port, pop3_tls, oauth_provider
      ) VALUES (
        $1, $2, $1, 'Shared mailbox', 'info@legit.example',
        'imap.legit.example', 993, true, 'info@legit.example',
        'smtp.legit.example', $3, true, 'info@legit.example', $4,
        'imap', NULL, $5, true, $6
      )
    `, [
      accountId,
      WORKSPACE_ID,
      options.nullPorts ? null : 587,
      options.smtpUseImapAuth ?? true,
      options.nullPorts ? null : 995,
      options.oauthRefreshToken ? 'google' : null,
    ]);
    const writes: Array<[string, string, string, string | undefined]> = [
      ['imap_password_secret_id', 'email.account.imap_password', 'imap', options.imapSecret],
      ['smtp_password_secret_id', 'email.account.smtp_password', 'smtp', options.smtpSecret],
      ['oauth_refresh_secret_id', 'email.account.oauth_refresh_token', 'oauth_refresh', options.oauthRefreshToken],
    ];
    for (const [column, kind, suffix, value] of writes) {
      if (value === undefined) continue;
      const secret = await secrets.writeSecret({
        workspaceId: WORKSPACE_ID,
        kind,
        name: `email_account:${accountId}:${suffix}`,
        value,
      });
      await postgres.admin.query(
        `UPDATE email_accounts SET ${column} = $1 WHERE workspace_id = $2 AND id = $3`,
        [secret.id, WORKSPACE_ID, accountId],
      );
    }
  }

  test.each([
    ['IMAP host', { imapHost: 'imap.attacker.example' }, 'imapPassword'],
    ['IMAP port', { imapPort: 143 }, 'imapPassword'],
    ['IMAP TLS', { imapTls: false }, 'imapPassword'],
    ['SMTP host (Anmeldung wie IMAP)', { smtpHost: 'smtp.attacker.example' }, 'imapPassword'],
    ['SMTP port', { smtpPort: 25 }, 'imapPassword'],
    ['SMTP TLS', { smtpTls: false }, 'imapPassword'],
    ['POP3 host', { pop3Host: 'pop.attacker.example' }, 'imapPassword'],
    ['POP3 port', { pop3Port: 110 }, 'imapPassword'],
    ['POP3 TLS', { pop3Tls: false }, 'imapPassword'],
  ])('rejects a %s change without a fresh password and leaves the account untouched', async (_label, body, field) => {
    const before = await storedEndpoints(PASSWORD_ACCOUNT);

    const response = await patch(PASSWORD_ACCOUNT, { displayName: 'Umgebogen', ...body });

    expect(response).toMatchObject({
      status: 400,
      body: {
        error: {
          code: 'email_account_credentials_required',
          message: expect.stringContaining('Zugangsdaten bei Serverwechsel neu eingeben'),
          details: { fields: [expect.objectContaining({ field })] },
        },
      },
    });
    expect(await storedEndpoints(PASSWORD_ACCOUNT)).toEqual(before);
  });

  test('an SMTP password does not unlock an SMTP change while SMTP logs in with the IMAP password', async () => {
    const response = await patch(PASSWORD_ACCOUNT, {
      smtpHost: 'smtp.attacker.example',
      smtpPassword: 'attacker-chosen',
    });

    expect(response).toMatchObject({ status: 400, body: { error: { code: 'email_account_credentials_required' } } });
    expect((await storedEndpoints(PASSWORD_ACCOUNT)).smtp_host).toBe('smtp.legit.example');
  });

  test('an IMAP password does not unlock an SMTP change for a separate SMTP login', async () => {
    const response = await patch(SEPARATE_SMTP_ACCOUNT, {
      smtpHost: 'smtp.attacker.example',
      imapPassword: 'attacker-chosen',
    });

    expect(response).toMatchObject({
      status: 400,
      body: { error: { code: 'email_account_credentials_required', details: { fields: [expect.objectContaining({ field: 'smtpPassword' })] } } },
    });
    expect(await readStoredSecret(SEPARATE_SMTP_ACCOUNT, 'smtp')).toBe('stored-smtp-secret');
    expect(await readStoredSecret(SEPARATE_SMTP_ACCOUNT, 'imap')).toBe('stored-imap-secret');
  });

  test('rejects a host change on an OAuth account without a new credential', async () => {
    const response = await patch(OAUTH_ACCOUNT, { imapHost: 'imap.attacker.example', imapTls: false, imapPort: 143 });

    expect(response).toMatchObject({ status: 400, body: { error: { code: 'email_account_credentials_required' } } });
    expect((await storedEndpoints(OAUTH_ACCOUNT)).imap_host).toBe('imap.legit.example');
  });

  test('allows an endpoint change together with the fresh password for that protocol', async () => {
    const imap = await patch(PASSWORD_ACCOUNT, {
      imapHost: 'imap.new.example',
      imapPort: 143,
      imapTls: false,
      imapPassword: 'fresh-imap-secret',
    });
    expect(imap.status).toBe(200);
    expect(await storedEndpoints(PASSWORD_ACCOUNT)).toMatchObject({ imap_host: 'imap.new.example', imap_port: 143, imap_tls: false });
    expect(await readStoredSecret(PASSWORD_ACCOUNT, 'imap')).toBe('fresh-imap-secret');

    const smtp = await patch(SEPARATE_SMTP_ACCOUNT, { smtpHost: 'smtp.new.example', smtpPassword: 'fresh-smtp-secret' });
    expect(smtp.status).toBe(200);
    expect((await storedEndpoints(SEPARATE_SMTP_ACCOUNT)).smtp_host).toBe('smtp.new.example');
    expect(await readStoredSecret(SEPARATE_SMTP_ACCOUNT, 'smtp')).toBe('fresh-smtp-secret');
  });

  test('accepts the full unchanged endpoint set the settings forms send with every save', async () => {
    // The account form and the SMTP panel always send host, port and TLS. Equal
    // values (host case/whitespace, NULL ports read as their 587/995 defaults)
    // are no endpoint change and must not demand a password.
    const response = await patch(IMPORTED_ACCOUNT, {
      displayName: 'Neuer Name',
      imapHost: ' IMAP.legit.example ',
      imapPort: 993,
      imapTls: true,
      smtpHost: 'smtp.legit.example',
      smtpPort: 587,
      smtpTls: true,
      smtpUseImapAuth: true,
      pop3Host: null,
      pop3Port: 995,
      pop3Tls: true,
    });

    expect(response.status).toBe(200);
    expect(await readStoredSecret(IMPORTED_ACCOUNT, 'imap')).toBe('stored-imap-secret');
  });
});
