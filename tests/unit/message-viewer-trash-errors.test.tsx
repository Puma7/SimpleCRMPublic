/**
 * Viewer: Papierkorb/Wiederherstellen melden Fehler statt sie zu verschlucken.
 * Gemockt sind Transport, Workspace-Kontext und schwere Unterkomponenten.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockInvoke = jest.fn();
const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();
const mockWorkspace: { current: unknown } = { current: null };

jest.mock('sonner', () => ({
  toast: Object.assign(jest.fn(), {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
    info: jest.fn(),
    warning: jest.fn(),
    message: jest.fn(),
  }),
}));

jest.mock('@/services/transport', () => ({
  getRendererTransport: () => ({ kind: 'http', serverBaseUrl: 'https://crm.example.com' }),
  getServerAccessToken: () => null,
  invokeRenderer: (...args: unknown[]) => mockInvoke(...args),
  decryptServerPgpAttachment: jest.fn(),
  verifyServerPgpAttachment: jest.fn(),
}));

jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => ({ user: { id: 'user-1', role: 'user' }, canViewWorkflows: false }),
}));

jest.mock('../../src/components/email/workspace-context', () => ({
  useMailWorkspace: () => mockWorkspace.current,
}));
jest.mock('../../src/components/email/message-metadata-panel', () => ({ MessageMetadataPanel: () => null }));
jest.mock('../../src/components/email/message-ai-suggestions', () => ({ MessageAiSuggestions: () => null }));
jest.mock('../../src/components/email/email-html-frame', () => ({ EmailHtmlFrame: () => null }));
jest.mock('../../src/components/email/apply-workflow-menu', () => ({ ApplyWorkflowMenu: () => null }));
jest.mock('../../src/components/email/workflow/workflow-run-detail-dialog', () => ({
  WorkflowRunDetailDialog: () => null,
}));
jest.mock('@/components/snooze/snooze-popover', () => ({ SnoozePopover: () => null }));

import { MessageViewer } from '../../src/components/email/message-viewer';
import type { EmailMessage } from '../../src/components/email/types';

const inboxMessage = {
  id: 7,
  account_id: 1,
  folder_id: 1,
  uid: 70,
  folder_kind: 'inbox',
  subject: 'Rechnung',
  snippet: 'Hallo',
  date_received: '2026-09-20T10:00:00.000Z',
  from_json: JSON.stringify({ value: [{ address: 'kunde@example.com' }] }),
  body_text: 'Hallo',
  body_html: null,
  seen_local: 1,
  soft_deleted: 0,
} as EmailMessage;

const trashedMessage = { ...inboxMessage, soft_deleted: 1 } as EmailMessage;

function renderViewer(selectedMessage: EmailMessage) {
  const advanceSelectionAfterMessageRemoved = jest.fn();
  const refreshCurrentMessage = jest.fn();
  const refreshList = jest.fn();
  mockWorkspace.current = {
    selectedMessage,
    setSelectedMessage: jest.fn(),
    metadataPanelOpen: false,
    setMetadataPanelOpen: jest.fn(),
    mailView: selectedMessage.soft_deleted ? 'trash' : 'inbox',
    messageDoneFilter: 'open',
    setComposeIntent: jest.fn(),
    conversationLocks: {},
    upsertConversationLock: jest.fn(),
  };
  render(
    <MessageViewer
      accounts={[]}
      teamMembers={[]}
      messageTags={[]}
      internalNotes={[]}
      messageAttachments={[]}
      reloadNotes={jest.fn()}
      refreshCurrentMessage={refreshCurrentMessage}
      refreshList={refreshList}
      advanceSelectionAfterMessageRemoved={advanceSelectionAfterMessageRemoved}
      categories={[]}
      reloadTags={jest.fn()}
      onReply={jest.fn()}
      onReplyAll={jest.fn()}
      onForward={jest.fn()}
    />,
  );
  return { advanceSelectionAfterMessageRemoved, refreshCurrentMessage, refreshList };
}

describe('MessageViewer: Fehler bei Papierkorb und Wiederherstellen', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
  });

  // F-A11a-08: Ein abgelehntes Loeschen (z. B. 403 ohne mail.delete) blieb ohne jede Rueckmeldung.
  test('Papierkorb meldet einen Serverfehler und springt nicht weiter', async () => {
    mockInvoke.mockImplementation((channel: string) => (
      channel === 'email:soft-delete-message'
        ? Promise.reject(new Error('Keine Berechtigung'))
        : Promise.resolve(null)
    ));
    const { advanceSelectionAfterMessageRemoved } = renderViewer(inboxMessage);

    fireEvent.click(screen.getByRole('button', { name: 'Papierkorb' }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Keine Berechtigung'));
    expect(mockToastSuccess).not.toHaveBeenCalledWith('In den Papierkorb verschoben');
    expect(advanceSelectionAfterMessageRemoved).not.toHaveBeenCalled();
  });

  test('Papierkorb meldet success:false ohne Erfolgsmeldung', async () => {
    mockInvoke.mockImplementation((channel: string) => (
      channel === 'email:soft-delete-message'
        ? Promise.resolve({ success: false, error: 'Nachricht gesperrt' })
        : Promise.resolve(null)
    ));
    const { advanceSelectionAfterMessageRemoved } = renderViewer(inboxMessage);

    fireEvent.click(screen.getByRole('button', { name: 'Papierkorb' }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Nachricht gesperrt'));
    expect(mockToastSuccess).not.toHaveBeenCalled();
    expect(advanceSelectionAfterMessageRemoved).not.toHaveBeenCalled();
  });

  test('Papierkorb bei Erfolg wie bisher', async () => {
    mockInvoke.mockImplementation((channel: string) => (
      channel === 'email:soft-delete-message' ? Promise.resolve({ success: true }) : Promise.resolve(null)
    ));
    const { advanceSelectionAfterMessageRemoved } = renderViewer(inboxMessage);

    fireEvent.click(screen.getByRole('button', { name: 'Papierkorb' }));

    await waitFor(() => expect(advanceSelectionAfterMessageRemoved).toHaveBeenCalledWith(7));
    expect(mockToastSuccess).toHaveBeenCalledWith('In den Papierkorb verschoben');
    expect(mockToastError).not.toHaveBeenCalled();
  });

  // F-A11a-08: Auch ein gescheitertes Wiederherstellen wurde verschluckt.
  test('Wiederherstellen meldet einen Serverfehler', async () => {
    mockInvoke.mockImplementation((channel: string) => (
      channel === 'email:restore-message'
        ? Promise.reject(new Error('Wiederherstellen verweigert'))
        : Promise.resolve(null)
    ));
    const { refreshCurrentMessage } = renderViewer(trashedMessage);

    fireEvent.click(screen.getByRole('button', { name: 'Wiederherstellen' }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Wiederherstellen verweigert'));
    expect(mockToastSuccess).not.toHaveBeenCalled();
    expect(refreshCurrentMessage).not.toHaveBeenCalled();
  });
});
