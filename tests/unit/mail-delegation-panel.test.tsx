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
        return {
          items: [{
            id: 900,
            subject: { type: 'user', id: 'user-1', label: 'Alice' },
            resource: { type: 'account', accountId: 101, label: 'Support' },
            permissions: ['mail.metadata.read'],
            profile: 'custom',
            updatedAt: '2026-07-19T10:00:00.000Z',
          }],
          nextCursor: null,
        };
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

  test('loads every bounded delegation page in cursor order', async () => {
    mockInvoke.mockImplementation(async (channel: string, payload?: { cursor?: number }) => {
      if (channel === 'email:list-accounts') return [{ id: 101, display_name: 'Support' }];
      if (channel === 'email:list-folders') return [{ id: 202, account_id: 101, path: 'INBOX' }];
      if (channel === 'auth:list-users') return [{ id: 'user-1', display_name: 'Alice', is_active: 1 }];
      if (channel === 'user-groups:list') return [];
      if (channel === 'email:list-mail-delegation-bindings' && payload?.cursor === 900) {
        return {
          items: [{
            id: 901,
            subject: { type: 'user', id: 'user-2', label: 'Bob' },
            resource: { type: 'account', accountId: 101, label: 'Support' },
            permissions: ['mail.metadata.read'],
            profile: null,
            updatedAt: '2026-07-20T10:01:00.000Z',
          }],
          nextCursor: null,
        };
      }
      if (channel === 'email:list-mail-delegation-bindings') {
        return {
          items: [{
            id: 900,
            subject: { type: 'user', id: 'user-1', label: 'Alice' },
            resource: { type: 'account', accountId: 101, label: 'Support' },
            permissions: ['mail.metadata.read'],
            profile: null,
            updatedAt: '2026-07-20T10:00:00.000Z',
          }],
          nextCursor: 900,
        };
      }
      return undefined;
    });

    render(<MailDelegationPanel />);

    expect(await screen.findByText('Bob')).toBeTruthy();
    expect(mockInvoke).toHaveBeenCalledWith('email:list-mail-delegation-bindings', { cursor: 900, limit: 100 });
  });

  test('keeps only the newest authorized resource state after racing ACL refreshes', async () => {
    const { unmount } = render(<MailDelegationPanel />);
    expect((await screen.findAllByText('Alice')).length).toBeGreaterThan(0);
    const editButton = screen.getAllByRole('button', { name: /Alice/ })
      .find((button) => !button.getAttribute('aria-label')?.startsWith('Löschen'));
    if (!editButton) throw new Error('missing edit binding button');
    fireEvent.click(editButton);
    fireEvent.change(screen.getByLabelText('Ressource'), { target: { value: 'folder' } });

    const slow = deferred<void>();
    const fast = deferred<void>();
    const passes = [
      refreshPass(slow.promise, 101, 202, true),
      refreshPass(fast.promise, 102, 203, false),
    ];
    let passIndex = -1;
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'email:list-accounts') passIndex += 1;
      return passes[passIndex]![channel]!;
    });

    const subscription = mockSubscribe.mock.calls.at(-1)?.[0] as { onEvent: (event: unknown) => void };
    act(() => subscription.onEvent({ type: 'email_acl.changed', payload: { targetUserId: 'user-1' } }));
    act(() => subscription.onEvent({ type: 'email_acl.changed', payload: { targetUserId: 'user-1' } }));
    await act(async () => fast.resolve());

    await waitFor(() => expect(screen.getByLabelText('Konto')).toHaveValue('102'));
    expect(screen.getByLabelText('Ordner')).toHaveValue('203');
    expect(screen.queryByRole('button', { name: 'Abbrechen' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Berechtigung speichern' }));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(
      'email:save-mail-delegation-binding',
      expect.objectContaining({
        resource: { type: 'folder', accountId: 102, folderId: 203 },
      }),
    ));
    const savePayload = mockInvoke.mock.calls.find(([channel]) => channel === 'email:save-mail-delegation-binding')?.[1];
    expect(savePayload).not.toHaveProperty('id');

    await act(async () => slow.resolve());
    expect(screen.getByLabelText('Konto')).toHaveValue('102');
    expect(screen.getByLabelText('Ordner')).toHaveValue('203');
    unmount();
  });

  test('loads after StrictMode effect replay and unsubscribes on final unmount', async () => {
    const { unmount } = render(
      <React.StrictMode>
        <MailDelegationPanel />
      </React.StrictMode>,
    );

    expect((await screen.findAllByText('Alice')).length).toBeGreaterThan(0);
    unmount();
    for (const [options] of mockSubscribe.mock.calls) {
      expect(options).toHaveProperty('onEvent');
    }
    for (const result of mockSubscribe.mock.results) {
      expect(result.value.unsubscribe).toHaveBeenCalledTimes(1);
    }
  });
});

function refreshPass(
  gate: Promise<void>,
  accountId: number,
  folderId: number,
  includeBinding: boolean,
): Record<string, Promise<unknown>> {
  const after = <T,>(value: T) => gate.then(() => value);
  return {
    'email:list-accounts': after([{ id: accountId, display_name: `Account ${accountId}` }]),
    'email:list-folders': after([{ id: folderId, account_id: accountId, path: `Folder ${folderId}` }]),
    'auth:list-users': after([{ id: 'user-1', display_name: 'Alice', is_active: 1 }]),
    'user-groups:list': after([]),
    'email:list-mail-delegation-bindings': after({
      items: includeBinding ? [{
        id: 900,
        subject: { type: 'user', id: 'user-1', label: 'Alice' },
        resource: { type: 'folder', accountId, folderId, label: `Folder ${folderId}` },
        permissions: ['mail.metadata.read', 'mail.send'],
        profile: 'custom',
        updatedAt: '2026-07-20T10:00:00.000Z',
      }] : [],
      nextCursor: null,
    }),
    'email:save-mail-delegation-binding': Promise.resolve({ success: true }),
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}
