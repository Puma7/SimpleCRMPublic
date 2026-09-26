import type { Kysely } from 'kysely';

import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { createPostgresWorkflowExecutionJobPort } from '../../packages/server/src/workflow-execution';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000d7';
const ACCOUNT_ID = 701;
const FOLDER_ID = 711;
const MESSAGE_ID = 721;
const DRAFT_WORKFLOW_ID = 731;
const TRANSFORM_WORKFLOW_ID = 732;
const MAX_CONTEXT_JSON_LENGTH = 128 * 1024;

type StepRow = { node_id: string; status: string; message: string | null };
type JobRow = { type: string; payload: Record<string, any> };

// Etwa 75 KB Text: lange zitierte Verlaeufe, aus HTML gewandelte Newsletter.
// Das Kennwort am Ende prueft, dass der synchrone Teil den vollen Text sieht.
const LONG_BODY = `${'Zitierte Zeile aus einem langen Verlauf mit Umlauten äöü.\n'.repeat(1300)}ENDE-KENNWORT`;

// F-D1-05: body_text und combined_text trugen den ungekuerzten Mailtext doppelt in
// den Continuation-Kontext; ab etwa 64 KB scheiterte jeder deferierte Knoten
// (auch ein terminales ai.draft_reply) mit "Continuation-Kontext ueberschreitet".
describe('deferred workflow nodes bound the mail body in their continuation payload', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('workflow-continuation-body');
    const { admin } = postgres;
    await admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Continuation Body Test')`, [WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_accounts (id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username)
      VALUES ($1, $2, $1, 'support', 'support@example.test', 'imap.example.test', 'support')
    `, [ACCOUNT_ID, WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_folders (id, workspace_id, source_sqlite_id, account_source_sqlite_id, account_id, path)
      VALUES ($1, $2, $1, $3, $3, 'INBOX')
    `, [FOLDER_ID, WORKSPACE_ID, ACCOUNT_ID]);
    await admin.query(`
      INSERT INTO email_messages (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
        account_id, folder_id, uid, subject, body_text, snippet
      ) VALUES ($1, $2, $1, $3, $4, $3, $4, 1, 'Langer Verlauf', $5, 'Zitierte Zeile')
    `, [MESSAGE_ID, WORKSPACE_ID, ACCOUNT_ID, FOLDER_ID, LONG_BODY]);

    const condition = {
      id: 'cond-1',
      type: 'condition',
      data: { field: 'body_text', op: 'contains', value: 'ENDE-KENNWORT' },
    };
    const graphs: Array<[number, unknown]> = [
      [DRAFT_WORKFLOW_ID, {
        version: 1,
        nodes: [
          { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } },
          condition,
          { id: 'draft-1', type: 'registry', data: { nodeType: 'ai.draft_reply', config: {} } },
        ],
        edges: [
          { id: 'edge-1', source: 'trigger-1', target: 'cond-1' },
          { id: 'edge-2', source: 'cond-1', target: 'draft-1', label: 'yes' },
        ],
      }],
      [TRANSFORM_WORKFLOW_ID, {
        version: 1,
        nodes: [
          { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } },
          condition,
          {
            id: 'transform-1',
            type: 'registry',
            data: { nodeType: 'ai.transform_text', config: { targetVariable: 'ai.text' } },
          },
          { id: 'tag-1', type: 'registry', data: { nodeType: 'email.tag', config: { tag: 'weiter' } } },
        ],
        edges: [
          { id: 'edge-1', source: 'trigger-1', target: 'cond-1' },
          { id: 'edge-2', source: 'cond-1', target: 'transform-1', label: 'yes' },
          { id: 'edge-3', source: 'transform-1', target: 'tag-1' },
        ],
      }],
    ];
    for (const [id, graph] of graphs) {
      await admin.query(`
        INSERT INTO email_workflows (
          id, workspace_id, source_sqlite_id, name, trigger_name, enabled, priority,
          definition_json, graph_json, execution_mode, engine_version
        ) VALUES ($1, $2, $1, $3, 'inbound', true, 1, '{}'::jsonb, $4::jsonb, 'graph', 1)
      `, [id, WORKSPACE_ID, `Workflow ${id}`, JSON.stringify(graph)]);
    }
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  beforeEach(async () => {
    await postgres.admin.query(`DELETE FROM job_queue`);
  });

  async function runInbound(workflowId: number): Promise<void> {
    await createPostgresWorkflowExecutionJobPort({ db }).execute({
      workspaceId: WORKSPACE_ID,
      workflowId,
      messageId: MESSAGE_ID,
      triggerName: 'inbound',
      context: {},
    });
  }

  async function steps(workflowId: number): Promise<StepRow[]> {
    const result = await postgres.admin.query<StepRow>(`
      SELECT s.node_id, s.status, s.message
      FROM email_workflow_run_steps s
      JOIN email_workflow_runs r ON r.id = s.run_id
      WHERE r.workspace_id = $1 AND r.workflow_id = $2
      ORDER BY s.id
    `, [WORKSPACE_ID, workflowId]);
    return [...result.rows];
  }

  async function jobs(type: string): Promise<JobRow[]> {
    const result = await postgres.admin.query<JobRow>(
      `SELECT type, payload FROM job_queue WHERE workspace_id = $1 AND type = $2 ORDER BY id`,
      [WORKSPACE_ID, type],
    );
    return [...result.rows];
  }

  function expectBoundedStrings(strings: Record<string, string>): void {
    expect(strings.body_truncated).toBe('true');
    expect(strings.body_text.length).toBeLessThanOrEqual(48_000);
    expect(LONG_BODY.startsWith(strings.body_text)).toBe(true);
    expect(strings.combined_text).toContain(strings.body_text);
    expect(strings.combined_text).not.toContain('ENDE-KENNWORT');
    expect(strings.subject).toBe('Langer Verlauf');
    expect(JSON.stringify(strings).length).toBeLessThanOrEqual(MAX_CONTEXT_JSON_LENGTH);
  }

  test('a terminal ai.draft_reply on a 75 KB mail is queued with a bounded body', async () => {
    expect(LONG_BODY.length).toBeGreaterThan(75_000);

    await runInbound(DRAFT_WORKFLOW_ID);

    const draftStep = (await steps(DRAFT_WORKFLOW_ID)).find((step) => step.node_id === 'draft-1');
    expect(draftStep).toMatchObject({ status: 'ok', message: expect.stringMatching(/^queued_ai_draft_reply:\d+$/) });
    const [job] = await jobs('ai.draft_reply');
    expect(job).toBeDefined();
    expectBoundedStrings(job!.payload.eventStrings);
  });

  test('a deferred node with a follow-up carries the bounded body into its continuation', async () => {
    await runInbound(TRANSFORM_WORKFLOW_ID);

    const transformStep = (await steps(TRANSFORM_WORKFLOW_ID)).find((step) => step.node_id === 'transform-1');
    expect(transformStep).toMatchObject({ status: 'ok' });
    const [job] = await jobs('ai.transform_text');
    expect(job).toBeDefined();
    expectBoundedStrings(job!.payload.eventStrings);
    expectBoundedStrings(job!.payload.continuation.eventStrings);
  });
});
