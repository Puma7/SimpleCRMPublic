import type { Kysely } from 'kysely';

import { createPostgresEmailReportingPort } from '../../packages/server/src/db/postgres-email-reporting-port';
import { createPostgresEmailMessageReadPort } from '../../packages/server/src/db/postgres-mail-read-ports';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

/**
 * Plan 049 (Server): Automatik-Cockpit in der Auswertung. RLS trennt
 * Workspaces; eine eingeschränkte Mail-Sicht blendet andere Konten und die
 * KI-Kosten aus; die Zähler der Warteschlangen entsprechen den Ansichten;
 * Testläufe (Plan 047) und alte Schritte zählen nicht.
 */
const WS_A = '10000000-0000-4000-8000-0000000000c1';
const WS_B = '10000000-0000-4000-8000-0000000000c2';
const A1 = 901;
const A2 = 902;
const B1 = 903;
const WORKFLOW_A = 931;
const WORKFLOW_B = 932;

describe('Server: Automatik-Cockpit', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;
  const now = new Date();
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60_000).toISOString();

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('automation-cockpit');
    const { admin } = postgres;
    for (const [ws, name] of [[WS_A, 'Cockpit A'], [WS_B, 'Cockpit B']] as const) {
      await admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, $2)`, [ws, name]);
    }
    for (const [id, ws] of [[A1, WS_A], [A2, WS_A], [B1, WS_B]] as const) {
      await admin.query(`
        INSERT INTO email_accounts (id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username)
        VALUES ($1, $2, $1, 'Konto', $3, 'imap.example.test', 'k')
      `, [id, ws, `k${id}@example.test`]);
      await admin.query(`
        INSERT INTO email_folders (id, workspace_id, source_sqlite_id, account_source_sqlite_id, account_id, path)
        VALUES ($1, $2, $1, $1, $1, 'INBOX')
      `, [id, ws]);
    }
    let nextId = 9500;
    async function mail(ws: string, account: number, values: {
      uid?: number; folderKind: string; sentByKind?: string | null; isSpam?: boolean; softDeleted?: boolean;
      approvalState?: string | null; outboundHold?: boolean; dateReceived?: string;
    }): Promise<number> {
      const id = nextId++;
      await admin.query(`
        INSERT INTO email_messages (
          id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id, account_id, folder_id,
          uid, subject, folder_kind, sent_by_kind, is_spam, soft_deleted, approval_state, outbound_hold, date_received
        ) VALUES ($1, $2, $1, $3, $3, $3, $3, $4, 'Cockpit', $5, $6, $7, $8, $9, $10, $11)
      `, [
        id, ws, account, values.uid ?? id, values.folderKind, values.sentByKind ?? null, values.isSpam ?? false,
        values.softDeleted ?? false, values.approvalState ?? null, values.outboundHold ?? false,
        values.dateReceived ?? hoursAgo(2),
      ]);
      return id;
    }
    const sentA1 = await mail(WS_A, A1, { folderKind: 'sent', sentByKind: 'human' });
    await mail(WS_A, A1, { folderKind: 'sent', sentByKind: 'ai_auto' });
    await mail(WS_A, A1, { folderKind: 'sent', sentByKind: 'ai_auto', isSpam: true });
    const sentA2 = await mail(WS_A, A2, { folderKind: 'sent', sentByKind: 'workflow' });
    await mail(WS_A, A1, { folderKind: 'sent', sentByKind: 'human', dateReceived: hoursAgo(24 * 120) });
    const sentB = await mail(WS_B, B1, { folderKind: 'sent', sentByKind: 'human' });
    await mail(WS_A, A1, { uid: -1, folderKind: 'draft', approvalState: 'pending' });
    await mail(WS_A, A1, { uid: -2, folderKind: 'draft', outboundHold: true });
    await mail(WS_A, A2, { uid: -3, folderKind: 'draft', approvalState: 'pending', outboundHold: true });
    await mail(WS_A, A1, { uid: -4, folderKind: 'draft', outboundHold: true, softDeleted: true });
    await mail(WS_B, B1, { uid: -5, folderKind: 'draft', approvalState: 'pending', outboundHold: true });

    for (const [id, ws] of [[WORKFLOW_A, WS_A], [WORKFLOW_B, WS_B]] as const) {
      await admin.query(`
        INSERT INTO email_workflows (id, workspace_id, source_sqlite_id, name, trigger_name, enabled, priority, definition_json, execution_mode, engine_version)
        VALUES ($1, $2, $1, 'Spamfilter', 'inbound', true, 1, '{}'::jsonb, 'graph', 1)
      `, [id, ws]);
    }
    let runId = 9600;
    async function decision(ws: string, workflow: number, messageId: number, port: string, extra: {
      dryRun?: boolean; message?: string; createdAt?: string;
    } = {}): Promise<void> {
      const id = runId++;
      await admin.query(`
        INSERT INTO email_workflow_runs (id, workspace_id, source_sqlite_id, workflow_source_sqlite_id, workflow_id, message_id, direction, status, started_at, finished_at, dry_run)
        VALUES ($1, $2, $1, $3, $3, $4, 'inbound', 'ok', $5, $5, $6)
      `, [id, ws, workflow, messageId, hoursAgo(3), extra.dryRun ?? false]);
      await admin.query(`
        INSERT INTO email_workflow_run_steps (workspace_id, run_source_sqlite_id, run_id, node_id, node_type, status, port, duration_ms, message, created_at)
        VALUES ($1, $2, $2, 'decide', 'ai.decide', 'ok', $3, 1, $4, $5)
      `, [ws, id, port, extra.message ?? 'Antwort', extra.createdAt ?? hoursAgo(3)]);
    }
    await decision(WS_A, WORKFLOW_A, sentA1, 'ja');
    await decision(WS_A, WORKFLOW_A, sentA2, 'nein');
    await decision(WS_A, WORKFLOW_A, sentA1, 'ja', { dryRun: true });
    await decision(WS_A, WORKFLOW_A, sentA1, 'unsicher', { message: 'Testlauf: keine KI-Anfrage' });
    await decision(WS_A, WORKFLOW_A, sentA1, 'ja', { createdAt: hoursAgo(24 * 40) });
    await decision(WS_B, WORKFLOW_B, sentB, 'ja');

    for (const [ws, cost] of [[WS_A, 1000], [WS_A, 2000], [WS_B, 5000]] as const) {
      await admin.query(`INSERT INTO ai_usage_events (workspace_id, node_type, est_cost_micro_usd) VALUES ($1, 'ai.decide', $2)`, [ws, cost]);
    }
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  function totals(weeks: Array<Record<string, unknown>>) {
    const sum = (key: string) => weeks.reduce((acc, week) => acc + Number(week[key]), 0);
    return { human: sum('human'), aiAuto: sum('aiAuto'), aiApproved: sum('aiApproved'), workflow: sum('workflow'), relay: sum('relay'), unknown: sum('unknown') };
  }

  test('volle Sicht: Herkunft, Warteschlangen, Entscheidungen, Kosten; Workspace B zählt nie', async () => {
    const report = await createPostgresEmailReportingPort({ db }).collect({ workspaceId: WS_A, now, mailScope: { kind: 'all' } });
    const automation = report.automation;
    expect(automation.sentByKindWeekly).toHaveLength(8);
    expect(totals(automation.sentByKindWeekly)).toEqual({ human: 1, aiAuto: 1, aiApproved: 0, workflow: 1, relay: 0, unknown: 0 });
    expect(automation.pendingApproval).toBe(2);
    expect(automation.outboundBlocked).toBe(2);
    expect(automation.aiDecideByWorkflow30d).toEqual([
      { workflowId: WORKFLOW_A, workflowName: 'Spamfilter', ja: 1, nein: 1, unsicher: 0, error: 0, total: 2 },
    ]);
    expect(automation.aiCost30d).toEqual({ costMicroUsd: 3000, events: 2 });
    expect(report.workflowRuns24h).toEqual([expect.objectContaining({ workflowId: WORKFLOW_A, workflowName: 'Spamfilter', count: 4 })]);
  });

  test('eingeschränkte Sicht: nur Konto A1, keine KI-Kosten', async () => {
    const report = await createPostgresEmailReportingPort({ db }).collect({
      workspaceId: WS_A,
      now,
      mailScope: { kind: 'restricted', accountIds: [A1], folderIds: [], messageIds: [] },
    });
    expect(totals(report.automation.sentByKindWeekly)).toMatchObject({ human: 1, aiAuto: 1, workflow: 0 });
    expect(report.automation).toMatchObject({ pendingApproval: 1, outboundBlocked: 1, aiCost30d: null });
    expect(report.automation.aiDecideByWorkflow30d).toEqual([
      expect.objectContaining({ workflowId: WORKFLOW_A, ja: 1, nein: 0, total: 1 }),
    ]);
  });

  test('Konto-Filter A2: keine KI-Kosten, weil Nutzungsereignisse keinem Konto zugeordnet sind', async () => {
    const report = await createPostgresEmailReportingPort({ db }).collect({ workspaceId: WS_A, accountId: A2, now, mailScope: { kind: 'all' } });
    expect(totals(report.automation.sentByKindWeekly)).toMatchObject({ human: 0, workflow: 1 });
    expect(report.automation).toMatchObject({ pendingApproval: 1, outboundBlocked: 1 });
    // Die Workspace-Summe (3000) darf nicht als Kosten von Konto A2 erscheinen.
    expect(report.automation.aiCost30d).toBeNull();
    expect(report.automation.aiDecideByWorkflow30d).toEqual([expect.objectContaining({ nein: 1, total: 1 })]);
  });

  test('Zähler entsprechen den Ansichten', async () => {
    const messages = createPostgresEmailMessageReadPort({ db });
    const report = await createPostgresEmailReportingPort({ db }).collect({ workspaceId: WS_A, now, mailScope: { kind: 'all' } });
    const pending = await messages.list({ workspaceId: WS_A, view: 'approval_pending', limit: 50, mailScope: { kind: 'all' } });
    const blocked = await messages.list({ workspaceId: WS_A, view: 'outbound_blocked', limit: 50, mailScope: { kind: 'all' } });
    expect(pending.items).toHaveLength(report.automation.pendingApproval);
    expect(blocked.items).toHaveLength(report.automation.outboundBlocked);
  });
});
