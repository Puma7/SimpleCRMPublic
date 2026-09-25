import type { Kysely } from 'kysely';

import type { EmailComposeSendInput } from '../../packages/server/src/api/types';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import {
  createPostgresScheduledSendJobPort,
  startScheduledSendTicker,
} from '../../packages/server/src/mail-scheduled-send';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000f1';
const ACCOUNT_ID = 901;
const FOLDER_ID = 911;
const USER_ID = 'scheduled-send-user';

describe('scheduled-send claim recovery', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('scheduled-send-claim-recovery');
    const { admin } = postgres;
    await admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Scheduled Send Claims')`, [WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_accounts (id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username)
      VALUES ($1, $2, $1, 'Support', 'support@example.test', 'imap.example.test', 'support')
    `, [ACCOUNT_ID, WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_folders (id, workspace_id, source_sqlite_id, account_source_sqlite_id, account_id, path)
      VALUES ($1, $2, $1, $3, $3, 'Drafts')
    `, [FOLDER_ID, WORKSPACE_ID, ACCOUNT_ID]);
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  async function insertDraft(id: number, scheduledSendAt: string | null): Promise<void> {
    await postgres.admin.query(`
      INSERT INTO email_messages (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
        account_id, folder_id, uid, subject, body_text, to_json, folder_kind,
        scheduled_send_at, scheduled_send_actor_user_id
      ) VALUES (
        $1, $2, $1, $3, $4, $3, $4, -($1::bigint), 'Geplant', 'Hallo',
        '{"value":[{"address":"kunde@example.test"}]}'::jsonb, 'draft', $5, $6
      )
    `, [id, WORKSPACE_ID, ACCOUNT_ID, FOLDER_ID, scheduledSendAt, USER_ID]);
  }

  async function insertClaim(draftId: number, claimedSendAt: string, claimAgeSql: string): Promise<void> {
    await postgres.admin.query(`
      INSERT INTO sync_info (workspace_id, key, value, last_updated, source_row)
      VALUES ($1, $2, $3, now() - ${claimAgeSql}::interval, '{}'::jsonb)
    `, [WORKSPACE_ID, `scheduled_send_claimed_at:${draftId}`, claimedSendAt]);
  }

  async function claimRow(draftId: number): Promise<readonly Record<string, unknown>[]> {
    const result = await postgres.admin.query(
      `SELECT value FROM sync_info WHERE workspace_id = $1 AND key = $2`,
      [WORKSPACE_ID, `scheduled_send_claimed_at:${draftId}`],
    );
    return result.rows;
  }

  async function scheduledSendAt(draftId: number): Promise<unknown> {
    const result = await postgres.admin.query(
      `SELECT scheduled_send_at FROM email_messages WHERE workspace_id = $1 AND id = $2`,
      [WORKSPACE_ID, draftId],
    );
    return result.rows[0]?.scheduled_send_at;
  }

  function recordingComposeSender(sent: EmailComposeSendInput[]) {
    return {
      async send(input: { values: EmailComposeSendInput }) {
        sent.push(input.values);
        return { ok: true as const, messageId: input.values.draftMessageId, accountId: input.values.accountId };
      },
    };
  }

  // F-A8-03: a claim orphaned by a crash/restart had no expiry; the draft stayed locked
  // and unsent because only a different due draft in the same workspace triggered recovery.
  test('the ticker recovers and sends a stale orphaned claim without another due draft', async () => {
    const draftId = 9101;
    await insertDraft(draftId, null);
    await insertClaim(draftId, '2026-08-01T10:00:00.000Z', `'1 hour'`);
    const sent: EmailComposeSendInput[] = [];
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const runtime = startScheduledSendTicker({
      db,
      pollIntervalMs: 50,
      composeSender: recordingComposeSender(sent),
      auth: {
        async listUsers() {
          return [{ id: USER_ID, role: 'user' as const, disabledAt: null }];
        },
      },
      mailResourceLookup: {
        async resolve() {
          return [{ type: 'message', accountId: String(ACCOUNT_ID), folderId: String(FOLDER_ID), messageId: String(draftId) }];
        },
      },
      mailAccess: {
        async assertPermission() {
          return undefined;
        },
        async resolveScope() {
          return { kind: 'all' as const };
        },
      },
    } as Parameters<typeof startScheduledSendTicker>[0]);
    try {
      for (let attempt = 0; attempt < 500 && sent.length === 0; attempt += 1) {
        await new Promise((resolveDone) => setTimeout(resolveDone, 20));
      }
    } finally {
      runtime.stop();
      warnSpy.mockRestore();
    }

    expect(sent.map((values) => values.draftMessageId)).toEqual([draftId]);
    expect(await claimRow(draftId)).toEqual([]);
  });

  // F-A8-06: recovery had no age limit, so any claim run in the same workspace took over
  // a claim another worker was still sending and lifted its edit/cancel lock.
  test('claiming another due draft leaves a fresh in-flight claim untouched', async () => {
    const inFlightDraftId = 9201;
    const dueDraftId = 9202;
    await insertDraft(inFlightDraftId, null);
    await insertClaim(inFlightDraftId, '2026-08-01T10:00:00.000Z', `'5 seconds'`);
    await insertDraft(dueDraftId, new Date(Date.now() - 60_000).toISOString());
    const sent: EmailComposeSendInput[] = [];
    const port = createPostgresScheduledSendJobPort({ db, composeSender: recordingComposeSender(sent) as never });

    await port.processDue({
      workspaceId: WORKSPACE_ID,
      draftId: dueDraftId,
      actorUserId: USER_ID,
      dueBefore: new Date(),
      limit: 1,
    });

    expect(sent.map((values) => values.draftMessageId)).toEqual([dueDraftId]);
    expect(await claimRow(inFlightDraftId)).toEqual([{ value: '2026-08-01T10:00:00.000Z' }]);
    expect(await scheduledSendAt(inFlightDraftId)).toBeNull();
  });
});
