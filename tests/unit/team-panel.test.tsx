import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockInvoke = jest.fn();
const mockSubscribe = jest.fn(() => ({ unsubscribe: jest.fn() }));
const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();

jest.mock('@/services/transport', () => ({
  invokeRenderer: (...args: unknown[]) => mockInvoke(...args),
  subscribeServerEvents: (...args: unknown[]) => mockSubscribe(...args),
  // Das Panel prueft getRendererTransport().kind === 'http' (Server-Edition);
  // nur dort existiert die linkedUserId-Verknuepfung.
  getRendererTransport: () => ({ kind: 'http' }),
  isMailAccountDataRefreshEvent: () => false,
}));

jest.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

jest.mock('@/components/email/signature-quill-editor', () => ({
  SignatureQuillEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea aria-label="Signatur" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));

jest.mock('@/components/email/workspace-context', () => ({
  useMailWorkspace: () => ({ bumpAccountsRevision: jest.fn() }),
}));

import { TeamPanel } from '../../src/components/email/settings/team-panel';

describe('TeamPanel', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
    mockInvoke.mockImplementation(async (channel: string) => {
      if (channel === 'email:list-team-members') {
        return [{ id: 'agent-1', display_name: 'Agent 1', signature_html: '<p>Hallo</p>', linked_user_id: null }];
      }
      throw new Error(`Unexpected channel ${channel}`);
    });
  });

  test('shows a toast when saving an invalid linked user id fails', async () => {
    render(<TeamPanel />);
    await screen.findByText(/Agent 1/);

    mockInvoke.mockImplementation(async (channel: string) => {
      if (channel === 'email:list-team-members') {
        return [{ id: 'agent-1', display_name: 'Agent 1', signature_html: '<p>Hallo</p>', linked_user_id: null }];
      }
      if (channel === 'email:save-team-member') {
        throw new Error('linkedUserId must be a UUID');
      }
      throw new Error(`Unexpected channel ${channel}`);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    fireEvent.change(screen.getByPlaceholderText('Workspace-User-UUID (leer = keine Verknüpfung)'), {
      target: { value: 'not-a-uuid' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('linkedUserId must be a UUID'));
    expect(mockToastSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeInTheDocument();
  });
});
