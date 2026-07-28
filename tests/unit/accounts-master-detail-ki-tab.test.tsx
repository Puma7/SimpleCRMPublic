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
const permissions = { account: new Map<string, boolean>(), settings: false };

jest.mock('@/services/transport', () => ({
  invokeRenderer: (...args: unknown[]) => mockInvoke(...args),
  getRendererTransport: () => ({ kind: 'http' }),
  subscribeServerEvents: () => ({ unsubscribe: jest.fn() }),
}));

jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => ({
    mailAccessUnrestricted: false,
    canManageSettings: permissions.settings,
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
jest.mock('@/components/email/settings/accounts-shipping-hint', () => ({ AccountsShippingHint: stub('shipping-hint') }));

import { AccountsMasterDetailSettings } from '@/components/email/settings/accounts-master-detail';

describe('AccountsMasterDetailSettings — per-account gates', () => {
  beforeEach(() => {
    permissions.account.clear();
    permissions.settings = false;
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (channel: string) => {
      if (channel === 'email:list-accounts') {
        return [{ id: 7, email_address: 'support@example.test', display_name: 'Support' }];
      }
      if (channel === 'email:get-account-mail-settings') {
        return { accountId: 7, ticketPrefix: '', ticketEnabled: false };
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

  const openSignatureTab = async () => {
    render(<AccountsMasterDetailSettings />);
    await waitFor(() => expect(screen.getAllByText('support@example.test').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: 'Signatur' }));
  };

  test('personal signatures need mail.draft.create, not mere visibility', async () => {
    // GET /email/user-signatures und der Upsert je Konto verlangen beide
    // mail.draft.create — wer das Postfach nur lesen darf, scheiterte hier
    // schon beim ersten Abruf.
    permissions.account.set('mail.metadata.read:7', true);
    await openSignatureTab();

    expect(screen.queryByText('user-signatures')).toBeNull();
    expect(screen.getByText(/Berechtigung zum Verfassen/)).toBeTruthy();
  });

  const openAdvancedTab = async () => {
    render(<AccountsMasterDetailSettings />);
    await waitFor(() => expect(screen.getAllByText('support@example.test').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: 'Erweitert' }));
  };

  test('the advanced panel stays read-only without mail.account.manage', async () => {
    // GET /email/settings/account-mail verlangt mail.metadata.read, PATCH aber
    // mail.account.manage auf DIESEM Konto. settings.manage allein reichte
    // nicht — die Felder waren bedienbar und der Save endete im 403.
    permissions.settings = true;
    permissions.account.set('mail.metadata.read:7', true);
    await openAdvancedTab();

    await waitFor(() => expect(screen.getByRole('button', { name: /Speichern/ })).toBeDisabled());
  });

  test('with mail.account.manage the advanced panel is editable', async () => {
    permissions.settings = true;
    permissions.account.set('mail.account.manage:7', true);
    await openAdvancedTab();

    await waitFor(() => expect(screen.getByRole('button', { name: /Speichern/ })).toBeEnabled());
  });

  test('a delegate who may compose gets the personal signature section', async () => {
    permissions.account.set('mail.draft.create:7', true);
    await openSignatureTab();

    expect(screen.getByText('user-signatures')).toBeTruthy();
    // Die GETEILTEN Kontosignaturen bleiben der Kontoverwaltung vorbehalten.
    expect(screen.queryByText('account-signatures')).toBeNull();
  });
});
