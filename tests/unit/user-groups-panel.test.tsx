import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockInvoke = jest.fn();
jest.mock('@/services/transport', () => ({
  invokeRenderer: (...args: unknown[]) => mockInvoke(...args),
}));

import { UserGroupsPanel } from '../../src/components/settings/user-groups-panel';

describe('UserGroupsPanel', () => {
  beforeEach(() => {
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

  test('asks for confirmation before applying a template that removes existing rights', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
    mockInvoke.mockImplementation(async (channel: string, payload?: { groupId?: number; permissions?: string[] }) => {
      switch (channel) {
        case 'user-groups:list':
          return [{ id: 1, name: 'Support', description: 'Hotline', memberCount: 2, updatedAt: '2026-06-06T10:00:00.000Z' }];
        case 'auth:list-users':
          return [{ id: 'u1', display_name: 'Alice', username: 'alice@example.com' }];
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

    render(<UserGroupsPanel />);
    await screen.findByText(/Support/);
    fireEvent.click(screen.getByRole('button', { name: /Rechte/ }));
    await screen.findByText(/Vorlage anwenden/);

    const setCallsBefore = mockInvoke.mock.calls.filter(([channel]) => channel === 'user-groups:set-permissions').length;
    fireEvent.click(screen.getByRole('button', { name: 'Support' }));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('users.manage')));
    const setCallsAfter = mockInvoke.mock.calls.filter(([channel]) => channel === 'user-groups:set-permissions').length;
    expect(setCallsAfter).toBe(setCallsBefore);

    confirmSpy.mockRestore();
  });
});
