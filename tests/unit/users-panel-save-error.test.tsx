import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const mockInvoke = jest.fn();
jest.mock('@/services/transport', () => ({
  invokeRenderer: (...args: unknown[]) => mockInvoke(...args),
  getRendererTransport: () => ({ kind: 'ipc' }),
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => ({ user: { id: 'me', role: 'admin' }, refresh: jest.fn() }),
}));

import { UsersPanel } from '@/components/settings/users-panel';

/**
 * Der Desktop meldet abgelehnte Benutzeraenderungen als { success: false }
 * statt per Exception (auth-store saveLocalAuthUser).
 */
describe('users panel save errors (Desktop)', () => {
  const rows = [
    { id: 'me', username: 'admin', display_name: 'Admin', role: 'admin', is_active: 1 },
    { id: 'owner', username: 'owner', display_name: 'Owner', role: 'owner', is_active: 1 },
  ];
  let saveResult: { success: boolean; error?: string };

  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (channel: string) => {
      if (channel === 'auth:save-user') return saveResult;
      return rows;
    });
  });

  const ownerRow = async () => {
    render(<UsersPanel />);
    return (await screen.findByText(/Owner \(owner\)/)).closest('li') as HTMLElement;
  };

  // C-A72: Lehnte der Desktop das Deaktivieren des letzten Owners ab, zeigte die Liste weiter "aktiv" ohne jede Meldung.
  test('shows the error when the desktop rejects the update', async () => {
    saveResult = { success: false, error: 'Mindestens ein aktiver Eigentümer muss bestehen bleiben' };
    const row = await ownerRow();

    fireEvent.click(within(row).getByRole('button', { name: 'Deaktivieren' }));

    expect(await screen.findByText('Mindestens ein aktiver Eigentümer muss bestehen bleiben')).toBeInTheDocument();
    expect(mockInvoke).toHaveBeenCalledWith('auth:save-user', expect.objectContaining({ id: 'owner', isActive: false }));
  });

  test('a successful update shows no error and reloads the list', async () => {
    saveResult = { success: true };
    const row = await ownerRow();
    const listCalls = () => mockInvoke.mock.calls.filter(([channel]) => channel === 'auth:list-users').length;
    const before = listCalls();

    fireEvent.click(within(row).getByRole('button', { name: 'Deaktivieren' }));

    await waitFor(() => expect(listCalls()).toBe(before + 1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
