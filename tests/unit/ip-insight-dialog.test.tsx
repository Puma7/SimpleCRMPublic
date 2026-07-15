import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';

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

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeInTheDocument();
  });

  test('deduplicates a StrictMode effect replay while the same insight is in flight', async () => {
    const pending = deferred<unknown>();
    jest.mocked(invokeRenderer).mockReturnValue(pending.promise);

    render(<StrictMode><IpInsightDialog open onOpenChange={jest.fn()} messageId={41} eventId={2} /></StrictMode>);

    await waitFor(() => expect(invokeRenderer).toHaveBeenCalledTimes(1));
  });

  test('retries a failed insight request exactly once more', async () => {
    jest.mocked(invokeRenderer)
      .mockRejectedValueOnce(new RendererTransportError('failed', { status: 503 }))
      .mockResolvedValueOnce({ countryCode: 'DE', networkName: 'Example' });

    render(<IpInsightDialog open onOpenChange={jest.fn()} messageId={41} eventId={2} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Erneut versuchen' }));

    expect(await screen.findByText('Deutschland')).toBeInTheDocument();
    expect(invokeRenderer).toHaveBeenCalledTimes(2);
  });

  test('ignores an older message response after the dialog switches messages', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    jest.mocked(invokeRenderer)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const view = render(<IpInsightDialog open onOpenChange={jest.fn()} messageId={41} eventId={2} />);
    view.rerender(<IpInsightDialog open onOpenChange={jest.fn()} messageId={42} eventId={3} />);

    await act(async () => {
      second.resolve({ countryCode: 'DE', networkName: 'Aktuell' });
      await second.promise;
    });
    expect(await screen.findByText('Deutschland')).toBeInTheDocument();

    await act(async () => {
      first.resolve({ countryCode: 'US', networkName: 'Veraltet' });
      await first.promise;
    });
    expect(screen.queryByText('Vereinigte Staaten')).not.toBeInTheDocument();
    expect(screen.queryByText('Veraltet')).not.toBeInTheDocument();
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
