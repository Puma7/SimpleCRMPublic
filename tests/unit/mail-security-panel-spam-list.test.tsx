import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

const mockInvoke = jest.fn();
jest.mock('@/services/transport', () => ({
  invokeRenderer: (...args: unknown[]) => mockInvoke(...args),
  subscribeServerEvents: () => ({ unsubscribe: jest.fn() }),
  isMailSpamListRefreshEvent: () => false,
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() } }));
jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'user' }, canManageSettings: true }),
}));

import { MailSecurityPanel } from '@/components/email/settings/mail-security-panel';
import { IPCChannels } from '@shared/ipc/channels';

const settings = {
  mailauthEnabled: true,
  rspamdEnabled: false,
  rspamdUrl: 'http://rspamd.local',
  rspamdTimeoutMs: 2000,
  rspamdSpamScore: 6,
  autoSpamDmarcFail: false,
  autoSpamSpfFail: false,
  autoSpamRspamd: false,
  senderWhitelist: '',
  senderBlacklist: '',
  spamScoreThreshold: 5,
  spamEngineEnabled: true,
  spamReviewThreshold: 3,
  spamSpamThreshold: 8,
  localLearningEnabled: false,
  rspamdContributionEnabled: false,
  rspamdLearningEnabled: false,
  aiSpamWorkflowEnabled: false,
};

/**
 * Die Allow-/Blocklist haengt an der Mail-Policy (workspace-weites
 * mail.metadata.read), die Sicherheitseinstellungen daneben an
 * settings.view/manage. Ein delegierter Einstellungsnutzer ohne vollen
 * Mail-Scope bekommt fuer die Liste 403 — in einem gemeinsamen Promise.all
 * haette der auch die erfolgreich geladenen Einstellungen verworfen.
 */
describe('mail security panel spam list', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  test('keeps the security settings usable when the spam list is forbidden', async () => {
    mockInvoke.mockImplementation(async (channel: string) => {
      if (channel === IPCChannels.Email.GetMailSecuritySettings) return settings;
      if (channel === IPCChannels.Email.ListSpamListEntries) throw new Error('mail_access_denied');
      return undefined;
    });

    render(<MailSecurityPanel />);

    // Die Einstellungen sind da …
    expect(await screen.findByDisplayValue('http://rspamd.local')).toBeInTheDocument();
    // … und der Listenabschnitt sagt ehrlich, dass er nicht verfuegbar ist.
    expect(screen.getByText(/Nicht verfügbar/)).toBeInTheDocument();
    expect(screen.getByTitle('Eintrag hinzufuegen')).toBeDisabled();
  });

  test('shows the list when it loads', async () => {
    mockInvoke.mockImplementation(async (channel: string) => {
      if (channel === IPCChannels.Email.GetMailSecuritySettings) return settings;
      if (channel === IPCChannels.Email.ListSpamListEntries) {
        return [{ id: 1, list_type: 'block', pattern_type: 'domain', pattern: 'spam.test', account_id: null, note: null }];
      }
      return undefined;
    });

    render(<MailSecurityPanel />);

    expect(await screen.findByText('spam.test')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/Nicht verfügbar/)).not.toBeInTheDocument());
    expect(screen.getByTitle('Eintrag hinzufuegen')).not.toBeDisabled();
  });
});
