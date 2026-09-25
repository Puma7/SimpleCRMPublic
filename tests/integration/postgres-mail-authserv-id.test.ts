import type { Kysely } from 'kysely';

import { createServerApi } from '../../packages/server/src/api/server-api';
import type { AuthenticatedPrincipal, EmailMessageApiPort, ServerApiPorts } from '../../packages/server/src/api/types';
import {
  createPostgresEmailAccountReadPort,
  createPostgresEmailMessageReadPort,
} from '../../packages/server/src/db/postgres-mail-read-ports';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { createPostgresMailResourceLookupPort } from '../../packages/server/src/mail-access/postgres-mail-resource-lookup';
import { MailAccessService } from '../../packages/server/src/mail-access/service';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));
// Live SPF/DKIM/DMARC always "fails" here, so every result below comes from the
// Authentication-Results fallback under test.
jest.mock('mailauth', () => ({
  authenticate: jest.fn(async () => {
    throw new Error('DNS nicht erreichbar');
  }),
}));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000e6';
const ADMIN_ID = '20000000-0000-4000-8000-0000000000e6';
const ACCOUNT_ID = 6101;
const POP3_ACCOUNT_ID = 6102;
const FOLDER_ID = 6201;
const POP3_FOLDER_ID = 6202;

const INJECTED_ONLY = [
  'Authentication-Results: evil.example; spf=pass smtp.mailfrom=kunde.de; dkim=pass; dmarc=pass',
  'Received: from attacker.example (attacker.example [192.0.2.1]) by mx.provider.example',
  'From: chef@kunde.de',
  'Subject: Neue Bankverbindung',
].join('\r\n');

const PROVIDER_THEN_INJECTED = [
  'Authentication-Results: mx01.provider.example; spf=fail smtp.mailfrom=kunde.de; dkim=none; dmarc=fail',
  'Received: from attacker.example (attacker.example [192.0.2.1]) by mx01.provider.example',
  'Authentication-Results: evil.example; spf=pass; dkim=pass; dmarc=pass',
  'From: chef@kunde.de',
  'Subject: Neue Bankverbindung',
].join('\r\n');

const GMAIL_HEADER = [
  'Authentication-Results: mx.google.com;',
  ' spf=pass smtp.mailfrom=partner.example; dkim=pass header.d=partner.example; dmarc=pass',
  'From: info@partner.example',
  'Subject: Angebot',
].join('\r\n');

