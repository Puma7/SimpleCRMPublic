import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { WorkflowRunHistory } from '@/components/email/workflow/workflow-run-history';
import {
  configureRendererTransport,
  createHttpRendererTransport,
  createIpcRendererTransport,
  resetRendererTransportForTests,
} from '@/services/transport';
import { IPCChannels } from '@shared/ipc/channels';

jest.mock('sonner', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

jest.mock('@/components/email/workflow/use-workflow-node-catalog', () => ({
  useWorkflowNodeCatalog: () => ({ labelByType: new Map([['ai.decide', 'KI-Entscheidung']]) }),
  getCachedWorkflowNodeCatalogEntry: () => undefined,
}));

const graphNodes = [
  { id: 'decide', type: 'registry', position: { x: 0, y: 0 }, data: { nodeType: 'ai.decide', config: {} } },
] as any;

function decisionSteps() {
  return [
    {
      id: 1,
      node_id: 'decide',
      node_type: 'ai.decide',
      status: 'ok',
      port: 'default',
      duration_ms: 2,
      message: 'queued_ai_decide:280',
      detail: {
        v: 1,
        input: {
          mail: { direction: 'inbound', subject: 'Sie haben gewonnen', from: 'gewinn@example.com', excerpt: 'Klicken Sie hier.' },
          config: { question: 'Ist das Spam?', threshold: 70 },
        },
        output: { port: 'default' },
      },
    },
    {
      id: 2,
      node_id: 'decide',
      node_type: 'ai.decide',
      status: 'ok',
      port: 'unsicher',
      duration_ms: 812,
      message: 'Entscheidungsmodell: Unsicher (Ja-Wahrscheinlichkeit 45 %)',
      detail: {
        v: 1,
        input: { extra: { question: 'Ist das Spam?', threshold: 70, model: 'respan/span-01' } },
        output: {
          port: 'unsicher',
          result: { answer: 'unsicher', probability: 45 },
          note: 'Ausgang „Unsicher“ ist mit keinem Knoten verbunden – der Lauf endet hier, es passiert nichts weiter.',
        },
      },
    },
  ];
}

describe('Lauf-Historie: Eingang und Ausgang je Schritt', () => {
  afterEach(() => {
    resetRendererTransportForTests();
  });

  test('Desktop: Mail, Hinweis auf nicht verbundenen Ausgang und Eingang/Ausgang im Dialog', async () => {
    const invoke = jest.fn(async (channel: string) => {
      if (channel === IPCChannels.Email.ListWorkflowRuns) {
        return [{ id: 905, status: 'ok', message_id: 1, started_at: '2026-09-27T07:46:21Z', finished_at: '2026-09-27T07:46:21Z' }];
      }
      if (channel === IPCChannels.Email.ListWorkflowRunSteps) return decisionSteps();
      return undefined;
    });
    configureRendererTransport(createIpcRendererTransport({ invoke } as any));

    render(<WorkflowRunHistory workflowId={3} graphNodes={graphNodes} />);
    const runButton = await screen.findByText('Lauf #905', {}, { timeout: 5_000 });
    await act(async () => {
      fireEvent.click(runButton);
    });

    expect(await screen.findByText('Sie haben gewonnen')).toBeInTheDocument();
    // Eingereihter Job: verständlicher Text, kein irreführendes „Standard“.
    expect(screen.getByText(/KI-Entscheidung läuft im Hintergrund \(Job 280\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Standard/)).not.toBeInTheDocument();
    expect(screen.getByText(/Ausgang „Unsicher“ ist mit keinem Knoten verbunden/)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText('Entscheidungsmodell: Unsicher (Ja-Wahrscheinlichkeit 45 %)'));
    });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Eingang')).toBeInTheDocument();
    expect(within(dialog).getByText('Ausgang')).toBeInTheDocument();
    expect(within(dialog).getByText('Frage')).toBeInTheDocument();
    expect(within(dialog).getAllByText('Ist das Spam?').length).toBeGreaterThan(0);
    expect(within(dialog).getByText('Ja-Wahrscheinlichkeit (%)')).toBeInTheDocument();
    expect(within(dialog).getByText('45')).toBeInTheDocument();
    expect(within(dialog).getByText('respan/span-01')).toBeInTheDocument();
  });

  test('Server-Modus: Schritte werden mit includeDetail geladen und die Details angezeigt', async () => {
    const requested: string[] = [];
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      if (url.includes('/steps')) {
        const items = decisionSteps().map((step) => ({
          id: step.id,
          sourceSqliteId: null,
          runSourceSqliteId: -905,
          runId: 905,
          nodeId: step.node_id,
          nodeType: step.node_type,
          status: step.status,
          port: step.port,
          durationMs: step.duration_ms,
          message: step.message,
          detail: step.detail,
          createdAt: '2026-09-27T07:46:21Z',
          updatedAt: '2026-09-27T07:46:21Z',
        }));
        return { ok: true, status: 200, text: async () => JSON.stringify({ data: { items, nextCursor: null } }) } as Response;
      }
      if (url.includes('/runs')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            data: {
              items: [{
                id: 905,
                sourceSqliteId: -905,
                workflowId: 3,
                workflowSourceSqliteId: 3,
                messageId: 1,
                messageSourceSqliteId: 1,
                direction: 'inbound',
                status: 'ok',
                startedAt: '2026-09-27T07:46:21Z',
                finishedAt: '2026-09-27T07:46:21Z',
                updatedAt: '2026-09-27T07:46:21Z',
              }],
              nextCursor: null,
            },
          }),
        } as Response;
      }
      return { ok: false, status: 404, text: async () => '{}' } as Response;
    });
    configureRendererTransport(createHttpRendererTransport({ baseUrl: 'https://crm.example.com', fetchImpl: fetchImpl as typeof fetch }));

    render(<WorkflowRunHistory workflowId={3} graphNodes={graphNodes} />);
    const runButton = await screen.findByText(/Lauf #/, {}, { timeout: 5_000 });
    await act(async () => {
      fireEvent.click(runButton);
    });

    await waitFor(() => expect(screen.getByText(/Ausgang „Unsicher“ ist mit keinem Knoten verbunden/)).toBeInTheDocument());
    expect(requested.some((url) => url.includes('/steps') && url.includes('includeDetail=true'))).toBe(true);
    expect(screen.getByText('Sie haben gewonnen')).toBeInTheDocument();
  });
});
