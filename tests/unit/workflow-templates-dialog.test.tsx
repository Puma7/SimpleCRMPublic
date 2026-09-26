/**
 * TA-P6: Vorlagen-Dialog zeigt für die Teilautomatisierung die Checkliste mit
 * Live-Ampel (Desktop über IPC, Server über HTTP) und übergibt die Vorlage
 * samt Priorität/Zeitplan an „Vorlage laden“.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { WorkflowTemplatesDialog } from '@/components/email/workflow/workflow-templates-dialog';
import {
  configureRendererTransport,
  createHttpRendererTransport,
  createIpcRendererTransport,
  resetRendererTransportForTests,
} from '@/services/transport';
import { IPCChannels } from '@shared/ipc/channels';
import { PARTIAL_AUTOMATION_TEMPLATE_IDS as IDS, partialAutomationWorkflowTemplates } from '@simplecrm/core';

const TEMPLATES = partialAutomationWorkflowTemplates();

function card(templateId: string): HTMLElement {
  const element = document.querySelector(`[data-template-id="${templateId}"]`);
  if (!element) throw new Error(`Vorlage ${templateId} nicht angezeigt`);
  return element as HTMLElement;
}

function checkStates(templateId: string): Record<string, string | null> {
  return Object.fromEntries(
    Array.from(card(templateId).querySelectorAll('[data-check]')).map((row) => [
      row.getAttribute('data-check'),
      row.getAttribute('data-state'),
    ]),
  );
}

function jsonResponse(value: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(value) } as Response;
}

describe('Vorlagen-Dialog: Teilautomatisierung', () => {
  afterEach(() => {
    resetRendererTransportForTests();
  });

  test('Desktop: Checkliste mit Entscheidungsmodell, Wissensbasis, Learnings und Zeitplan', async () => {
    const invoke = jest.fn(async (channel: string) => {
      switch (channel) {
        case IPCChannels.Email.ListWorkflowTemplates:
          return TEMPLATES;
        case IPCChannels.Email.ListAiProfiles:
          // Nur ein Entscheidungsmodell: reicht für „KI-Entscheidung“, nicht für Entwurf/Gegenprüfung.
          return [{ id: 1, label: 'Jev', provider: 'openrouter_decisions', hasApiKey: true }];
        case IPCChannels.Email.ListKnowledgeBases:
          return [{ id: 3, name: 'FAQ' }];
        case IPCChannels.Email.GetLearningsOverview:
          return { settings: { collectEnabled: false, targetKnowledgeBaseId: null, profileId: null } };
        case IPCChannels.Email.ListCannedResponses:
          return [];
        case IPCChannels.Email.GetWorkflowAutomationSettings:
          return { autoReplyEnabled: true };
        case IPCChannels.Email.ListWorkflowNodeCatalog:
          return [];
        default:
          return undefined;
      }
    });
    configureRendererTransport(createIpcRendererTransport({ invoke } as any));
    const onPick = jest.fn();
    const onOpenChange = jest.fn();

    render(<WorkflowTemplatesDialog open onOpenChange={onOpenChange} onPick={onPick} />);

    await screen.findByText('Eingehend: Spam-Entscheidung (Entscheidungsmodell)');
    await waitFor(() => expect(checkStates(IDS.learningsWeekly).learningsCollect).toBe('missing'));
    expect(checkStates(IDS.spamDecision)).toEqual({ decideProfile: 'ok' });
    expect(checkStates(IDS.humanOrAiReply)).toEqual({
      chatProfile: 'missing',
      decideProfile: 'ok',
      autoReply: 'ok',
      knowledgeBase: 'ok',
    });
    expect(checkStates(IDS.outboundDecision)).toEqual({ decideProfile: 'ok' });
    expect(checkStates(IDS.learningsWeekly)).toEqual({
      chatProfile: 'missing',
      learningsCollect: 'missing',
      scheduleTrigger: 'ok',
    });
    const spamCard = within(card(IDS.spamDecision));
    expect(spamCard.getByText('KI-Profil vom Typ Entscheidungsmodell (oder Chat-Modell)')).toBeInTheDocument();
    expect(spamCard.getByText('Beim Laden eingetragen: Priorität 5')).toBeInTheDocument();
    expect(within(card(IDS.learningsWeekly)).getByText('Beim Laden eingetragen: Zeitplan 0 6 * * 1')).toBeInTheDocument();
    expect(within(card(IDS.learningsWeekly)).getByText('(Desktop: läuft, solange SimpleCRM geöffnet ist)')).toBeInTheDocument();

    expect(
      spamCard.getByText('(„Jev“ wird beim Laden im Baustein „KI-Entscheidung“ eingetragen)'),
    ).toBeInTheDocument();

    fireEvent.click(within(card(IDS.learningsWeekly)).getByRole('button', { name: 'Vorlage laden' }));
    expect(onPick).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: IDS.learningsWeekly, cronExpr: '0 6 * * 1' }),
      { decisionProfileLabel: null },
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);

    // „Vorlage laden“ trägt das Entscheidungsmodell in „KI-Entscheidung“ ein —
    // nur in die übergebene Kopie, die mitgelieferte Vorlage bleibt leer.
    fireEvent.click(spamCard.getByRole('button', { name: 'Vorlage laden' }));
    const [picked, info] = onPick.mock.calls.at(-1)!;
    expect(info).toEqual({ decisionProfileLabel: 'Jev' });
    const decide = picked.graph.nodes.find((n: { id: string }) => n.id === 'decide');
    expect(decide.data.config).toMatchObject({ profileId: 1, question: 'Ist diese E-Mail Spam, Phishing oder unerwünschte Werbung?' });
    const shipped = TEMPLATES.find((t) => t.id === IDS.spamDecision)!;
    expect((shipped.graph.nodes.find((n) => n.id === 'decide')!.data as any).config.profileId).toBeNull();
  });

  test('Server: Checkliste über HTTP, Zeitplan-Hinweis „einmal speichern“', async () => {
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/workflow/templates')) return jsonResponse({ data: TEMPLATES });
      if (url.includes('/api/v1/ai/profiles')) {
        return jsonResponse({ data: { items: [{ id: 5, label: 'Chat', provider: 'openai', apiKeyConfigured: true }], nextCursor: null } });
      }
      if (url.includes('/api/v1/workflow/node-catalog')) return jsonResponse({ data: [] });
      if (url.includes('/api/v1/workflow-knowledge-bases')) return jsonResponse({ data: { items: [], nextCursor: null } });
      if (url.includes('/api/v1/ai-learnings/overview')) {
        return jsonResponse({ data: { settings: { collectEnabled: true, targetKnowledgeBaseId: null, profileId: null } } });
      }
      return jsonResponse({ error: { code: 'not_found' } }, 404);
    });
    configureRendererTransport(createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl: fetchImpl as typeof fetch,
    }));

    const onPick = jest.fn();
    render(<WorkflowTemplatesDialog open onOpenChange={jest.fn()} onPick={onPick} />);

    await screen.findByText('Learnings wöchentlich auswerten');
    await waitFor(() => expect(checkStates(IDS.learningsWeekly).learningsCollect).toBe('ok'));
    await waitFor(() => expect(checkStates(IDS.humanOrAiReply).knowledgeBase).toBe('missing'));
    expect(checkStates(IDS.humanOrAiReply)).toEqual({
      chatProfile: 'ok',
      decideProfile: 'ok',
      // Automatisierungs-Einstellungen nicht erreichbar → neutral statt rot.
      autoReply: 'unknown',
      knowledgeBase: 'missing',
    });
    expect(checkStates(IDS.learningsWeekly).scheduleTrigger).toBe('ok');
    expect(
      within(card(IDS.learningsWeekly)).getByText(
        '(Server: nach dem Laden einmal speichern, damit der Zeitplan scharf geschaltet ist)',
      ),
    ).toBeInTheDocument();
    const paths = fetchImpl.mock.calls.map(([input]) => new URL(String(input)).pathname);
    expect(paths).toEqual(expect.arrayContaining(['/api/v1/workflow-knowledge-bases', '/api/v1/ai-learnings/overview']));
    // Nur ein Chat-Modell: „KI-Entscheidung“ bleibt beim Laden leer (Standard-Profil), die Checkliste sagt es.
    expect(
      within(card(IDS.outboundDecision)).getByText(
        '(kein Entscheidungsmodell angelegt — der Baustein „KI-Entscheidung“ nutzt das Standard-Profil; Einstellungen → E-Mail → KI)',
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(card(IDS.outboundDecision)).getByRole('button', { name: 'Vorlage laden' }));
    const [picked, info] = onPick.mock.calls.at(-1)!;
    expect(info).toEqual({ decisionProfileLabel: null });
    expect(picked.graph.nodes.find((n: { id: string }) => n.id === 'decide').data.config.profileId).toBeNull();
  });

  test('Server: Entscheidungsmodell aus der HTTP-Profilliste wird beim Laden eingetragen', async () => {
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/workflow/templates')) return jsonResponse({ data: TEMPLATES });
      if (url.includes('/api/v1/ai/profiles')) {
        return jsonResponse({
          data: {
            items: [
              { id: 5, label: 'Chat', provider: 'openai', apiKeyConfigured: true },
              { id: 8, label: 'Jev', provider: 'openrouter_decisions', apiKeyConfigured: true },
            ],
            nextCursor: null,
          },
        });
      }
      return jsonResponse({ error: { code: 'not_found' } }, 404);
    });
    configureRendererTransport(createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl: fetchImpl as typeof fetch,
    }));
    const onPick = jest.fn();

    render(<WorkflowTemplatesDialog open onOpenChange={jest.fn()} onPick={onPick} />);

    await screen.findByText('Eingehend: Mensch oder KI? → KI-Antwort mit Gegenprüfung');
    await within(card(IDS.humanOrAiReply)).findByText('(„Jev“ wird beim Laden im Baustein „KI-Entscheidung“ eingetragen)');
    fireEvent.click(within(card(IDS.humanOrAiReply)).getByRole('button', { name: 'Vorlage laden' }));
    const [picked, info] = onPick.mock.calls.at(-1)!;
    expect(info).toEqual({ decisionProfileLabel: 'Jev' });
    const configs = Object.fromEntries(
      picked.graph.nodes.map((n: { id: string; data: { config?: Record<string, unknown> } }) => [n.id, n.data.config]),
    );
    expect(configs.decide).toMatchObject({ profileId: 8 });
    // Entwurf und Gegenprüfung behalten das Standard-Profil (Chat-Modell).
    expect(configs.review).toEqual({ draftIdVariable: 'draft.id', reviewPrompt: '' });
    expect(configs.draft.profileId).toBeUndefined();
  });
});
