/**
 * Plan 046: Details → Automatik – alle Workflow-Läufe einer Mail mit Ergebnis,
 * KI-Entscheidung und Fortsetzung; ein Klick öffnet die Schritte.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockInvoke = jest.fn();
jest.mock('@/services/transport', () => ({
  invokeRenderer: (...args: unknown[]) => mockInvoke(...args),
}));
const mockDialog = jest.fn();
jest.mock('../../src/components/email/workflow/workflow-run-detail-dialog', () => ({
  WorkflowRunDetailDialog: (props: { runId: number | null; open: boolean }) => {
    mockDialog(props);
    return props.open ? <div data-testid="run-dialog">Lauf {props.runId}</div> : null;
  },
}));

import { IPCChannels } from '@shared/ipc/channels';
import type { MessageWorkflowRunSummary } from '@shared/workflow-run-message-history';
import { MessageAutomationHistory } from '../../src/components/email/message-automation-history';

function run(overrides: Partial<MessageWorkflowRunSummary>): MessageWorkflowRunSummary {
  return {
    id: 1,
    server_id: 1,
    workflow_id: 7,
    workflow_name: 'Rückgaben',
    direction: 'inbound',
    status: 'completed',
    started_at: null,
    finished_at: null,
    last_step: null,
    decision: null,
    continued_from_run_id: null,
    dry_run: false,
    ...overrides,
  };
}

describe('MessageAutomationHistory', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockDialog.mockReset();
  });

  test('zeigt Workflow, Status, Ausgang und KI-Entscheidung', async () => {
    mockInvoke.mockResolvedValue([
      run({
        id: -91,
        server_id: 401,
        last_step: { node_type: 'ai.decide', status: 'ok', port: 'yes' },
        decision: { answer: 'ja', probability: 88, summary: 'Kunde möchte zurückgeben' },
      }),
    ]);
    render(<MessageAutomationHistory messageId={55} />);
    expect(await screen.findByText('Rückgaben')).toBeInTheDocument();
    expect(mockInvoke).toHaveBeenCalledWith(IPCChannels.Email.ListWorkflowRunsForMessage, { messageId: 55 });
    expect(screen.getByText('abgeschlossen')).toBeInTheDocument();
    expect(screen.getByText(/^Ausgang:/)).toBeInTheDocument();
    expect(screen.getByText('KI: ja · 88 % — Kunde möchte zurückgeben')).toBeInTheDocument();
  });

  test('Fortsetzung eingerückt unter dem Ursprungslauf', async () => {
    mockInvoke.mockResolvedValue([
      run({ id: -92, server_id: 402, workflow_name: 'Rückgaben', continued_from_run_id: 401 }),
      run({ id: -91, server_id: 401, workflow_name: 'Rückgaben' }),
    ]);
    render(<MessageAutomationHistory messageId={55} />);
    expect(await screen.findByText('Fortsetzung von Lauf #-91')).toBeInTheDocument();
    const buttons = screen.getAllByTestId('automation-run');
    expect(buttons).toHaveLength(2);
    expect(buttons[1]).toHaveTextContent('Fortsetzung von Lauf #-91');
  });

  test('Klick öffnet die Schritte des Laufs', async () => {
    mockInvoke.mockResolvedValue([run({ id: -91, server_id: 401 })]);
    render(<MessageAutomationHistory messageId={55} />);
    const button = await screen.findByTestId('automation-run');
    await act(async () => {
      fireEvent.click(button);
    });
    expect(screen.getByTestId('run-dialog')).toHaveTextContent('Lauf -91');
  });

  test('Fehler und leere Liste', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('403'));
    const { unmount } = render(<MessageAutomationHistory messageId={55} />);
    expect(await screen.findByText('Automatik-Läufe konnten nicht geladen werden.')).toBeInTheDocument();
    unmount();
    mockInvoke.mockResolvedValueOnce([]);
    render(<MessageAutomationHistory messageId={56} />);
    await waitFor(() => expect(screen.getByText('Noch keine Automatik-Läufe für diese Mail.')).toBeInTheDocument());
  });

  // Plan 047: Testläufe sind gekennzeichnet.
  test('kennzeichnet Testläufe mit „Test“', async () => {
    mockInvoke.mockResolvedValue([run({ id: 3, server_id: 3, dry_run: true }), run({ id: 2, server_id: 2 })]);
    render(<MessageAutomationHistory messageId={55} />);
    const rows = await screen.findAllByTestId('automation-run');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Test');
    expect(rows[1]).not.toHaveTextContent('Test');
  });
});
