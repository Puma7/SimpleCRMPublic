import type { Kysely } from 'kysely';
import { sql } from 'kysely';

import { createPostgresEmailMessageReadPort } from '../../packages/server/src/db/postgres-mail-read-ports';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000d4';
const ACCOUNT_ID = 401;
const FOLDER_ID = 411;

// Rueckverweise zwingen PostgreSQLs Regex-Engine ins Backtracking: gegen
// 'a' x 300 + 'bx' probiert sie jede Aufteilung in drei Gruppen durch, bevor
// sie aufgibt. Gemessen: 100 Zeichen 1,4 s, 200 Zeichen schon ueber 20 s.
const BACKTRACKING_SEARCH = '/(.+)(.+)(.+)\\1\\2\\3x/';

// F-A6-03: Die Regex-Suche lief ohne statement_timeout; ein Muster mit Rueckverweisen hielt eine Pool-Verbindung beliebig lange fest, auch nach Abbruch des Clients.
describe('Regex-Suche in der Mail-Liste ist zeitlich begrenzt', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('mail-regex-timeout');
    const { admin } = postgres;
    await admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Regex Timeout Test')`, [WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_accounts (id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username)
      VALUES ($1, $2, $1, 'Support', 'support@example.test', 'imap.example.test', 'support')
    `, [ACCOUNT_ID, WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_folders (id, workspace_id, source_sqlite_id, account_source_sqlite_id, account_id, path)
      VALUES ($1, $2, $1, $3, $3, 'INBOX')
    `, [FOLDER_ID, WORKSPACE_ID, ACCOUNT_ID]);
    const messages: Array<[number, string, string]> = [
      [421, 'Rechnung', 'Ihre invoice 4711 liegt bei.'],
      [422, 'Backtracking', `${'a'.repeat(300)}bx`],
    ];
    for (const [id, subject, bodyText] of messages) {
      await admin.query(`
        INSERT INTO email_messages (
          id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
          account_id, folder_id, uid, subject, body_text, folder_kind
        ) VALUES ($1, $2, $1, $3, $4, $3, $4, $1, $5, $6, 'inbox')
      `, [id, WORKSPACE_ID, ACCOUNT_ID, FOLDER_ID, subject, bodyText]);
    }
    // Eine Verbindung: die Folgeabfrage laeuft garantiert auf derselben Session.
    db = postgres.createApplicationDb({ maxConnections: 1 });
  });

  afterAll(async () => {
    // Laeuft die Suche ungebremst weiter (Regression), wartete pool.end() auf sie.
    await postgres?.admin.query(`
      SELECT pg_cancel_backend(pid) FROM pg_stat_activity
      WHERE state = 'active' AND pid <> pg_backend_pid()
    `).catch(() => undefined);
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  test('ein gewoehnliches Muster findet weiterhin seine Treffer', async () => {
    const port = createPostgresEmailMessageReadPort({ db });
    const result = await port.list({ workspaceId: WORKSPACE_ID, search: '/invoice\\s+\\d+/i', limit: 10 });
    expect(result.searchMode).toBe('regex');
    expect(result.items.map((item) => item.id)).toEqual([421]);
  });

  test('ein Backtracking-Muster wird von PostgreSQL abgebrochen', async () => {
    const port = createPostgresEmailMessageReadPort({ db });
    const started = Date.now();
    const outcome = await port.list({ workspaceId: WORKSPACE_ID, search: BACKTRACKING_SEARCH, limit: 10 })
      .then(() => 'finished', (error: unknown) => error);
    expect(outcome).toMatchObject({ code: '57014' });
    expect(Date.now() - started).toBeLessThan(30_000);

    // Das Limit gilt nur fuer diese Abfrage, nicht fuer die Session danach.
    const after = await sql<{ statement_timeout: string }>`SHOW statement_timeout`.execute(db);
    expect(after.rows[0]?.statement_timeout).toBe('0');
  }, 60_000);
});
