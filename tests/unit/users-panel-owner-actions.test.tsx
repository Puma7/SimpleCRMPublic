import React from 'react';
import { render, screen, within } from '@testing-library/react';

const mockInvoke = jest.fn();
let mockTransportKind: 'http' | 'ipc' = 'http';
jest.mock('@/services/transport', () => ({
  invokeRenderer: (...args: unknown[]) => mockInvoke(...args),
  getRendererTransport: () => ({ kind: mockTransportKind }),
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

let mockRole: 'owner' | 'admin' = 'admin';
jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => ({ user: { id: 'me', role: mockRole }, refresh: jest.fn() }),
}));

import { UsersPanel } from '@/components/settings/users-panel';

const ACCOUNT_ACTIONS = ['Deaktivieren', 'Passwort neu setzen', 'Löschen'];
const SECURITY_ACTIONS = ['Login-PIN setzen', 'Authenticator einrichten', 'E-Mail-2FA aktivieren'];

// C-A72 (G3): Admins sahen an Owner-Zeilen Deaktivieren, Passwort neu setzen, Loeschen, PIN und 2FA,
// obwohl nur Owner Owner-Konten aendern duerfen; jeder Klick waere eine Ablehnung.
describe.each(['http', 'ipc'] as const)('users panel owner rows (%s)', (transportKind) => {
  const rows = [
    { id: 'me', username: 'me@example.com', display_name: 'Ich', role: 'admin', is_active: 1, mfa_enabled: false },
    { id: 'owner', username: 'owner@example.com', display_name: 'Chefin', role: 'owner', is_active: 1, mfa_enabled: false },
    { id: 'admin2', username: 'admin2@example.com', display_name: 'Kollege', role: 'admin', is_active: 1, mfa_enabled: false },
  ];

  beforeEach(() => {
    mockTransportKind = transportKind;
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async () => rows.map((row) => (row.id === 'me' ? { ...row, role: mockRole } : row)));
  });

  const rowOf = async (name: RegExp) => (await screen.findByText(name)).closest('li') as HTMLElement;
  const expectedActions = transportKind === 'http' ? [...ACCOUNT_ACTIONS, ...SECURITY_ACTIONS] : ACCOUNT_ACTIONS;

  test('an admin sees no actions on an owner account', async () => {
    mockRole = 'admin';
    render(<UsersPanel />);
    const owner = await rowOf(/Chefin \(owner@example\.com\)/);

    for (const name of [...ACCOUNT_ACTIONS, ...SECURITY_ACTIONS, 'Öffentl. Name']) {
      expect(within(owner).queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(within(owner).getByText('Nur Owner können Owner-Konten ändern.')).toBeInTheDocument();
  });

  test('an admin keeps every action on another admin', async () => {
    mockRole = 'admin';
    render(<UsersPanel />);
    const colleague = await rowOf(/Kollege \(admin2@example\.com\)/);

    for (const name of expectedActions) {
      expect(within(colleague).getByRole('button', { name })).toBeInTheDocument();
    }
    expect(within(colleague).queryByText('Nur Owner können Owner-Konten ändern.')).not.toBeInTheDocument();
  });

  test('an owner manages other owner accounts', async () => {
    mockRole = 'owner';
    render(<UsersPanel />);
    const owner = await rowOf(/Chefin \(owner@example\.com\)/);

    for (const name of expectedActions) {
      expect(within(owner).getByRole('button', { name })).toBeInTheDocument();
    }
    expect(within(owner).queryByText('Nur Owner können Owner-Konten ändern.')).not.toBeInTheDocument();
  });
});
