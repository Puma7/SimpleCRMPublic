/**
 * ComposeDialog (Teilautomatisierung P2): Ein vom Ausgang angehaltener Entwurf
 * bekommt neben „Senden“ den Knopf „Ohne Ausgangsprüfung senden“ — nur laut
 * Einstellung, mit Rückfrage, und erst nach dem Speichern des Entwurfs.
 * Gemockt sind nur die Modulgrenzen (wie compose-dialog-draft-safety.test.tsx).
 */
import React, { useCallback, useState } from 'react';
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react';

// Der Verfasser ist gross (Bootstrap mit mehreren async Schritten); unter
// Coverage und paralleler Last dauert das erste Rendern deutlich laenger.
jest.setTimeout(30_000);
configure({ asyncUtilTimeout: 10_000 });

const mockInvoke = jest.fn();
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
}));

jest.mock('@tanstack/react-router', () => ({ useNavigate: () => jest.fn() }));

const mockAuth = { user: { id: 'user-1', role: 'user', username: 'anna@firma.de', displayName: 'Anna', publicName: null } };
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


let heldDraft = true;
let policy = 'all';

function heldDraftMessage() {
  return {
    id: 77,
    account_id: 1,
    folder_id: 1,
    uid: -77,
    subject: 'Re: Frage',
    snippet: null,
    date_received: null,
    from_json: null,
    to_json: JSON.stringify({ value: [{ address: 'kunde@example.com' }] }),
    body_text: 'Antwort',
    body_html: '<p>Antwort</p>',
    seen_local: 0,
    folder_kind: 'draft',
    outbound_hold: heldDraft ? 1 : 0,
    outbound_block_reason: heldDraft ? 'Preisangabe fehlt' : null,
  };
}

function invoke(channel: string): Promise<unknown> {
  switch (channel) {
    case 'email:get-message':
      return Promise.resolve(heldDraftMessage());
    case 'email:update-compose-draft':
      return Promise.resolve({ success: true });
    case 'workflow:get-automation-settings':
      return Promise.resolve({ outboundReviewSkipPolicy: policy });
    case 'email:send-draft-skip-outbound-review':
      return Promise.resolve({ success: true });
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
    default:
      return Promise.resolve({ success: true });
  }
}

function Harness({ onSent }: { onSent: jest.Mock }) {
  const [composeIntent, setComposeIntent] = useState<ComposeIntent>({ mode: 'draft', messageId: 77 });
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

async function renderDraft() {
  const onSent = jest.fn();
  render(<Harness onSent={onSent} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Senden' })).toBeEnabled());
  return onSent;
}

describe('ComposeDialog: Ohne Ausgangsprüfung senden', () => {
  beforeEach(() => {
    heldDraft = true;
    policy = 'all';
    mockInvoke.mockReset();
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
    mockInvoke.mockImplementation(invoke);
  });

  test('angehaltener Entwurf: speichert erst, sendet dann ohne Ausgangsprüfung', async () => {
    const onSent = await renderDraft();

    fireEvent.click(await screen.findByRole('button', { name: 'Ohne Ausgangsprüfung senden' }));
    expect(screen.getByText(
      'Die Ausgangs-Workflows werden für diese E-Mail übersprungen. Der Versand wird protokolliert.',
    )).toBeInTheDocument();
    mockInvoke.mockClear();
    const confirm = screen.getAllByRole('button', { name: 'Senden' }).find((button) => button.closest('[role="alertdialog"]'));
    fireEvent.click(confirm!);

    await waitFor(() => expect(onSent).toHaveBeenCalled());
    const channels = mockInvoke.mock.calls.map(([name]) => name);
    const saveIndex = channels.indexOf('email:update-compose-draft');
    const skipIndex = channels.indexOf('email:send-draft-skip-outbound-review');
    expect(saveIndex).toBeGreaterThanOrEqual(0);
    expect(skipIndex).toBeGreaterThan(saveIndex);
    expect(mockInvoke).toHaveBeenCalledWith('email:send-draft-skip-outbound-review', { draftId: 77 });
    expect(channels).not.toContain('email:send-compose');
  });

  test('ohne Sperre oder bei Einstellung „niemand“ kein Knopf', async () => {
    heldDraft = false;
    await renderDraft();
    expect(screen.queryByRole('button', { name: 'Ohne Ausgangsprüfung senden' })).not.toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalledWith('workflow:get-automation-settings');
  });

  test('Einstellung „niemand“ blendet den Knopf aus', async () => {
    policy = 'none';
    await renderDraft();
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('workflow:get-automation-settings'));
    expect(screen.queryByRole('button', { name: 'Ohne Ausgangsprüfung senden' })).not.toBeInTheDocument();
  });
});
