import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockInvoke = jest.fn();
const mockSubscribe = jest.fn(() => ({ unsubscribe: jest.fn() }));

jest.mock('@/services/transport', () => ({
  invokeRenderer: (...args: unknown[]) => mockInvoke(...args),
  subscribeServerEvents: (...args: unknown[]) => mockSubscribe(...args),
  isMailAclRefreshEvent: (event: { type?: string }) => event.type === 'email_acl.changed',
}));

import { MailDelegationPanel } from '@/components/email/settings/mail-delegation-panel';

describe('MailDelegationPanel', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockSubscribe.mockClear();
    mockInvoke.mockImplementation(async (channel: string, payload?: unknown) => {
      if (channel === 'email:list-accounts') return [{ id: 101, display_name: 'Support', email_address: 'support@example.test' }];
      if (channel === 'email:list-folders') return [{ id: 202, account_id: 101, path: 'INBOX' }];
      if (channel === 'auth:list-users') return [{ id: 'user-1', display_name: 'Alice', username: 'alice@example.test', role: 'agent', is_active: 1 }];
      if (channel === 'user-groups:list') return [{ id: 55, name: 'Support-Team', description: null, memberCount: 2, updatedAt: '2026-07-19T10:00:00.000Z' }];
      if (channel === 'email:list-mail-delegation-bindings') {
        return [{
          id: 900,
          subject: { type: 'user', id: 'user-1', label: 'Alice' },
          resource: { type: 'account', accountId: 101, label: 'Support' },
          permissions: ['mail.metadata.read'],
          profile: 'custom',
          updatedAt: '2026-07-19T10:00:00.000Z',
        }];
      }
      if (channel === 'email:save-mail-delegation-binding') return { success: true };
      if (channel === 'email:delete-mail-delegation-binding') return { success: true };
      return undefined;
    });
  });

  test('saves a profile-expanded binding and an individual permission override', async () => {
    render(<MailDelegationPanel />);

    expect((await screen.findAllByText('Alice')).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('Profil'), { target: { value: 'triage' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Senden' }));
    fireEvent.click(screen.getByRole('button', { name: 'Berechtigung speichern' }));

    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(
      'email:save-mail-delegation-binding',
      expect.objectContaining({
        subject: { type: 'user', id: 'user-1' },
        resource: { type: 'account', accountId: 101 },
        profile: 'custom',
        permissions: expect.arrayContaining(['mail.metadata.read', 'mail.triage', 'mail.send']),
      }),
    ));
  });

  test('deletes a binding and refetches after ACL invalidation events', async () => {
    render(<MailDelegationPanel />);

    expect((await screen.findAllByText('Alice')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /Löschen/ }));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('email:delete-mail-delegation-binding', 900));

    const subscription = mockSubscribe.mock.calls[0]?.[0] as { onEvent: (event: unknown) => void };
    await act(async () => {
      subscription.onEvent({ type: 'email_acl.changed', entityType: 'email_acl', payload: { targetUserId: 'user-1' } });
    });

    await waitFor(() => {
      const listCalls = mockInvoke.mock.calls.filter(([channel]) => channel === 'email:list-mail-delegation-bindings');
      expect(listCalls.length).toBeGreaterThanOrEqual(3);
    });
  });
});
