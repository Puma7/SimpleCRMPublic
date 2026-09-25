/**
 * Nachrichtenliste im Papierkorb: Mehrfach-Wiederherstellen meldet Fehlschlaege.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockInvoke = jest.fn();
const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();
const mockToastWarning = jest.fn();

jest.mock('sonner', () => ({
  toast: Object.assign(jest.fn(), {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
    warning: (...args: unknown[]) => mockToastWarning(...args),
    info: jest.fn(),
    message: jest.fn(),
  }),
}));

jest.mock('@/services/transport', () => ({
  getRendererTransport: () => ({ kind: 'ipc' }),
  invokeRenderer: (...args: unknown[]) => mockInvoke(...args),
}));

const mockWorkspace = {
  searchQuery: '',
  setSearchQuery: jest.fn(),
  searchScope: { allFolders: false },
  setSearchScope: jest.fn(),
  searchSortMode: 'relevance',
  setSearchSortMode: jest.fn(),
  selectedMessage: null,
  selectedAccountId: 1,
  messageListFilter: 'all',
  messageDoneFilter: 'all',
  mailView: 'trash',
  categoryFilterId: null,
  listSortMode: 'date_desc',
  setListSortMode: jest.fn(),
  listDisplayMode: 'flat',
  setListDisplayMode: jest.fn(),
  conversationLocks: {},
};
jest.mock('../../src/components/email/workspace-context', () => ({
  useMailWorkspace: () => mockWorkspace,
}));

import { MessageList } from '../../src/components/email/message-list';
import type { EmailMessage } from '../../src/components/email/types';

function trashed(id: number): EmailMessage {
  return {
    id,
    account_id: 1,
    folder_id: 1,
    uid: id,
    subject: `Mail ${id}`,
    snippet: null,
    date_received: '2026-09-20T10:00:00.000Z',
    from_json: JSON.stringify({ value: [{ address: `absender${id}@example.com` }] }),
    body_text: null,
    body_html: null,
    seen_local: 1,
    soft_deleted: 1,
  } as EmailMessage;
}

function renderTrashList(onListChanged = jest.fn()) {
  render(
    <MessageList
      messages={[trashed(1), trashed(2)]}
      accounts={[]}
      loading={false}
      onOpen={jest.fn()}
      onListChanged={onListChanged}
    />,
  );
  fireEvent.click(screen.getByRole('checkbox', { name: 'Alle geladenen auswählen' }));
  return onListChanged;
}

describe('MessageList: Mehrfach-Wiederherstellen im Papierkorb', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
    mockToastWarning.mockReset();
  });

  // F-A11a-08: success:false beim Wiederherstellen wurde still weggezaehlt ('0 Nachrichten wiederhergestellt').
  test('meldet einen Fehler, wenn keine Nachricht wiederhergestellt wurde', async () => {
    mockInvoke.mockResolvedValue({ success: false, error: 'Ordner nicht gefunden' });
    const onListChanged = renderTrashList();

    fireEvent.click(screen.getByRole('button', { name: 'Wiederherstellen' }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Ordner nicht gefunden'));
    expect(mockToastSuccess).not.toHaveBeenCalled();
    expect(onListChanged).not.toHaveBeenCalled();
  });

  test('meldet einen Teilerfolg mit Anzahl', async () => {
    mockInvoke.mockImplementation((_channel: string, id: number) => Promise.resolve(
      id === 2 ? { success: false, error: 'Ordner nicht gefunden' } : { success: true },
    ));
    const onListChanged = renderTrashList();

    fireEvent.click(screen.getByRole('button', { name: 'Wiederherstellen' }));

    await waitFor(() => expect(mockToastWarning).toHaveBeenCalledWith(
      '1 von 2 Nachrichten wiederhergestellt (1 fehlgeschlagen: Ordner nicht gefunden)',
    ));
    expect(mockToastSuccess).not.toHaveBeenCalled();
    await waitFor(() => expect(onListChanged).toHaveBeenCalled());
  });

  test('meldet Erfolg wie bisher', async () => {
    mockInvoke.mockResolvedValue({ success: true });
    const onListChanged = renderTrashList();

    fireEvent.click(screen.getByRole('button', { name: 'Wiederherstellen' }));

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('2 Nachrichten wiederhergestellt'));
    await waitFor(() => expect(onListChanged).toHaveBeenCalled());
  });
});
