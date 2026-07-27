import { render, screen } from '@testing-library/react';

import { SnoozeSettingsSection } from '@/components/email/settings/snooze-settings-section';
import { ReplySuggestionSettingsSection } from '@/components/email/settings/reply-suggestion-settings-section';
import { invokeRenderer } from '@/services/transport';
import { DEFAULT_SNOOZE_SETTINGS } from '@shared/snooze-settings';

let canManageSettings = true;

jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => ({ canManageSettings, user: { id: 'u1', role: 'user' }, loading: false }),
}));
jest.mock('@/services/transport', () => ({ invokeRenderer: jest.fn() }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

const replySettings = {
  autoEnabled: true,
  triggerOnInbound: true,
  triggerOnOpen: false,
  categoryMode: 'any' as const,
  categoryIds: [] as number[],
};

/**
 * Die PATCH-Routen fuer Snooze und Antwortvorschlaege verlangen settings.manage.
 * Ein Nutzer mit nur settings.view darf die Werte sehen, aber keine
 * Bedienelemente bekommen, die garantiert im 403 enden.
 */
describe('settings panels honour settings.manage', () => {
  beforeEach(() => {
    canManageSettings = true;
    jest.mocked(invokeRenderer).mockReset();
  });

  test('snooze section hides the save action without settings.manage', async () => {
    canManageSettings = false;
    jest.mocked(invokeRenderer).mockResolvedValue(DEFAULT_SNOOZE_SETTINGS as never);
    render(<SnoozeSettingsSection />);

    expect(await screen.findByLabelText('Heute Abend')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Snooze-Zeiten speichern/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Nur lesbar/)).toBeInTheDocument();
  });

  test('snooze section stays editable with settings.manage', async () => {
    jest.mocked(invokeRenderer).mockResolvedValue(DEFAULT_SNOOZE_SETTINGS as never);
    render(<SnoozeSettingsSection />);

    expect(await screen.findByLabelText('Heute Abend')).toBeEnabled();
    expect(screen.getByRole('button', { name: /Snooze-Zeiten speichern/ })).toBeInTheDocument();
  });

  test('reply suggestion section hides the save action without settings.manage', async () => {
    canManageSettings = false;
    jest.mocked(invokeRenderer)
      .mockResolvedValueOnce(replySettings as never)
      .mockResolvedValueOnce([] as never);
    render(<ReplySuggestionSettingsSection />);

    expect(await screen.findByRole('switch', { name: 'Automatische Vorschläge' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /speichern/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Nur lesbar/)).toBeInTheDocument();
  });

  test('reply suggestion section stays editable with settings.manage', async () => {
    jest.mocked(invokeRenderer)
      .mockResolvedValueOnce(replySettings as never)
      .mockResolvedValueOnce([] as never);
    render(<ReplySuggestionSettingsSection />);

    expect(await screen.findByRole('switch', { name: 'Automatische Vorschläge' })).toBeEnabled();
    expect(screen.getByRole('button', { name: /speichern/i })).toBeInTheDocument();
  });
});
