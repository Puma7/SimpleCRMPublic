import type { Kysely } from 'kysely';

import type { MailPermission } from '@simplecrm/core';

import { createServerApi } from '../../packages/server/src/api/server-api';
import type { AuthenticatedPrincipal, ServerApiPorts } from '../../packages/server/src/api/types';
import { createPostgresEmailMessageReadPort } from '../../packages/server/src/db/postgres-mail-read-ports';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { createPostgresMailResourceLookupPort } from '../../packages/server/src/mail-access/postgres-mail-resource-lookup';
import { MailAccessService } from '../../packages/server/src/mail-access/service';
import type { MailAccessGrant } from '../../packages/server/src/mail-access/types';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000f1';
const OWNER_ID = '20000000-0000-4000-8000-0000000000f1';
const LIMITED_ID = '20000000-0000-4000-8000-0000000000f2';
const FULL_ID = '20000000-0000-4000-8000-0000000000f3';
const METADATA_ONLY_ID = '20000000-0000-4000-8000-0000000000f4';
const ACCOUNT_A = 7601;
const ACCOUNT_B = 7602;
const DRAFT_FOLDER_A = 7611;
const INBOX_B = 7621;
const HIDDEN_PARENT = 7701;
const DRAFT = 7702;
const ATTACHMENT_PATH = `${WORKSPACE_ID}/compose-drafts/${DRAFT}/geheim-vertrag.pdf`;

type Grants = Partial<Record<MailPermission, readonly number[]>>;

function accountGrants(accountIds: readonly number[] | undefined): MailAccessGrant[] {
  return (accountIds ?? []).map((accountId, index) => ({
    bindingId: accountId * 10 + index,
    resourceType: 'account' as const,
    accountId,
    folderId: null,
    messageId: null,
    constraints: null,
  }));
}

// LIMITED: triage/draft.edit/content.read on A, but no mail.attachment.read and no
// access to account B (where the draft's reply parent lives).
// FULL: additionally content.read on B and attachment.read on A.
// METADATA_ONLY: triage/draft.edit on A without mail.content.read.
const GRANTS_BY_USER: Record<string, Grants> = {
  [LIMITED_ID]: {
    'mail.triage': [ACCOUNT_A],
    'mail.draft.edit': [ACCOUNT_A],
    'mail.content.read': [ACCOUNT_A],
    'mail.metadata.read': [ACCOUNT_A],
  },
  [FULL_ID]: {
    'mail.triage': [ACCOUNT_A],
    'mail.draft.edit': [ACCOUNT_A],
    'mail.content.read': [ACCOUNT_A, ACCOUNT_B],
    'mail.metadata.read': [ACCOUNT_A, ACCOUNT_B],
    'mail.attachment.read': [ACCOUNT_A],
  },
  [METADATA_ONLY_ID]: {
    'mail.triage': [ACCOUNT_A],
    'mail.draft.edit': [ACCOUNT_A],
    'mail.metadata.read': [ACCOUNT_A],
  },
};

const MUTATIONS: ReadonlyArray<readonly [string, string, Record<string, unknown>]> = [
  ['customer-link', `/api/v1/email/messages/${DRAFT}/customer-link`, { customerId: null }],
  ['assignment', `/api/v1/email/messages/${DRAFT}/assignment`, { teamMemberId: null }],
  ['spam-status', `/api/v1/email/messages/${DRAFT}/spam-status`, { status: 'clean', train: false }],
  ['compose-draft', `/api/v1/email/messages/${DRAFT}/compose-draft`, {}],
];

type EchoedMessage = {
  id: number;
  snippet: string | null;
  draftAttachmentPathsJson: string | null;
  replyParentMessageId: number | null;
  bodyText?: string | null;
};

