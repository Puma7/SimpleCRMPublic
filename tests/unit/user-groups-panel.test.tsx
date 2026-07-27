import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockInvoke = jest.fn();
jest.mock('@/services/transport', () => ({
  invokeRenderer: (...args: unknown[]) => mockInvoke(...args),
}));

let mockRole: 'owner' | 'admin' | 'user' = 'admin';
jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', role: mockRole } }),
}));
jest.mock('@/lib/runtime-mode', () => ({ isServerClientMode: () => true }));

import { UserGroupsPanel } from '../../src/components/settings/user-groups-panel';

describe('UserGroupsPanel', () => {
  beforeEach(() => {
    mockRole = 'admin';
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (channel: string, payload?: { name?: string; permissions?: string[] }) => {
      switch (channel) {
        case 'user-groups:list':
          return [{ id: 1, name: 'Support', description: 'Hotline', memberCount: 2, updatedAt: '2026-06-06T10:00:00.000Z' }];
        case 'auth:list-users':
          return [{ id: 'u1', display_name: 'Alice', username: 'alice@example.com' }];
        case 'user-groups:create':
          return { id: 2, name: payload?.name ?? '', description: null, memberCount: 0, updatedAt: '2026-06-06T10:00:00.000Z' };
        case 'user-groups:list-members':
          return [];
        case 'user-groups:list-permissions':
          return ['crm.write'];
        case 'user-groups:set-permissions':
          return Array.isArray(payload?.permissions) ? payload.permissions : [];
        default:
          return undefined;
      }
    });
  });

  test('lists existing groups', async () => {
    render(<UserGroupsPanel />);
    expect(await screen.findByText(/Support/)).toBeInTheDocument();
    expect(mockInvoke).toHaveBeenCalledWith('user-groups:list', undefined);
  });

  test('creates a group via the user-groups:create channel', async () => {
    render(<UserGroupsPanel />);
    await screen.findByText(/Support/);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Vertrieb' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gruppe anlegen' }));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('user-groups:create', { name: 'Vertrieb', description: undefined }),
    );
  });

  test('surfaces errors from the service', async () => {
    render(<UserGroupsPanel />);
    await screen.findByText(/Support/);

    mockInvoke.mockRejectedValueOnce(new Error('Eine Gruppe mit diesem Namen existiert bereits'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Support' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gruppe anlegen' }));

    expect(await screen.findByText(/existiert bereits/)).toBeInTheDocument();
  });

  test('renders read-only for non-admins because every mutation route is admin-only', async () => {
    mockRole = 'user';
    render(<UserGroupsPanel />);
    await screen.findByText(/Support/);

    expect(screen.getByText(/Nur lesbar/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Vertrieb' } });
    expect(screen.getByRole('button', { name: 'Gruppe anlegen' })).toBeDisabled();
  });

  describe('applying a rights template to an existing group', () => {
    // Vorlagen sind ein Full-Replace: ohne Rueckfrage wuerde ein Klick alle
    // nicht in der Vorlage enthaltenen Rechte der Gruppe sofort entziehen.
    const openSupportGroup = async () => {
      render(<UserGroupsPanel />);
      await screen.findByText(/Support/);
      fireEvent.click(screen.getByRole('button', { name: /Rechte/ }));
      await screen.findByText(/Vorlage anwenden/);
    };

    let confirmSpy: jest.SpyInstance;

    beforeEach(() => {
      confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    });

    afterEach(() => {
      confirmSpy.mockRestore();
    });

    test('asks before a template removes rights and aborts on cancel', async () => {
      // Gespeichert ist users.manage + crm.write; die Support-Vorlage kennt nur CRM.
      mockInvoke.mockImplementation(async (channel: string) => {
        switch (channel) {
          case 'user-groups:list':
            return [{ id: 1, name: 'Support', description: null, memberCount: 2, updatedAt: null }];
          case 'auth:list-users':
            return [];
          case 'user-groups:list-members':
            return [];
          case 'user-groups:list-permissions':
            return ['crm.write', 'users.manage'];
          default:
            return undefined;
        }
      });
      confirmSpy.mockReturnValue(false);
      await openSupportGroup();

      fireEvent.click(screen.getByRole('button', { name: 'Support' }));

      await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
      expect(confirmSpy.mock.calls[0]![0]).toContain('Benutzer');
      expect(mockInvoke).not.toHaveBeenCalledWith('user-groups:set-permissions', expect.anything());
    });

    test('applies the template after confirmation', async () => {
      mockInvoke.mockImplementation(async (channel: string, payload?: { permissions?: string[] }) => {
        switch (channel) {
          case 'user-groups:list':
            return [{ id: 1, name: 'Support', description: null, memberCount: 2, updatedAt: null }];
          case 'auth:list-users':
            return [];
          case 'user-groups:list-members':
            return [];
          case 'user-groups:list-permissions':
            return ['crm.write', 'users.manage'];
          case 'user-groups:set-permissions':
            return payload?.permissions ?? [];
          default:
            return undefined;
        }
      });
      await openSupportGroup();

      fireEvent.click(screen.getByRole('button', { name: 'Support' }));

      await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(
        'user-groups:set-permissions',
        expect.objectContaining({ permissions: ['crm.read', 'crm.write'] }),
      ));
    });

    test('does not ask when the template only adds rights', async () => {
      mockInvoke.mockImplementation(async (channel: string, payload?: { permissions?: string[] }) => {
        switch (channel) {
          case 'user-groups:list':
            return [{ id: 1, name: 'Support', description: null, memberCount: 2, updatedAt: null }];
          case 'auth:list-users':
            return [];
          case 'user-groups:list-members':
            return [];
          case 'user-groups:list-permissions':
            return ['crm.read'];
          case 'user-groups:set-permissions':
            return payload?.permissions ?? [];
          default:
            return undefined;
        }
      });
      await openSupportGroup();

      fireEvent.click(screen.getByRole('button', { name: 'Support' }));

      await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(
        'user-groups:set-permissions',
        expect.anything(),
      ));
      expect(confirmSpy).not.toHaveBeenCalled();
    });
  });
});
