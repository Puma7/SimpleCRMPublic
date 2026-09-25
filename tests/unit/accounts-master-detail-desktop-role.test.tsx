import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * Desktop: keine Mail-ACL, Konto anlegen, bearbeiten, loeschen und die
 * Verbindungstests verlangen per IPC Owner/Admin (E16). Konten ansehen bleibt
 * fuer alle Rollen.
 */
const mockInvoke = jest.fn();
const auth = { role: 'agent' };

jest.mock('@/services/transport', () => ({
  invokeRenderer: (...args: unknown[]) => mockInvoke(...args),
  getRendererTransport: () => ({ kind: 'ipc' }),
  subscribeServerEvents: () => ({ unsubscribe: jest.fn() }),
}));

// Werte wie im echten AuthProvider ohne HTTP-Transport: die Mail-ACL erlaubt dort alles.
jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => ({
    user: { id: 'u1', role: auth.role },
    mailAccessUnrestricted: true,
    canManageSettings: true,
    hasMailPermissionForAccount: () => true,
  }),
}));

jest.mock('../../src/components/email/workspace-context', () => ({
  useMailWorkspace: () => ({
    bumpAccountsRevision: jest.fn(),
    setSettingsAccountId: jest.fn(),
    settingsAccountId: null,
    settingsAccountDeepLinkId: null,
    setSettingsAccountDeepLinkId: jest.fn(),
    settingsAccountsSubTab: null,
    setSettingsAccountsSubTab: jest.fn(),
    accountsRevision: 0,
  }),
}));

function stub(label: string) {
  return function Stub() {
    return <div>{label}</div>;
  };
}

jest.mock('@/components/email/settings/account-form', () => ({ AccountForm: stub('account-form') }));
jest.mock('@/components/email/settings/smtp-panel', () => ({ SmtpPanel: stub('smtp-panel') }));
jest.mock('@/components/email/settings/oauth-account-link-panel', () => ({ OAuthAccountLinkPanel: stub('oauth-panel') }));
jest.mock('@/components/email/settings/reply-suggestion-settings-section', () => ({
  ReplySuggestionSettingsSection: stub('reply-suggestion-section'),
}));
jest.mock('@/components/email/settings/account-signatures-section', () => ({ AccountSignaturesSection: stub('account-signatures') }));
jest.mock('@/components/email/settings/user-signatures-section', () => ({ UserSignaturesSection: stub('user-signatures') }));
jest.mock('@/components/email/settings/account-knowledge-slots', () => ({ AccountKnowledgeSlots: stub('knowledge-slots') }));
jest.mock('@/components/email/settings/account-advanced-panel', () => ({ AccountAdvancedPanel: stub('advanced-panel') }));
jest.mock('@/components/email/settings/accounts-shipping-hint', () => ({ AccountsShippingHint: stub('shipping-hint') }));

import { AccountsMasterDetailSettings } from '@/components/email/settings/accounts-master-detail';

describe('AccountsMasterDetailSettings im Desktop — Kontoverwaltung nach Rolle', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (channel: string) => {
      if (channel === 'email:list-accounts') {
        return [{ id: 7, email_address: 'support@example.test', display_name: 'Support' }];
      }
      return [];
    });
  });

  const renderSettings = async () => {
    render(<AccountsMasterDetailSettings />);
    await waitFor(() => expect(screen.getAllByText('support@example.test').length).toBeGreaterThan(0));
  };

  // C-A12: Agent und Viewer sahen Konto-Formular und Verbindungstests, obwohl Anlegen und Bearbeiten seit E16 Owner/Admin verlangen.
  test.each(['agent', 'viewer'])('%s sieht Konten, aber weder Anlegen, Bearbeiten, Loeschen noch Testen', async (role) => {
    auth.role = role;
    await renderSettings();

    expect(screen.queryByRole('button', { name: 'Konto' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Konto löschen/ })).toBeNull();
    expect(screen.queryByText('account-form')).toBeNull();
    expect(screen.getByText(/fehlt die Berechtigung zur Kontoverwaltung/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'SMTP' }));
    expect(screen.queryByText('smtp-panel')).toBeNull();
    expect(screen.getByText(/fehlt die Berechtigung zur Kontoverwaltung/)).toBeTruthy();
  });

  test.each(['owner', 'admin'])('%s verwaltet Konten wie bisher', async (role) => {
    auth.role = role;
    await renderSettings();

    expect(screen.getByRole('button', { name: 'Konto' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Konto löschen/ })).toBeTruthy();
    expect(screen.getByText('account-form')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'SMTP' }));
    expect(screen.getByText('smtp-panel')).toBeTruthy();
  });
});
