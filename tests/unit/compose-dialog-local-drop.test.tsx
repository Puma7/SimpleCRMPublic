/**
 * ComposeDialog im Desktop-Modus: Anhaenge per Drag & Drop. Den Pfad liefert der
 * Preload-Helfer (webUtils.getPathForFile), der die Datei im Main-Prozess
 * freigibt; der Verfasser speichert nur die so freigegebenen Pfade. Gemockt sind
 * nur die Modulgrenzen (Transport, Workspace-Kontext, Quill, Radix-Select, Toasts).
 */
import React, { useCallback, useState } from 'react';
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react';

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
  getRendererTransport: () => ({ kind: 'ipc' }),
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

const accounts = [{ id: 1, display_name: 'Service', email_address: 'service@firma.de' }] as EmailAccount[];
const noTeamMembers: never[] = [];
const noCanned: never[] = [];
const noPrompts: never[] = [];
const mockRegisterDropped = jest.fn();

function invokeByChannel(channel: string): Promise<unknown> {
  switch (channel) {
    case 'email:create-compose-draft':
      return Promise.resolve({ success: true, id: 42 });
    case 'email:get-compose-signature':
      return Promise.resolve({ html: null });
    case 'email:get-scheduled-send-draft-state':
      return Promise.resolve({ success: true, failureCount: 0, status: 'ok', lastError: null });
    case 'email:get-compose-draft-recovery-state':
      return Promise.resolve({ success: true, smtpCommitted: false, needsResendFinalize: false });
    case 'email:list-workflows':
      return Promise.resolve([]);
    case 'email:get-message':
      return Promise.resolve(null);
    default:
      return Promise.resolve({ success: true });
  }
}

function Harness() {
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
      onSent={jest.fn()}
    />
  );
}

function dropFiles(files: File[]) {
  fireEvent.drop(screen.getByLabelText('Betreff'), {
    dataTransfer: { types: ['Files'], files, dropEffect: 'none' },
  });
}

const attachmentUpdates = () =>
  mockInvoke.mock.calls
    .filter(([channel, payload]) =>
      channel === 'email:update-compose-draft'
      && (payload as { draftAttachmentPaths?: string[] }).draftAttachmentPaths !== undefined)
    .map(([, payload]) => (payload as { draftAttachmentPaths: string[] }).draftAttachmentPaths);

describe('ComposeDialog (Desktop): Anhaenge per Drag & Drop', () => {
  beforeEach(() => {
    mockInvoke.mockReset().mockImplementation(invokeByChannel);
    mockRegisterDropped.mockReset();
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
    Object.assign(window, {
      electronAPI: {
        invoke: (channel: string) => invokeByChannel(channel),
        registerDroppedComposeAttachments: mockRegisterDropped,
      },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
  });

  // C-A30: Der Verfasser las den Pfad aus File.path und meldete ihn ungeprueft an den Main-Prozess.
  test('uebernimmt nur die vom Preload freigegebenen Pfade', async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Senden' })).toBeEnabled());
    const file = new File(['a'], 'angebot.pdf', { type: 'application/pdf' });
    mockRegisterDropped.mockResolvedValueOnce(['/home/anna/angebot.pdf']);

    dropFiles([file]);

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('Anhang hinzugefügt'));
    expect(mockRegisterDropped).toHaveBeenCalledWith([file]);
    expect(attachmentUpdates().at(-1)).toEqual(['/home/anna/angebot.pdf']);
  });

  test('meldet einen Fehler, wenn der Preload nichts freigibt', async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Senden' })).toBeEnabled());
    mockRegisterDropped.mockRejectedValueOnce(new Error('kein Zugriff'));

    dropFiles([new File(['a'], 'a.pdf')]);

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith(
      'Anhänge per Drag & Drop sind nur für lokale Dateien verfügbar.',
    ));
    expect(attachmentUpdates()).toEqual([]);
  });
});
