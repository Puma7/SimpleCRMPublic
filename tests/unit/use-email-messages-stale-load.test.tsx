import { renderHook, act, waitFor } from '@testing-library/react';
import { IPCChannels } from '@shared/ipc/channels';
import { useEmailMessages } from '@/components/email/hooks/use-email-messages';

// --- transport mock: return a deferred promise per ListMessagesByView call,
// keyed by the account id in the payload, so the test controls resolve order.
const mockInvokeRenderer = jest.fn();
const listDeferreds = new Map<number, (value: unknown) => void>();

jest.mock('@/services/transport', () => ({
  invokeRenderer: (...args: unknown[]) => mockInvokeRenderer(...args),
}));

jest.mock('sonner', () => ({
  toast: Object.assign(jest.fn(), {
    error: jest.fn(),
    info: jest.fn(),
    success: jest.fn(),
  }),
}));

// --- workspace mock: a single mutable object read at call time (name starts
// with `mock` so the jest.mock factory may close over it).
const mockWorkspace: Record<string, unknown> = {
  selectedAccountId: 1,
  mailView: 'inbox',
  categoryFilterId: null,
  searchQuery: '',
  selectedMessage: null,
  setSelectedMessage: jest.fn(),
  listSortMode: 'date_desc',
  messageListFilter: 'all',
  messageDoneFilter: 'open',
  bumpCategoryAssignmentRevision: jest.fn(),
};

jest.mock('@/components/email/workspace-context', () => ({
  useMailWorkspace: () => mockWorkspace,
}));

