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
          type: 'open_probable',
          source: 'tracking_pixel',
          confidence: 'low',
          automated: true,
          occurredAt: '2026-07-15T10:00:00.000Z',
          metadata: { client: 'Chrome', operatingSystem: 'Windows' },
          classification: {
            version: 2,
            actorClass: 'mail_proxy',
            confidence: 'low',
            reasons: ['known_proxy_user_agent'],
          },
        },
        {
          id: 2,
          type: 'open_probable',
          source: 'tracking_pixel',
          confidence: 'low',
          automated: true,
          occurredAt: '2026-07-15T10:01:00.000Z',
          metadata: { client: 'Chrome', operatingSystem: 'Windows' },
          classification: {
            version: 2,
            actorClass: 'mail_proxy',
            confidence: 'low',
            reasons: ['known_proxy_user_agent'],
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
    expect(within(screen.getByText('Automatisierte Abrufe').parentElement!).getByText('2')).toBeInTheDocument();
    expect(within(screen.getByText('Ursache unklar').parentElement!).getByText('0')).toBeInTheDocument();
    expect(within(screen.getByText('Wahrscheinlich menschlich').parentElement!).getByText('0')).toBeInTheDocument();
    expect(within(screen.getByText('Öffnungssitzungen').parentElement!).getByText('0')).toBeInTheDocument();
    expect(screen.queryByText('Wahrscheinlich geöffnet')).not.toBeInTheDocument();
    expect(screen.queryByText('Menschlicher Abruf wahrscheinlich')).not.toBeInTheDocument();
    expect(screen.getAllByText('Abrufende Infrastruktur')).toHaveLength(2);
    expect(screen.getAllByText('Bekannter Mail-Proxy-User-Agent')).toHaveLength(2);
    expect(screen.queryByText('Chrome')).not.toBeInTheDocument();
    expect(screen.queryByText('Windows')).not.toBeInTheDocument();
    expect(screen.queryByText(/automatischer Abruf wahrscheinlich/i)).not.toBeInTheDocument();
  });

  test('keeps a reply stronger than an automated pixel fetch', async () => {
    const replyTimeline = {
      ...v2Timeline(41),
      summary: {
        ...v2Timeline(41).summary,
        engagement: 'human_reply',
        pixelFetchCount: 1,
        automatedPixelFetchCount: 1,
        repliedAt: '2026-07-15T10:05:00.000Z',
      },
      events: [{
        id: 1,
        type: 'open_automated',
        source: 'tracking_pixel',
        confidence: 'low',
        automated: true,
        occurredAt: '2026-07-15T10:00:00.000Z',
        metadata: {},
        classification: { version: 2, actorClass: 'mail_proxy', confidence: 'low', reasons: [] },
      }],
    };
    jest.mocked(invokeRenderer).mockResolvedValueOnce(replyTimeline);

    render(<MessageEvidencePanel messageId={41} folderKind="sent" />);

    expect(await screen.findByText('Antwort erhalten')).toBeInTheDocument();
    expect(screen.queryByText('Automatischer Abruf')).not.toBeInTheDocument();
  });

  test('keeps a classified human click as a link interaction', async () => {
    const clickTimeline = {
      ...v2Timeline(41),
      summary: { ...v2Timeline(41).summary, engagement: 'link_interaction', clickCount: 1 },
      events: [{
        id: 1,
        type: 'click',
        source: 'tracking_link',
        confidence: 'medium',
        automated: false,
        occurredAt: '2026-07-15T10:00:00.000Z',
        metadata: {},
        classification: { version: 2, actorClass: 'probable_human', confidence: 'medium', reasons: [] },
      }],
    };
    jest.mocked(invokeRenderer).mockResolvedValueOnce(clickTimeline);

    render(<MessageEvidencePanel messageId={41} folderKind="sent" />);

    expect(await screen.findByText('Link angeklickt')).toBeInTheDocument();
    expect(screen.queryByText('Menschlicher Abruf wahrscheinlich')).not.toBeInTheDocument();
  });

  test('does not present a scanner click as a human link interaction', async () => {
    jest.mocked(invokeRenderer).mockResolvedValueOnce({
      ...v2Timeline(41),
      summary: { ...v2Timeline(41).summary, engagement: 'link_interaction', clickCount: 1 },
      events: [{
        id: 1,
        type: 'click',
        source: 'tracking_link',
        confidence: 'high',
        automated: false,
        occurredAt: '2026-07-15T10:00:00.000Z',
        metadata: {},
        classification: { version: 2, actorClass: 'security_scanner', confidence: 'high', reasons: [] },
      }],
    });

    render(<MessageEvidencePanel messageId={41} folderKind="sent" />);

    expect(await screen.findByText('Automatischer Abruf')).toBeInTheDocument();
    expect(screen.queryByText('Link angeklickt')).not.toBeInTheDocument();
  });

  test('labels an unclassified click conservatively', async () => {
    jest.mocked(invokeRenderer).mockResolvedValueOnce({
      ...v2Timeline(41),
      summary: { ...v2Timeline(41).summary, engagement: 'link_interaction', clickCount: 1 },
      events: [{
        id: 1,
        type: 'click',
        source: 'tracking_link',
        confidence: 'medium',
        automated: false,
        occurredAt: '2026-07-15T10:00:00.000Z',
        metadata: {},
        classification: { version: 2, actorClass: 'unknown', confidence: 'medium', reasons: [] },
      }],
    });

    render(<MessageEvidencePanel messageId={41} folderKind="sent" />);

    expect(await screen.findByText('Interaktion, Ursache unklar')).toBeInTheDocument();
    expect(screen.queryByText('Link angeklickt')).not.toBeInTheDocument();
  });

  test('keeps an MDN-backed probable-open summary', async () => {
    const mdnTimeline = {
      ...v2Timeline(41),
      summary: { ...v2Timeline(41).summary, engagement: 'probable_open' },
      events: [{
        id: 1,
        type: 'mdn_displayed',
        source: 'mdn',
        confidence: 'verified',
        automated: false,
        occurredAt: '2026-07-15T10:00:00.000Z',
        metadata: {},
        classification: { version: 2, actorClass: 'system', confidence: 'verified', reasons: [] },
      }],
    };
    jest.mocked(invokeRenderer).mockResolvedValueOnce(mdnTimeline);

    render(<MessageEvidencePanel messageId={41} folderKind="sent" />);

    expect(await screen.findByText('Menschlicher Abruf wahrscheinlich')).toBeInTheDocument();
  });

  test('keeps a truncated MDN summary stronger than a later automated pixel fetch', async () => {
    const truncatedMdnTimeline = {
      ...v2Timeline(41),
      summary: {
        ...v2Timeline(41).summary,
        engagement: 'probable_open',
        mdnDisplayedCount: 1,
        pixelFetchCount: 1,
        automatedPixelFetchCount: 1,
      },
      events: [{
        id: 1_001,
        type: 'open_automated',
        source: 'tracking_pixel',
        confidence: 'low',
        automated: true,
        occurredAt: '2026-07-15T11:00:00.000Z',
        metadata: {},
        classification: { version: 2, actorClass: 'mail_proxy', confidence: 'low', reasons: [] },
      }],
      eventsTruncated: true,
    };
    jest.mocked(invokeRenderer).mockResolvedValueOnce(truncatedMdnTimeline);

    render(<MessageEvidencePanel messageId={41} folderKind="sent" />);

    expect(await screen.findByText('Menschlicher Abruf wahrscheinlich')).toBeInTheDocument();
    expect(screen.queryByText('Automatischer Abruf')).not.toBeInTheDocument();
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

  test('finishes a pending reclassification after parent close without allowing a duplicate', async () => {
    const reclassification = deferred<unknown>();
    let timelineLoads = 0;
    const invoke = jest.mocked(invokeRenderer);
    invoke.mockImplementation((channel) => {
      if (channel === 'email:reclassify-message-tracking') return reclassification.promise;
      timelineLoads += 1;
      return Promise.resolve(timelineLoads === 1 ? v2Timeline(41) : timeline(41, 'failed'));
    });

    render(<MessageEvidencePanel messageId={41} folderKind="sent" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Verlauf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Neu bewerten' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Verlauf' }));

    const reopenedAction = screen.getByRole('button', { name: 'Neu bewerten' });
    expect(reopenedAction).toBeDisabled();
    fireEvent.click(reopenedAction);
    expect(invoke.mock.calls.filter(([channel]) => channel === 'email:reclassify-message-tracking')).toHaveLength(1);

    await act(async () => {
      reclassification.resolve({ classified: 1, unavailableRaw: 0 });
      await reclassification.promise;
    });

    expect(await screen.findAllByText('Fehlgeschlagen')).toHaveLength(2);
    expect(invoke.mock.calls.filter(([channel]) => channel === 'email:reclassify-message-tracking')).toHaveLength(1);
  });

  test('keeps a pending action locked and non-sensitive when raw data is disabled', async () => {
    const reclassification = deferred<unknown>();
    const invoke = jest.mocked(invokeRenderer);
    invoke.mockImplementation((channel) => {
      if (channel === 'email:reclassify-message-tracking') return reclassification.promise;
      return Promise.resolve(v2Timeline(41));
    });

    render(<MessageEvidencePanel messageId={41} folderKind="sent" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Verlauf' }));
    const sensitiveSwitch = screen.getByRole('switch', { name: 'Sensible Rohdaten' });
    fireEvent.click(sensitiveSwitch);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      'email:get-message-tracking',
      { messageId: 41, includeSensitive: true },
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Neu bewerten' }));
    fireEvent.click(sensitiveSwitch);

    const action = screen.getByRole('button', { name: 'Neu bewerten' });
    expect(action).toBeDisabled();
    fireEvent.click(action);
    expect(invoke.mock.calls.filter(([channel]) => channel === 'email:reclassify-message-tracking')).toHaveLength(1);

    await act(async () => {
      reclassification.resolve({ classified: 1, unavailableRaw: 0 });
      await reclassification.promise;
    });

    await waitFor(() => expect(invoke.mock.calls.at(-1)).toEqual([
      'email:get-message-tracking',
      { messageId: 41 },
    ]));
  });

  test('does not reload message A after reclassification completes for message B', async () => {
    const reclassification = deferred<unknown>();
    const invoke = jest.mocked(invokeRenderer);
    invoke.mockImplementation((channel, payload) => {
      if (channel === 'email:reclassify-message-tracking') {
        return reclassification.promise;
      }
      return Promise.resolve(v2Timeline((payload as { messageId: number }).messageId));
    });

    const view = render(<MessageEvidencePanel messageId={1} folderKind="sent" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Verlauf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Neu bewerten' }));
    view.rerender(<MessageEvidencePanel messageId={2} folderKind="sent" />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('email:get-message-tracking', { messageId: 2 }));

    await act(async () => {
      reclassification.resolve({ classified: 1, unavailableRaw: 0 });
      await reclassification.promise;
    });

    expect(invoke.mock.calls.filter(([channel, payload]) => (
      channel === 'email:get-message-tracking' && (payload as { messageId: number }).messageId === 1
    ))).toHaveLength(1);
  });

  test('uses classification actors over legacy open and click event labels', async () => {
    const reclassifiedTimeline = {
      ...v2Timeline(41),
      summary: {
        ...v2Timeline(41).summary,
        engagement: 'probable_open',
        pixelFetchCount: 1,
        unknownPixelFetchCount: 1,
      },
      events: [
        {
          id: 1,
          type: 'open_probable',
          source: 'tracking_pixel',
          confidence: 'medium',
          automated: false,
          occurredAt: '2026-07-15T10:00:00.000Z',
          metadata: {},
          classification: {
            version: 2,
            actorClass: 'unknown',
            confidence: 'medium',
            reasons: ['raw_request_data_unavailable'],
          },
        },
        {
          id: 2,
          type: 'click',
          source: 'tracking_link',
          confidence: 'high',
          automated: false,
          occurredAt: '2026-07-15T10:01:00.000Z',
          metadata: {},
          classification: {
            version: 2,
            actorClass: 'security_scanner',
            confidence: 'high',
            reasons: ['known_scanner_user_agent'],
          },
        },
      ],
    };
    jest.mocked(invokeRenderer).mockResolvedValueOnce(reclassifiedTimeline);

    render(<MessageEvidencePanel messageId={41} folderKind="sent" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Verlauf' }));

    expect(await screen.findAllByText('Pixelabruf, Ursache unklar')).toHaveLength(4);
    expect(screen.getByText('Linkabruf durch Sicherheits-Scanner')).toBeInTheDocument();
    expect(screen.getByText('Rohdaten der Anfrage nicht verfügbar')).toBeInTheDocument();
    expect(screen.getByText('Bekannter Sicherheits-Scanner-User-Agent')).toBeInTheDocument();
    expect(screen.queryByText('Wahrscheinliches Öffnen')).not.toBeInTheDocument();
    expect(screen.queryByText('Link angeklickt')).not.toBeInTheDocument();
    expect(screen.queryByText('Menschlicher Abruf wahrscheinlich')).not.toBeInTheDocument();
  });

  test('treats a legacy probable-open event without V2 classification as unknown', async () => {
    const legacyTimeline = {
      summary: {
        ...timeline(41, 'smtp_accepted').summary,
        engagement: 'probable_open',
        openCount: 1,
      },
      messageId: 41,
      tracked: true,
      warning: null,
      events: [{
        id: 1,
        type: 'open_probable',
        source: 'tracking_pixel',
        confidence: 'medium',
        automated: false,
        occurredAt: '2026-07-15T10:00:00.000Z',
        metadata: {},
      }],
    };
    jest.mocked(invokeRenderer).mockResolvedValueOnce(legacyTimeline);

    render(<MessageEvidencePanel messageId={41} folderKind="sent" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Verlauf' }));

    expect(await screen.findAllByText('Pixelabruf, Ursache unklar')).toHaveLength(4);
    expect(within(screen.getByText('Ursache unklar').parentElement!).getByText('1')).toBeInTheDocument();
    expect(screen.queryByText('Wahrscheinliches Öffnen')).not.toBeInTheDocument();
    expect(screen.queryByText('Menschlicher Abruf wahrscheinlich')).not.toBeInTheDocument();
  });

  test('reloads deleted tracking data before closing the timeline', async () => {
    const invoke = jest.mocked(invokeRenderer);
    invoke
      .mockResolvedValueOnce(v2Timeline(41))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ ...v2Timeline(41), tracked: false });

    render(<MessageEvidencePanel messageId={41} folderKind="sent" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Verlauf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tracking-Daten löschen' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Endgültig löschen' }));

    await waitFor(() => expect(invoke).toHaveBeenLastCalledWith('email:get-message-tracking', { messageId: 41 }));
    fireEvent.click(screen.getByRole('button', { name: 'Verlauf' }));
    expect(await screen.findByText('Für diese Nachricht ist keine Evidenz vorhanden.')).toBeInTheDocument();
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
    invoke
      .mockResolvedValueOnce(sensitiveTimeline)
      .mockResolvedValueOnce(sensitiveTimeline)
      .mockResolvedValueOnce({
        ipAddress: '8.8.8.8', ipFamily: 'ipv4', scope: 'public', countryCode: 'US',
        continentCode: 'NA', asn: 15169, networkName: 'Google LLC', networkCidr: '8.8.8.0/24',
        databaseBuildAt: '2026-07-15T00:00:00.000Z',
      });

    render(<MessageEvidencePanel messageId={41} folderKind="sent" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Verlauf' }));
    expect(screen.queryByRole('button', { name: /IP-Insight für/i })).not.toBeInTheDocument();
    const sensitiveSwitch = screen.getByRole('switch', { name: 'Sensible Rohdaten' });
    fireEvent.click(sensitiveSwitch);
    const ipButton = await screen.findByRole('button', { name: 'IP-Insight für 8.8.8.8' });
    expect(ipButton).toHaveTextContent('8.8.8.8');
    fireEvent.click(ipButton);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('email:get-message-tracking-ip-insight', {
      messageId: 41,
      eventId: 2,
    }));
  });

  test('clears message-specific confirmation and closes the IP dialog when the parent closes', async () => {
    const sensitiveTimeline = {
      ...v2Timeline(41),
      events: [{
        id: 2, type: 'open_automated', source: 'tracking_pixel', confidence: 'low', automated: true,
        occurredAt: '2026-07-15T10:00:00.000Z', metadata: { raw: { ip: '8.8.8.8' } },
        classification: { version: 2, actorClass: 'mail_proxy', confidence: 'low', reasons: [] },
      }],
    };
    const invoke = jest.mocked(invokeRenderer);
    invoke.mockResolvedValueOnce(sensitiveTimeline).mockResolvedValueOnce(sensitiveTimeline).mockResolvedValueOnce({
      ipAddress: '8.8.8.8', ipFamily: 'ipv4', scope: 'public', countryCode: 'US', continentCode: 'NA',
      asn: 15169, networkName: 'Google LLC', networkCidr: '8.8.8.0/24', databaseBuildAt: null,
    });
    render(<MessageEvidencePanel messageId={41} folderKind="sent" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Verlauf' }));
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(await screen.findByRole('button', { name: 'IP-Insight für 8.8.8.8' }));
    expect(await screen.findByRole('dialog', { name: 'IP-Insight' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'IP-Insight' })).not.toBeInTheDocument());
  });

  test('does not offer the IP insight button to non-admin users', async () => {
    mockUser = { id: 'user-1', role: 'user' };
    jest.mocked(invokeRenderer).mockResolvedValueOnce({
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
    });

    render(<MessageEvidencePanel messageId={41} folderKind="sent" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Verlauf' }));
    expect(screen.queryByRole('button', { name: /IP-Insight für/i })).not.toBeInTheDocument();
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
