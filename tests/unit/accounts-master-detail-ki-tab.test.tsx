import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * Sichtbarkeit eines Kontos ist NICHT dasselbe wie Zugriff auf das Konto.
 *
 * Wer nur einen Ordner (oder eine Nachricht) darunter delegiert bekommt, sieht
 * das Elternkonto trotzdem in der Liste — der Lese-Port nimmt es redigiert auf.
 * GET /email/settings/reply-suggestion?accountId= prueft dagegen
 * mail.metadata.read auf der KONTO-Ressource, und ein Kindgrant autorisiert die
 * nicht. Der KI-Abschnitt war damit ein Bedienelement, das deterministisch im
 * Fehler endet — genau die Klasse, gegen die die Selbstauskunft antritt.
 */
const mockInvoke = jest.fn();
const permissions = { account: new Map<string, boolean>() };

jest.mock('@/services/transport', () => ({
  invokeRenderer: (...args: unknown[]) => mockInvoke(...args),
  getRendererTransport: () => ({ kind: 'http' }),
  subscribeServerEvents: () => ({ unsubscribe: jest.fn() }),
}));

jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => ({
    mailAccessUnrestricted: false,
    hasMailPermissionForAccount: (permission: string, accountId: number | string | null) =>
      permissions.account.get(`${permission}:${accountId}`) === true,
  }),
}));

const workspace = {
  bumpAccountsRevision: jest.fn(),
  setSettingsAccountId: jest.fn(),
  settingsAccountId: null as number | null,
  settingsAccountDeepLinkId: null as number | null,
  setSettingsAccountDeepLinkId: jest.fn(),
  settingsAccountsSubTab: null as string | null,
  setSettingsAccountsSubTab: jest.fn(),
  accountsRevision: 0,
};
jest.mock('../../src/components/email/workspace-context', () => ({
  useMailWorkspace: () => workspace,
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

describe('AccountsMasterDetailSettings — KI tab', () => {
  beforeEach(() => {
    permissions.account.clear();
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (channel: string) => {
      if (channel === 'email:list-accounts') {
        return [{ id: 7, email_address: 'support@example.test', display_name: 'Support' }];
      }
      return [];
    });
  });

  const openKiTab = async () => {
    render(<AccountsMasterDetailSettings />);
    await waitFor(() => expect(screen.getAllByText('support@example.test').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: 'KI' }));
  };

  test('a folder-only delegate does not get the account reply-suggestion section', async () => {
    // Kein Konto-Grant: der Server antwortet auf die Abfrage garantiert ablehnend.
    await openKiTab();

    expect(screen.queryByText('reply-suggestion-section')).toBeNull();
    expect(screen.getByText(/nicht\s+einsehbar/)).toBeTruthy();
    // Die Wissensablagen haengen an den Workflow-Capabilities, nicht an der
    // Mail-ACL — sie bleiben.
    expect(screen.getByText('knowledge-slots')).toBeTruthy();
  });

  test('an account-level delegate gets it', async () => {
    permissions.account.set('mail.metadata.read:7', true);
    await openKiTab();

    expect(screen.getByText('reply-suggestion-section')).toBeTruthy();
    expect(screen.queryByText(/nicht\s+einsehbar/)).toBeNull();
  });
});
