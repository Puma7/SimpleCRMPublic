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
    mockInvoke.mockImplementation(async (channel: string, payload?: { name?: string }) => {
      switch (channel) {
        case 'user-groups:list':
          return [{ id: 1, name: 'Support', description: 'Hotline', memberCount: 2, updatedAt: '2026-06-06T10:00:00.000Z' }];
        case 'auth:list-users':
          return [{ id: 'u1', display_name: 'Alice', username: 'alice@example.com' }];
        case 'user-groups:create':
          return { id: 2, name: payload?.name ?? '', description: null, memberCount: 0, updatedAt: '2026-06-06T10:00:00.000Z' };
        case 'user-groups:list-members':
          return [];
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
});
