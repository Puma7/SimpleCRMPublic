import { renderHook, act, waitFor } from '@testing-library/react';
import { IPCChannels } from '@shared/ipc/channels';
import { toast } from 'sonner';
import { useEmailMessages } from '@/components/email/hooks/use-email-messages';

const mockInvokeRenderer = jest.fn();

jest.mock('@/services/transport', () => ({
  invokeRenderer: (...args: unknown[]) => mockInvokeRenderer(...args),
}));

jest.mock('sonner', () => ({
  toast: Object.assign(jest.fn(), {
    error: jest.fn(),
    info: jest.fn(),
    success: jest.fn(),
    warning: jest.fn(),
  }),
}));

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

describe('useEmailMessages.moveMessagesToView — Fehlschlaege', () => {
  let moveResults: Map<number, { success: boolean; error?: string }>;

  beforeEach(() => {
    moveResults = new Map();
    mockInvokeRenderer.mockReset();
    jest.mocked(toast.success).mockReset();
    jest.mocked(toast.error).mockReset();
    jest.mocked(toast.warning).mockReset();
    mockInvokeRenderer.mockImplementation((channel: unknown, payload: any) => {
      if (channel === IPCChannels.Email.MoveMessageToView) {
        return Promise.resolve(moveResults.get(payload.messageId) ?? { success: true });
      }
      if (channel === IPCChannels.Email.ListMessagesByView) return Promise.resolve([]);
      return Promise.resolve(null);
    });
  });

  // F-A11a-08: Scheiterte das Verschieben fuer alle Nachrichten, meldete die UI '0 Nachrichten → Papierkorb' als Erfolg.
  test('meldet einen Fehler, wenn keine Nachricht verschoben wurde', async () => {
    moveResults.set(1, { success: false, error: 'Keine Berechtigung' });
    moveResults.set(2, { success: false, error: 'Keine Berechtigung' });
    const { result } = renderHook(() => useEmailMessages());

    let moved: boolean | undefined;
    await act(async () => {
      moved = await result.current.moveMessagesToView([1, 2], 'trash');
    });

    expect(moved).toBe(false);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Keine Berechtigung');
  });

  // F-A11a-08: Teilfehlschlaege wurden nie gemeldet.
  test('meldet einen Teilerfolg mit Anzahl statt reinem Erfolg', async () => {
    moveResults.set(2, { success: false, error: 'Nachricht gesperrt' });
    const { result } = renderHook(() => useEmailMessages());

    let moved: boolean | undefined;
    await act(async () => {
      moved = await result.current.moveMessagesToView([1, 2, 3], 'trash');
    });

    expect(moved).toBe(true);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledWith('2 von 3 Nachrichten → Papierkorb (1 fehlgeschlagen: Nachricht gesperrt)');
  });

  test('meldet Erfolg wie bisher, wenn alle verschoben wurden', async () => {
    const { result } = renderHook(() => useEmailMessages());

    await act(async () => {
      await result.current.moveMessagesToView([1, 2], 'archived');
    });

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('2 Nachrichten → Archiv'));
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
  });
});
