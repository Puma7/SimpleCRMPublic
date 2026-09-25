/**
 * ComposeDialog im Server-Client-Modus: Schutz des Verfasser-Inhalts beim
 * Schliessen, Kontowechsel und Hochladen von Anhaengen. Gemockt sind nur die
 * Modulgrenzen (Transport, Workspace-Kontext, Quill, Radix-Select, Toasts).
 */
import React, { useCallback, useState } from 'react';
import { act, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';

// Der Verfasser ist gross (Bootstrap mit mehreren async Schritten); unter
// Coverage und paralleler Last dauert das erste Rendern deutlich laenger.
jest.setTimeout(30_000);
configure({ asyncUtilTimeout: 10_000 });

const mockInvoke = jest.fn();
const mockUpload = jest.fn();
const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();
const mockToastInfo = jest.fn();
const mockWorkspace: { current: unknown } = { current: null };

jest.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
    info: (...args: unknown[]) => mockToastInfo(...args),
    warning: jest.fn(),
  },
}));

jest.mock('@/services/transport', () => ({
  getRendererTransport: () => ({ kind: 'http' }),
  invokeRenderer: (...args: unknown[]) => mockInvoke(...args),
  uploadServerComposeAttachment: (...args: unknown[]) => mockUpload(...args),
}));

jest.mock('@tanstack/react-router', () => ({ useNavigate: () => jest.fn() }));

const mockAuth = { user: { id: 'user-1', username: 'anna@firma.de', displayName: 'Anna', publicName: null } };
jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => mockAuth,
}));

jest.mock('../../src/components/email/workspace-context', () => ({
  useMailWorkspace: () => mockWorkspace.current,
}));

jest.mock('../../src/components/email/compose-quill-editor', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    ComposeQuillEditor: ReactActual.forwardRef(function MockComposeQuillEditor(
      { value, onChange }: { value: string; onChange: (html: string) => void },
      ref: React.ForwardedRef<unknown>,
    ) {
      ReactActual.useImperativeHandle(ref, () => ({
        focus: () => true,
        getHtml: () => value,
        getSelectionText: () => null,
        replaceSelectionText: () => false,
        insertTextAtCursor: () => false,
        hasKnownCursor: () => false,
      }));
      return (
        <textarea aria-label="Nachricht" value={value} onChange={(e) => onChange(e.target.value)} />
      );
    }),
  };
});

jest.mock('../../src/components/email/signature-quill-editor', () => ({
  SignatureQuillEditor: () => null,
}));
jest.mock('../../src/components/email/compose-outbound-preview-dialog', () => ({
  ComposeOutboundPreviewDialog: () => null,
}));
jest.mock('../../src/components/email/workflow/workflow-run-detail-dialog', () => ({
  WorkflowRunDetailDialog: () => null,
}));

