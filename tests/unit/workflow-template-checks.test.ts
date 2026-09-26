/**
 * TA-P6: Voraussetzungs-Checkliste im Vorlagen-Dialog (reine Logik) und was
 * „Vorlage laden“ außer dem Graphen übernimmt. Render-Test des Dialogs:
 * tests/unit/workflow-templates-dialog.test.tsx.
 */
import { getWorkflowTemplate, PARTIAL_AUTOMATION_TEMPLATE_IDS as IDS, type WorkflowTemplate } from '@simplecrm/core';

import { graphHasTriggerToActionShortcut } from '../../src/components/email/workflow/workflow-graph-layout';
import {
  aiProfileReadiness,
  learningsCollectEnabled,
  requiredTemplateChecks,
  templateCheckRows,
  templatePickEdits,
  UNKNOWN_TEMPLATE_LIVE_CHECKS,
} from '../../src/components/email/workflow/workflow-template-checks';
import type { WorkflowTemplateDto } from '../../shared/workflow-types';

function template(id: string): WorkflowTemplateDto {
  const found = getWorkflowTemplate(id) as WorkflowTemplate | undefined;
  if (!found) throw new Error(`Vorlage ${id} fehlt`);
  return found as unknown as WorkflowTemplateDto;
}

const chat = { provider: 'openai', hasApiKey: true };
const decisions = { provider: 'openrouter_decisions', hasApiKey: true };

describe('requiredTemplateChecks', () => {
  test('Vorlagen der Teilautomatisierung', () => {
    expect(requiredTemplateChecks(template(IDS.spamDecision))).toEqual(['decideProfile']);
    expect(requiredTemplateChecks(template(IDS.humanOrAiReply))).toEqual([
      'chatProfile',
      'decideProfile',
      'autoReply',
      'knowledgeBase',
    ]);
    expect(requiredTemplateChecks(template(IDS.outboundDecision))).toEqual(['decideProfile']);
    expect(requiredTemplateChecks(template(IDS.learningsWeekly))).toEqual([
      'chatProfile',
      'learningsCollect',
      'scheduleTrigger',
    ]);
  });

  test('bestehende Vorlagen behalten ihre Prüfungen', () => {
    expect(requiredTemplateChecks(template('inbound-ai-auto-reply'))).toEqual(['chatProfile', 'canned', 'autoReply']);
    expect(requiredTemplateChecks(template('inbound-ai-two-stage-reply'))).toEqual([
      'chatProfile',
      'autoReply',
      'knowledgeBase',
    ]);
    expect(requiredTemplateChecks(template('inbound-invoice'))).toEqual([]);
    expect(requiredTemplateChecks(template('schedule-inbox-sync'))).toEqual(['scheduleTrigger']);
  });
});

describe('aiProfileReadiness', () => {
  test('Entscheidungsmodell zählt nur für „KI-Entscheidung“', () => {
    expect(aiProfileReadiness([decisions])).toEqual({ chatProfileReady: false, decideProfileReady: true });
  });

  test('Chat-Modell genügt für beides', () => {
    expect(aiProfileReadiness([chat])).toEqual({ chatProfileReady: true, decideProfileReady: true });
    expect(aiProfileReadiness([decisions, chat])).toEqual({ chatProfileReady: true, decideProfileReady: true });
  });

  test('Profile ohne API-Schlüssel zählen nicht; ältere Antworten ohne Feld schon', () => {
    expect(aiProfileReadiness([{ provider: 'openai', hasApiKey: false }])).toEqual({
      chatProfileReady: false,
      decideProfileReady: false,
    });
    expect(aiProfileReadiness([{ provider: 'openai' }])).toEqual({ chatProfileReady: true, decideProfileReady: true });
    expect(aiProfileReadiness([])).toEqual({ chatProfileReady: false, decideProfileReady: false });
    expect(aiProfileReadiness(null)).toEqual({ chatProfileReady: false, decideProfileReady: false });
  });
});

test('learningsCollectEnabled liest den Schalter aus der Learnings-Übersicht', () => {
  expect(learningsCollectEnabled({ settings: { collectEnabled: true } })).toBe(true);
  expect(learningsCollectEnabled({ settings: { collectEnabled: false } })).toBe(false);
  expect(learningsCollectEnabled(null)).toBeNull();
  expect(learningsCollectEnabled({})).toBeNull();
});

