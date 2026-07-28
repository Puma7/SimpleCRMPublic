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

  test('the reconcile PAGINATES the loaded range — the transport caps each page at 100', async () => {
    // Zwei Befunde in einem Test. Erstens: liegt die geoeffnete Nachricht
    // hinter dem ersten Fenster, half ein Abgleich der ersten Seite gar nichts.
    // Zweitens: ein groesseres `limit` mitzuschicken half auch nicht — der
    // HTTP-Transport deckelt jede Listenabfrage auf 100 (limitValue), die
    // gekappte Antwort waere faelschlich fuer den vollstaendigen Bereich
    // gehalten worden und haette alle tieferen, weiterhin erlaubten Zeilen
    // samt Auswahl verworfen.
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

    // Der Server liefert seitenweise und kennt 130 nicht mehr.
    const visible = many.filter((m) => m.id !== 130);
    mockInvokeRenderer.mockImplementation(async (channel: unknown, payload: any) => {
      if (channel === IPCChannels.Email.ListMessagesByView) {
        const offset = Number(payload.offset ?? 0);
        const limit = Number(payload.limit ?? 100);
        return visible.slice(offset, offset + limit);
      }
      return null;
    });

    await act(async () => {
      await result.current.refreshList({ preserveSelection: true, dropMissing: true });
    });

    const listCalls = mockInvokeRenderer.mock.calls
      .filter(([channel]) => channel === IPCChannels.Email.ListMessagesByView)
      .map(([, payload]) => payload as { limit: number; offset: number });
    // Zwei Seiten, jede innerhalb des Transport-Deckels.
    expect(listCalls).toEqual([
      expect.objectContaining({ limit: 100, offset: 0 }),
      expect.objectContaining({ limit: 100, offset: 100 }),
    ]);

    // Alle 149 weiterhin erlaubten Zeilen bleiben — nur die entzogene faellt.
    await waitFor(() => expect(result.current.messages).toHaveLength(149));
    expect(result.current.messages.some((m) => m.id === 130)).toBe(false);
    expect(result.current.messages.some((m) => m.id === 150)).toBe(true);
    expect(mockWorkspace.setSelectedMessage).toHaveBeenCalledWith(null);
  });

  test('a normal refresh that SUPERSEDES a running reconcile inherits the obligation', async () => {
    // Jeder nicht-anhaengende Load erhoeht loadGenerationRef und verwirft damit
    // die Antwort eines laufenden Abgleichs. Liefe der Nachfolger dann im
    // erhaltenden Modus, haengte er die inzwischen entzogene Zeile samt Auswahl
    // wieder an — ein Mail-Ereignis oder ein Klick auf „Aktualisieren" waehrend
    // einer langsamen ACL-Antwort genuegte dafuer.
    const { result, rerender } = renderHook(() => useEmailMessages());
    await loadInitial(rerender);

    // Abgleich starten, aber NICHT antworten lassen.
    await act(async () => {
      void result.current.refreshList({ preserveSelection: true, dropMissing: true });
    });
    await waitFor(() => expect(listDeferreds.has(1)).toBe(true));
    listDeferreds.delete(1);

    // Ein gewoehnlicher Refresh verdraengt ihn.
    await act(async () => {
      void result.current.refreshList({ preserveSelection: true });
    });
    await waitFor(() => expect(listDeferreds.has(1)).toBe(true));
    await act(async () => {
      listDeferreds.get(1)!([{ id: 1 }, { id: 3 }] as unknown[]);
    });

    // Er hat die Pflicht geerbt: Zeile 2 faellt weg statt wieder angehaengt zu
    // werden, und die Auswahl darauf wird geschlossen.
    await waitFor(() => expect(result.current.messages.map((m) => m.id)).toEqual([1, 3]));
    expect(mockWorkspace.setSelectedMessage).toHaveBeenCalledWith(null);
  });

  test('a FAILED reconcile clears list and selection instead of trusting them', async () => {
    // Der Abgleich sollte pruefen, ob geladene Nachrichten noch sichtbar sind.
    // Konnte er das nicht — Netz- oder Serverfehler —, weiss niemand es. Die
    // alte Liste stehenzulassen hiesse, moeglicherweise entzogene Inhalte
    // weiter anzuzeigen; der Detailbereich haelt ohnehin an seinem geladenen
    // Inhalt fest.
    const rejecters = new Map<number, (reason: unknown) => void>();
    const { result, rerender } = renderHook(() => useEmailMessages());
    await loadInitial(rerender);

    mockInvokeRenderer.mockImplementation((channel: unknown, payload: any) => {
      if (channel === IPCChannels.Email.ListMessagesByView) {
        return new Promise((_resolve, reject) => {
          rejecters.set(payload.accountId as number, reject);
        });
      }
      return Promise.resolve(null);
    });

    await act(async () => {
      void result.current.refreshList({ preserveSelection: true, dropMissing: true });
    });
    await waitFor(() => expect(rejecters.has(1)).toBe(true));
    await act(async () => {
      rejecters.get(1)!(new Error('network down'));
    });

    await waitFor(() => expect(result.current.messages).toEqual([]));
    expect(mockWorkspace.setSelectedMessage).toHaveBeenCalledWith(null);
  });

  test('a failed ORDINARY silent refresh keeps the list — nothing was revoked', async () => {
    const rejecters = new Map<number, (reason: unknown) => void>();
    const { result, rerender } = renderHook(() => useEmailMessages());
    await loadInitial(rerender);

    mockInvokeRenderer.mockImplementation((channel: unknown, payload: any) => {
      if (channel === IPCChannels.Email.ListMessagesByView) {
        return new Promise((_resolve, reject) => {
          rejecters.set(payload.accountId as number, reject);
        });
      }
      return Promise.resolve(null);
    });

    await act(async () => {
      void result.current.refreshList({ preserveSelection: true });
    });
    await waitFor(() => expect(rejecters.has(1)).toBe(true));
    await act(async () => {
      rejecters.get(1)!(new Error('network down'));
    });

    expect(result.current.messages.map((m) => m.id)).toEqual([1, 2, 3]);
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
