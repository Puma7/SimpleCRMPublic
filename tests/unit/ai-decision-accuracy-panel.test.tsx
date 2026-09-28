import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AiDecisionAccuracyPanel } from '@/components/email/workflow/ai-decision-accuracy';
import {
  configureRendererTransport,
  createHttpRendererTransport,
  createIpcRendererTransport,
  resetRendererTransportForTests,
} from '@/services/transport';
import { IPCChannels } from '@shared/ipc/channels';

/**
 * Plan 050: „Treffsicherheit (90 Tage)“ am Knoten `ai.decide` – Hinweis ohne
 * Rückmeldungsart, Kennzahlen, Schwellen-Vorschlag mit „Übernehmen“ (ändert nur
 * die Einstellung im Editor) und Server-Modus über die HTTP-Route.
 */
function stats(overrides: Record<string, unknown> = {}) {
  return {
    total: 40,
    byAnswer: { ja: 20, nein: 15, unsicher: 4, error: 1 },
    histogram: [10, 5, 0, 0, 1, 3, 1, 0, 5, 15],
    closed: 36,
    agreed: 27,
    overridden: 3,
    agreementRate: 0.9,
    labelled: 32,
    minSamples: 30,
    suggestedThreshold: 85,
    ...overrides,
  };
}

describe('Treffsicherheit der KI-Entscheidung im Knoten', () => {
  afterEach(() => {
    resetRendererTransportForTests();
  });

  test('Desktop: Kennzahlen, Vorschlag übernehmen, Hinweis ohne Rückmeldungsart', async () => {
    const invoke = jest.fn(async (channel: string, _payload: unknown) => {
      if (channel === IPCChannels.Email.GetAiDecisionStats) return stats();
      return undefined;
    });
    configureRendererTransport(createIpcRendererTransport({ invoke } as any));
    const onApply = jest.fn();

    const { rerender } = render(
      <AiDecisionAccuracyPanel workflowId={3} nodeId="decide" config={{ threshold: 80, feedbackSignal: 'spam' }} onApplyThreshold={onApply} />,
    );
    expect(await screen.findByText(/40 Entscheidungen/)).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith(IPCChannels.Email.GetAiDecisionStats, { workflowId: 3, nodeId: 'decide', days: 90 });
    expect(screen.getByTestId('ai-decision-agreement')).toHaveTextContent('Übereinstimmung mit Menschen: 90 % (27 bestätigt, 3 korrigiert)');
    expect(screen.getByTestId('ai-decision-suggestion')).toHaveTextContent('Vorschlag: Schwelle 85 (aktuell 80');
    expect(screen.queryByTestId('ai-decision-feedback-hint')).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    });
    expect(onApply).toHaveBeenCalledWith(85);

    // Gleiche Schwelle: kein Knopf. Ohne Rückmeldungsart: Hinweis.
    rerender(
      <AiDecisionAccuracyPanel workflowId={3} nodeId="decide" config={{ threshold: 85 }} onApplyThreshold={onApply} />,
    );
    expect(screen.queryByRole('button', { name: 'Übernehmen' })).not.toBeInTheDocument();
    expect(screen.getByTestId('ai-decision-feedback-hint')).toBeInTheDocument();
  });

  test('zu wenige Fälle: kein Vorschlag; ohne abgeschlossene Fälle keine Übereinstimmung', async () => {
    const invoke = jest.fn(async () => stats({ agreementRate: null, agreed: 0, overridden: 0, labelled: 4, suggestedThreshold: null }));
    configureRendererTransport(createIpcRendererTransport({ invoke } as any));
    render(<AiDecisionAccuracyPanel workflowId={3} nodeId="decide" config={{ feedbackSignal: 'spam' }} onApplyThreshold={jest.fn()} />);
    expect(await screen.findByTestId('ai-decision-suggestion')).toHaveTextContent('Schwellen-Vorschlag ab 30 Fällen mit bekannter Antwort (bisher 4).');
    expect(screen.getByTestId('ai-decision-agreement')).toHaveTextContent('noch keine abgeschlossenen Ja/Nein-Fälle');
  });

  test('ungespeicherter Workflow: keine Anfrage', async () => {
    const invoke = jest.fn();
    configureRendererTransport(createIpcRendererTransport({ invoke } as any));
    render(<AiDecisionAccuracyPanel workflowId={null} nodeId="decide" config={{}} onApplyThreshold={jest.fn()} />);
    expect(screen.getByText(/sobald der Workflow gespeichert ist/)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });

  test('Server-Modus: GET …/by-source/:id/ai-decisions mit nodeId und days', async () => {
    const requested: string[] = [];
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: stats({ total: 7 }) }) } as Response;
    });
    configureRendererTransport(createHttpRendererTransport({ baseUrl: 'https://crm.example.com', fetchImpl: fetchImpl as typeof fetch }));
    render(<AiDecisionAccuracyPanel workflowId={3} nodeId="decide" config={{ feedbackSignal: 'spam' }} onApplyThreshold={jest.fn()} />);
    await waitFor(() => expect(screen.getByText(/7 Entscheidungen/)).toBeInTheDocument());
    expect(requested).toEqual(['https://crm.example.com/api/v1/workflows/by-source/3/ai-decisions?nodeId=decide&days=90']);
  });
});
