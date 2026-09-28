/**
 * Plan 048: Quellenangabe („Genutztes Wissen“) im Freigabe-Hinweis eines KI-Entwurfs.
 * Gemockt sind Transport, Workspace-Kontext und schwere Unterkomponenten.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';

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

const pendingDraft = {
  id: 9,
  account_id: 1,
  folder_id: 1,
  uid: -9,
  folder_kind: 'draft',
  subject: 'Re: Rücksendung',
  snippet: 'Guten Tag',
  date_received: '2026-09-20T10:00:00.000Z',
  from_json: JSON.stringify({ value: [{ address: 'support@firma.test' }] }),
  body_text: 'Guten Tag, das Etikett liegt bei.',
  body_html: null,
  seen_local: 1,
  soft_deleted: 0,
  approval_state: 'pending',
  approval_reason: 'Kulanz nicht eindeutig',
} as EmailMessage;

function renderViewer(selectedMessage: EmailMessage) {
  mockWorkspace.current = {
    selectedMessage,
    setSelectedMessage: jest.fn(),
    metadataPanelOpen: false,
    setMetadataPanelOpen: jest.fn(),
    mailView: 'inbox',
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
      refreshCurrentMessage={jest.fn()}
      refreshList={jest.fn()}
      advanceSelectionAfterMessageRemoved={jest.fn()}
      categories={[]}
      reloadTags={jest.fn()}
      onReply={jest.fn()}
      onReplyAll={jest.fn()}
      onForward={jest.fn()}
    />,
  );
}

/** Plan 048: der Freigabe-Hinweis nennt das genutzte Wissen des KI-Entwurfs. */
describe('MessageViewer: genutztes Wissen am Entwurf', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(null);
  });

  test('zeigt die Quellen im Hinweis „Wartet auf Freigabe“', () => {
    renderViewer({ ...pendingDraft, ai_sources: 'Handbuch › Rücksendungen; Learnings › Rückgabe' } as EmailMessage);
    expect(screen.getByText('Wartet auf Freigabe')).toBeInTheDocument();
    expect(screen.getByTestId('approval-ai-sources')).toHaveTextContent(
      'Genutztes Wissen: Handbuch › Rücksendungen; Learnings › Rückgabe',
    );
  });

  test('ohne Quellen keine Zeile', () => {
    renderViewer(pendingDraft);
    expect(screen.getByText('Wartet auf Freigabe')).toBeInTheDocument();
    expect(screen.queryByTestId('approval-ai-sources')).toBeNull();
  });
});