// C-A31, C-C9: Die vier Mail-Mutationsantworten (customer-link, assignment, spam-status,
// compose-draft) redigierten nur den Inhalt; Anhangpfade und die Reply-Parent-ID gingen
// auch an Delegierte ohne mail.attachment.read bzw. ohne Sicht auf die Eltern-Mail.
describe('mail mutation responses apply the GET projection for restricted delegates', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;
  let api: ReturnType<typeof createServerApi>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('mail-mutation-response-projection');
    const { admin } = postgres;
    await admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Mutation Projection')`, [WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_accounts (id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username)
      VALUES ($1, $3, $1, 'Support', 'support@example.test', 'imap.example.test', 'support'),
             ($2, $3, $2, 'Vorstand', 'vorstand@example.test', 'imap.example.test', 'vorstand')
    `, [ACCOUNT_A, ACCOUNT_B, WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_folders (id, workspace_id, source_sqlite_id, account_source_sqlite_id, account_id, path)
      VALUES ($1, $3, $1, $2, $2, 'Drafts'), ($4, $3, $4, $5, $5, 'INBOX')
    `, [DRAFT_FOLDER_A, ACCOUNT_A, WORKSPACE_ID, INBOX_B, ACCOUNT_B]);
    await admin.query(`
      INSERT INTO email_messages (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
        account_id, folder_id, uid, subject, body_text, folder_kind
      ) VALUES ($1, $2, $1, $3, $4, $3, $4, 91, 'Vertraulich', 'Nur Vorstand', 'inbox')
    `, [HIDDEN_PARENT, WORKSPACE_ID, ACCOUNT_B, INBOX_B]);
    await admin.query(`
      INSERT INTO email_messages (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
        account_id, folder_id, uid, subject, body_text, snippet, folder_kind,
        draft_attachment_paths_json, reply_parent_message_id
      ) VALUES ($1, $2, $1, $3, $4, $3, $4, $5, 'Antwort', 'Entwurfstext', 'Entwurfstext', 'draft', $6, $7)
    `, [
      DRAFT,
      WORKSPACE_ID,
      ACCOUNT_A,
      DRAFT_FOLDER_A,
      -DRAFT,
      JSON.stringify([{ path: ATTACHMENT_PATH, filename: 'geheim-vertrag.pdf' }]),
      HIDDEN_PARENT,
    ]);
    db = postgres.createApplicationDb();
    const mailAccess = new MailAccessService({
      async resolveGrants(request) {
        return accountGrants(GRANTS_BY_USER[request.userId]?.[request.permission]);
      },
    });
    api = createServerApi({
      auth: {} as ServerApiPorts['auth'],
      locks: {} as ServerApiPorts['locks'],
      mailAccess,
      mailResourceLookup: createPostgresMailResourceLookupPort({ db }),
      emailMessages: createPostgresEmailMessageReadPort({ db }),
    } as unknown as ServerApiPorts);
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  function principal(userId: string): AuthenticatedPrincipal {
    return { userId, workspaceId: WORKSPACE_ID, role: userId === OWNER_ID ? 'owner' : 'user' };
  }

  async function mutate(userId: string, path: string, body: Record<string, unknown>): Promise<EchoedMessage> {
    const response = await api.handle({ method: 'PATCH', path, principal: principal(userId), body });
    expect(response.status).toBe(200);
    const payload = (response.body as { data: EchoedMessage | { message: EchoedMessage } }).data;
    return 'message' in payload ? payload.message : payload;
  }

  async function fetchMessage(userId: string): Promise<EchoedMessage> {
    const response = await api.handle({
      method: 'GET',
      path: `/api/v1/email/messages/${DRAFT}`,
      query: { includeBody: 'true' },
      principal: principal(userId),
    });
    expect(response.status).toBe(200);
    return (response.body as { data: EchoedMessage }).data;
  }

  test.each(MUTATIONS)('%s hides attachment paths and a hidden reply parent like GET', async (_name, path, body) => {
    const echoed = await mutate(LIMITED_ID, path, body);
    const fetched = await fetchMessage(LIMITED_ID);

    expect(fetched.draftAttachmentPathsJson).toBeNull();
    expect(fetched.replyParentMessageId).toBeNull();
    expect(echoed.draftAttachmentPathsJson).toBeNull();
    expect(echoed.replyParentMessageId).toBeNull();
    // Content stays readable: the delegate holds mail.content.read on the draft.
    expect(echoed.snippet).toBe('Entwurfstext');
  });

  test.each(MUTATIONS)('%s keeps the full row for a delegate with attachment and parent access', async (_name, path, body) => {
    const echoed = await mutate(FULL_ID, path, body);

    expect(echoed.draftAttachmentPathsJson).toContain(ATTACHMENT_PATH);
    expect(echoed.replyParentMessageId).toBe(HIDDEN_PARENT);
    expect(echoed.snippet).toBe('Entwurfstext');
  });

  test.each(MUTATIONS)('%s keeps the full row for the owner', async (_name, path, body) => {
    const echoed = await mutate(OWNER_ID, path, body);

    expect(echoed.draftAttachmentPathsJson).toContain(ATTACHMENT_PATH);
    expect(echoed.replyParentMessageId).toBe(HIDDEN_PARENT);
  });

  test.each(MUTATIONS)('%s still redacts content for a delegate without mail.content.read', async (name, path, body) => {
    const echoed = await mutate(METADATA_ONLY_ID, path, body);

    expect(echoed.snippet).toBeNull();
    expect(echoed.draftAttachmentPathsJson).toBeNull();
    expect(echoed.replyParentMessageId).toBeNull();
    if (name === 'compose-draft') expect(echoed.bodyText).toBeNull();
  });
});
