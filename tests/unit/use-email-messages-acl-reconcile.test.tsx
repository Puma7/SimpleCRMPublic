import { renderHook, act, waitFor } from '@testing-library/react';
import { IPCChannels } from '@shared/ipc/channels';
import { useEmailMessages } from '@/components/email/hooks/use-email-messages';

const mockInvokeRenderer = jest.fn();
const listDeferreds = new Map<number, (value: unknown) => void>();

jest.mock('@/services/transport', () => ({
  invokeRenderer: (...args: unknown[]) => mockInvokeRenderer(...args),
}));

jest.mock('sonner', () => ({
  toast: Object.assign(jest.fn(), { error: jest.fn(), info: jest.fn(), success: jest.fn() }),
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

/**
 * Der stille Refresh nach einer ACL-Aenderung muss ABGLEICHEN, nicht erhalten.
 *
 * Schreibt ein Workflow oder die KI einer bereits geladenen Nachricht einen
 * Tag bzw. eine Kategorie aus einem Ausschlussfilter, faellt sie aus der
 * gescopten Serverliste. Der erhaltende Pfad haengt genau diese Zeilen als
 * `notInServer` wieder an und behaelt die Auswahl — der parallele
 * Detail-Refresh protokolliert die abgelehnte Anfrage nur und laesst den alten
 * Inhalt stehen. Die Invalidierung erfuellte damit ihren Zweck nicht.
 */
describe('useEmailMessages — ACL reconcile', () => {
  beforeEach(() => {
    mockInvokeRenderer.mockReset();
    (mockWorkspace.setSelectedMessage as jest.Mock).mockReset();
    listDeferreds.clear();
    mockWorkspace.selectedAccountId = 1;
    mockWorkspace.selectedMessage = null;
    mockInvokeRenderer.mockImplementation((channel: unknown, payload: any) => {
      if (channel === IPCChannels.Email.ListMessagesByView) {
        return new Promise((resolve) => {
          listDeferreds.set(payload.accountId as number, resolve);
        });
      }
      return Promise.resolve(null);
    });
  });

  const loadInitial = async (rerender: () => void) => {
    await waitFor(() => expect(listDeferreds.has(1)).toBe(true));
    await act(async () => {
      listDeferreds.get(1)!([{ id: 1 }, { id: 2 }, { id: 3 }] as unknown[]);
    });
    listDeferreds.delete(1);
    // Nachricht 2 ist geoeffnet.
    act(() => {
      mockWorkspace.selectedMessage = { id: 2 };
    });
    rerender();
    // Der Erstlauf setzt die Auswahl selbst auf null — ab hier zaehlt nur noch,
    // was der Abgleich tut.
    (mockWorkspace.setSelectedMessage as jest.Mock).mockClear();
  };

  test('a revoked message disappears from the list AND from the selection', async () => {
    const { result, rerender } = renderHook(() => useEmailMessages());
    await loadInitial(rerender);

    await act(async () => {
      void result.current.refreshList({ preserveSelection: true, dropMissing: true });
    });
    await waitFor(() => expect(listDeferreds.has(1)).toBe(true));
    // Der Server liefert 2 nicht mehr — der Sichtbarkeitsfilter schliesst sie aus.
    await act(async () => {
      listDeferreds.get(1)!([{ id: 1 }, { id: 3 }] as unknown[]);
    });

    await waitFor(() => expect(result.current.messages.map((m) => m.id)).toEqual([1, 3]));
    expect(mockWorkspace.setSelectedMessage).toHaveBeenCalledWith(null);
  });

  test('without the reconcile flag the row and the selection survive', async () => {
    // Das ist das richtige Verhalten fuer den ALLTAEGLICHEN stillen Refresh:
    // die erste Seite beschreibt die tiefer geladenen Seiten nicht.
    const { result, rerender } = renderHook(() => useEmailMessages());
    await loadInitial(rerender);

    await act(async () => {
      void result.current.refreshList({ preserveSelection: true });
    });
    await waitFor(() => expect(listDeferreds.has(1)).toBe(true));
    await act(async () => {
      listDeferreds.get(1)!([{ id: 1 }, { id: 3 }] as unknown[]);
    });

    await waitFor(() => expect(result.current.messages.map((m) => m.id)).toEqual([1, 3, 2]));
    expect(mockWorkspace.setSelectedMessage).not.toHaveBeenCalledWith(null);
  });

  test('a row BEYOND the first page is checked too — and its selection cleared', async () => {
    // Der Kern des Befunds: liegt die geoeffnete Nachricht hinter dem ersten
    // PAGE_SIZE-Fenster, half ein Abgleich der ersten Seite gar nichts. Der
    // Abgleich fragt deshalb den GESAMTEN geladenen Bereich neu ab.
    const many = Array.from({ length: 150 }, (_, index) => ({ id: index + 1 }));
    const { result, rerender } = renderHook(() => useEmailMessages());
    await waitFor(() => expect(listDeferreds.has(1)).toBe(true));
    await act(async () => {
      listDeferreds.get(1)!(many as unknown[]);
    });
    listDeferreds.delete(1);
    act(() => {
      mockWorkspace.selectedMessage = { id: 130 };
    });
    rerender();
    (mockWorkspace.setSelectedMessage as jest.Mock).mockClear();
    mockInvokeRenderer.mockClear();

    await act(async () => {
      void result.current.refreshList({ preserveSelection: true, dropMissing: true });
    });
    await waitFor(() => expect(listDeferreds.has(1)).toBe(true));

    // Die Abfrage deckt alle 150 geladenen Zeilen ab, nicht nur die ersten 100.
    const listCall = mockInvokeRenderer.mock.calls
      .find(([channel]) => channel === IPCChannels.Email.ListMessagesByView);
    expect((listCall?.[1] as { limit: number }).limit).toBe(150);

    // 130 ist entzogen.
    await act(async () => {
      listDeferreds.get(1)!(many.filter((m) => m.id !== 130) as unknown[]);
    });

    await waitFor(() => expect(result.current.messages).toHaveLength(149));
    expect(result.current.messages.some((m) => m.id === 130)).toBe(false);
    expect(mockWorkspace.setSelectedMessage).toHaveBeenCalledWith(null);
  });

  test('a still-visible selection is kept across the reconcile', async () => {
    const { result, rerender } = renderHook(() => useEmailMessages());
    await loadInitial(rerender);

    await act(async () => {
      void result.current.refreshList({ preserveSelection: true, dropMissing: true });
    });
    await waitFor(() => expect(listDeferreds.has(1)).toBe(true));
    await act(async () => {
      listDeferreds.get(1)!([{ id: 1 }, { id: 2 }] as unknown[]);
    });

    await waitFor(() => expect(result.current.messages.map((m) => m.id)).toEqual([1, 2]));
    expect(mockWorkspace.setSelectedMessage).not.toHaveBeenCalledWith(null);
  });
});
