import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MAIL_PERMISSION_PROFILES } from '@simplecrm/core';

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
    mockInvoke.mockImplementation(defaultInvoke);
  });

  test('uses policy-scoped options without users.manage and saves profile plus individual permission', async () => {
    render(<MailDelegationPanel />);

    expect((await screen.findAllByText('Alice')).length).toBeGreaterThan(0);
    expect(mockInvoke.mock.calls.some(([channel]) => channel === 'auth:list-users')).toBe(false);
    expect(mockInvoke.mock.calls.some(([channel]) => channel === 'user-groups:list')).toBe(false);
    expect(mockInvoke.mock.calls.some(([channel]) => channel === 'email:list-accounts')).toBe(false);
    expect(mockInvoke.mock.calls.some(([channel]) => channel === 'email:list-folders')).toBe(false);

    fireEvent.change(screen.getByLabelText('Profil'), { target: { value: 'triage' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Senden', exact: true }));
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

  test('loads every bounded resource, subject, and binding page', async () => {
    mockInvoke.mockImplementation(async (channel: string, payload?: Record<string, unknown>) => {
      if (channel === 'email:list-mail-delegation-resources') {
        const resourceType = payload?.resourceType;
        if (resourceType === 'account' && payload?.cursor === 101) {
          return { items: [{ type: 'account', accountId: 102, label: 'Sales' }], nextCursor: null };
        }
        if (resourceType === 'account') {
          return { items: [{ type: 'account', accountId: 101, label: 'Support' }], nextCursor: 101 };
        }
        return { items: [{ type: 'folder', accountId: 101, folderId: 202, accountLabel: 'Support', label: 'INBOX' }], nextCursor: null };
      }
      if (channel === 'email:list-mail-delegation-subjects') {
        if (payload?.subjectType === 'user' && payload?.cursor === 'user-1') {
          return { items: [{ type: 'user', id: 'user-2', label: 'Bob' }], nextCursor: null };
        }
        if (payload?.subjectType === 'user') {
          return { items: [{ type: 'user', id: 'user-1', label: 'Alice' }], nextCursor: 'user-1' };
        }
        return { items: [{ type: 'group', id: 55, label: 'Support-Team' }], nextCursor: null };
      }
      if (channel === 'email:list-mail-delegation-bindings' && payload?.cursor === 900) {
        return { items: [binding(901, 'user-2', 'Bob')], nextCursor: null };
      }
      if (channel === 'email:list-mail-delegation-bindings') {
        return { items: [binding(900, 'user-1', 'Alice')], nextCursor: 900 };
      }
      return { success: true };
    });

    render(<MailDelegationPanel />);

    expect((await screen.findAllByText('Bob')).length).toBeGreaterThan(0);
    expect(mockInvoke).toHaveBeenCalledWith('email:list-mail-delegation-resources', {
      resourceType: 'account',
      cursor: 101,
      limit: 100,
    });
    expect(mockInvoke).toHaveBeenCalledWith('email:list-mail-delegation-subjects', {
      resource: { type: 'account', accountId: 101 },
      subjectType: 'user',
      cursor: 'user-1',
      limit: 100,
    });
    expect(mockInvoke).toHaveBeenCalledWith('email:list-mail-delegation-bindings', { cursor: 900, limit: 100 });
  });

  test('turns an edited user binding into a create with reset permissions after subject type changes', async () => {
    mockInvoke.mockImplementation(subjectChangeInvoke);
    render(<MailDelegationPanel />);

    await editAliceBinding();
    expect(screen.getByRole('checkbox', { name: 'Senden', exact: true })).toBeChecked();
    expect(screen.getByLabelText('Profil')).toHaveValue('custom');

    fireEvent.change(screen.getByLabelText('Subjekt'), { target: { value: 'group' } });

    expect(screen.queryByRole('button', { name: 'Abbrechen' })).toBeNull();
    expect(screen.getByLabelText('Profil')).toHaveValue('viewer');
    expect(screen.getByRole('checkbox', { name: 'Senden', exact: true })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Berechtigung speichern' }));

    await expectCreateFor({ type: 'group', id: 55 });
  });

  test('turns an edited binding into a create with reset permissions after subject id changes', async () => {
    mockInvoke.mockImplementation(subjectChangeInvoke);
    render(<MailDelegationPanel />);

    await editAliceBinding();
    fireEvent.change(screen.getByLabelText('Auswahl'), { target: { value: 'user-2' } });

    expect(screen.queryByRole('button', { name: 'Abbrechen' })).toBeNull();
    expect(screen.getByLabelText('Profil')).toHaveValue('viewer');
    expect(screen.getByRole('checkbox', { name: 'Senden', exact: true })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Berechtigung speichern' }));

    await expectCreateFor({ type: 'user', id: 'user-2' });
  });

  test('keeps edit cancel and resource changes fail-safe', async () => {
    mockInvoke.mockImplementation(subjectChangeInvoke);
    render(<MailDelegationPanel />);

    await editAliceBinding();
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(screen.queryByRole('button', { name: 'Abbrechen' })).toBeNull();
    expect(screen.getByLabelText('Profil')).toHaveValue('viewer');
    expect(screen.getByRole('checkbox', { name: 'Senden', exact: true })).not.toBeChecked();

    await editAliceBinding();
    fireEvent.change(screen.getByLabelText('Ressource'), { target: { value: 'folder' } });
    await waitFor(() => expect(screen.getByLabelText('Ressource')).toHaveValue('folder'));
    expect(screen.queryByRole('button', { name: 'Abbrechen' })).toBeNull();
    expect(screen.getByLabelText('Profil')).toHaveValue('viewer');
    expect(screen.getByRole('checkbox', { name: 'Senden', exact: true })).not.toBeChecked();
  });

  test('fails closed on ACL refresh errors, ignores late responses, and recovers only after full retry', async () => {
    render(<MailDelegationPanel />);
    expect((await screen.findAllByText('Alice')).length).toBeGreaterThan(0);
    const editButton = screen.getAllByRole('button', { name: /Alice/ })
      .find((button) => !button.getAttribute('aria-label')?.startsWith('Löschen'));
    if (!editButton) throw new Error('missing edit binding button');
    fireEvent.click(editButton);
    fireEvent.change(screen.getByLabelText('Profil'), { target: { value: 'sender' } });

    const slow = deferred<void>();
    const failure = deferred<void>();
    const retry = deferred<void>();
    const passes = [
      refreshPass(slow.promise, 101, 202, true),
      refreshPass(failure.promise, 101, 202, true, true),
      refreshPass(retry.promise, 102, 203, false),
    ];
    let passIndex = -1;
    mockInvoke.mockImplementation((channel: string, payload?: Record<string, unknown>) => {
      if (channel === 'email:list-mail-delegation-resources' && payload?.resourceType === 'account') passIndex += 1;
      return passes[passIndex]!(channel, payload);
    });

    const subscription = mockSubscribe.mock.calls.at(-1)?.[0] as { onEvent: (event: unknown) => void };
    act(() => subscription.onEvent({ type: 'email_acl.changed', payload: { targetUserId: 'manager' } }));
    act(() => subscription.onEvent({ type: 'email_acl.changed', payload: { targetUserId: 'manager' } }));

    expect(screen.getByLabelText('Konto')).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Abbrechen' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Berechtigung speichern' })).toBeDisabled();
    for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).not.toBeChecked();

    await act(async () => failure.resolve());
    expect(await screen.findByText('Delegationen konnten nicht geladen werden.')).toBeTruthy();
    expect(screen.getByLabelText('Konto')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Berechtigung speichern' })).toBeDisabled();

    await act(async () => slow.resolve());
    expect(screen.getByLabelText('Konto')).toHaveValue('');

    fireEvent.click(screen.getByRole('button', { name: 'Aktualisieren' }));
    await act(async () => retry.resolve());
    await waitFor(() => expect(screen.getByLabelText('Konto')).toHaveValue('102'));
    expect(screen.queryByRole('option', { name: 'Account 101' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Berechtigung speichern' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Abbrechen' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Berechtigung speichern' }));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(
      'email:save-mail-delegation-binding',
      expect.objectContaining({ resource: { type: 'account', accountId: 102 } }),
    ));
    const saves = mockInvoke.mock.calls.filter(([channel]) => channel === 'email:save-mail-delegation-binding');
    expect(saves.at(-1)?.[1]).not.toHaveProperty('id');
  });

  test('unsubscribes and ignores an in-flight ACL refresh after unmount under StrictMode', async () => {
    const view = render(
      <React.StrictMode>
        <MailDelegationPanel />
      </React.StrictMode>,
    );
    expect((await screen.findAllByText('Alice')).length).toBeGreaterThan(0);

    const gate = deferred<void>();
    const pass = refreshPass(gate.promise, 102, 203, false);
    mockInvoke.mockImplementation(pass);
    const subscription = mockSubscribe.mock.calls.at(-1)?.[0] as { onEvent: (event: unknown) => void };
    act(() => subscription.onEvent({ type: 'email_acl.changed', payload: { targetUserId: 'manager' } }));
    view.unmount();
    await act(async () => gate.resolve());

    for (const result of mockSubscribe.mock.results) {
      expect(result.value.unsubscribe).toHaveBeenCalledTimes(1);
    }
  });
});

async function defaultInvoke(channel: string, payload?: Record<string, unknown>) {
  if (channel === 'email:list-mail-delegation-resources') {
    if (payload?.resourceType === 'account') {
      return { items: [{ type: 'account', accountId: 101, label: 'Support' }], nextCursor: null };
    }
    return {
      items: [{ type: 'folder', accountId: 101, folderId: 202, accountLabel: 'Support', label: 'INBOX' }],
      nextCursor: null,
    };
  }
  if (channel === 'email:list-mail-delegation-subjects') {
    if (payload?.subjectType === 'user') {
      return { items: [{ type: 'user', id: 'user-1', label: 'Alice' }], nextCursor: null };
    }
    return { items: [{ type: 'group', id: 55, label: 'Support-Team' }], nextCursor: null };
  }
  if (channel === 'email:list-mail-delegation-bindings') {
    return { items: [binding(900, 'user-1', 'Alice')], nextCursor: null };
  }
  if (channel === 'email:save-mail-delegation-binding') return { success: true };
  if (channel === 'email:delete-mail-delegation-binding') return { success: true };
  throw new Error(`Unexpected channel ${channel}`);
}

function binding(id: number, userId: string, label: string) {
  return {
    id,
    subject: { type: 'user', id: userId, label },
    resource: { type: 'account', accountId: 101, label: 'Support' },
    permissions: ['mail.metadata.read'],
    profile: 'custom',
    updatedAt: '2026-07-20T10:00:00.000Z',
  };
}

async function subjectChangeInvoke(channel: string, payload?: Record<string, unknown>) {
  if (channel === 'email:list-mail-delegation-resources') return defaultInvoke(channel, payload);
  if (channel === 'email:list-mail-delegation-subjects') {
    if (payload?.subjectType === 'user') {
      return {
        items: [
          { type: 'user', id: 'user-1', label: 'Alice' },
          { type: 'user', id: 'user-2', label: 'Bob' },
        ],
        nextCursor: null,
      };
    }
    return { items: [{ type: 'group', id: 55, label: 'Support-Team' }], nextCursor: null };
  }
  if (channel === 'email:list-mail-delegation-bindings') {
    return {
      items: [{
        ...binding(900, 'user-1', 'Alice'),
        permissions: ['mail.metadata.read', 'mail.send'],
      }],
      nextCursor: null,
    };
  }
  if (channel === 'email:save-mail-delegation-binding') return { success: true };
  throw new Error(`Unexpected channel ${channel}`);
}

async function editAliceBinding() {
  expect((await screen.findAllByText('Alice')).length).toBeGreaterThan(0);
  const editButton = screen.getAllByRole('button', { name: /Alice/ })
    .find((button) => !button.getAttribute('aria-label')?.startsWith('Löschen'));
  if (!editButton) throw new Error('missing edit binding button');
  fireEvent.click(editButton);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeVisible());
}

async function expectCreateFor(subject: { type: 'user'; id: string } | { type: 'group'; id: number }) {
  await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(
    'email:save-mail-delegation-binding',
    expect.objectContaining({
      subject,
      profile: 'viewer',
      permissions: [...MAIL_PERMISSION_PROFILES.viewer].sort(),
    }),
  ));
  const saves = mockInvoke.mock.calls.filter(([channel]) => channel === 'email:save-mail-delegation-binding');
  expect(saves.at(-1)?.[1]).not.toHaveProperty('id');
}

function refreshPass(
  gate: Promise<void>,
  accountId: number,
  folderId: number,
  includeBinding: boolean,
  fail = false,
) {
  return (channel: string, payload?: Record<string, unknown>): Promise<unknown> => gate.then(() => {
    if (fail && channel === 'email:list-mail-delegation-resources' && payload?.resourceType === 'account') {
      throw new Error('transient resource options failure');
    }
    if (channel === 'email:list-mail-delegation-resources') {
      if (payload?.resourceType === 'account') {
        return { items: [{ type: 'account', accountId, label: `Account ${accountId}` }], nextCursor: null };
      }
      return {
        items: [{
          type: 'folder',
          accountId,
          folderId,
          accountLabel: `Account ${accountId}`,
          label: `Folder ${folderId}`,
        }],
        nextCursor: null,
      };
    }
    if (channel === 'email:list-mail-delegation-subjects') {
      if (payload?.subjectType === 'user') {
        return { items: [{ type: 'user', id: 'user-1', label: 'Alice' }], nextCursor: null };
      }
      return { items: [], nextCursor: null };
    }
    if (channel === 'email:list-mail-delegation-bindings') {
      return { items: includeBinding ? [binding(900, 'user-1', 'Alice')] : [], nextCursor: null };
    }
    if (channel === 'email:save-mail-delegation-binding') return { success: true };
    throw new Error(`Unexpected channel ${channel}`);
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}