describe('templateCheckRows', () => {
  const live = {
    chatProfileReady: true,
    decideProfileReady: true,
    cannedReady: false,
    autoReplyEnabled: false,
    knowledgeBaseReady: false,
    learningsCollectEnabled: true,
  };

  test('b: Beschriftungen und Live-Werte', () => {
    expect(templateCheckRows(template(IDS.humanOrAiReply), live, { serverClientMode: false })).toEqual([
      { id: 'chatProfile', ok: true, label: 'KI-Profil mit API-Schlüssel', hint: '(Chat-Modell; Einstellungen → E-Mail → KI)' },
      {
        id: 'decideProfile',
        ok: true,
        label: 'KI-Profil vom Typ Entscheidungsmodell (oder Chat-Modell)',
        hint: '(Einstellungen → E-Mail → KI; im Baustein „KI-Entscheidung“ auswählen — leer = Standard-Profil)',
      },
      {
        id: 'autoReply',
        ok: false,
        label: 'Auto-Antwort-Schalter aktiviert',
        hint: '(Einstellungen → Automatisierung — sonst wird nie automatisch gesendet)',
      },
      {
        id: 'knowledgeBase',
        ok: false,
        label: 'Wissensbasis vorhanden',
        hint: '(Einstellungen → Wissensbasis — Grundlage für die KI-Antworten)',
      },
    ]);
  });

  test('d: Learnings sammeln und Zeitplan in beiden Editionen', () => {
    const desktop = templateCheckRows(template(IDS.learningsWeekly), live, { serverClientMode: false });
    expect(desktop.map((row) => [row.id, row.ok, row.label])).toEqual([
      ['chatProfile', true, 'KI-Profil mit API-Schlüssel'],
      ['learningsCollect', true, 'Learnings sammeln aktiviert'],
      ['scheduleTrigger', true, 'Auslöser Zeitplan verfügbar'],
    ]);
    expect(desktop[2]!.hint).toBe('(Desktop: läuft, solange SimpleCRM geöffnet ist)');
    const server = templateCheckRows(template(IDS.learningsWeekly), UNKNOWN_TEMPLATE_LIVE_CHECKS, { serverClientMode: true });
    expect(server.map((row) => [row.id, row.ok])).toEqual([
      ['chatProfile', null],
      ['learningsCollect', null],
      ['scheduleTrigger', true],
    ]);
    expect(server[2]!.hint).toBe('(Server: nach dem Laden einmal speichern, damit der Zeitplan scharf geschaltet ist)');
  });
});

test('templatePickEdits übernimmt Priorität und Zeitplan', () => {
  expect(templatePickEdits(template(IDS.spamDecision))).toEqual({ priority: '5' });
  expect(templatePickEdits(template(IDS.humanOrAiReply))).toEqual({ priority: '50' });
  expect(templatePickEdits(template(IDS.outboundDecision))).toEqual({ priority: '50' });
  expect(templatePickEdits(template(IDS.learningsWeekly))).toEqual({ cronExpr: '0 6 * * 1' });
  // Bestehende Vorlagen ändern Priorität und Zeitplan nicht.
  expect(templatePickEdits(template('inbound-ai-two-stage-reply'))).toEqual({});
  // Zeitplan nur für Zeitplan-Vorlagen; ungültige Priorität wird ignoriert.
  expect(templatePickEdits({ trigger: 'inbound', cronExpr: '0 6 * * 1', priority: 0 })).toEqual({});
});

test('Hinweis „Aktionen direkt am Auslöser“ bleibt bei den neuen Eingangsvorlagen aus', () => {
  expect(graphHasTriggerToActionShortcut(template(IDS.spamDecision).graph)).toBe(false);
  expect(graphHasTriggerToActionShortcut(template(IDS.humanOrAiReply).graph)).toBe(false);
  // Eine echte Aktion direkt am Auslöser meldet er weiterhin.
  expect(graphHasTriggerToActionShortcut({
    version: 1,
    nodes: [
      { id: 't1', type: 'trigger', data: { kind: 'inbound' } },
      { id: 'tag', type: 'registry', data: { nodeType: 'email.tag', config: { tag: 'x' } } },
    ],
    edges: [{ id: 'e0', source: 't1', target: 'tag' }],
  })).toBe(true);
  expect(graphHasTriggerToActionShortcut(template('inbound-ai-two-stage-reply').graph)).toBe(true);
});
