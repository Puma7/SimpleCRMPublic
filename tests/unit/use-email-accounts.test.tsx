import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { EmailAccount } from '@/components/email/types';

const mockInvoke = jest.fn();
const mockSubscribe = jest.fn(() => ({ unsubscribe: jest.fn() }));
const mockToastError = jest.fn();

jest.mock('@/services/transport', () => ({
  invokeRenderer: (...args: unknown[]) => mockInvoke(...args),
  subscribeServerEvents: (...args: unknown[]) => mockSubscribe(...args),
  isMailAclRefreshEvent: (event: { type?: string }) => event.type === 'email_acl.changed',
}));

jest.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => mockToastError(...args) } }));

import { useEmailAccounts } from '@/components/email/hooks/use-email-accounts';
import { MailWorkspaceProvider, useMailWorkspace } from '@/components/email/workspace-context';

describe('useEmailAccounts ACL invalidation', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockSubscribe.mockClear();
    mockToastError.mockReset();
    window.localStorage.clear();
    window.localStorage.setItem('email:selectedAccountId', '101');
    window.localStorage.setItem('email:mailView', 'sent');
  });

  test('loads accounts normally and preserves a visible workspace selection', async () => {
    mockInvoke.mockImplementation(defaultInvoke);

    renderHookHarness();

    await waitFor(() => expect(screen.getByTestId('accounts')).toHaveTextContent('101'));
    expect(screen.getByTestId('selected-account')).toHaveTextContent('101');
    expect(screen.getByTestId('mail-view')).toHaveTextContent('sent');
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });

  test('keeps a revoked account empty when an older load resolves after the ACL refresh returns empty', async () => {
    const stale = deferred<EmailAccount[]>();
    const current = deferred<EmailAccount[]>();
    let accountRequest = 0;
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'email:list-accounts') {
        accountRequest += 1;
        if (accountRequest === 1) return Promise.resolve([account(101)]);
        if (accountRequest === 2) return stale.promise;
        if (accountRequest === 3) return current.promise;
      }
      if (channel === 'email:list-team-members') return Promise.resolve([]);
      throw new Error(`Unexpected channel ${channel}`);
    });

    renderHookHarness();
    await waitFor(() => expect(screen.getByTestId('accounts')).toHaveTextContent('101'));
    fireEvent.click(screen.getByRole('button', { name: 'Retry accounts' }));
    await waitFor(() => expect(accountRequest).toBe(2));

    emitAclChanged();

    expect(screen.getByTestId('accounts')).toHaveTextContent('none');
    expect(screen.getByTestId('selected-account')).toHaveTextContent('none');
    expect(screen.getByTestId('mail-view')).toHaveTextContent('inbox');
    expect(screen.getByTestId('loading')).toHaveTextContent('true');

    await act(async () => current.resolve([]));
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    await act(async () => stale.resolve([account(101)]));

    expect(screen.getByTestId('accounts')).toHaveTextContent('none');
    expect(screen.getByTestId('selected-account')).toHaveTextContent('none');
  });

  test('stays fail-closed after a refresh error, ignores stale success, and permits retry', async () => {
    const stale = deferred<EmailAccount[]>();
    const current = deferred<EmailAccount[]>();
    let accountRequest = 0;
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'email:list-accounts') {
        accountRequest += 1;
        if (accountRequest === 1) return Promise.resolve([account(101)]);
        if (accountRequest === 2) return stale.promise;
        if (accountRequest === 3) return current.promise;
        return Promise.resolve([account(102)]);
      }
      if (channel === 'email:list-team-members') return Promise.resolve([]);
      throw new Error(`Unexpected channel ${channel}`);
    });

    renderHookHarness();
    await waitFor(() => expect(screen.getByTestId('accounts')).toHaveTextContent('101'));
    fireEvent.click(screen.getByRole('button', { name: 'Retry accounts' }));
    await waitFor(() => expect(accountRequest).toBe(2));
    emitAclChanged();

    await act(async () => current.reject(new Error('transient account failure')));
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('accounts')).toHaveTextContent('none');
    expect(screen.getByTestId('selected-account')).toHaveTextContent('none');
    await act(async () => stale.resolve([account(101)]));
    expect(screen.getByTestId('accounts')).toHaveTextContent('none');

    fireEvent.click(screen.getByRole('button', { name: 'Retry accounts' }));
    await waitFor(() => expect(screen.getByTestId('accounts')).toHaveTextContent('102'));
    expect(screen.getByTestId('selected-account')).toHaveTextContent('102');
  });

  test('uses the latest StrictMode generation and ignores a pending load after unmount', async () => {
    const first = deferred<EmailAccount[]>();
    const second = deferred<EmailAccount[]>();
    const afterUnmount = deferred<EmailAccount[]>();
    let accountRequest = 0;
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'email:list-accounts') {
        accountRequest += 1;
        if (accountRequest === 1) return first.promise;
        if (accountRequest === 2) return second.promise;
        return afterUnmount.promise;
      }
      if (channel === 'email:list-team-members') return Promise.resolve([]);
      throw new Error(`Unexpected channel ${channel}`);
    });

    const view = renderHookHarness(true);
    await waitFor(() => expect(accountRequest).toBe(2));
    await act(async () => second.resolve([account(102)]));
    await waitFor(() => expect(screen.getByTestId('accounts')).toHaveTextContent('102'));
    await act(async () => first.resolve([account(101)]));
    expect(screen.getByTestId('accounts')).toHaveTextContent('102');

    fireEvent.click(screen.getByRole('button', { name: 'Retry accounts' }));
    await waitFor(() => expect(accountRequest).toBe(3));
    view.unmount();
    await act(async () => afterUnmount.resolve([account(103)]));
    for (const result of mockSubscribe.mock.results) {
      expect(result.value.unsubscribe).toHaveBeenCalledTimes(1);
    }
  });
});

