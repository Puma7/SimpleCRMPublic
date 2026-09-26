/**
 * Viewer: Die Freigabe fuer Remote-Inhalte gilt nur fuer die Nachricht, fuer die
 * sie erteilt wurde. Spaete Antworten (Policy-Abfrage, "Absender erlauben")
 * duerfen eine inzwischen ausgewaehlte andere Nachricht nicht freischalten.
 * Gemockt sind Transport, Workspace-Kontext und schwere Unterkomponenten.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { IPCChannels } from '@shared/ipc/channels';

const mockInvoke = jest.fn();
const mockWorkspace: { current: unknown } = { current: null };
const mockFrameRenders: Array<{ html: string; allowRemote: boolean }> = [];

jest.mock('sonner', () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
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
jest.mock('../../src/components/email/email-html-frame', () => ({
  EmailHtmlFrame: (props: { html: string; allowRemote: boolean }) => {
    mockFrameRenders.push({ html: props.html, allowRemote: props.allowRemote });
    return null;
  },
}));
jest.mock('../../src/components/email/apply-workflow-menu', () => ({ ApplyWorkflowMenu: () => null }));
jest.mock('../../src/components/email/workflow/workflow-run-detail-dialog', () => ({
  WorkflowRunDetailDialog: () => null,
}));
jest.mock('@/components/snooze/snooze-popover', () => ({ SnoozePopover: () => null }));

import { MessageViewer } from '../../src/components/email/message-viewer';
import type { EmailMessage } from '../../src/components/email/types';

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const TRACKER_A = 'https://tracker.example/a.png';
const TRACKER_B = 'https://tracker.example/b.png';

function htmlMessage(id: number, tracker: string): EmailMessage {
  return {
    id,
    account_id: 1,
    folder_id: 1,
    uid: id * 10,
    folder_kind: 'inbox',
    subject: `Newsletter ${id}`,
    snippet: 'Hallo',
    date_received: '2026-09-20T10:00:00.000Z',
    from_json: JSON.stringify({ value: [{ address: `absender${id}@example.com` }] }),
    body_text: 'Hallo',
    body_html: `<p>Hallo ${id}</p><img src="${tracker}" alt="">`,
    seen_local: 1,
    soft_deleted: 0,
  } as EmailMessage;
}

const messageA = htmlMessage(11, TRACKER_A);
const messageB = htmlMessage(12, TRACKER_B);

let policyRequests: Map<number, Deferred<unknown>>;
let setPolicyRequests: Deferred<unknown>[];

function workspaceFor(selectedMessage: EmailMessage) {
  return {
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
}

function viewerElement() {
  return (
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
    />
  );
}

function renderViewer(selectedMessage: EmailMessage) {
  mockWorkspace.current = workspaceFor(selectedMessage);
  const view = render(viewerElement());
  return {
    select(next: EmailMessage) {
      mockWorkspace.current = workspaceFor(next);
      view.rerender(viewerElement());
    },
  };
}

async function resolvePolicy(messageId: number, allowRemote: boolean) {
  const request = policyRequests.get(messageId);
  if (!request) throw new Error(`keine Policy-Anfrage fuer Nachricht ${messageId}`);
  await act(async () => {
    request.resolve({ allowRemote });
  });
}

function lastFrame() {
  const frame = mockFrameRenders[mockFrameRenders.length - 1];
  if (!frame) throw new Error('EmailHtmlFrame wurde nicht gerendert');
  return frame;
}

describe('MessageViewer: Remote-Inhalte sind an die Nachricht gebunden', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockFrameRenders.length = 0;
    policyRequests = new Map();
    setPolicyRequests = [];
    mockInvoke.mockImplementation((channel: string, payload?: { messageId?: number }) => {
      if (channel === IPCChannels.Email.GetRemoteContentPolicy && typeof payload?.messageId === 'number') {
        const request = deferred<unknown>();
        policyRequests.set(payload.messageId, request);
        return request.promise;
      }
      if (channel === IPCChannels.Email.SetRemoteContentPolicy) {
        const request = deferred<unknown>();
        setPolicyRequests.push(request);
        return request.promise;
      }
      return Promise.resolve(null);
    });
  });

  // C-C8: Eine spaete allowRemote:true-Antwort fuer A schaltete Remote-Inhalte der danach gewaehlten Nachricht B frei.
  test('spaete Policy-Antwort der vorigen Nachricht gibt die aktuelle nicht frei', async () => {
    const viewer = renderViewer(messageA);
    expect(policyRequests.has(messageA.id)).toBe(true);

    viewer.select(messageB);
    expect(policyRequests.has(messageB.id)).toBe(true);

    await resolvePolicy(messageB.id, false);
    await resolvePolicy(messageA.id, true);

    fireEvent.click(screen.getByRole('button', { name: 'HTML anzeigen' }));

    expect(lastFrame().allowRemote).toBe(false);
    expect(lastFrame().html).not.toContain(TRACKER_B);
    expect(screen.getByRole('button', { name: 'Einmal laden' })).toBeInTheDocument();
    expect(mockFrameRenders.some((frame) => frame.allowRemote)).toBe(false);
  });

  // C-A33: "Absender erlauben" auf A schaltete nach dem await ungeprueft die inzwischen gewaehlte Nachricht B frei.
  test('abgeschlossenes "Absender erlauben" der vorigen Nachricht gibt die aktuelle nicht frei', async () => {
    const viewer = renderViewer(messageA);
    await resolvePolicy(messageA.id, false);

    fireEvent.click(screen.getByRole('button', { name: 'HTML anzeigen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Absender erlauben' }));
    expect(setPolicyRequests).toHaveLength(1);
    expect(mockInvoke).toHaveBeenCalledWith(IPCChannels.Email.SetRemoteContentPolicy, {
      messageId: messageA.id,
      policy: 'allowed_sender',
      rememberSender: true,
    });

    viewer.select(messageB);
    await resolvePolicy(messageB.id, false);
    await act(async () => {
      setPolicyRequests[0].resolve({ success: true });
    });

    fireEvent.click(screen.getByRole('button', { name: 'HTML anzeigen' }));

    expect(lastFrame().allowRemote).toBe(false);
    expect(lastFrame().html).not.toContain(TRACKER_B);
    expect(mockFrameRenders.some((frame) => frame.allowRemote)).toBe(false);
  });

  // C-B7: "Einmal laden" auf A galt beim Wechsel auf B noch einen Render lang und B wurde mit gelockerter CSP gerendert.
  test('"Einmal laden" gilt nur fuer die Nachricht, auf der geklickt wurde', async () => {
    const viewer = renderViewer(messageA);
    await resolvePolicy(messageA.id, false);

    fireEvent.click(screen.getByRole('button', { name: 'HTML anzeigen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Einmal laden' }));
    expect(lastFrame().allowRemote).toBe(true);
    expect(lastFrame().html).toContain(TRACKER_A);

    mockFrameRenders.length = 0;
    viewer.select(messageB);

    const framesForB = mockFrameRenders.filter((frame) => frame.html.includes('Hallo 12'));
    expect(framesForB.every((frame) => !frame.allowRemote && !frame.html.includes(TRACKER_B))).toBe(true);

    await resolvePolicy(messageB.id, false);
    fireEvent.click(screen.getByRole('button', { name: 'HTML anzeigen' }));
    expect(lastFrame().allowRemote).toBe(false);
    expect(lastFrame().html).not.toContain(TRACKER_B);
  });

  test('Policy-Antwort der aktuellen Nachricht laedt Remote-Inhalte wie bisher', async () => {
    renderViewer(messageB);
    await resolvePolicy(messageB.id, true);

    fireEvent.click(screen.getByRole('button', { name: 'HTML anzeigen' }));

    expect(lastFrame().allowRemote).toBe(true);
    expect(lastFrame().html).toContain(TRACKER_B);
    expect(screen.queryByRole('button', { name: 'Einmal laden' })).not.toBeInTheDocument();
  });

  test('"Absender erlauben" ohne Nachrichtenwechsel laedt Remote-Inhalte wie bisher', async () => {
    renderViewer(messageA);
    await resolvePolicy(messageA.id, false);

    fireEvent.click(screen.getByRole('button', { name: 'HTML anzeigen' }));
    expect(lastFrame().allowRemote).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Absender erlauben' }));
    await act(async () => {
      setPolicyRequests[0].resolve({ success: true });
    });

    expect(lastFrame().allowRemote).toBe(true);
    expect(lastFrame().html).toContain(TRACKER_A);
  });
});
