/**
 * TA-P6 Vorlagenpaket „Teilautomatisierung“: die vier Vorlagen sind in beiden
 * Editionen angeboten, speichern ohne Fehler und ohne ungewollte Warnungen
 * (keine Outbound-Falle, keine unbeschriftete Kante an Mehr-Port-Knoten,
 * Inbound-Gate erfüllt) und tragen Priorität bzw. Zeitplan für den Editor.
 * Durchläufe: tests/mail/workflow-template-partial-automation-e2e.test.ts
 * (Desktop) und tests/integration/postgres-workflow-templates-partial-automation.test.ts
 * (Server).
 */
import {
  compileGraphToDefinition,
  findInboundDelaysHoldingChain,
  findLoopBodyDeferringNodes,
  findOutboundGraphTraps,
  findWorkflowConfigRisks,
  getWorkflowTemplate,
  listBuiltinWorkflowNodeCatalog,
  PARTIAL_AUTOMATION_TEMPLATE_IDS,
  partialAutomationWorkflowTemplates,
  WORKFLOW_TEMPLATES,
  type WorkflowGraphDocument,
  type WorkflowTemplate,
} from '@simplecrm/core';
import { findOutboundGraphTraps as findOutboundGraphTrapsShared } from '../../electron/email/email-workflow-graph-compile';
import { inboundNodeRequiresConditionGate } from '../../electron/workflow/inbound-gate';
import { ensureBuiltinWorkflowNodes, listWorkflowNodeCatalog } from '../../electron/workflow/registry';
import { WORKFLOW_TEMPLATES as DESKTOP_WORKFLOW_TEMPLATES } from '../../electron/workflow/templates';
import {
  isServerWorkflowNodeTypeSupported,
  listServerWorkflowNodeCatalog,
} from '../../packages/server/src/workflow-node-catalog';
import { createServerApi } from '../../packages/server/src/api/server-api';
import type { AuthenticatedPrincipal, ServerApiPorts } from '../../packages/server/src/api/types';
import {
  createStaticWorkflowTemplatePort,
  listServerWorkflowTemplates,
} from '../../packages/server/src/workflow-templates';
import { validateWorkflowGraphConfigs } from '../../shared/workflow-config-validate';
import type { WorkflowNodeCatalogEntry } from '../../shared/workflow-types';

const IDS = PARTIAL_AUTOMATION_TEMPLATE_IDS;
const ALL_IDS = [IDS.spamDecision, IDS.humanOrAiReply, IDS.outboundDecision, IDS.learningsWeekly];

function template(id: string): WorkflowTemplate {
  const found = getWorkflowTemplate(id);
  if (!found) throw new Error(`Vorlage ${id} fehlt`);
  return found;
}

function node(t: WorkflowTemplate, id: string) {
  const found = t.graph.nodes.find((n) => n.id === id);
  if (!found) throw new Error(`Knoten ${id} fehlt in ${t.id}`);
  return found.data as { nodeType?: string; config?: Record<string, unknown> };
}

function edgeLabels(t: WorkflowTemplate, source: string): Record<string, string> {
  return Object.fromEntries(
    t.graph.edges.filter((e) => e.source === source).map((e) => [String(e.label ?? ''), e.target]),
  );
}

/** Wie der Editor beim Speichern (workflow-shell handleSave). */
function editorIssues(t: WorkflowTemplate, catalog: readonly WorkflowNodeCatalogEntry[]) {
  const byType = new Map(catalog.map((entry) => [entry.type, entry]));
  const nodes = t.graph.nodes.map((n) => {
    const data = n.data as { nodeType?: string; config?: Record<string, unknown> };
    return {
      id: n.id,
      nodeType: typeof data.nodeType === 'string' ? data.nodeType : null,
      title: n.id,
      config: data.config ?? {},
    };
  });
  const edges = t.graph.edges.map((e) => ({ source: e.source, label: typeof e.label === 'string' ? e.label : null }));
  return validateWorkflowGraphConfigs(nodes, edges, byType);
}

