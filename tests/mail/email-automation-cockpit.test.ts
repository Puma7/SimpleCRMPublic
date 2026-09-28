/**
 * Plan 049: Automatik-Cockpit (Desktop) – Anteil Mensch/KI je Woche,
 * Warteschlangen, Antworten der KI-Entscheidung je Workflow. Echte
 * In-Memory-DB mit dem echten Schema.
 */
import Database from 'better-sqlite3';

const db = new Database(':memory:');
db.pragma('foreign_keys = OFF');

jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => db,
  getSyncInfo: () => null,
  setSyncInfo: () => undefined,
}));

import {
  createEmailMessagesTable,
  createEmailWorkflowRunStepsTable,
  createEmailWorkflowRunsTable,
  createEmailWorkflowsTable,
} from '../../electron/database-schema';
import { ensureSentProvenanceColumns } from '../../electron/email/email-sent-provenance-schema';
import { getAutomationCockpitSnapshot } from '../../electron/email/email-automation-cockpit';
import { listMessagesForAccountView } from '../../electron/email/email-store';
import { AI_DECIDE_DRY_RUN_SUMMARY } from '../../packages/core/src/workflow/ai-decide';

const NOW = new Date('2026-09-23T12:00:00Z');

beforeAll(() => {
  db.exec(createEmailMessagesTable);
  db.exec(`
    ALTER TABLE email_messages ADD COLUMN snoozed_until TEXT;
    ALTER TABLE email_messages ADD COLUMN scheduled_send_at TEXT;
    ALTER TABLE email_messages ADD COLUMN approval_state TEXT;
    ALTER TABLE email_messages ADD COLUMN approval_reason TEXT;
    ALTER TABLE email_messages ADD COLUMN bcc_json TEXT;
  `);
  ensureSentProvenanceColumns(db);
  db.exec(createEmailWorkflowsTable);
  db.exec(createEmailWorkflowRunsTable);
  db.exec(createEmailWorkflowRunStepsTable);

  const mail = db.prepare(
    `INSERT INTO email_messages
       (id, account_id, folder_id, uid, subject, folder_kind, sent_by_kind, is_spam, soft_deleted,
        approval_state, outbound_hold, scheduled_send_at, date_received)
     VALUES (?, ?, 10, ?, 'x', ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // Gesendet, Woche ab 21.09.
  mail.run(1, 1, 101, 'sent', 'human', 0, 0, null, 0, null, '2026-09-21T08:00:00Z');
  mail.run(2, 1, 102, 'sent', 'ai_auto', 0, 0, null, 0, null, '2026-09-22T08:00:00Z');
  mail.run(3, 1, 103, 'sent', 'ai_approved', 0, 1, null, 0, null, '2026-09-22T09:00:00Z'); // gelöscht: zählt
  mail.run(4, 1, 104, 'sent', 'workflow', 1, 0, null, 0, null, '2026-09-22T10:00:00Z'); // Spam: zählt nicht
  mail.run(5, 1, 105, 'sent', null, 0, 0, null, 0, null, '2026-09-20T10:00:00Z'); // Vorwoche, unbekannt
  mail.run(6, 2, 106, 'sent', 'relay', 0, 0, null, 0, null, '2026-09-22T11:00:00Z'); // anderes Konto
  mail.run(7, 1, 107, 'inbox', 'ai_auto', 0, 0, null, 0, null, '2026-09-22T12:00:00Z'); // Eingang
  mail.run(8, 1, 108, 'sent', 'human', 0, 0, null, 0, null, '2026-07-01T12:00:00Z'); // vor dem Fenster
  // Warteschlangen (wie die Ansichten).
  mail.run(20, 1, -20, 'draft', null, 0, 0, 'pending', 0, null, '2026-09-22T08:00:00Z');
  mail.run(21, 1, -21, 'draft', null, 0, 0, 'pending', 0, '2026-09-30T08:00:00Z', '2026-09-22T08:00:00Z');
  mail.run(22, 1, -22, 'draft', null, 0, 0, null, 1, null, '2026-09-22T08:00:00Z');
  mail.run(23, 1, -23, 'draft', null, 0, 0, 'pending', 1, null, '2026-09-22T08:00:00Z');
  mail.run(24, 1, -24, 'draft', null, 0, 1, null, 1, null, '2026-09-22T08:00:00Z');
  mail.run(25, 2, -25, 'draft', null, 0, 0, 'pending', 1, null, '2026-09-22T08:00:00Z');

  db.prepare(`INSERT INTO email_workflows (id, name, trigger, definition_json) VALUES (71, 'Spamfilter', 'inbound', '{}')`).run();
  db.prepare(`INSERT INTO email_workflows (id, name, trigger, definition_json) VALUES (72, 'Rückgaben', 'inbound', '{}')`).run();
  const run = db.prepare(
    `INSERT INTO email_workflow_runs (id, workflow_id, message_id, direction, status, started_at, dry_run)
     VALUES (?, ?, ?, 'inbound', 'ok', '2026-09-22T08:00:00Z', ?)`,
  );
  run.run(1, 71, 1, 0);
  run.run(2, 71, 2, 0);
  run.run(3, 72, 6, 0); // Konto 2
  run.run(4, 72, 1, 1); // Testlauf (Plan 047)
  run.run(5, 72, null, 0); // ohne Mail (Zeitplan)
  const step = db.prepare(
    `INSERT INTO email_workflow_run_steps (run_id, node_id, node_type, status, port, message, created_at)
     VALUES (?, 'decide', ?, ?, ?, ?, ?)`,
  );
  step.run(1, 'ai.decide', 'ok', 'ja', 'Ja', '2026-09-22T08:00:00Z');
  step.run(1, 'ai.decide', 'ok', 'nein', 'Nein', '2026-09-22T08:00:00Z');
  step.run(2, 'ai.decide', 'error', 'error', 'KI-Fehler', '2026-09-22 08:00:00');
  step.run(2, 'ai.decide', 'skipped', 'unsicher', null, '2026-09-22T08:00:00Z'); // übersprungen
  step.run(2, 'ai.decide', 'ok', 'unsicher', AI_DECIDE_DRY_RUN_SUMMARY, '2026-09-22T08:00:00Z'); // alter Probelauf
  step.run(2, 'ai.decide', 'ok', 'ja', 'alt', '2026-08-01T08:00:00Z'); // älter als 30 Tage
  step.run(2, 'ai.decide', 'ok', 'default', null, '2026-09-22T08:00:00Z'); // Einreihung ohne Antwort
  step.run(2, 'email.tag', 'ok', 'ja', null, '2026-09-22T08:00:00Z'); // anderer Knoten
  step.run(3, 'ai.decide', 'ok', 'unsicher', 'Unsicher', '2026-09-22T08:00:00Z');
  step.run(4, 'ai.decide', 'ok', 'ja', 'Ja (Testlauf mit KI)', '2026-09-22T08:00:00Z');
  step.run(5, 'ai.decide', 'ok', 'nein', 'Nein', '2026-09-22T08:00:00Z');
});

describe('Desktop: Automatik-Cockpit', () => {
  test('alle Konten: Herkunft je Woche, Warteschlangen, KI-Entscheidungen, keine Kosten', () => {
    const snap = getAutomationCockpitSnapshot(db, { accountIds: null }, NOW);
    expect(snap.sentByKindWeekly).toHaveLength(8);
    const current = snap.sentByKindWeekly[7]!;
    expect(current).toEqual({ weekStart: '2026-09-21', human: 1, aiAuto: 1, aiApproved: 1, workflow: 0, relay: 1, unknown: 0 });
    expect(snap.sentByKindWeekly[6]).toMatchObject({ weekStart: '2026-09-14', unknown: 1 });
    expect(snap.pendingApproval).toBe(3);
    expect(snap.outboundBlocked).toBe(3);
    expect(snap.aiDecideByWorkflow30d).toEqual([
      { workflowId: 71, workflowName: 'Spamfilter', ja: 1, nein: 1, unsicher: 0, error: 1, total: 3 },
      { workflowId: 72, workflowName: 'Rückgaben', ja: 0, nein: 1, unsicher: 1, error: 0, total: 2 },
    ]);
    expect(snap.aiCost30d).toBeNull();
  });

  test('ein Konto: andere Konten und Läufe ohne Mail zählen nicht; Zähler = Ansichten', () => {
    const snap = getAutomationCockpitSnapshot(db, { accountIds: [1] }, NOW);
    expect(snap.sentByKindWeekly[7]).toMatchObject({ human: 1, aiAuto: 1, aiApproved: 1, relay: 0 });
    expect(snap.pendingApproval).toBe(listMessagesForAccountView(1, 'approval_pending').length);
    expect(snap.outboundBlocked).toBe(listMessagesForAccountView(1, 'outbound_blocked').length);
    expect(snap.pendingApproval).toBe(2);
    expect(snap.outboundBlocked).toBe(2);
    expect(snap.aiDecideByWorkflow30d).toEqual([
      { workflowId: 71, workflowName: 'Spamfilter', ja: 1, nein: 1, unsicher: 0, error: 1, total: 3 },
    ]);
  });

  test('keine erlaubten Konten: alles null', () => {
    const snap = getAutomationCockpitSnapshot(db, { accountIds: [] }, NOW);
    expect(snap.sentByKindWeekly.every((week) => week.human + week.aiAuto + week.relay + week.unknown === 0)).toBe(true);
    expect(snap).toMatchObject({ pendingApproval: 0, outboundBlocked: 0, aiDecideByWorkflow30d: [], aiCost30d: null });
  });
});

// Die Ansichten blenden aktiv zurückgestellte Entwürfe aus (SNOOZE_FILTER_SQL);
// die Zähler im Cockpit müssen dieselbe Bedingung verwenden.
describe('Desktop: Automatik-Cockpit und Zurückstellen', () => {
  beforeAll(() => {
    const draft = db.prepare(
      `INSERT INTO email_messages
         (id, account_id, folder_id, uid, subject, folder_kind, approval_state, outbound_hold, snoozed_until, date_received)
       VALUES (?, 3, 10, ?, 'x', 'draft', ?, ?, ?, '2026-09-22T08:00:00Z')`,
    );
    draft.run(30, -30, 'pending', 0, '2099-01-01T00:00:00Z'); // zurückgestellt: zählt nicht
    draft.run(31, -31, null, 1, '2099-01-01T00:00:00Z'); // zurückgestellt: zählt nicht
    draft.run(32, -32, 'pending', 0, '2000-01-01T00:00:00Z'); // Zurückstellen abgelaufen: zählt
    draft.run(33, -33, null, 1, '2000-01-01T00:00:00Z'); // Zurückstellen abgelaufen: zählt
  });

  afterAll(() => {
    db.prepare('DELETE FROM email_messages WHERE id BETWEEN 30 AND 33').run();
  });

  test('aktiv zurückgestellte Entwürfe zählen nicht; Zähler = Ansichten', () => {
    const snap = getAutomationCockpitSnapshot(db, { accountIds: [3] }, NOW);
    expect(snap.pendingApproval).toBe(listMessagesForAccountView(3, 'approval_pending').length);
    expect(snap.outboundBlocked).toBe(listMessagesForAccountView(3, 'outbound_blocked').length);
    expect(snap).toMatchObject({ pendingApproval: 1, outboundBlocked: 1 });
    // Alle Konten: die drei von oben plus je ein abgelaufen zurückgestellter Entwurf.
    expect(getAutomationCockpitSnapshot(db, { accountIds: null }, NOW)).toMatchObject({ pendingApproval: 4, outboundBlocked: 4 });
  });
});