// F-A5-12 (E6): when live checks failed, the fallback took SPF/DKIM/DMARC from
// the topmost Authentication-Results field whatever its authserv-id; without a
// field of the own MTA that was the one the sender injected.
describe('Authentication-Results fallback trusts only the account authserv-id', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;
  let messages: EmailMessageApiPort;
  let api: ReturnType<typeof createServerApi>;
  let nextMessageId = 6300;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('mail-authserv-id');
    const { admin } = postgres;
    await admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Authserv Test')`, [WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_accounts (id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username)
      VALUES ($1, $2, $1, 'Info', 'info@provider.example', 'imap.provider.example', 'info')
    `, [ACCOUNT_ID, WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_accounts (
        id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username, protocol, pop3_host
      ) VALUES ($1, $2, $1, 'Pop', 'pop@other.example', '', 'pop', 'pop3', 'pop.other.example')
    `, [POP3_ACCOUNT_ID, WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_folders (id, workspace_id, source_sqlite_id, account_source_sqlite_id, account_id, path)
      VALUES ($1, $3, $1, $2, $2, 'INBOX'), ($4, $3, $4, $5, $5, 'INBOX')
    `, [FOLDER_ID, ACCOUNT_ID, WORKSPACE_ID, POP3_FOLDER_ID, POP3_ACCOUNT_ID]);
    db = postgres.createApplicationDb();
    messages = createPostgresEmailMessageReadPort({ db });
    api = createServerApi({
      auth: {} as ServerApiPorts['auth'],
      locks: {} as ServerApiPorts['locks'],
      mailAccess: new MailAccessService({ async resolveGrants() { return []; } }),
      mailResourceLookup: createPostgresMailResourceLookupPort({ db }),
      emailAccounts: createPostgresEmailAccountReadPort({ db }),
    } as unknown as ServerApiPorts);
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  beforeEach(async () => {
    await postgres.admin.query(
      'UPDATE email_accounts SET trusted_authserv_id = NULL WHERE workspace_id = $1',
      [WORKSPACE_ID],
    );
  });

  function admin(): AuthenticatedPrincipal {
    return { userId: ADMIN_ID, workspaceId: WORKSPACE_ID, role: 'owner' };
  }

  async function checkMessage(rawHeaders: string, accountId = ACCOUNT_ID) {
    nextMessageId += 1;
    const folderId = accountId === ACCOUNT_ID ? FOLDER_ID : POP3_FOLDER_ID;
    await postgres.admin.query(`
      INSERT INTO email_messages (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
        account_id, folder_id, uid, subject, raw_headers, body_text
      ) VALUES ($1, $2, $1, $3, $4, $3, $4, $1, 'Test', $5, 'Hallo')
    `, [nextMessageId, WORKSPACE_ID, accountId, folderId, rawHeaders]);
    await messages.runSecurityCheck!({
      workspaceId: WORKSPACE_ID,
      messageId: nextMessageId,
      values: { applyStatus: false },
    });
    const result = await postgres.admin.query<{ auth_spf: string; auth_dkim: string; auth_dmarc: string }>(
      'SELECT auth_spf, auth_dkim, auth_dmarc FROM email_messages WHERE workspace_id = $1 AND id = $2',
      [WORKSPACE_ID, nextMessageId],
    );
    return result.rows[0];
  }

  test('migration adds the nullable trusted_authserv_id column', async () => {
    const result = await postgres.admin.query<{ data_type: string; is_nullable: string }>(`
      SELECT data_type, is_nullable FROM information_schema.columns
       WHERE table_name = 'email_accounts' AND column_name = 'trusted_authserv_id'
    `);
    expect(result.rows).toEqual([{ data_type: 'text', is_nullable: 'YES' }]);
  });

  test('ignores a sender-injected field when the own MTA added none', async () => {
    expect(await checkMessage(INJECTED_ONLY)).toEqual({ auth_spf: 'unknown', auth_dkim: 'unknown', auth_dmarc: 'unknown' });
  });

  test('uses the field of the incoming server domain by default', async () => {
    expect(await checkMessage(PROVIDER_THEN_INJECTED)).toEqual({ auth_spf: 'fail', auth_dkim: 'none', auth_dmarc: 'fail' });
  });

  test('POP3 accounts default to the POP3 host domain', async () => {
    const header = PROVIDER_THEN_INJECTED.replace(/mx01\.provider\.example/g, 'mx.other.example');
    expect(await checkMessage(header, POP3_ACCOUNT_ID)).toEqual({ auth_spf: 'fail', auth_dkim: 'none', auth_dmarc: 'fail' });
  });

  test('a configured authserv-id replaces the default', async () => {
    expect(await checkMessage(GMAIL_HEADER)).toEqual({ auth_spf: 'unknown', auth_dkim: 'unknown', auth_dmarc: 'unknown' });

    const saved = await api.handle({
      method: 'PATCH',
      path: `/api/v1/email/accounts/${ACCOUNT_ID}`,
      principal: admin(),
      body: { trustedAuthservId: ' MX.Google.com ' },
    });
    expect(saved).toMatchObject({ status: 200, body: { data: { account: { trustedAuthservId: 'mx.google.com' } } } });

    expect(await checkMessage(GMAIL_HEADER)).toEqual({ auth_spf: 'pass', auth_dkim: 'pass', auth_dmarc: 'pass' });
    expect(await checkMessage(PROVIDER_THEN_INJECTED)).toEqual({ auth_spf: 'unknown', auth_dkim: 'unknown', auth_dmarc: 'unknown' });
  });

  test('the API validates and clears the setting', async () => {
    const invalid = await api.handle({
      method: 'PATCH',
      path: `/api/v1/email/accounts/${ACCOUNT_ID}`,
      principal: admin(),
      body: { trustedAuthservId: 'evil.example; spf=pass' },
    });
    expect(invalid).toMatchObject({ status: 400, body: { error: { code: 'validation_error' } } });

    await postgres.admin.query(
      'UPDATE email_accounts SET trusted_authserv_id = $1 WHERE workspace_id = $2 AND id = $3',
      ['mx.google.com', WORKSPACE_ID, ACCOUNT_ID],
    );
    const cleared = await api.handle({
      method: 'PATCH',
      path: `/api/v1/email/accounts/${ACCOUNT_ID}`,
      principal: admin(),
      body: { trustedAuthservId: '' },
    });
    expect(cleared).toMatchObject({ status: 200, body: { data: { account: { trustedAuthservId: null } } } });
  });
});
