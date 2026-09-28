/**
 * Plan 049: Automatik-Cockpit – reine Hilfsfunktionen (Wochen, Anteil
 * automatisch, KI-Entscheidungen je Workflow).
 */
import {
  AUTOMATION_COCKPIT_WEEKS,
  automatedShare,
  automationWindowStart,
  bucketSentByKindWeekly,
  summarizeAiDecideAnswers,
  type SentKindWeek,
} from '../../packages/core/src/email/automation-cockpit';

// Mittwoch, 2026-09-23 12:00 UTC → aktuelle Woche beginnt Montag 2026-09-21.
const NOW = new Date('2026-09-23T12:00:00Z');

describe('automationWindowStart', () => {
  test('Montag 00:00 UTC der ältesten Woche', () => {
    expect(automationWindowStart(NOW).toISOString()).toBe('2026-08-03T00:00:00.000Z');
    expect(automationWindowStart(NOW, 1).toISOString()).toBe('2026-09-21T00:00:00.000Z');
  });

  test('Sonntag gehört zur laufenden Woche, Montag 00:00 beginnt eine neue', () => {
    expect(automationWindowStart(new Date('2026-09-27T23:59:59Z'), 1).toISOString()).toBe('2026-09-21T00:00:00.000Z');
    expect(automationWindowStart(new Date('2026-09-28T00:00:00Z'), 1).toISOString()).toBe('2026-09-28T00:00:00.000Z');
  });
});

describe('bucketSentByKindWeekly', () => {
  test('genau N Wochen alt → neu, mit Nullen', () => {
    const weeks = bucketSentByKindWeekly([], NOW);
    expect(weeks).toHaveLength(AUTOMATION_COCKPIT_WEEKS);
    expect(weeks[0]!.weekStart).toBe('2026-08-03');
    expect(weeks[weeks.length - 1]!.weekStart).toBe('2026-09-21');
    expect(weeks.every((week) => week.human + week.aiAuto + week.aiApproved + week.workflow + week.relay + week.unknown === 0)).toBe(true);
  });

  test('Wochengrenze Sonntag/Montag, Arten, unbekannt, außerhalb des Fensters', () => {
    const weeks = bucketSentByKindWeekly([
      { day: '2026-09-20', kind: 'human', count: 2 }, // Sonntag → Woche ab 14.09.
      { day: '2026-09-21', kind: 'human', count: 1 }, // Montag → Woche ab 21.09.
      { day: '2026-09-22', kind: 'ai_auto', count: 3 },
      { day: '2026-09-22', kind: 'ai_approved', count: 1 },
      { day: '2026-09-23', kind: 'workflow', count: 1 },
      { day: '2026-09-23', kind: 'relay', count: 4 },
      { day: '2026-09-23', kind: null, count: 5 },
      { day: '2026-09-23', kind: 'roboter', count: 1 },
      { day: '2026-08-02', kind: 'human', count: 9 }, // vor dem Fenster
      { day: '2026-09-28', kind: 'human', count: 9 }, // nach dem Fenster
    ], NOW);
    const byStart = new Map(weeks.map((week) => [week.weekStart, week]));
    expect(byStart.get('2026-09-14')).toMatchObject({ human: 2 });
    expect(byStart.get('2026-09-21')).toEqual({
      weekStart: '2026-09-21', human: 1, aiAuto: 3, aiApproved: 1, workflow: 1, relay: 4, unknown: 6,
    });
    expect(weeks.reduce((sum, week) => sum + week.human, 0)).toBe(3);
  });
});

describe('automatedShare', () => {
  const week = (patch: Partial<SentKindWeek>): SentKindWeek => ({
    weekStart: '2026-09-21', human: 0, aiAuto: 0, aiApproved: 0, workflow: 0, relay: 0, unknown: 0, ...patch,
  });
  test('Anteil ohne Relay und Unbekannt; leere Woche null', () => {
    expect(automatedShare(week({}))).toBeNull();
    expect(automatedShare(week({ relay: 5, unknown: 3 }))).toBeNull();
    expect(automatedShare(week({ human: 1, aiAuto: 1, aiApproved: 1, workflow: 1, relay: 10 }))).toBe(0.75);
  });
});

describe('summarizeAiDecideAnswers', () => {
  test('Ports je Workflow, unbekannte Ports ignoriert, nach Summe sortiert, begrenzt', () => {
    const rows = summarizeAiDecideAnswers([
      { workflowId: 1, workflowName: 'Spam', port: 'ja', count: 2 },
      { workflowId: 1, workflowName: 'Spam', port: 'nein', count: 1 },
      { workflowId: 1, workflowName: 'Spam', port: 'default', count: 7 },
      { workflowId: 2, workflowName: null, port: 'unsicher', count: 4 },
      { workflowId: 2, workflowName: null, port: 'error', count: 1 },
      { workflowId: 3, workflowName: 'Klein', port: 'ja', count: 1 },
    ]);
    expect(rows).toEqual([
      { workflowId: 2, workflowName: null, ja: 0, nein: 0, unsicher: 4, error: 1, total: 5 },
      { workflowId: 1, workflowName: 'Spam', ja: 2, nein: 1, unsicher: 0, error: 0, total: 3 },
      { workflowId: 3, workflowName: 'Klein', ja: 1, nein: 0, unsicher: 0, error: 0, total: 1 },
    ]);
    expect(summarizeAiDecideAnswers(rows.flatMap((row) => [{ workflowId: row.workflowId, workflowName: row.workflowName, port: 'ja', count: 1 }]), 2))
      .toHaveLength(2);
  });
});
