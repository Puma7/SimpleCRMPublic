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
  withDecisionModelProfile,
} from '../../src/components/email/workflow/workflow-template-checks';
import type { WorkflowTemplateDto } from '../../shared/workflow-types';

function template(id: string): WorkflowTemplateDto {
  const found = getWorkflowTemplate(id) as WorkflowTemplate | undefined;
  if (!found) throw new Error(`Vorlage ${id} fehlt`);
  return found as unknown as WorkflowTemplateDto;
}

const chat = { id: 1, label: 'Chat', provider: 'openai', hasApiKey: true };
const decisions = { id: 2, label: 'Jev', provider: 'openrouter_decisions', hasApiKey: true };

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
  test('Entscheidungsmodell zählt nur für „KI-Entscheidung“ und wird zum Eintragen gemerkt', () => {
    expect(aiProfileReadiness([decisions])).toEqual({
      chatProfileReady: false,
      decideProfileReady: true,
      decisionModelProfile: { id: 2, label: 'Jev' },
    });
  });

  test('Chat-Modell genügt für beides; das erste Entscheidungsmodell mit Schlüssel gewinnt', () => {
    expect(aiProfileReadiness([chat])).toEqual({
      chatProfileReady: true,
      decideProfileReady: true,
      decisionModelProfile: null,
    });
    const spanWithoutKey = { id: 3, label: 'Span', provider: 'openrouter_decisions', hasApiKey: false };
    const spanSecond = { id: 4, label: 'Span 2', provider: 'OpenRouter_Decisions', hasApiKey: true };
    expect(aiProfileReadiness([chat, spanWithoutKey, decisions, spanSecond])).toEqual({
      chatProfileReady: true,
      decideProfileReady: true,
      decisionModelProfile: { id: 2, label: 'Jev' },
    });
  });

  test('Profile ohne API-Schlüssel zählen nicht; ältere Antworten ohne Feld schon', () => {
    expect(aiProfileReadiness([{ provider: 'openai', hasApiKey: false }])).toEqual({
      chatProfileReady: false,
      decideProfileReady: false,
      decisionModelProfile: null,
    });
    expect(aiProfileReadiness([{ id: 9, provider: 'openai' }])).toMatchObject({ chatProfileReady: true, decideProfileReady: true });
    expect(aiProfileReadiness([])).toEqual({ chatProfileReady: false, decideProfileReady: false, decisionModelProfile: null });
    expect(aiProfileReadiness(null)).toEqual({ chatProfileReady: false, decideProfileReady: false, decisionModelProfile: null });
  });
});

describe('withDecisionModelProfile („Vorlage laden“)', () => {
  const decideConfig = (t: WorkflowTemplateDto, id = 'decide') =>
    (t.graph.nodes.find((n) => n.id === id)!.data as { config: Record<string, unknown> }).config;

  test('trägt das Entscheidungsmodell in „KI-Entscheidung“ ohne Profil ein, ohne das Original zu ändern', () => {
    for (const id of [IDS.spamDecision, IDS.humanOrAiReply, IDS.outboundDecision]) {
      const original = template(id);
      const before = JSON.stringify(original.graph);
      const result = withDecisionModelProfile(original, { id: 2, label: 'Jev' });
      expect(result.nodeIds).toEqual(['decide']);
      expect(decideConfig(result.template)).toMatchObject({ profileId: 2 });
      // Alle übrigen Einstellungen und Knoten bleiben, wie sie waren.
      expect({ ...decideConfig(result.template), profileId: null }).toEqual(decideConfig(original));
      expect(result.template.graph.nodes.filter((n) => n.id !== 'decide')).toEqual(
        original.graph.nodes.filter((n) => n.id !== 'decide'),
      );
      expect(JSON.stringify(original.graph)).toBe(before);
    }
  });

  test('ohne Entscheidungsmodell, mit gewähltem Profil oder ohne ai.decide bleibt alles unverändert', () => {
    const spam = template(IDS.spamDecision);
    expect(withDecisionModelProfile(spam, null)).toEqual({ template: spam, nodeIds: [] });
    const chosen = withDecisionModelProfile(spam, { id: 7, label: 'Eigenes' }).template;
    expect(withDecisionModelProfile(chosen, { id: 2, label: 'Jev' })).toEqual({ template: chosen, nodeIds: [] });
    const twoStage = template('inbound-ai-two-stage-reply');
    expect(withDecisionModelProfile(twoStage, { id: 2, label: 'Jev' })).toEqual({ template: twoStage, nodeIds: [] });
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
    decisionModelProfile: null,
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
        hint:
          '(kein Entscheidungsmodell angelegt — der Baustein „KI-Entscheidung“ nutzt das Standard-Profil; Einstellungen → E-Mail → KI)',
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

  test('Hinweis nennt das Entscheidungsmodell, das beim Laden eingetragen wird', () => {
    const rows = templateCheckRows(
      template(IDS.spamDecision),
      { ...live, decisionModelProfile: { id: 2, label: 'Jev' } },
      { serverClientMode: true },
    );
    expect(rows).toEqual([
      {
        id: 'decideProfile',
        ok: true,
        label: 'KI-Profil vom Typ Entscheidungsmodell (oder Chat-Modell)',
        hint: '(„Jev“ wird beim Laden im Baustein „KI-Entscheidung“ eingetragen)',
      },
    ]);
    const unknown = templateCheckRows(template(IDS.spamDecision), UNKNOWN_TEMPLATE_LIVE_CHECKS, { serverClientMode: false });
    expect(unknown[0]).toMatchObject({ ok: null, hint: '(Einstellungen → E-Mail → KI)' });
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