describe('useEmailMessages — stale/racing list load', () => {
  beforeEach(() => {
    mockInvokeRenderer.mockReset();
    (mockWorkspace.setSelectedMessage as jest.Mock).mockReset();
    listDeferreds.clear();
    mockWorkspace.selectedAccountId = 1;
    mockWorkspace.selectedMessage = null;
    // Every ListMessagesByView call returns a promise the test resolves later,
    // keyed by the account id in the payload.
    mockInvokeRenderer.mockImplementation((channel: unknown, payload: any) => {
      if (channel === IPCChannels.Email.ListMessagesByView) {
        return new Promise((resolve) => {
          listDeferreds.set(payload.accountId as number, resolve);
        });
      }
      // GetMessage / anything else the hook may call during selection.
      return Promise.resolve(null);
    });
  });

  test('the later-started load wins even if the earlier one resolves last', async () => {
    const { result, rerender } = renderHook(() => useEmailMessages());

    // Account 1's load is now in flight (pending deferred).
    await waitFor(() => expect(listDeferreds.has(1)).toBe(true));

    // User switches to account 2 -> a second load starts, also pending.
    act(() => {
      mockWorkspace.selectedAccountId = 2;
    });
    rerender();
    await waitFor(() => expect(listDeferreds.has(2)).toBe(true));

    // Account 2 (the later request) resolves FIRST.
    await act(async () => {
      listDeferreds.get(2)!([{ id: 20 } as unknown]);
    });
    await waitFor(() =>
      expect(result.current.messages.map((m) => m.id)).toEqual([20]),
    );

    // Account 1 (the earlier request) resolves LAST — it is stale and must NOT
    // overwrite account 2's list.
    await act(async () => {
      listDeferreds.get(1)!([{ id: 10 } as unknown]);
    });

    expect(result.current.messages.map((m) => m.id)).toEqual([20]);
  });

  test('a normal single load still populates the list', async () => {
    const { result } = renderHook(() => useEmailMessages());
    await waitFor(() => expect(listDeferreds.has(1)).toBe(true));

    await act(async () => {
      listDeferreds.get(1)!([{ id: 1 }, { id: 2 }] as unknown[]);
    });

    await waitFor(() =>
      expect(result.current.messages.map((m) => m.id)).toEqual([1, 2]),
    );
    expect(result.current.loadingMessages).toBe(false);
  });

  test('a cleared account scope drops an in-flight load (stale resolve is not repopulated)', async () => {
    const { result, rerender } = renderHook(() => useEmailMessages());

    // Account 1's load is now in flight (pending deferred).
    await waitFor(() => expect(listDeferreds.has(1)).toBe(true));

    // User clears the account scope -> the effect clears the list and bumps
    // loadSeqRef (Step 1f), so any in-flight request becomes stale.
    act(() => {
      mockWorkspace.selectedAccountId = null;
    });
    rerender();
    await waitFor(() => expect(result.current.messages).toEqual([]));

    // The in-flight account-1 request resolves LATE — it is stale and must NOT
    // repopulate the just-cleared list.
    await act(async () => {
      listDeferreds.get(1)!([{ id: 10 } as unknown]);
    });

    expect(result.current.messages).toEqual([]);
  });

  test('a late detail response cannot replace the message selected afterwards', async () => {
    const detailResolvers = new Map<number, (value: unknown) => void>();
    mockInvokeRenderer.mockImplementation((channel: unknown, payload: any) => {
      if (channel === IPCChannels.Email.ListMessagesByView) {
        return new Promise((resolve) => {
          listDeferreds.set(payload.accountId as number, resolve);
        });
      }
      if (channel === IPCChannels.Email.GetMessage) {
        return new Promise((resolve) => {
          detailResolvers.set(Number(payload), resolve);
        });
      }
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => useEmailMessages());
    await waitFor(() => expect(listDeferreds.has(1)).toBe(true));

    const rows = [
      { id: 1, uid: -1, seen_local: 1 },
      { id: 2, uid: -2, seen_local: 1 },
    ] as any[];
    await act(async () => {
      listDeferreds.get(1)!(rows);
    });

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.openMessage(rows[0]);
      second = result.current.openMessage(rows[1]);
    });
    await waitFor(() => expect(detailResolvers.size).toBe(2));

    await act(async () => {
      detailResolvers.get(2)!({ ...rows[1], body_text: 'zweite Nachricht' });
      await second;
    });
    await act(async () => {
      detailResolvers.get(1)!({ ...rows[0], body_text: 'veraltete erste Nachricht' });
      await first;
    });

    const selections = (mockWorkspace.setSelectedMessage as jest.Mock).mock.calls
      .map(([value]) => value)
      .filter((value) => value && typeof value === 'object');
    expect(selections.at(-1)).toMatchObject({ id: 2, body_text: 'zweite Nachricht' });
  });

  test('a late refresh cannot restore the message that was open before a new selection', async () => {
    const detailResolvers = new Map<number, (value: unknown) => void>();
    mockInvokeRenderer.mockImplementation((channel: unknown, payload: any) => {
      if (channel === IPCChannels.Email.ListMessagesByView) {
        return new Promise((resolve) => {
          listDeferreds.set(payload.accountId as number, resolve);
        });
      }
      if (channel === IPCChannels.Email.GetMessage) {
        return new Promise((resolve) => {
          detailResolvers.set(Number(payload), resolve);
        });
      }
      return Promise.resolve(null);
    });

    const first = { id: 1, uid: -1, seen_local: 1 } as any;
    const second = { id: 2, uid: -2, seen_local: 1 } as any;
    mockWorkspace.selectedMessage = first;
    const { result } = renderHook(() => useEmailMessages());
    await waitFor(() => expect(listDeferreds.has(1)).toBe(true));

    let refresh!: Promise<void>;
    let open!: Promise<void>;
    act(() => {
      refresh = result.current.refreshCurrentMessage();
      open = result.current.openMessage(second);
    });
    await waitFor(() => expect(detailResolvers.size).toBe(2));

    await act(async () => {
      detailResolvers.get(2)!({ ...second, body_text: 'aktuelle Nachricht' });
      await open;
    });
    await act(async () => {
      detailResolvers.get(1)!({ ...first, body_text: 'veralteter Refresh' });
      await refresh;
    });

    const selections = (mockWorkspace.setSelectedMessage as jest.Mock).mock.calls
      .map(([value]) => value)
      .filter((value) => value && typeof value === 'object');
    expect(selections.at(-1)).toMatchObject({ id: 2, body_text: 'aktuelle Nachricht' });
  });
});
