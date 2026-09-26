/**
 * Hinweis „Versand blockiert“ (Teilautomatisierung P2): Grund bzw. Fallback,
 * „Ohne Ausgangsprüfung senden“ nur laut Einstellung und Rolle, mit Rückfrage.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockInvoke = jest.fn();
jest.mock('@/services/transport', () => ({
  invokeRenderer: (...args: unknown[]) => mockInvoke(...args),
  getRendererTransport: () => ({ kind: 'http' }),
}));

let mockRole = 'user';
jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', role: mockRole } }),
}));

const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();
jest.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
    warning: jest.fn(),
    info: jest.fn(),
  },
}));

import { IPCChannels } from '@shared/ipc/channels';
import { OutboundHoldBanner } from '@/components/email/outbound-hold-banner';

let policy: string | undefined = 'all';
let sendResult: unknown = { success: true };

beforeEach(() => {
  mockRole = 'user';
  policy = 'all';
  sendResult = { success: true };
  mockInvoke.mockReset();
  mockToastSuccess.mockReset();
  mockToastError.mockReset();
  mockInvoke.mockImplementation(async (channel: string) => {
    if (channel === IPCChannels.Email.GetWorkflowAutomationSettings) {
      return { outboundReviewSkipPolicy: policy };
    }
    if (channel === IPCChannels.Email.SendDraftSkipOutboundReview) return sendResult;
    if (channel === IPCChannels.Email.GetLatestWorkflowRunForMessage) return { id: 9 };
    throw new Error(`unexpected channel ${channel}`);
  });
});

function renderBanner(reason: string | null = 'Preisangabe fehlt', canViewWorkflows = false) {
  const onSent = jest.fn();
  const onShowWorkflowRun = jest.fn();
  render(
    <OutboundHoldBanner
      message={{ id: 41, outbound_block_reason: reason }}
      canViewWorkflows={canViewWorkflows}
      onShowWorkflowRun={onShowWorkflowRun}
      onSent={onSent}
    />,
  );
  return { onSent, onShowWorkflowRun };
}

describe('OutboundHoldBanner', () => {
  test('zeigt den Grund bzw. den einheitlichen Fallback-Text', async () => {
    renderBanner(null);
    expect(screen.getByText('Ausgangsprüfung — Versand blockiert')).toBeInTheDocument();
    expect(screen.getByText('Vom Workflow ohne Begründung angehalten – bitte E-Mail prüfen.')).toBeInTheDocument();
    await screen.findByRole('button', { name: 'Ohne Ausgangsprüfung senden' });
  });

  test('„Ohne Ausgangsprüfung senden“ fragt nach, sendet und meldet den Versand', async () => {
    const { onSent } = renderBanner();

    fireEvent.click(await screen.findByRole('button', { name: 'Ohne Ausgangsprüfung senden' }));
    expect(screen.getByText(
      'Die Ausgangs-Workflows werden für diese E-Mail übersprungen. Der Versand wird protokolliert.',
    )).toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalledWith(IPCChannels.Email.SendDraftSkipOutboundReview, expect.anything());

    fireEvent.click(screen.getByRole('button', { name: 'Senden' }));

    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
    expect(mockInvoke).toHaveBeenCalledWith(IPCChannels.Email.SendDraftSkipOutboundReview, { draftId: 41 });
    expect(mockToastSuccess).toHaveBeenCalledWith('E-Mail ohne Ausgangsprüfung gesendet.');
  });

  test('Abbrechen sendet nichts; ein Fehler bleibt sichtbar und meldet keinen Versand', async () => {
    const { onSent } = renderBanner();
    fireEvent.click(await screen.findByRole('button', { name: 'Ohne Ausgangsprüfung senden' }));
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(mockInvoke).not.toHaveBeenCalledWith(IPCChannels.Email.SendDraftSkipOutboundReview, expect.anything());

    sendResult = { success: false, error: 'SMTP down' };
    fireEvent.click(screen.getByRole('button', { name: 'Ohne Ausgangsprüfung senden' }));
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }));
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('SMTP down'));
    expect(onSent).not.toHaveBeenCalled();
  });

  test('Einstellung „niemand“: kein Knopf', async () => {
    policy = 'none';
    renderBanner();
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(IPCChannels.Email.GetWorkflowAutomationSettings));
    expect(screen.queryByRole('button', { name: 'Ohne Ausgangsprüfung senden' })).not.toBeInTheDocument();
  });

  test('Einstellung „nur Owner und Admin“: Nutzer ohne, Admin mit Knopf', async () => {
    policy = 'admins';
    const first = render(
      <OutboundHoldBanner
        message={{ id: 41, outbound_block_reason: 'x' }}
        canViewWorkflows={false}
        onShowWorkflowRun={jest.fn()}
        onSent={jest.fn()}
      />,
    );
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(IPCChannels.Email.GetWorkflowAutomationSettings));
    expect(screen.queryByRole('button', { name: 'Ohne Ausgangsprüfung senden' })).not.toBeInTheDocument();
    first.unmount();

    mockRole = 'admin';
    renderBanner();
    expect(await screen.findByRole('button', { name: 'Ohne Ausgangsprüfung senden' })).toBeInTheDocument();
  });

  test('Workflow-Details nur mit Workflow-Leserecht', async () => {
    const { onShowWorkflowRun } = renderBanner('Grund', true);
    fireEvent.click(screen.getByRole('button', { name: 'Workflow-Details ansehen' }));
    await waitFor(() => expect(onShowWorkflowRun).toHaveBeenCalledWith(9));
  });
});
