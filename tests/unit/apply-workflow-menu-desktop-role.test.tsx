import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockInvoke = jest.fn();
jest.mock('@/services/transport', () => ({
  invokeRenderer: (...args: unknown[]) => mockInvoke(...args),
  getRendererTransport: () => ({ kind: 'ipc' }),
}));
jest.mock('@/components/email/types', () => ({
  ...jest.requireActual('@/components/email/types'),
  hasLocalIpc: () => true,
}));

let mockRole = 'agent';
jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => ({
    user: { id: 'u1', role: mockRole },
    // Desktop kennt keine Capabilities; ein true hier darf nichts freischalten.
    hasCapability: () => true,
  }),
}));

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn() } }));
jest.mock('@/components/email/workflow/workflow-run-detail-dialog', () => ({
  WorkflowRunDetailDialog: () => null,
}));

let mockOpenMenu: (() => void) | null = null;
jest.mock('@/components/ui/dropdown-menu', () => {
  const ReactRuntime = jest.requireActual<typeof React>('react');
  return {
    DropdownMenu: ({ children, onOpenChange }: { children: React.ReactNode; onOpenChange?: (open: boolean) => void }) => {
      mockOpenMenu = () => onOpenChange?.(true);
      return <div>{children}</div>;
    },
    DropdownMenuTrigger: ({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) => {
      if (asChild && ReactRuntime.isValidElement(children)) {
        return ReactRuntime.cloneElement(children, { onClick: () => mockOpenMenu?.() } as never);
      }
      return <button onClick={() => mockOpenMenu?.()}>{children}</button>;
    },
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuItem: ({ children, disabled, onClick }: { children: React.ReactNode; disabled?: boolean; onClick?: () => void }) => (
      <button disabled={disabled} onClick={onClick}>{children}</button>
    ),
    DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuSub: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuSubContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuSubTrigger: ({ children, disabled }: { children: React.ReactNode; disabled?: boolean }) => (
      <button disabled={disabled}>{children}</button>
    ),
  };
});

import { ApplyWorkflowMenu } from '@/components/email/apply-workflow-menu';
import { IPCChannels } from '@shared/ipc/channels';

const message = {
  id: 99,
  account_id: 1,
  uid: 123,
  subject: 'Test',
  snippet: null,
  date_received: '2026-01-01T00:00:00.000Z',
  from_json: null,
  body_text: null,
  body_html: null,
  seen_local: 0,
  folder_kind: 'inbox',
} as never;

beforeEach(() => {
  mockOpenMenu = null;
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async (channel: string) => {
    if (channel === IPCChannels.Email.ListWorkflows) {
      // Ohne Graph (also ohne Seiteneffekt-Knoten): im Server-Modus duerfte
      // auch ein Nicht-Admin live ausfuehren, auf dem Desktop nicht.
      return [{ id: 44, name: 'Eingang sortieren', trigger: 'inbound', enabled: 1, priority: 5, graph_json: null }];
    }
    if (channel === IPCChannels.Email.TestWorkflowOnMessage) return { success: true, log: ['dry'] };
    if (channel === IPCChannels.Email.ExecuteWorkflowNow) return { success: true, status: 'ok', log: [] };
    return [];
  });
});

// G1: workflow:execute-now verlangt auf dem Desktop fuer jeden Graphen
// Owner/Admin; das Nachrichtenmenue bot Agent und Viewer trotzdem
// „Jetzt ausführen“ an — ein Knopf, der sicher mit „Keine Berechtigung“ endete.
describe('ApplyWorkflowMenu im Desktop-Modus nach Rolle (G1)', () => {
  test.each(['agent', 'viewer'])('%s bekommt nur den Dry-Run angeboten', async (role) => {
    mockRole = role;
    render(<ApplyWorkflowMenu message={message} />);
    fireEvent.click(screen.getAllByRole('button')[0]!);

    expect(await screen.findByText('Eingang sortieren')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Jetzt ausführen' })).not.toBeInTheDocument();
    expect(screen.getByText(/Live-Ausführung erfordert Adminrechte/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Dry-Run/ }));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(
      IPCChannels.Email.TestWorkflowOnMessage,
      { workflowId: 44, messageId: 99, dryRun: true },
    ));
    expect(mockInvoke).not.toHaveBeenCalledWith(IPCChannels.Email.ExecuteWorkflowNow, expect.anything());
  });

  test.each(['owner', 'admin'])('%s behaelt „Jetzt ausführen“', async (role) => {
    mockRole = role;
    render(<ApplyWorkflowMenu message={message} />);
    fireEvent.click(screen.getAllByRole('button')[0]!);

    expect(await screen.findByText('Eingang sortieren')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Jetzt ausführen' }));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(
      IPCChannels.Email.ExecuteWorkflowNow,
      { workflowId: 44, messageId: 99, dryRun: false },
    ));
  });
});