// Radix-Select als natives <select>, damit der Kontowechsel im Test bedienbar ist.
jest.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children: React.ReactNode;
  }) => (
    <select value={value ?? ''} onChange={(e) => onValueChange?.(e.target.value)}>
      <option value="" />
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

import { ComposeDialog } from '../../src/components/email/compose-dialog';
import type { EmailAccount } from '../../src/components/email/types';
import type { ComposeIntent } from '../../src/components/email/workspace-context';

const accounts = [
  { id: 1, display_name: 'Service', email_address: 'service@firma.de' },
  { id: 2, display_name: 'Vertrieb', email_address: 'vertrieb@firma.de' },
] as EmailAccount[];
const noTeamMembers: never[] = [];
const noCanned: never[] = [];
const noPrompts: never[] = [];

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let nextDraftId = 42;
let updateComposeDraftImpl: (payload: Record<string, unknown>) => Promise<unknown>;

function defaultInvoke(channel: string, payload?: unknown): Promise<unknown> {
  switch (channel) {
    case 'email:create-compose-draft':
      return Promise.resolve({ success: true, id: nextDraftId++ });
    case 'email:update-compose-draft':
      return updateComposeDraftImpl(payload as Record<string, unknown>);
    case 'email:get-compose-signature':
      return Promise.resolve({ html: null });
    case 'email:list-user-signatures':
      return Promise.resolve({ signatures: [] });
    case 'email:get-tracking-settings':
      return Promise.reject(new Error('not configured'));
    case 'email:get-scheduled-send-draft-state':
      return Promise.resolve({ success: true, failureCount: 0, status: 'ok', lastError: null });
    case 'email:get-compose-draft-recovery-state':
      return Promise.resolve({ success: true, smtpCommitted: false, needsResendFinalize: false });
    case 'email:list-workflows':
      return Promise.resolve([]);
    case 'email:get-message':
      return Promise.resolve(null);
    case 'email:send-compose':
      return Promise.resolve({ success: true });
    default:
      return Promise.resolve({ success: true });
  }
}

function Harness({ onSent }: { onSent: jest.Mock }) {
  const [composeIntent, setComposeIntent] = useState<ComposeIntent>({ mode: 'new' });
  const [composeSession, setComposeSession] = useState<unknown>(null);
  const clearComposeSession = useCallback(() => setComposeSession(null), []);
  mockWorkspace.current = {
    composeIntent,
    setComposeIntent,
    selectedAccountId: 1,
    selectedMessage: null,
    setMailView: jest.fn(),
    setSelectedMessage: jest.fn(),
    setSettingsTab: jest.fn(),
    setSettingsAccountDeepLinkId: jest.fn(),
    setSettingsAccountsSubTab: jest.fn(),
    accountsRevision: 0,
    composeSession,
    setComposeSession,
    clearComposeSession,
  };
  return (
    <ComposeDialog
      accounts={accounts}
      teamMembers={noTeamMembers}
      cannedList={noCanned}
      aiPrompts={noPrompts}
      onSent={onSent}
    />
  );
}

function channelCalls(channel: string): unknown[][] {
  return mockInvoke.mock.calls.filter(([name]) => name === channel);
}

async function renderReadyCompose(onSent = jest.fn()) {
  render(<Harness onSent={onSent} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Senden' })).toBeEnabled());
  return onSent;
}

function dropFiles(files: File[]) {
  fireEvent.drop(screen.getByLabelText('Betreff'), {
    dataTransfer: { types: ['Files'], files, dropEffect: 'none' },
  });
}

describe('ComposeDialog: Verfasser-Inhalt bleibt bei Fehlern erhalten', () => {
  beforeEach(() => {
    nextDraftId = 42;
    mockInvoke.mockReset();
    mockUpload.mockReset();
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
    mockToastInfo.mockReset();
    updateComposeDraftImpl = () => Promise.resolve({ success: true });
    mockInvoke.mockImplementation(defaultInvoke);
  });

  // F-A11a-03: 'Als Entwurf speichern' schloss den Verfasser auch dann, wenn das Speichern scheiterte.
  test('Als Entwurf speichern laesst den Verfasser offen, wenn das Speichern scheitert', async () => {
    const onSent = await renderReadyCompose();
    fireEvent.change(screen.getByLabelText('Betreff'), { target: { value: 'Angebot Mai' } });
    updateComposeDraftImpl = () => Promise.reject(new Error('offline'));

    fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Als Entwurf speichern' }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith(
      'Entwurf konnte nicht gespeichert werden. Der Verfasser bleibt geöffnet.',
    ));
    expect(screen.getByLabelText('Betreff')).toHaveValue('Angebot Mai');
    expect(onSent).not.toHaveBeenCalled();
    expect(mockToastSuccess).not.toHaveBeenCalledWith('Entwurf in „Entwürfe“ gespeichert');
  });

  test('Als Entwurf speichern schliesst nach erfolgreichem Speichern', async () => {
    const onSent = await renderReadyCompose();
    fireEvent.change(screen.getByLabelText('Betreff'), { target: { value: 'Angebot Mai' } });

    fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Als Entwurf speichern' }));

    await waitFor(() => expect(onSent).toHaveBeenCalled());
    expect(mockToastSuccess).toHaveBeenCalledWith('Entwurf in „Entwürfe“ gespeichert');
    expect(screen.queryByLabelText('Betreff')).not.toBeInTheDocument();
  });

  // F-A11a-03: Auch der Kontowechsel ignorierte ein gescheitertes Speichern und verwarf den Entwurf.
  test('Kontowechsel bricht ab, wenn der Entwurf nicht gespeichert werden kann', async () => {
    await renderReadyCompose();
    fireEvent.change(screen.getByLabelText('Betreff'), { target: { value: 'Angebot Mai' } });
    updateComposeDraftImpl = () => Promise.reject(new Error('offline'));

    fireEvent.change(screen.getByDisplayValue('Service'), { target: { value: '2' } });

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith(
      'Entwurf konnte nicht gespeichert werden. Das Konto wurde nicht gewechselt.',
    ));
    expect(screen.getByDisplayValue('Service')).toBeInTheDocument();
    expect(screen.getByLabelText('Betreff')).toHaveValue('Angebot Mai');
    expect(channelCalls('email:create-compose-draft')).toHaveLength(1);
  });

  // F-A11a-02: Parallele Uploads bildeten die Pfadliste aus demselben veralteten Stand und verwarfen einen Anhang.
  test('zwei parallel hochgeladene Anhaenge bleiben beide im Entwurf', async () => {
    await renderReadyCompose();
    const uploadA = deferred<{ path: string }>();
    const uploadB = deferred<{ path: string }>();
    mockUpload
      .mockImplementationOnce(() => uploadA.promise)
      .mockImplementationOnce(() => uploadB.promise);

    dropFiles([new File(['a'], 'a.pdf', { type: 'application/pdf' })]);
    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
    dropFiles([new File(['b'], 'b.pdf', { type: 'application/pdf' })]);
    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(2));

    await act(async () => uploadA.resolve({ path: 'ws/compose-drafts/42/a.pdf' }));
    await act(async () => uploadB.resolve({ path: 'ws/compose-drafts/42/b.pdf' }));

    await waitFor(() => {
      const attachmentUpdates = channelCalls('email:update-compose-draft')
        .map(([, payload]) => payload as { draftAttachmentPaths?: string[] })
        .filter((payload) => payload.draftAttachmentPaths !== undefined);
      expect(attachmentUpdates.at(-1)?.draftAttachmentPaths).toEqual([
        'ws/compose-drafts/42/a.pdf',
        'ws/compose-drafts/42/b.pdf',
      ]);
    });
  });

  // F-A11a-02: Senden war waehrend eines laufenden Uploads moeglich, die Mail ging ohne den Anhang raus.
  test('Senden ist gesperrt, solange ein Anhang hochgeladen wird', async () => {
    await renderReadyCompose();
    fireEvent.change(screen.getByPlaceholderText('empfänger@example.com'), { target: { value: 'kunde@firma.de' } });
    const uploadA = deferred<{ path: string }>();
    mockUpload.mockImplementationOnce(() => uploadA.promise);

    dropFiles([new File(['a'], 'a.pdf', { type: 'application/pdf' })]);
    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));

    expect(screen.getByRole('button', { name: 'Senden' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Später senden' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }));
    expect(channelCalls('email:send-compose')).toHaveLength(0);

    await act(async () => uploadA.resolve({ path: 'ws/compose-drafts/42/a.pdf' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Senden' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }));

    await waitFor(() => expect(channelCalls('email:send-compose')).toHaveLength(1));
    expect(channelCalls('email:send-compose')[0]![1]).toEqual(expect.objectContaining({
      attachmentPaths: ['ws/compose-drafts/42/a.pdf'],
    }));
  });

  // F-A11a-02: Scheiterte im selben Stapel eine spaetere Datei, fehlte die bereits hochgeladene im Entwurf.
  test('bereits hochgeladene Dateien bleiben erhalten, wenn eine spaetere im Stapel scheitert', async () => {
    await renderReadyCompose();
    mockUpload
      .mockResolvedValueOnce({ path: 'ws/compose-drafts/42/a.pdf' })
      .mockRejectedValueOnce(new Error('Upload abgebrochen'));

    dropFiles([
      new File(['a'], 'a.pdf', { type: 'application/pdf' }),
      new File(['b'], 'b.pdf', { type: 'application/pdf' }),
    ]);

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Upload abgebrochen'));
    await waitFor(() => {
      const attachmentUpdates = channelCalls('email:update-compose-draft')
        .map(([, payload]) => payload as { draftAttachmentPaths?: string[] })
        .filter((payload) => payload.draftAttachmentPaths !== undefined);
      expect(attachmentUpdates.at(-1)?.draftAttachmentPaths).toEqual(['ws/compose-drafts/42/a.pdf']);
    });
  });
});
