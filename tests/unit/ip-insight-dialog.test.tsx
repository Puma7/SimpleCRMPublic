import { act, render, screen, waitFor } from '@testing-library/react';

import { IpInsightDialog } from '@/components/email/ip-insight-dialog';
import { RendererTransportError, invokeRenderer } from '@/services/transport';
import { IPCChannels } from '@shared/ipc/channels';

jest.mock('@/services/transport', () => ({
  RendererTransportError: class RendererTransportError extends Error {
    status?: number;
    constructor(message: string, options: { status?: number } = {}) {
      super(message);
      this.status = options.status;
    }
  },
  invokeRenderer: jest.fn(),
}));

describe('IP insight dialog', () => {
  beforeEach(() => jest.mocked(invokeRenderer).mockReset());

  test('loads a local insight with an ID-only request and renders no city or coordinates', async () => {
    jest.mocked(invokeRenderer).mockResolvedValueOnce({
      ipAddress: '8.8.8.8', ipFamily: 'ipv4', scope: 'public',
      countryCode: 'US', continentCode: 'NA', asn: 15169,
      networkName: 'Google LLC', networkCidr: '8.8.8.0/24',
      databaseBuildAt: '2026-07-15T00:00:00.000Z',
    });

    render(<IpInsightDialog open onOpenChange={jest.fn()} messageId={41} eventId="9007199254740993" />);

    expect(await screen.findByText('Vereinigte Staaten')).toBeInTheDocument();
    expect(screen.getByText('Google LLC')).toBeInTheDocument();
    expect(screen.getByText('Ungefährer Standort der abrufenden Infrastruktur; kein Nachweis des Empfängerstandorts')).toBeInTheDocument();
    expect(screen.queryByText(/Stadt|Koordinaten/i)).not.toBeInTheDocument();
    expect(invokeRenderer).toHaveBeenCalledWith(IPCChannels.Email.GetMessageTrackingIpInsight, {
      messageId: 41,
      eventId: '9007199254740993',
    });
  });

  test.each([
    [410, 'Rohdaten für diesen IP-Insight sind nicht mehr verfügbar.'],
    [503, 'Lokale IP-Insight-Datenbank ist nicht verfügbar.'],
    [500, 'IP-Insight konnte nicht geladen werden.'],
  ])('keeps %s failures honest', async (status, message) => {
    jest.mocked(invokeRenderer).mockRejectedValueOnce(new RendererTransportError('failed', { status }));

    render(<IpInsightDialog open onOpenChange={jest.fn()} messageId={41} eventId={2} />);

    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  test('does not update after its request is cancelled by unmount', async () => {
    const pending = deferred<unknown>();
    jest.mocked(invokeRenderer).mockReturnValueOnce(pending.promise);
    const view = render(<IpInsightDialog open onOpenChange={jest.fn()} messageId={41} eventId={2} />);

    view.unmount();
    await act(async () => {
      pending.resolve({ countryCode: 'US' });
      await pending.promise;
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
