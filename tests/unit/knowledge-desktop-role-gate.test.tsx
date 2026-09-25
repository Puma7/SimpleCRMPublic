import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

const mockInvoke = jest.fn();
jest.mock('@/services/transport', () => ({
  invokeRenderer: (...args: unknown[]) => mockInvoke(...args),
  // Desktop-Modus: Rechte kommen aus der lokalen Rolle, nicht aus Capabilities.
  getRendererTransport: () => ({ kind: 'ipc' }),
  isWorkflowKnowledgeRefreshEvent: () => false,
  subscribeServerEvents: () => ({ unsubscribe: jest.fn() }),
}));
jest.mock('@/components/email/types', () => ({
  ...jest.requireActual('@/components/email/types'),
  hasLocalIpc: () => true,
  invokeIpc: jest.fn(),
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
// Monaco ist im jsdom-Lauf nicht ladbar; der Stub zeigt, ob der Editor schreibgeschuetzt ist.
jest.mock('@/components/email/settings/knowledge-markdown-editor', () => ({
  KnowledgeMarkdownEditor: ({ value, readOnly }: { value: string; readOnly?: boolean }) => (
    <textarea aria-label="Markdown editor" value={value} readOnly={readOnly === true} onChange={() => undefined} />
  ),
}));

let mockRole = 'agent';
jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', role: mockRole } }),
}));

import { KnowledgePanel } from '@/components/email/settings/knowledge-panel';
import { AccountKnowledgeSlots } from '@/components/email/settings/account-knowledge-slots';
import { IPCChannels } from '@shared/ipc/channels';

const globalKb = { id: 9, name: 'Retouren', description: null, account_id: null, knowledge_context: 'inbound' };
const accountKb = { id: 11, name: 'Shop A Eingang', description: null, account_id: 3, knowledge_context: 'inbound' };

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async (channel: string, payload?: unknown) => {
    if (channel === IPCChannels.Email.ListKnowledgeBases) {
      const scope = (payload as { accountId?: unknown } | undefined)?.accountId;
      return scope === 3 ? [accountKb, globalKb] : [globalKb];
    }
    if (channel === IPCChannels.Email.GetKnowledgeBaseDocument) {
      return { success: true, content: '# Retouren', fileName: 'retouren.md' };
    }
    if (channel === IPCChannels.Email.ListAccounts) return [];
    return { success: true };
  });
});

// G1 (Paritaet workflows.manage): Auf dem Desktop durfte jede Rolle
// Wissensbasen anlegen, ueberschreiben und loeschen; die IPC verlangt jetzt
// Owner/Admin, die Oberflaeche darf keine Knoepfe anbieten, die sicher scheitern.
describe('Desktop-Wissensbasis-Tab nach Rolle (G1)', () => {
  test.each(['agent', 'viewer'])('%s sieht die Wissensbasen nur lesend', async (role) => {
    mockRole = role;
    render(<KnowledgePanel />);
    fireEvent.click(await screen.findByText('Retouren'));
    await screen.findByDisplayValue('# Retouren');

    expect(screen.getByText(/Nur lesbar: Wissensbasen/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Anlegen' })).not.toBeInTheDocument();
    expect(screen.queryByTitle('Löschen')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /\.md hochladen/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled();
    expect(screen.getByLabelText('Markdown editor')).toHaveAttribute('readonly');
    // Lesen und Export bleiben offen.
    expect(screen.getByRole('button', { name: /\.md speichern/ })).not.toBeDisabled();
  });

  test('admin darf Wissensbasen bearbeiten', async () => {
    mockRole = 'admin';
    render(<KnowledgePanel />);
    fireEvent.click(await screen.findByText('Retouren'));
    await screen.findByDisplayValue('# Retouren');

    expect(screen.queryByText(/Nur lesbar: Wissensbasen/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anlegen' })).toBeInTheDocument();
    expect(screen.getByTitle('Löschen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /\.md hochladen/ })).not.toBeDisabled();
    expect(screen.getByLabelText('Markdown editor')).not.toHaveAttribute('readonly');
  });
});

describe('Desktop-Wissensbasis-Slots im Konto nach Rolle (G1)', () => {
  test('agent sieht Zuordnung und Inhalt nur lesend', async () => {
    mockRole = 'agent';
    render(<AccountKnowledgeSlots accountId={3} />);

    expect(await screen.findByText(/Nur lesbar: Wissensbasen/)).toBeInTheDocument();
    expect(screen.getByText('Shop A Eingang')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Neu anlegen/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Entfernen/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Name speichern/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Inhalt ansehen' }));
    expect(await screen.findByLabelText('Markdown editor')).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: /Inhalt speichern/ })).not.toBeInTheDocument();
  });

  test('admin darf Slots anlegen, umbenennen und entfernen', async () => {
    mockRole = 'admin';
    render(<AccountKnowledgeSlots accountId={3} />);

    expect(await screen.findByRole('button', { name: /Entfernen/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Name speichern/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Neu anlegen/ }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Nur lesbar: Wissensbasen/)).not.toBeInTheDocument();
  });
});
