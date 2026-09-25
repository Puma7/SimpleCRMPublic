/**
 * Details-Spalte: Mail-Sicherheit (SPF/DKIM/DMARC) und Konversation gehoeren
 * immer zur aktuell gewaehlten Nachricht, auch wenn Antworten spaet kommen.
 */
import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockInvoke = jest.fn();
const mockWorkspace: { current: unknown } = { current: null };

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/services/transport', () => ({
  invokeRenderer: (...args: unknown[]) => mockInvoke(...args),
}));
jest.mock('../../src/components/email/workspace-context', () => ({
  useMailWorkspace: () => mockWorkspace.current,
}));
jest.mock('../../src/components/email/message-evidence-panel', () => ({
  MessageEvidencePanel: () => null,
}));
jest.mock('@/components/customer-combobox', () => ({
  CustomerCombobox: () => null,
}));
jest.mock('../../src/components/email/note-markdown', () => ({
  NoteMarkdown: () => null,
}));

import { MessageMetadataPanel } from '../../src/components/email/message-metadata-panel';
import type { EmailMessage } from '../../src/components/email/types';

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function message(id: number, from: string): EmailMessage {
  return {
    id,
    account_id: 1,
    folder_id: 1,
    uid: id,
    subject: `Mail ${id}`,
    snippet: null,
    date_received: null,
    from_json: JSON.stringify({ value: [{ address: from }] }),
    body_text: null,
    body_html: null,
    seen_local: 1,
  } as EmailMessage;
}

const mailA = message(1, 'partner@example.com');
const mailB = message(2, 'phish@example.net');

const noop = () => undefined;
let selectMessage: (message: EmailMessage) => void = noop;

function Harness() {
  const [selectedMessage, setSelectedMessage] = useState<EmailMessage>(mailA);
  selectMessage = setSelectedMessage;
  mockWorkspace.current = {
    selectedMessage,
    selectedAccountId: 1,
    setSelectedMessage,
    categoryAssignmentRevision: 0,
    bumpCategoryAssignmentRevision: noop,
  };
  return (
    <MessageMetadataPanel
      teamMembers={[]}
      categories={[]}
      messageTags={[]}
      internalNotes={[]}
      reloadNotes={noop}
      reloadTags={noop}
      refreshCurrentMessage={noop}
    />
  );
}

function securityResponse(result: 'pass' | 'fail') {
  return { success: true, authSpf: result, authDkim: result, authDmarc: result, authArc: null };
}

function dmarcValue(): string | null {
  const label = screen.queryByText('DMARC');
  return label?.nextElementSibling?.textContent ?? null;
}

describe('MessageMetadataPanel: Sicherheitsanzeige ohne Werte der vorigen Nachricht', () => {
  let securityByMessage: Map<number, Promise<unknown>[]>;
  let conversationByMessage: Map<number, Promise<unknown>>;

  beforeEach(() => {
    selectMessage = noop;
    securityByMessage = new Map();
    conversationByMessage = new Map();
    mockInvoke.mockReset();
    mockInvoke.mockImplementation((channel: string, payload: unknown) => {
      if (channel === 'email:get-message-security') {
        const queue = securityByMessage.get(payload as number) ?? [];
        return queue.shift() ?? Promise.resolve({ success: false });
      }
      if (channel === 'email:list-conversation-messages') {
        const messageId = (payload as { messageId: number }).messageId;
        return conversationByMessage.get(messageId) ?? Promise.resolve([]);
      }
      if (channel === 'email:run-mail-security-check') return Promise.resolve({ success: true });
      return Promise.resolve([]);
    });
  });

  // F-A11a-05: Beim Nachrichtenwechsel blieben SPF/DKIM/DMARC der vorigen Mail sichtbar.
  test('zeigt beim Wechsel keine Werte der vorigen Nachricht, solange die neue laedt', async () => {
    const securityB = deferred<unknown>();
    securityByMessage.set(1, [Promise.resolve(securityResponse('pass'))]);
    securityByMessage.set(2, [securityB.promise]);
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Mail-Sicherheit' }));
    await waitFor(() => expect(dmarcValue()).toBe('pass'));

    act(() => selectMessage(mailB));

    expect(dmarcValue()).toBeNull();
    expect(screen.getByText('Lädt…')).toBeInTheDocument();
    await act(async () => securityB.resolve(securityResponse('fail')));
    await waitFor(() => expect(dmarcValue()).toBe('fail'));
  });

  // F-A11a-05: Eine spaete Antwort fuer die vorige Mail ueberschrieb die Werte der aktuellen dauerhaft.
  test('eine spaete Antwort fuer die vorige Nachricht ueberschreibt die aktuelle nicht', async () => {
    const securityA = deferred<unknown>();
    securityByMessage.set(1, [securityA.promise]);
    securityByMessage.set(2, [Promise.resolve(securityResponse('fail'))]);
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Mail-Sicherheit' }));

    act(() => selectMessage(mailB));
    await waitFor(() => expect(dmarcValue()).toBe('fail'));
    await act(async () => securityA.resolve(securityResponse('pass')));

    expect(dmarcValue()).toBe('fail');
  });

  // F-A11a-05: 'Erneut pruefen' bei Mail A schrieb sein Ergebnis unter Mail B, wenn inzwischen gewechselt wurde.
  test('Erneut pruefen schreibt nach einem Wechsel nicht in die neue Nachricht', async () => {
    const recheckA = deferred<unknown>();
    securityByMessage.set(1, [Promise.resolve(securityResponse('pass')), recheckA.promise]);
    securityByMessage.set(2, [Promise.resolve(securityResponse('fail'))]);
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Mail-Sicherheit' }));
    await waitFor(() => expect(dmarcValue()).toBe('pass'));

    fireEvent.click(screen.getByRole('button', { name: 'Erneut prüfen' }));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('email:run-mail-security-check', 1));
    act(() => selectMessage(mailB));
    await waitFor(() => expect(dmarcValue()).toBe('fail'));
    await act(async () => recheckA.resolve(securityResponse('pass')));

    expect(dmarcValue()).toBe('fail');
  });

  // F-A11a-05: Auch die Konversationsliste uebernahm eine spaete Antwort der vorigen Nachricht.
  test('eine spaete Konversationsantwort der vorigen Nachricht wird verworfen', async () => {
    const conversationA = deferred<unknown>();
    conversationByMessage.set(1, conversationA.promise);
    conversationByMessage.set(2, Promise.resolve([{ ...message(20, 'phish@example.net'), subject: 'Verlauf B' }]));
    render(<Harness />);

    act(() => selectMessage(mailB));
    expect(await screen.findByText('Verlauf B')).toBeInTheDocument();
    await act(async () => conversationA.resolve([{ ...message(10, 'partner@example.com'), subject: 'Verlauf A' }]));

    expect(screen.queryByText('Verlauf A')).not.toBeInTheDocument();
    expect(screen.getByText('Verlauf B')).toBeInTheDocument();
  });
});
