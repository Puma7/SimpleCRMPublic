import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

const mockUseAuth = jest.fn();
jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

import { ApplyWorkflowMenu } from '@/components/email/apply-workflow-menu';
import {
  configureRendererTransport,
  createHttpRendererTransport,
  resetRendererTransportForTests,
} from '@/services/transport';

let mockOpenMenu: (() => void) | null = null;

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
    warning: jest.fn(),
  },
}));

jest.mock('@/components/email/workflow/workflow-run-detail-dialog', () => ({
  WorkflowRunDetailDialog: () => null,
}));

jest.mock('@/components/ui/dropdown-menu', () => {
  const ReactRuntime = jest.requireActual<typeof React>('react');
  return {
    DropdownMenu: ({
      children,
      onOpenChange,
    }: {
      children: React.ReactNode;
      onOpenChange?: (open: boolean) => void;
    }) => {
      mockOpenMenu = () => onOpenChange?.(true);
      return <div>{children}</div>;
    },
    DropdownMenuTrigger: ({
      children,
      asChild,
    }: {
      children: React.ReactNode;
      asChild?: boolean;
    }) => {
      if (asChild && ReactRuntime.isValidElement(children)) {
        return ReactRuntime.cloneElement(children, { onClick: () => mockOpenMenu?.() });
      }
      return <button onClick={() => mockOpenMenu?.()}>{children}</button>;
    },
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuItem: ({
      children,
      disabled,
      onClick,
    }: {
      children: React.ReactNode;
      disabled?: boolean;
      onClick?: () => void;
    }) => (
      <button disabled={disabled} onClick={onClick}>
        {children}
      </button>
    ),
    DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuSub: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuSubContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuSubTrigger: ({
      children,
      disabled,
    }: {
      children: React.ReactNode;
      disabled?: boolean;
    }) => <button disabled={disabled}>{children}</button>,
  };
});

describe('ApplyWorkflowMenu server-client mode', () => {
  beforeEach(() => {
    mockOpenMenu = null;
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue({
      user: { id: 'user-1', role: 'user' },
      loading: false,
      hasCapability: (cap: string) => cap === 'workflows.run',
    });
    resetRendererTransportForTests();
    delete (window as any).electronAPI;
  });

  afterEach(() => {
    resetRendererTransportForTests();
    delete (window as any).electronAPI;
  });

  test('hides the menu when workflows.run is missing in HTTP mode', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'user-1', role: 'user' },
      loading: false,
      hasCapability: () => false,
    });
    configureRendererTransport(createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl: jest.fn() as unknown as typeof fetch,
    }));

    const { container } = render(<ApplyWorkflowMenu message={message()} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('runs dry-run and executes workflow through HTTP transport', async () => {
    const localInvoke = jest.fn();
    (window as any).electronAPI = { invoke: localInvoke };
    const fetchImpl = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/v1/workflows/by-source/44/execute')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { dryRun?: boolean };
        if (body.dryRun) {
          return jsonResponse({
            data: {
              success: true,
              dryRun: true,
              log: ['dry_run:server'],
            },
          });
        }
        return jsonResponse({ data: { success: true, queued: true } });
      }
      if (url.includes('/api/v1/workflows')) {
        return jsonResponse({
          data: {
            items: [{
              id: 11,
              sourceSqliteId: 44,
              name: 'Inbound Review',
              triggerName: 'inbound',
              enabled: true,
              priority: 5,
              definition: {},
              graph: null,
            }],
          },
        });
      }
      return jsonResponse({ data: null }, 404);
    });
    configureRendererTransport(createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl: fetchImpl as typeof fetch,
    }));

    render(<ApplyWorkflowMenu message={message()} onApplied={jest.fn()} />);
    fireEvent.click(screen.getAllByRole('button')[0]!);

    expect(await screen.findByText('Inbound Review')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Dry-Run/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Dry-Run/ }));

    await waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledWith(
        'https://crm.example.com/api/v1/workflows/by-source/44/execute',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ messageId: 99, dryRun: true }),
        }),
      );
    });
    expect(toast.success).toHaveBeenCalledWith('Dry-Run OK: dry_run:server');

    fireEvent.click(screen.getByRole('button', { name: /Jetzt/ }));

    await waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledWith(
        'https://crm.example.com/api/v1/workflows/by-source/44/execute',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ messageId: 99, dryRun: false }),
        }),
      );
    });
    expect(localInvoke).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Workflow-Job eingereiht.');
  });

  test('offers only the dry run for a side-effect graph without admin rights', async () => {
    // handleWorkflowExecute lehnt den Live-Lauf eines Graphen mit schreibenden
    // Knoten fuer Nicht-Admins ab — unabhaengig von workflows.run/manage. Der
    // Knopf waere also ein garantierter 403.
    const sideEffectGraph = {
      version: 1,
      nodes: [
        { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } },
        { id: 'tag-1', type: 'action', data: { nodeType: 'email.add_tag' } },
      ],
      edges: [{ id: 'e1', source: 'trigger-1', target: 'tag-1' }],
    };
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/v1/workflows')) {
        return jsonResponse({
          data: {
            items: [{
              id: 11,
              sourceSqliteId: 44,
              name: 'Tagger',
              triggerName: 'inbound',
              enabled: true,
              priority: 5,
              definition: {},
              graph: sideEffectGraph,
            }],
          },
        });
      }
      return jsonResponse({ data: null }, 404);
    });
    configureRendererTransport(createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl: fetchImpl as typeof fetch,
    }));

    render(<ApplyWorkflowMenu message={message()} />);
    fireEvent.click(screen.getAllByRole('button')[0]!);

    expect(await screen.findByText('Tagger')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Jetzt/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Live-Ausführung erfordert Adminrechte/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Dry-Run/ })).toBeInTheDocument();
  });

  test('an admin keeps the live run for the same graph', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'user-1', role: 'admin' },
      loading: false,
      hasCapability: () => true,
    });
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/v1/workflows')) {
        return jsonResponse({
          data: {
            items: [{
              id: 11,
              sourceSqliteId: 44,
              name: 'Tagger',
              triggerName: 'inbound',
              enabled: true,
              priority: 5,
              definition: {},
              graph: {
                version: 1,
                nodes: [
                  { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } },
                  { id: 'tag-1', type: 'action', data: { nodeType: 'email.add_tag' } },
                ],
                edges: [{ id: 'e1', source: 'trigger-1', target: 'tag-1' }],
              },
            }],
          },
        });
      }
      return jsonResponse({ data: null }, 404);
    });
    configureRendererTransport(createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl: fetchImpl as typeof fetch,
    }));

    render(<ApplyWorkflowMenu message={message()} />);
    fireEvent.click(screen.getAllByRole('button')[0]!);

    expect(await screen.findByText('Tagger')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Jetzt/ })).toBeInTheDocument();
  });
});

function message() {
  return {
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
  } as any;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}
