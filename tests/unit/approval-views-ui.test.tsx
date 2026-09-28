/**
 * Plan 049: Warteschlangen „Wartet auf Freigabe“ und „Versand blockiert“ in
 * der Seitenleiste (direkt unter „Entwürfe“, kein Zähler, kein Ablageziel)
 * und deren Wiederherstellung aus localStorage.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

const mockSetMailView = jest.fn();
let mockUseRealWorkspace = false;
jest.mock('@/components/email/workspace-context', () => {
  const actual = jest.requireActual('@/components/email/workspace-context');
  return {
    ...actual,
    useMailWorkspace: () => (mockUseRealWorkspace ? actual.useMailWorkspace() : {
      selectedAccountId: 'all',
      setSelectedAccountId: jest.fn(),
      mailView: 'inbox',
      setMailView: mockSetMailView,
      categoryFilterId: null,
      setCategoryFilterId: jest.fn(),
      setSearchQuery: jest.fn(),
    }),
  };
});

jest.mock('@/components/email/hooks/use-mail-folder-counts', () => ({
  useMailFolderCounts: () => ({
    counts: {
      inbox: 0, inboxUnread: 0, sentFailed: 0, drafts: 3, scheduledSend: 0,
      archived: 0, spamReview: 0, spam: 0, trash: 0, snoozed: 0,
    },
  }),
}));

jest.mock('@/services/transport', () => ({
  invokeRenderer: jest.fn(async () => []),
  getRendererTransport: () => ({ kind: 'ipc' }),
}));

import { MailSidebar } from '@/components/email/mail-sidebar';
import { MailWorkspaceProvider, useMailWorkspace } from '@/components/email/workspace-context';

beforeEach(() => {
  mockSetMailView.mockReset();
  mockUseRealWorkspace = false;
  window.localStorage.clear();
});

function renderSidebar() {
  render(
    <MailSidebar
      accounts={[]}
      loadingAccounts={false}
      categories={[]}
      countForCategory={() => 0}
      onCategoriesChanged={jest.fn()}
      onMoveMessageToView={jest.fn(async () => true)}
      onMoveMessagesToView={jest.fn(async () => true)}
      onAssignMessageCategory={jest.fn(async () => true)}
      onAssignMessagesCategory={jest.fn(async () => true)}
      onSnoozeMessage={jest.fn(async () => true)}
    />,
  );
}

test('stehen direkt unter „Entwürfe“ und wählen ihre Ansicht', () => {
  renderSidebar();
  const labels = screen
    .getAllByRole('button')
    .map((button) => button.getAttribute('title'))
    .filter((title): title is string => Boolean(title));
  const draftsIndex = labels.findIndex((title) => title.startsWith('Entwürfe'));
  expect(draftsIndex).toBeGreaterThanOrEqual(0);
  expect(labels.slice(draftsIndex + 1, draftsIndex + 3)).toEqual(['Wartet auf Freigabe', 'Versand blockiert']);

  const pending = screen.getByTitle('Wartet auf Freigabe');
  expect(pending).toHaveTextContent(/^Wartet auf Freigabe$/);
  fireEvent.click(pending);
  expect(mockSetMailView).toHaveBeenCalledWith('approval_pending');
  fireEvent.click(screen.getByTitle('Versand blockiert'));
  expect(mockSetMailView).toHaveBeenCalledWith('outbound_blocked');
});

test('sind keine Ablageziele für Drag & Drop', () => {
  renderSidebar();
  const dataTransfer = {
    getData: () => JSON.stringify({ messageId: 5, messageIds: [5] }),
    types: ['application/x-simplecrm-mail'],
    dropEffect: 'none',
  };
  expect(fireEvent.dragOver(screen.getByTitle('Archiv'), { dataTransfer })).toBe(false);
  expect(fireEvent.dragOver(screen.getByTitle('Wartet auf Freigabe'), { dataTransfer })).toBe(true);
  expect(fireEvent.dragOver(screen.getByTitle('Versand blockiert'), { dataTransfer })).toBe(true);
});

test.each(['approval_pending', 'outbound_blocked'])('%s wird aus localStorage wiederhergestellt', (view) => {
  mockUseRealWorkspace = true;
  function Probe() {
    const { mailView } = useMailWorkspace();
    return <span data-testid="view">{mailView}</span>;
  }
  window.localStorage.setItem('email:mailView', view);
  render(<MailWorkspaceProvider><Probe /></MailWorkspaceProvider>);
  expect(screen.getByTestId('view')).toHaveTextContent(view);
});