describe('Vorlagenpaket Teilautomatisierung (TA-P6)', () => {
  test('vier Vorlagen mit Name, Auslöser, Priorität und Zeitplan', () => {
    expect(partialAutomationWorkflowTemplates().map((t) => t.id)).toEqual(ALL_IDS);
    expect(ALL_IDS.map((id) => {
      const t = template(id);
      return { id, name: t.name, trigger: t.trigger, priority: t.priority, cronExpr: t.cronExpr };
    })).toEqual([
      {
        id: IDS.spamDecision,
        name: 'Eingehend: Spam-Entscheidung (Entscheidungsmodell)',
        trigger: 'inbound',
        priority: 5,
        cronExpr: undefined,
      },
      {
        id: IDS.humanOrAiReply,
        name: 'Eingehend: Mensch oder KI? → KI-Antwort mit Gegenprüfung',
        trigger: 'inbound',
        priority: 50,
        cronExpr: undefined,
      },
      {
        id: IDS.outboundDecision,
        name: 'Ausgehend: KI-Entscheidung vor dem Versand',
        trigger: 'outbound',
        priority: 50,
        cronExpr: undefined,
      },
      {
        id: IDS.learningsWeekly,
        name: 'Learnings wöchentlich auswerten',
        trigger: 'schedule',
        priority: undefined,
        cronExpr: '0 6 * * 1',
      },
    ]);
    // Trigger-Knoten passt zum Auslöser der Vorlage; Ids sind eindeutig.
    for (const id of ALL_IDS) {
      const t = template(id);
      const trigger = t.graph.nodes.find((n) => n.type === 'trigger');
      expect((trigger?.data as { kind?: string }).kind).toBe(t.trigger);
      expect(t.description.length).toBeGreaterThan(80);
    }
    expect(new Set(WORKFLOW_TEMPLATES.map((t) => t.id)).size).toBe(WORKFLOW_TEMPLATES.length);
  });

  test('beide Editionen bieten alle vier Vorlagen an, alle Knoten laufen dort', () => {
    ensureBuiltinWorkflowNodes();
    const desktopTypes = new Set(listWorkflowNodeCatalog().map((entry) => entry.type));
    const desktopIds = DESKTOP_WORKFLOW_TEMPLATES.map((t) => t.id);
    const serverIds = listServerWorkflowTemplates().map((t) => t.id);
    for (const id of ALL_IDS) {
      expect(desktopIds).toContain(id);
      expect(serverIds).toContain(id);
      for (const n of template(id).graph.nodes) {
        const nodeType = (n.data as { nodeType?: string }).nodeType;
        if (typeof nodeType !== 'string') continue;
        expect({ id, nodeType, desktop: desktopTypes.has(nodeType) }).toEqual({ id, nodeType, desktop: true });
        expect({ id, nodeType, server: isServerWorkflowNodeTypeSupported(nodeType) }).toEqual({ id, nodeType, server: true });
      }
    }
  });

  test('Server-API liefert die vier Vorlagen mit Priorität und Zeitplan', async () => {
    const api = createServerApi({
      auth: {} as ServerApiPorts['auth'],
      locks: {} as ServerApiPorts['locks'],
      workflowTemplates: createStaticWorkflowTemplatePort(),
    } as unknown as ServerApiPorts);
    const response = await api.handle({
      method: 'GET',
      path: '/api/v1/workflow/templates',
      principal: {
        userId: '10000000-0000-4000-8000-0000000000f2',
        workspaceId: '10000000-0000-4000-8000-0000000000f1',
        role: 'user',
        capabilities: ['workflows.manage'],
      } as AuthenticatedPrincipal,
    });
    expect(response.status).toBe(200);
    const rows = (response.body as { data: Array<{ id: string; priority?: number; cronExpr?: string }> }).data;
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(ALL_IDS.map((id) => ({ id, priority: byId.get(id)?.priority, cronExpr: byId.get(id)?.cronExpr }))).toEqual([
      { id: IDS.spamDecision, priority: 5, cronExpr: undefined },
      { id: IDS.humanOrAiReply, priority: 50, cronExpr: undefined },
      { id: IDS.outboundDecision, priority: 50, cronExpr: undefined },
      { id: IDS.learningsWeekly, priority: undefined, cronExpr: '0 6 * * 1' },
    ]);
    // Bestehende Vorlagen ohne Empfehlung bekommen keine erfundenen Felder.
    expect(Object.keys(byId.get('inbound-ai-two-stage-reply') ?? {}).sort()).toEqual(
      ['description', 'graph', 'id', 'name', 'trigger'],
    );
  });

  test('Speichern im Editor: keine Fehler und keine Kanten-Warnungen (Desktop- und Server-Katalog)', () => {
    ensureBuiltinWorkflowNodes();
    for (const id of ALL_IDS) {
      const t = template(id);
      expect({ id, issues: editorIssues(t, listWorkflowNodeCatalog()) }).toEqual({ id, issues: [] });
      expect({ id, issues: editorIssues(t, listServerWorkflowNodeCatalog()) }).toEqual({ id, issues: [] });
    }
  });

  test('jede Kante an einem Mehr-Port-Knoten trägt einen gültigen Ausgang', () => {
    const portsByType = new Map(
      listBuiltinWorkflowNodeCatalog().map((entry) => [entry.type, (entry.ports ?? []).map((p) => p.id)]),
    );
    for (const id of ALL_IDS) {
      const t = template(id);
      for (const e of t.graph.edges) {
        const sourceType = (t.graph.nodes.find((n) => n.id === e.source)?.data as { nodeType?: string }).nodeType;
        const ports = sourceType ? portsByType.get(sourceType) ?? [] : [];
        if (ports.length > 1) expect({ id, edge: e.id, ok: ports.includes(String(e.label)) }).toEqual({ id, edge: e.id, ok: true });
        else expect({ id, edge: e.id, label: e.label }).toEqual({ id, edge: e.id, label: undefined });
      }
    }
  });

  test('keine Outbound-Falle, keine haltende Verzögerung, keine asynchronen Schleifen, kompilierbar', () => {
    for (const id of ALL_IDS) {
      const graph = template(id).graph as WorkflowGraphDocument;
      expect(findOutboundGraphTraps(graph)).toEqual([]);
      expect(findOutboundGraphTrapsShared(graph as never)).toEqual([]);
      expect(findInboundDelaysHoldingChain(graph)).toEqual([]);
      expect(findLoopBodyDeferringNodes(graph, { edition: 'desktop' })).toEqual([]);
      expect(findLoopBodyDeferringNodes(graph, { edition: 'server' })).toEqual([]);
      expect(() => compileGraphToDefinition(graph)).not.toThrow();
    }
    expect(findOutboundGraphTraps(template(IDS.outboundDecision).graph, { effectiveTrigger: 'outbound' })).toEqual([]);
  });

  test('Konfigurations-Risiken: nur die gewollte Freigabe im Ausgang (wie „KI-Qualitätsprüfung“)', () => {
    expect(findWorkflowConfigRisks(template(IDS.spamDecision).graph)).toEqual([]);
    // runOutboundReview: true — die KI-Antwort geht durch die Ausgangs-Workflows.
    expect(findWorkflowConfigRisks(template(IDS.humanOrAiReply).graph)).toEqual([]);
    expect(findWorkflowConfigRisks(template(IDS.learningsWeekly).graph)).toEqual([]);
    // Im Ausgang ist die KI-Entscheidung selbst der Freigabeschritt; der Hinweis
    // erscheint genauso bei der bestehenden Vorlage outbound-quality-check.
    const expected = [{ code: 'auto_send_without_review', nodeId: 'release', nodeType: 'email.release_outbound' }];
    expect(findWorkflowConfigRisks(template(IDS.outboundDecision).graph)).toEqual(expected);
    expect(findWorkflowConfigRisks(template('outbound-quality-check').graph)).toEqual(expected);
  });

  test('Inbound-Gate: Aktionen liegen nur hinter der KI-Entscheidung', () => {
    for (const id of [IDS.spamDecision, IDS.humanOrAiReply]) {
      const t = template(id);
      const byId = new Map(t.graph.nodes.map((n) => [n.id, n]));
      // Breitensuche vom Auslöser bis zur ersten Bedingung (ai.decide öffnet das Gate).
      const start = t.graph.nodes.find((n) => n.type === 'trigger')!.id;
      const queue = [start];
      const beforeGate: string[] = [];
      while (queue.length > 0) {
        const current = queue.shift()!;
        const n = byId.get(current)!;
        if ((n.data as { nodeType?: string }).nodeType === 'ai.decide') continue;
        beforeGate.push(current);
        expect({ id, node: current, needsGate: inboundNodeRequiresConditionGate(n as never) })
          .toEqual({ id, node: current, needsGate: false });
        for (const e of t.graph.edges) if (e.source === current) queue.push(e.target);
      }
      expect(beforeGate[0]).toBe(start);
    }
  });

  test('a: Spam-Entscheidung — Ja → Spam + Verschieben + Stopp, Unsicher → prüfen + Stopp, Nein offen, KI-Fehler → ki-fehler', () => {
    const t = template(IDS.spamDecision);
    expect(node(t, 'decide')).toEqual({
      nodeType: 'ai.decide',
      config: expect.objectContaining({
        question: 'Ist diese E-Mail Spam, Phishing oder unerwünschte Werbung?',
        contextMode: 'full',
        threshold: 80,
        profileId: null,
      }),
    });
    expect(String(node(t, 'decide').config?.yesCriteria)).toContain('Phishing');
    expect(String(node(t, 'decide').config?.noCriteria)).toContain('Kunden');
    expect(edgeLabels(t, 'decide')).toEqual({ ja: 'spam', unsicher: 'review', error: 'tag_error' });
    expect(node(t, 'spam')).toEqual({
      nodeType: 'email.mark_spam',
      config: { spam: true, tag: 'ki-spam', moveImap: true, train: false, stopFurtherWorkflows: true },
    });
    expect(edgeLabels(t, 'spam')).toEqual({ '': 'stop_spam' });
    expect(node(t, 'stop_spam').nodeType).toBe('logic.stop_after_spam');
    expect(node(t, 'review')).toEqual({
      nodeType: 'email.set_spam_status',
      config: { status: 'review', tag: 'spam-pruefen', train: false, stopFurtherWorkflows: true },
    });
    expect(edgeLabels(t, 'review')).toEqual({ '': 'stop_review' });
    expect(node(t, 'tag_error')).toEqual({ nodeType: 'email.tag', config: { tag: 'ki-fehler' } });
  });

  test('b: Mensch oder KI — Entscheidung, Gate mit ai.decide.confidence, Zwei-Stufen-Antwort mit Ausgangsprüfung', () => {
    const t = template(IDS.humanOrAiReply);
    const decide = node(t, 'decide').config!;
    expect(decide).toMatchObject({ question: 'Muss ein Mensch diese Anfrage bearbeiten?', contextMode: 'full', threshold: 80 });
    for (const needle of ['Beschwerde', 'rechtliches', 'Preisverhandlung', 'Kündigung', 'Zahlungsproblem', 'sensible Daten', 'mehrere Anliegen', 'mehrdeutige', 'Wissensbasis']) {
      expect(String(decide.yesCriteria)).toContain(needle);
    }
    for (const needle of ['Öffnungszeiten', 'Versand', 'Lieferzeiten', 'Produktinformationen', 'Stand einer Bestellung']) {
      expect(String(decide.noCriteria)).toContain(needle);
    }
    expect(edgeLabels(t, 't1')).toEqual({ '': 'stop_spam' });
    expect(edgeLabels(t, 'stop_spam')).toEqual({ '': 'decide' });
    expect(edgeLabels(t, 'decide')).toEqual({ ja: 'tag_manual', unsicher: 'tag_manual', error: 'tag_manual', nein: 'gate' });
    expect(node(t, 'tag_manual').config).toEqual({ tag: 'manuell' });
    expect(node(t, 'gate')).toEqual({
      nodeType: 'email.auto_reply',
      config: { confidenceVar: 'ai.decide.confidence', minConfidence: 80 },
    });
    expect(edgeLabels(t, 'gate')).toEqual({ approved: 'draft', blocked: 'tag_blocked' });
    expect(node(t, 'tag_blocked').config).toEqual({ tag: 'ki-manuell' });
    // Bewährte Einstellungen der Zwei-Stufen-Vorlage übernommen.
    const twoStage = template('inbound-ai-two-stage-reply');
    expect(node(t, 'draft')).toEqual(node(twoStage, 'draft'));
    expect(node(t, 'review')).toEqual(node(twoStage, 'review'));
    expect(node(t, 'tag_review')).toEqual(node(twoStage, 'tag_review'));
    expect(node(t, 'task_review')).toEqual(node(twoStage, 'task_review'));
    expect(node(t, 'draft').config?.knowledgeBaseId).toBeNull();
    expect(edgeLabels(t, 'draft')).toEqual({ '': 'review' });
    expect(edgeLabels(t, 'review')).toEqual({ send: 'send', hold: 'tag_review' });
    expect(node(t, 'send')).toEqual({
      nodeType: 'email.send_draft',
      config: { draftIdVariable: 'draft.id', runOutboundReview: true },
    });
  });

  test('c: Ausgang — Ja gibt frei (autoSend), alle anderen Ausgänge taggen ausgang-blockiert', () => {
    const t = template(IDS.outboundDecision);
    expect(node(t, 'decide').config).toMatchObject({
      question: 'Ist diese E-Mail in dieser Form an den Kunden versandfähig?',
      contextMode: 'full',
      threshold: 80,
    });
    const yes = String(node(t, 'decide').config?.yesCriteria);
    for (const needle of ['höflich', 'Anrede', 'beantwortet', 'internen Informationen', 'Zusagen', 'sensiblen Daten Dritter', 'Anhänge']) {
      expect(yes).toContain(needle);
    }
    expect(edgeLabels(t, 'decide')).toEqual({
      ja: 'release',
      nein: 'tag_blocked',
      unsicher: 'tag_blocked',
      error: 'tag_blocked',
    });
    expect(node(t, 'release')).toEqual({ nodeType: 'email.release_outbound', config: { autoSend: true } });
    expect(node(t, 'tag_blocked').config).toEqual({ tag: 'ausgang-blockiert' });
  });

  test('d: Learnings — Zeitplan Mo 06:00, Zeitraum Woche, ab 3 Einträgen', () => {
    const t = template(IDS.learningsWeekly);
    expect(node(t, 'digest')).toEqual({
      nodeType: 'ai.learnings_digest',
      config: { knowledgeBaseId: null, period: 'week', minCandidates: 3, profileId: null },
    });
    expect(t.description).toContain('einmal speichern');
    expect(t.description).toMatch(/täglich|monatlich/i);
  });
});
