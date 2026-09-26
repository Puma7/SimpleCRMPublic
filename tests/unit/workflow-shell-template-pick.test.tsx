/**
 * TA-P6: „Vorlage laden“ übernimmt neben dem Graphen die empfohlene Priorität
 * und bei Zeitplan-Vorlagen den Cron-Ausdruck; Speichern schickt beides mit.
 * Setup wie tests/unit/workflow-shell-schedule-fields.test.tsx.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockInvoke = jest.fn();
jest.mock('@/services/transport', () => ({
  invokeRenderer: (...args: unknown[]) => mockInvoke(...args),
  getRendererTransport: () => ({ kind: 'http' }),
  isWorkflowListRefreshEvent: () => false,
  subscribeServerEvents: () => ({ unsubscribe: jest.fn() }),
}));
jest.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() } }));
jest.mock('@/components/email/workflow/workflow-canvas', () => ({ WorkflowCanvas: () => null }));
jest.mock('@/components/email/use-has-electron', () => ({ useHasElectron: () => false }));
jest.mock('@/components/email/workflow/node-properties-panel', () => ({ NodePropertiesPanel: () => null }));
jest.mock('@/components/email/workflow/json-dev-drawer', () => ({ JsonDevDrawer: () => null }));
// Der Dialog selbst hat einen eigenen Test; hier zählt nur, was onPick bewirkt.
type TemplatesDialogProps = { onPick: (template: unknown) => void };
let mockTemplatesDialogProps: TemplatesDialogProps | null = null;
jest.mock('@/components/email/workflow/workflow-templates-dialog', () => ({
  WorkflowTemplatesDialog: (props: TemplatesDialogProps) => {
    mockTemplatesDialogProps = props;
    return null;
  },
}));
jest.mock('@/components/email/workflow/workflow-reference-dialog', () => ({ WorkflowReferenceDialog: () => null }));
jest.mock('@/components/email/workflow/workflow-versions-dialog', () => ({ WorkflowVersionsDialog: () => null }));
jest.mock('@/components/email/workflow/workflow-run-history', () => ({ WorkflowRunHistory: () => null }));
jest.mock('@/components/email/workflow/node-palette', () => ({ NodePalette: () => null }));
jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => ({
    user: { id: 'u1', role: 'user' },
    hasCapability: () => true,
    canViewWorkflows: true,
    capabilitiesReady: true,
  }),
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
if (!window.matchMedia) {
  (window as unknown as { matchMedia: unknown }).matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
}

import { toast } from 'sonner';
import { getWorkflowTemplate, PARTIAL_AUTOMATION_TEMPLATE_IDS as IDS } from '@simplecrm/core';
import { WorkflowShell } from '@/components/email/workflow/workflow-shell';
import { IPCChannels } from '@shared/ipc/channels';

const row = {
  id: 7,
  name: 'Neuer Workflow',
  trigger: 'inbound',
  enabled: 1,
  priority: 100,
  definition_json: '{"version":1,"rules":[]}',
  graph_json: JSON.stringify({ version: 1, nodes: [{ id: 't1', type: 'trigger', data: { kind: 'inbound' } }], edges: [] }),
  cron_expr: null,
  schedule_account_id: null,
  created_at: '',
  updated_at: '',
};

async function openRowAndPick(templateId: string): Promise<void> {
  render(<WorkflowShell />);
  fireEvent.click(await screen.findByText('Neuer Workflow'));
  await screen.findByDisplayValue('100');
  const template = getWorkflowTemplate(templateId);
  expect(mockTemplatesDialogProps).not.toBeNull();
  act(() => {
    mockTemplatesDialogProps!.onPick(template);
  });
}

async function saveAndReadUpdate(): Promise<Record<string, unknown>> {
  fireEvent.click(screen.getByRole('button', { name: /Speichern/ }));
  await waitFor(() => expect(
    mockInvoke.mock.calls.some(([channel]) => channel === IPCChannels.Email.UpdateWorkflow),
  ).toBe(true));
  return mockInvoke.mock.calls.find(([channel]) => channel === IPCChannels.Email.UpdateWorkflow)![1] as Record<string, unknown>;
}

describe('Vorlage laden übernimmt Priorität und Zeitplan (TA-P6)', () => {
  beforeEach(() => {
    mockTemplatesDialogProps = null;
    mockInvoke.mockReset();
    (toast.success as jest.Mock).mockReset();
    (toast.error as jest.Mock).mockReset();
    mockInvoke.mockImplementation(async (channel: string) => {
      if (channel === IPCChannels.Email.ListWorkflows) return [row];
      if (channel === IPCChannels.Email.GetWorkflow) return row;
      if (channel === IPCChannels.Email.GetWorkflowAutomationSettings) {
        return { imapDeleteOptIn: false, httpAllowlist: '', autoReplyEnabled: true, scheduleTimezone: 'Europe/Berlin' };
      }
      return [];
    });
  });

  test('Spam-Entscheidung: Priorität 5 wird eingetragen und gespeichert', async () => {
    await openRowAndPick(IDS.spamDecision);
    expect(screen.getByDisplayValue('5')).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith(
      'Vorlage „Eingehend: Spam-Entscheidung (Entscheidungsmodell)" geladen (Priorität 5) — bitte speichern.',
    );
    const update = await saveAndReadUpdate();
    expect(update).toMatchObject({ priority: 5, trigger: 'inbound' });
    expect(JSON.parse(String(update.graphJson)).nodes.map((n: { id: string }) => n.id)).toContain('decide');
    expect(toast.error).not.toHaveBeenCalled();
  });

  test('Learnings wöchentlich: Zeitplan 0 6 * * 1 wird eingetragen und gespeichert', async () => {
    await openRowAndPick(IDS.learningsWeekly);
    expect(await screen.findByDisplayValue('0 6 * * 1')).toBeInTheDocument();
    // Priorität bleibt, wie sie war.
    expect(screen.getByDisplayValue('100')).toBeInTheDocument();
    const update = await saveAndReadUpdate();
    expect(update).toMatchObject({ trigger: 'schedule', cronExpr: '0 6 * * 1', priority: 100 });
    expect(toast.error).not.toHaveBeenCalled();
  });
});
