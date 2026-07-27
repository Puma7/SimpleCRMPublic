import React from 'react';
import { render, screen } from '@testing-library/react';

const mockInvoke = jest.fn();
jest.mock('@/services/transport', () => ({
  invokeRenderer: (...args: unknown[]) => mockInvoke(...args),
  getRendererTransport: () => ({ kind: 'http' }),
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

let mockRole: 'owner' | 'admin' | 'user' = 'admin';
jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => ({ user: { id: 'me', role: mockRole }, refresh: jest.fn() }),
}));

import { UsersPanel } from '@/components/settings/users-panel';

/**
 * users.manage erlaubt Anlegen und Bearbeiten von Benutzern, aber
 * handleCreateInvitation ist ausdruecklich admin-only und die 2FA-Endpunkte
 * lassen nur Admin ODER den Nutzer selbst zu. Sichtbare Knoepfe dafuer waeren
 * fuer einen delegierten Benutzerverwalter garantierte 403er.
 */
describe('users panel delegate actions', () => {
  const rows = [
    { id: 'me', username: 'me@example.com', display_name: 'Ich', role: 'user', is_active: 1, mfa_enabled: false },
    { id: 'other', username: 'other@example.com', display_name: 'Andere', role: 'user', is_active: 1, mfa_enabled: false },
  ];

  beforeEach(() => {
    mockRole = 'admin';
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async () => rows);
  });

  test('a non-admin user manager sees no invitation button and no foreign 2FA actions', async () => {
    mockRole = 'user';
    render(<UsersPanel />);
    await screen.findByText(/Andere \(other@example\.com\)/);

    expect(screen.queryByRole('button', { name: 'Einladungslink erstellen' })).not.toBeInTheDocument();
    // Genau eine Zeile darf 2FA-Aktionen zeigen: die eigene.
    expect(screen.getAllByRole('button', { name: 'Authenticator einrichten' })).toHaveLength(1);
    // Anlegen und Bearbeiten bleiben erlaubt.
    expect(screen.getByRole('button', { name: 'Benutzer anlegen' })).toBeInTheDocument();
  });

  test('an admin keeps invitations and 2FA for every user', async () => {
    render(<UsersPanel />);
    await screen.findByText(/Andere \(other@example\.com\)/);

    expect(screen.getByRole('button', { name: 'Einladungslink erstellen' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Authenticator einrichten' })).toHaveLength(2);
  });
});
