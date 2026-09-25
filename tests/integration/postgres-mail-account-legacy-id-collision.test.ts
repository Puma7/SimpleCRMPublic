import type { Kysely } from 'kysely';

import type { MailPermission } from '@simplecrm/core';

import { createServerApi } from '../../packages/server/src/api/server-api';
import type { AuthenticatedPrincipal, ServerApiPorts } from '../../packages/server/src/api/types';
import { createPostgresEmailAccountReadPort } from '../../packages/server/src/db/postgres-mail-read-ports';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { createPostgresMailResourceLookupPort } from '../../packages/server/src/mail-access/postgres-mail-resource-lookup';
import { MailAccessService } from '../../packages/server/src/mail-access/service';
import type { MailAccessGrant } from '../../packages/server/src/mail-access/types';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000f5';
const OWNER_ID = '20000000-0000-4000-8000-0000000000f5';
const ACCOUNT_DELEGATE_ID = '20000000-0000-4000-8000-0000000000f6';
const FOLDER_DELEGATE_ID = '20000000-0000-4000-8000-0000000000f7';
const LEGACY_DELEGATE_ID = '20000000-0000-4000-8000-0000000000f8';
// Server-created account A: postgres id 7801, negative legacy id.
const ACCOUNT_A = 7801;
const FOLDER_A = 7811;
// Migrated account B: its legacy (public) id collides with A's postgres id.
const ACCOUNT_B = 7802;
// Migrated account C without a collision, addressed by its legacy id.
const ACCOUNT_C = 7803;
const LEGACY_ID_C = 42;
// Server-created account D, reached by a folder-only delegate as a parent.
const ACCOUNT_D = 7804;
const FOLDER_D = 7814;

function grant(resourceType: 'account' | 'folder', accountId: number, folderId: number | null): MailAccessGrant {
  return resourceType === 'account'
    ? { bindingId: accountId, resourceType, accountId, folderId: null, messageId: null, constraints: null }
    : { bindingId: folderId!, resourceType, accountId, folderId: folderId!, messageId: null, constraints: null };
}

const GRANTS_BY_USER: Record<string, Partial<Record<MailPermission, readonly MailAccessGrant[]>>> = {
  [ACCOUNT_DELEGATE_ID]: { 'mail.metadata.read': [grant('account', ACCOUNT_A, null)] },
  [FOLDER_DELEGATE_ID]: {
    'mail.metadata.read': [grant('folder', ACCOUNT_A, FOLDER_A), grant('folder', ACCOUNT_D, FOLDER_D)],
  },
  [LEGACY_DELEGATE_ID]: { 'mail.metadata.read': [grant('account', ACCOUNT_C, null)] },
};

type AccountBody = { data?: { id: number; displayName: string; emailAddress: string; imapHost: string } };

// C-A67: GET /accounts/:id pruefte die URL-Zahl als Postgres-ID, der Read-Port las sie aber
// zuerst als Legacy-ID; bei einer Kollision bekam ein Delegierter von Konto A die Identitaet
// des migrierten Kontos B (redigiert) ausgeliefert.
describe('GET /api/v1/email/accounts/:accountId with colliding legacy account ids', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;
  let api: ReturnType<typeof createServerApi>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('mail-account-legacy-id-collision');
    const { admin } = postgres;
    await admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Legacy Id Collision')`, [WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_accounts (id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username)
      VALUES ($1, $5, -$1::bigint, 'Support', 'support@example.test', 'imap.support.test', 'support'),
             ($2, $5, $1, 'Vorstand', 'vorstand@example.test', 'imap.vorstand.test', 'vorstand'),
             ($3, $5, $6, 'Vertrieb', 'vertrieb@example.test', 'imap.vertrieb.test', 'vertrieb'),
             ($4, $5, -$4::bigint, 'Buchhaltung', 'buchhaltung@example.test', 'imap.buchhaltung.test', 'buchhaltung')
    `, [ACCOUNT_A, ACCOUNT_B, ACCOUNT_C, ACCOUNT_D, WORKSPACE_ID, LEGACY_ID_C]);
    await admin.query(`
      INSERT INTO email_folders (id, workspace_id, source_sqlite_id, account_source_sqlite_id, account_id, path)
      VALUES ($1, $3, $1, -$2::bigint, $2, 'INBOX'), ($4, $3, $4, -$5::bigint, $5, 'INBOX')
    `, [FOLDER_A, ACCOUNT_A, WORKSPACE_ID, FOLDER_D, ACCOUNT_D]);
    db = postgres.createApplicationDb();
    const mailAccess = new MailAccessService({
      async resolveGrants(request) {
        return GRANTS_BY_USER[request.userId]?.[request.permission] ?? [];
      },
    });
    api = createServerApi({
      auth: {} as ServerApiPorts['auth'],
      locks: {} as ServerApiPorts['locks'],
      mailAccess,
      mailResourceLookup: createPostgresMailResourceLookupPort({ db }),
      emailAccounts: createPostgresEmailAccountReadPort({ db }),
    } as unknown as ServerApiPorts);
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  async function getAccount(userId: string, accountId: number) {
    const principal: AuthenticatedPrincipal = {
      userId,
      workspaceId: WORKSPACE_ID,
      role: userId === OWNER_ID ? 'owner' : 'user',
    };
    const response = await api.handle({ method: 'GET', path: `/api/v1/email/accounts/${accountId}`, principal });
    return { status: response.status, body: response.body as AccountBody };
  }

  test.each([
    ['a direct account grant on A', ACCOUNT_DELEGATE_ID],
    ['a folder grant under A', FOLDER_DELEGATE_ID],
    ['the owner', OWNER_ID],
  ])('an ambiguous id is rejected for %s and never returns the other mailbox', async (_label, userId) => {
    const response = await getAccount(userId, ACCOUNT_A);

    expect(JSON.stringify(response.body)).not.toContain('vorstand@example.test');
    expect(response.status).toBe(404);
  });

  test('a delegate with a direct grant still reads a migrated account by its legacy id', async () => {
    const response = await getAccount(LEGACY_DELEGATE_ID, LEGACY_ID_C);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ id: ACCOUNT_C, emailAddress: 'vertrieb@example.test', imapHost: 'imap.vertrieb.test' });
  });

  test('a folder-only delegate still reads the redacted parent of an unambiguous account', async () => {
    const response = await getAccount(FOLDER_DELEGATE_ID, ACCOUNT_D);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ id: ACCOUNT_D, emailAddress: 'buchhaltung@example.test' });
    expect(response.body.data?.imapHost).not.toBe('imap.buchhaltung.test');
  });

  test('the owner still reads unambiguous accounts by postgres or legacy id', async () => {
    expect((await getAccount(OWNER_ID, ACCOUNT_B)).body.data).toMatchObject({ id: ACCOUNT_B });
    expect((await getAccount(OWNER_ID, LEGACY_ID_C)).body.data).toMatchObject({ id: ACCOUNT_C });
    expect((await getAccount(OWNER_ID, ACCOUNT_D)).body.data).toMatchObject({ id: ACCOUNT_D, imapHost: 'imap.buchhaltung.test' });
  });
});
