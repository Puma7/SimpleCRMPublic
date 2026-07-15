import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { MessageEvidencePanel } from '@/components/email/message-evidence-panel';
import { invokeRenderer } from '@/services/transport';

let mockUser: { id: string; role: string } | null = { id: 'admin-1', role: 'admin' };

jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => ({
    user: mockUser,
    loading: false,
  }),
}));

jest.mock('@/lib/runtime-mode', () => ({
  isServerClientMode: () => true,
}));

jest.mock('@/services/transport', () => ({
  invokeRenderer: jest.fn(),
  isMailTrackingRefreshEvent: jest.fn(() => false),
  subscribeServerEvents: jest.fn(() => ({ unsubscribe: jest.fn() })),
}));

describe('message evidence panel', () => {
  beforeEach(() => {
    mockUser = { id: 'admin-1', role: 'admin' };
    jest.mocked(invokeRenderer).mockReset();
  });

  test('renders Google proxy fetches as automated without recipient device claims', async () => {
    const invoke = jest.mocked(invokeRenderer);
    invoke.mockResolvedValueOnce({
      messageId: 41,
      tracked: true,
      warning: null,
      summary: {
        transport: 'smtp_accepted',
        delivery: 'unknown',
        engagement: 'automated_fetch',
        confidence: 'low',
        pixelFetchCount: 2,
        automatedPixelFetchCount: 2,
        unknownPixelFetchCount: 0,
        probableHumanPixelFetchCount: 0,
        probableHumanOpenSessionCount: 0,
        openCount: 2,
        clickCount: 0,
        firstPixelFetchedAt: '2026-07-15T10:00:00.000Z',
        lastPixelFetchedAt: '2026-07-15T10:01:00.000Z',
        firstProbableHumanOpenAt: null,
        lastProbableHumanOpenAt: null,
        firstOpenedAt: null,
        lastOpenedAt: null,
        firstClickedAt: null,
        lastClickedAt: null,
        repliedAt: null,
      },
      events: [
        {
          id: '9007199254740993',
          type: 'open_automated',
          source: 'tracking_pixel',
          confidence: 'low',
          automated: true,
          occurredAt: '2026-07-15T10:00:00.000Z',
          metadata: { client: 'Chrome', operatingSystem: 'Windows' },
          classification: {
            version: 2,
            actorClass: 'mail_proxy',
            confidence: 'low',
            reasons: ['known_security_or_mail_proxy'],
          },
        },
        {
          id: 2,
          type: 'open_automated',
          source: 'tracking_pixel',
          confidence: 'low',
          automated: true,
          occurredAt: '2026-07-15T10:01:00.000Z',
          metadata: { client: 'Chrome', operatingSystem: 'Windows' },
          classification: {
            version: 2,
            actorClass: 'mail_proxy',
            confidence: 'low',
            reasons: ['known_security_or_mail_proxy'],
          },
        },
        {
          id: 3,
          type: 'smtp_accepted',
          source: 'smtp',
          confidence: 'high',
          automated: true,
          occurredAt: '2026-07-15T09:59:00.000Z',
          metadata: {},
          classification: {
            version: 2,
            actorClass: 'system',
            confidence: 'high',
            reasons: [],
          },
        },
      ],
      eventsTruncated: false,
    });

    render(<MessageEvidencePanel messageId={41} folderKind="sent" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Verlauf' }));

    expect(await screen.findByText('Pixelabrufe')).toBeInTheDocument();
    expect(within(screen.getByText('Pixelabrufe').parentElement!).getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Automatisierte Abrufe')).toBeInTheDocument();
    expect(screen.getByText('Ursache unklar')).toBeInTheDocument();
    expect(screen.getByText('Wahrscheinlich menschlich')).toBeInTheDocument();
    expect(screen.getByText('Öffnungssitzungen')).toBeInTheDocument();
    expect(screen.queryByText('Wahrscheinlich geöffnet')).not.toBeInTheDocument();
    expect(screen.getAllByText('Abrufende Infrastruktur')).toHaveLength(2);
    expect(screen.queryByText('Chrome')).not.toBeInTheDocument();
    expect(screen.queryByText('Windows')).not.toBeInTheDocument();
    expect(screen.queryByText(/automatischer Abruf wahrscheinlich/i)).not.toBeInTheDocument();
  });

  test('ignores a stale timeline response after selecting another message', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const invoke = jest.mocked(invokeRenderer);
    invoke.mockImplementation((_channel, payload) => (
      (payload as { messageId: number }).messageId === 1 ? first.promise : second.promise
    ));

    const view = render(<MessageEvidencePanel messageId={1} folderKind="sent" />);
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));

    view.rerender(<MessageEvidencePanel messageId={2} folderKind="sent" />);
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));

    await act(async () => {
      second.resolve(timeline(2, 'failed'));
      await second.promise;
    });
    expect(await screen.findByText('Fehlgeschlagen')).toBeInTheDocument();

    await act(async () => {
      first.resolve(timeline(1, 'smtp_accepted'));
      await first.promise;
    });
    expect(screen.getByText('Fehlgeschlagen')).toBeInTheDocument();
    expect(screen.queryByText('Vom Mailserver angenommen')).not.toBeInTheDocument();
  });

  test('lets an admin reclassify once and reloads the timeline', async () => {
    const invoke = jest.mocked(invokeRenderer);
    const initial = v2Timeline(41);
    invoke
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce({ classified: 2, unavailableRaw: 0 })
      .mockResolvedValueOnce(initial);

    render(<MessageEvidencePanel messageId={41} folderKind="sent" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Verlauf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Neu bewerten' }));
    fireEvent.click(screen.getByRole('button', { name: 'Neu bewerten' }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      'email:reclassify-message-tracking',
      41,
    ));
    expect(invoke.mock.calls.filter(([channel]) => channel === 'email:reclassify-message-tracking')).toHaveLength(1);
    await waitFor(() => expect(invoke).toHaveBeenLastCalledWith(
      'email:get-message-tracking',
      { messageId: 41 },
    ));
  });

  test('shows the IP insight button only to admins after sensitive raw data was requested', async () => {
    const sensitiveTimeline = {
      ...v2Timeline(41),
      events: [{
        id: 2,
        type: 'open_automated',
        source: 'tracking_pixel',
        confidence: 'low',
        automated: true,
        occurredAt: '2026-07-15T10:00:00.000Z',
        metadata: { raw: { ip: '8.8.8.8' } },
        classification: { version: 2, actorClass: 'mail_proxy', confidence: 'low', reasons: [] },
      }],
    };
    const invoke = jest.mocked(invokeRenderer);
    invoke.mockResolvedValueOnce(sensitiveTimeline).mockResolvedValueOnce(sensitiveTimeline);

    render(<MessageEvidencePanel messageId={41} folderKind="sent" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Verlauf' }));
    expect(screen.queryByRole('button', { name: 'IP-Insight öffnen' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch'));
    expect(await screen.findByRole('button', { name: 'IP-Insight öffnen' })).toBeInTheDocument();
  });

  test('does not offer the IP insight button to non-admin users', async () => {
    mockUser = { id: 'user-1', role: 'user' };
    jest.mocked(invokeRenderer).mockResolvedValueOnce(v2Timeline(41));

    render(<MessageEvidencePanel messageId={41} folderKind="sent" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Verlauf' }));
    expect(screen.queryByRole('button', { name: 'IP-Insight öffnen' })).not.toBeInTheDocument();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function timeline(messageId: number, transport: 'failed' | 'smtp_accepted') {
  return {
    messageId,
    tracked: true,
    warning: null,
    summary: {
      transport,
      delivery: 'unknown',
      engagement: 'none',
      confidence: 'low',
      openCount: 0,
      clickCount: 0,
      firstOpenedAt: null,
      lastOpenedAt: null,
      firstClickedAt: null,
      lastClickedAt: null,
      repliedAt: null,
    },
    events: [],
    eventsTruncated: false,
  };
}

function v2Timeline(messageId: number) {
  return {
    ...timeline(messageId, 'smtp_accepted'),
    summary: {
      ...timeline(messageId, 'smtp_accepted').summary,
      pixelFetchCount: 0,
      automatedPixelFetchCount: 0,
      unknownPixelFetchCount: 0,
      probableHumanPixelFetchCount: 0,
      probableHumanOpenSessionCount: 0,
      firstPixelFetchedAt: null,
      lastPixelFetchedAt: null,
      firstProbableHumanOpenAt: null,
      lastProbableHumanOpenAt: null,
    },
  };
}