function HookHarness() {
  const { accounts, loadingAccounts, loadAccounts } = useEmailAccounts();
  const { selectedAccountId, mailView } = useMailWorkspace();
  return (
    <>
      <output data-testid="accounts">{accounts.map((entry) => entry.id).join(',') || 'none'}</output>
      <output data-testid="selected-account">{selectedAccountId ?? 'none'}</output>
      <output data-testid="mail-view">{mailView}</output>
      <output data-testid="loading">{String(loadingAccounts)}</output>
      <button type="button" onClick={() => void loadAccounts()}>Retry accounts</button>
    </>
  );
}

function renderHookHarness(strict = false) {
  const content = (
    <MailWorkspaceProvider>
      <HookHarness />
    </MailWorkspaceProvider>
  );
  return render(strict ? <React.StrictMode>{content}</React.StrictMode> : content);
}

function emitAclChanged() {
  const subscription = mockSubscribe.mock.calls.at(-1)?.[0] as { onEvent: (event: unknown) => void };
  act(() => subscription.onEvent({ type: 'email_acl.changed', entityType: 'email_acl', payload: {} }));
}

async function defaultInvoke(channel: string) {
  if (channel === 'email:list-accounts') return [account(101)];
  if (channel === 'email:list-team-members') return [];
  throw new Error(`Unexpected channel ${channel}`);
}

function account(id: number): EmailAccount {
  return {
    id,
    display_name: `Account ${id}`,
    email_address: `account-${id}@example.test`,
    imap_host: 'imap.example.test',
    imap_port: 993,
    imap_tls: 1,
    imap_username: `account-${id}@example.test`,
    keytar_account_key: `account-${id}`,
    created_at: '2026-07-20T10:00:00.000Z',
    updated_at: '2026-07-20T10:00:00.000Z',
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((fulfill, fail) => {
    resolve = fulfill;
    reject = fail;
  });
  return { promise, resolve, reject };
}
