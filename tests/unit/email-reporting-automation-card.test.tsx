/**
 * Plan 049: Karte „Automatisierung“ auf der Seite „Auswertung“ –
 * Wochen-Tabelle mit Anteil automatisch, Warteschlangen, KI-Entscheidungen je
 * Workflow (Name statt Id) und KI-Kosten bzw. Hinweis.
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react';

const mockInvoke = jest.fn();
jest.mock('@/services/transport', () => ({
  invokeRenderer: (...args: unknown[]) => mockInvoke(...args),
}));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

import { IPCChannels } from '@shared/ipc/channels';
import EmailReportingPage from '@/app/email/reporting/page';

function snapshot(aiCost30d: { costMicroUsd: number; events: number } | null) {
  return {
    accounts: [],
    totals: { messages: 1, unread: 0, archived: 0, withCustomer: 0, withAssignment: 0, withAttachments: 0 },
    perAccount: [],
    workflowRuns24h: [
      { workflow_id: -23, workflow_name: 'Rückgaben', count: 4, errors: 1 },
      { workflow_id: 7, workflow_name: null, count: 1, errors: 0 },
    ],
    automation: {
      sentByKindWeekly: [
        { weekStart: '2026-09-14', human: 0, aiAuto: 0, aiApproved: 0, workflow: 0, relay: 2, unknown: 0 },
        { weekStart: '2026-09-21', human: 1, aiAuto: 2, aiApproved: 1, workflow: 0, relay: 5, unknown: 0 },
      ],
      pendingApproval: 3,
      outboundBlocked: 1,
      aiDecideByWorkflow30d: [
        { workflowId: -23, workflowName: 'Rückgaben', ja: 5, nein: 2, unsicher: 1, error: 0, total: 8 },
      ],
      aiCost30d,
    },
  };
}

function mockReporting(data: unknown) {
  mockInvoke.mockImplementation(async (channel: string) => {
    if (channel === IPCChannels.Email.EmailReporting) return { success: true, data };
    if (channel === IPCChannels.Email.ListAccounts) return [];
    throw new Error(`unexpected ${channel}`);
  });
}

beforeEach(() => mockInvoke.mockReset());

test('Wochen, Anteil automatisch, Warteschlangen, Entscheidungen und Kosten', async () => {
  mockReporting(snapshot({ costMicroUsd: 4_200_000, events: 12 }));
  render(<EmailReportingPage />);
  const card = await screen.findByTestId('automation-cockpit');
  expect(within(card).getByText('Wartet auf Freigabe').nextSibling).toHaveTextContent('3');
  expect(within(card).getByText('Versand blockiert').nextSibling).toHaveTextContent('1');
  expect(within(card).getByText('$4.20')).toBeInTheDocument();
  expect(within(card).getByText('12 Aufrufe')).toBeInTheDocument();
  const weekRow = within(card).getByText('21.09.2026').closest('tr')!;
  // (2 + 1 + 0) / (1 + 2 + 1 + 0) = 75 %; Relay zählt nicht.
  expect(weekRow).toHaveTextContent('75 %');
  expect(within(card).getByText('14.09.2026').closest('tr')).toHaveTextContent('–');
  const decisionRow = within(card).getByText('Rückgaben').closest('tr')!;
  expect(decisionRow).toHaveTextContent(/Rückgaben\s*5\s*2\s*1\s*0\s*8/);
  // Workflow-Läufe: Name statt Id, Rückfall „Workflow #…“.
  expect(screen.getAllByText('Rückgaben')).toHaveLength(2);
  expect(screen.getByText('Workflow #7')).toBeInTheDocument();
});

test('ohne Kosten: Hinweis; älterer Server ohne Cockpit: keine Karte', async () => {
  mockReporting(snapshot(null));
  const first = render(<EmailReportingPage />);
  expect(await screen.findByText('Nur in der Server-Edition, mit Vollzugriff und ohne Kontofilter verfügbar.')).toBeInTheDocument();
  first.unmount();

  const legacy = snapshot(null) as Record<string, unknown>;
  delete legacy.automation;
  mockReporting(legacy);
  render(<EmailReportingPage />);
  expect(await screen.findByText('Workflow #7')).toBeInTheDocument();
  expect(screen.queryByTestId('automation-cockpit')).toBeNull();
});
