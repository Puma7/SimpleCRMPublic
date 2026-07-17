import { render, screen, waitFor } from '@testing-library/react';

import { IPCChannels } from '@shared/ipc/channels';
import type { DmarcStatsSnapshot } from '@shared/dmarc-stats';

const mockInvoke = jest.fn();
let mockTransportKind: 'http' | 'ipc' = 'http';

jest.mock('@/services/transport', () => ({
  invokeRenderer: (...args: unknown[]) => mockInvoke(...args),
  getRendererTransport: () => ({ kind: mockTransportKind, serverBaseUrl: 'https://crm.example.com' }),
}));

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

// Recharts' ResponsiveContainer needs real layout dimensions that jsdom lacks;
// stub it to a fixed-size div so the SVG marks mount without warnings.
jest.mock('recharts', () => {
  const actual = jest.requireActual('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 800, height: 300 }}>{children}</div>
    ),
  };
});

import EmailDmarcPage from '@/app/email/dmarc/page';

function snapshot(): DmarcStatsSnapshot {
  return {
    windowDays: 30,
    totals: {
      reports: 4,
      records: 12,
      messages: 340,
      passMessages: 300,
      failMessages: 40,
      rejectMessages: 30,
      quarantineMessages: 10,
      unauthorizedSources: 2,
      domains: 1,
    },
    timeSeries: [
      { date: '2026-07-01', pass: 100, fail: 10, reject: 8, quarantine: 2 },
      { date: '2026-07-02', pass: 200, fail: 30, reject: 22, quarantine: 8 },
    ],
    topSourceIps: [
      { sourceIp: '209.85.220.41', messages: 300, passMessages: 300, failMessages: 0 },
      { sourceIp: '45.83.12.9', messages: 40, passMessages: 0, failMessages: 40 },
    ],
    topFromDomains: [{ headerFrom: 'firma.de', messages: 340, failMessages: 40 }],
    dispositions: [
      { disposition: 'none', messages: 300 },
      { disposition: 'reject', messages: 30 },
      { disposition: 'quarantine', messages: 10 },
    ],
    unauthorizedSources: [
      {
        sourceIp: '45.83.12.9',
        headerFrom: 'firma.de',
        domain: 'firma.de',
        orgName: 'google.com',
        messages: 40,
        lastSeen: '2026-07-02T00:00:00Z',
      },
    ],
  };
}

describe('EmailDmarcPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTransportKind = 'http';
    mockInvoke.mockResolvedValue({ success: true, data: snapshot() });
  });

  test('renders KPI totals, the anomaly table, and requests the DMARC stats channel', async () => {
    render(<EmailDmarcPage />);

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(IPCChannels.Email.ListDmarcStats, { windowDays: 30 }),
    );

    // KPI values (reports, messages) and the anomaly source IP.
    await screen.findByText('340'); // Nachrichten
    expect(screen.getByText('11.8 %')).toBeInTheDocument(); // 40/340 fail rate
    expect(screen.getAllByText('45.83.12.9').length).toBeGreaterThan(0);
    expect(screen.getByText('Top-Quell-IPs')).toBeInTheDocument();
  });

  test('shows a server-only notice and skips the channel in desktop mode', async () => {
    mockTransportKind = 'ipc';
    render(<EmailDmarcPage />);
    expect(await screen.findByText('Nur Server-Edition')).toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  test('renders the empty state when there are no reports', async () => {
    mockInvoke.mockResolvedValue({
      success: true,
      data: { ...snapshot(), totals: { ...snapshot().totals, reports: 0 } },
    });
    render(<EmailDmarcPage />);
    expect(await screen.findByText(/Noch keine DMARC-Reports/)).toBeInTheDocument();
  });
});
