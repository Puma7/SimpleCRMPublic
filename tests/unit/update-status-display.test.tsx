import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { UpdateStatusDisplay } from '@/components/update-status-display';

function mockUpdates(status: unknown) {
  return {
    checkForUpdates: jest.fn(),
    getStatus: jest.fn(async () => status),
    installUpdate: jest.fn(),
    onStatusChange: jest.fn(() => () => undefined),
    onDownloadProgress: jest.fn(() => () => undefined),
  };
}

describe('UpdateStatusDisplay', () => {
  afterEach(() => {
    delete (window as any).electron;
    delete (window as any).electronAPI;
  });

  // F-A7-10: Auf macOS meldete das Banner "Download läuft", obwohl der Updater dort nichts mehr lädt; der Nutzer braucht den Weg zur Release-Seite.
  test('macOS shows the manual update hint and opens the release page', async () => {
    const invoke = jest.fn(async () => ({ success: true }));
    (window as any).electronAPI = { invoke };
    (window as any).electron = {
      updates: mockUpdates({
        status: 'available',
        manualUpdate: { releasePageUrl: 'https://github.com/Puma7/SimpleCRMPublic/releases' },
      }),
    };

    render(<UpdateStatusDisplay />);

    expect(await screen.findByText(/bitte manuell von der Release-Seite installieren/)).toBeTruthy();
    expect(screen.queryByText(/Download läuft/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Release-Seite öffnen' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app:open-external-url', {
      url: 'https://github.com/Puma7/SimpleCRMPublic/releases',
    }));
  });

  test('Windows keeps the automatic download label without a release link', async () => {
    (window as any).electron = { updates: mockUpdates({ status: 'available' }) };

    render(<UpdateStatusDisplay />);

    expect(await screen.findByText('Update verfügbar – Download läuft…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Release-Seite öffnen' })).toBeNull();
  });
});
