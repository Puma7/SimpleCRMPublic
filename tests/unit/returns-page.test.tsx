import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { IPCChannels } from '@shared/ipc/channels';

// Mock the transport BEFORE importing the page so the page picks up our fake.
const invokeMock = jest.fn();
jest.mock('@/services/transport', () => ({
  invokeRenderer: (...args: unknown[]) => invokeMock(...args),
}));

const mockUseAuth = jest.fn();
jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

// Toast — no-op in tests, but spy so we can assert on success/error toasts.
const toastSuccess = jest.fn();
const toastError = jest.fn();
const toastInfo = jest.fn();
jest.mock('sonner', () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
    info: (...a: unknown[]) => toastInfo(...a),
  },
}));

import ReturnsPage from '@/app/returns/page';

const EMPTY_LIST = { items: [], totalCount: 0 };
const REASONS = [
  { id: 1, code: 'size_wrong', label: 'Falsche Größe', isActive: true, sortOrder: 10 },
  { id: 2, code: 'defective', label: 'Defekt / Beschädigt', isActive: true, sortOrder: 30 },
];
const SAMPLE_RECORD = {
  id: 7,
  returnNumber: 'R-DEADBEEF',
  customerId: null,
  emailMessageId: null,
  jtlOrderNumber: 'EXT-42',
  jtlKauftrag: 99,
  status: 'pending',
  outcome: null,
  customerEmail: 'kunde@example.com',
  customerName: 'Max Mustermann',
  notes: null,
  createdAt: '2026-06-08T05:00:00.000Z',
  updatedAt: '2026-06-08T05:00:00.000Z',
  items: [
    { id: 1, returnId: 7, productId: null, reasonId: 1, sku: 'SKU-A', productName: 'Artikel A', quantity: 2, condition: 'opened', notes: null },
  ],
};

function setMockResponses(map: Record<string, unknown[]>) {
  invokeMock.mockImplementation(async (channel: string) => {
    const queue = map[channel];
    if (!queue || queue.length === 0) {
      throw new Error(`no canned response for channel ${channel}`);
    }
    return queue.shift();
  });
}

beforeEach(() => {
  mockUseAuth.mockReturnValue({
    user: { id: 'owner-1', role: 'owner' },
    loading: false,
  });
  invokeMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  toastInfo.mockReset();
});

describe('ReturnsPage', () => {
  test('hides portal settings from non-admin users', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'user-1', role: 'user' },
      loading: false,
    });
    setMockResponses({
      [IPCChannels.Returns.List]: [EMPTY_LIST],
      [IPCChannels.Returns.ListReasons]: [REASONS],
    });

    render(<ReturnsPage />);

    await screen.findByText(/Noch keine Retouren/);
    expect(screen.queryByRole('button', { name: /Portal/ })).toBeNull();
    expect(invokeMock).not.toHaveBeenCalledWith(IPCChannels.Returns.GetPortalSettings);
  });

  test('loads reasons + list on mount and shows the empty state', async () => {
    setMockResponses({
      [IPCChannels.Returns.List]: [EMPTY_LIST],
      [IPCChannels.Returns.ListReasons]: [REASONS],
    });
    render(<ReturnsPage />);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(IPCChannels.Returns.List, expect.objectContaining({ limit: 100 }));
      expect(invokeMock).toHaveBeenCalledWith(IPCChannels.Returns.ListReasons);
    });
    expect(await screen.findByText(/Noch keine Retouren/)).toBeTruthy();
  });

  test('renders the table when the list endpoint returns records', async () => {
    setMockResponses({
      [IPCChannels.Returns.List]: [{ items: [SAMPLE_RECORD], totalCount: 1 }],
      [IPCChannels.Returns.ListReasons]: [REASONS],
    });
    render(<ReturnsPage />);

    const row = await screen.findByTestId(`return-row-${SAMPLE_RECORD.id}`);
    expect(row).toBeTruthy();
    expect(row.textContent).toContain(SAMPLE_RECORD.returnNumber);
    expect(row.textContent).toContain('Max Mustermann');
    expect(row.textContent).toContain('Offen');
  });

  test('JTL lookup falls back to a manual-entry hint when JTL is not configured', async () => {
    setMockResponses({
      [IPCChannels.Returns.List]: [EMPTY_LIST],
      [IPCChannels.Returns.ListReasons]: [REASONS],
      [IPCChannels.Returns.LookupJtlOrder]: [{ configured: false, order: null }],
    });
    render(<ReturnsPage />);

    fireEvent.click(await screen.findByRole('button', { name: /Neue Retoure/ }));
    fireEvent.change(await screen.findByLabelText(/JTL-Bestellnummer/), { target: { value: 'EXT-9999' } });
    fireEvent.click(screen.getByRole('button', { name: /Aus JTL übernehmen/ }));

    const hint = await screen.findByTestId('lookup-hint');
    expect(hint.textContent).toMatch(/JTL nicht konfiguriert/);
    expect(invokeMock).toHaveBeenCalledWith(IPCChannels.Returns.LookupJtlOrder, 'EXT-9999');
  });

  test('JTL lookup prefills positions when the order is found', async () => {
    setMockResponses({
      [IPCChannels.Returns.List]: [EMPTY_LIST],
      [IPCChannels.Returns.ListReasons]: [REASONS],
      [IPCChannels.Returns.LookupJtlOrder]: [{
        configured: true,
        order: {
          kAuftrag: 12345,
          orderNumber: 'EXT-42',
          kKunde: 99,
          dateCreated: '2026-05-01T10:00:00',
          items: [
            { kAuftragPosition: 1, kArtikel: 900, sku: 'SKU-A', name: 'Artikel A', quantity: 2, unitPriceNet: 19.99 },
            { kAuftragPosition: 2, kArtikel: 901, sku: 'SKU-B', name: 'Artikel B', quantity: 1, unitPriceNet: 5.50 },
          ],
        },
      }],
    });
    render(<ReturnsPage />);

    fireEvent.click(await screen.findByRole('button', { name: /Neue Retoure/ }));
    fireEvent.change(await screen.findByLabelText(/JTL-Bestellnummer/), { target: { value: 'EXT-42' } });
    fireEvent.click(screen.getByRole('button', { name: /Aus JTL übernehmen/ }));

    const hint = await screen.findByTestId('lookup-hint');
    expect(hint.textContent).toMatch(/2 Position\(en\) aus JTL/);
    // Both SKUs must appear as input values somewhere.
    await waitFor(() => {
      const skuInputs = screen.getAllByPlaceholderText('SKU') as HTMLInputElement[];
      const values = skuInputs.map((i) => i.value);
      expect(values).toContain('SKU-A');
      expect(values).toContain('SKU-B');
    });
  });

  test('JTL lookup gracefully falls back to manual entry on a not-found order', async () => {
    setMockResponses({
      [IPCChannels.Returns.List]: [EMPTY_LIST],
      [IPCChannels.Returns.ListReasons]: [REASONS],
      [IPCChannels.Returns.LookupJtlOrder]: [{ configured: true, order: null }],
    });
    render(<ReturnsPage />);

    fireEvent.click(await screen.findByRole('button', { name: /Neue Retoure/ }));
    fireEvent.change(await screen.findByLabelText(/JTL-Bestellnummer/), { target: { value: 'NOPE' } });
    fireEvent.click(screen.getByRole('button', { name: /Aus JTL übernehmen/ }));

    const hint = await screen.findByTestId('lookup-hint');
    expect(hint.textContent).toMatch(/nicht gefunden/);
  });

  test('the analytics panel loads on toggle and renders totals + top reasons', async () => {
    setMockResponses({
      [IPCChannels.Returns.List]: [EMPTY_LIST],
      [IPCChannels.Returns.ListReasons]: [REASONS],
      [IPCChannels.Returns.Analytics]: [{
        totalCount: 12,
        byStatus: [{ status: 'pending', count: 7 }, { status: 'refunded', count: 5 }],
        byOutcome: [{ outcome: 'refund', count: 5 }, { outcome: null, count: 7 }],
        topReasons: [
          { reasonId: 1, code: 'size_wrong', label: 'Falsche Größe', count: 9 },
          { reasonId: null, code: null, label: null, count: 3 },
        ],
        generatedAt: '2026-06-09T00:00:00.000Z',
      }],
    });
    render(<ReturnsPage />);

    fireEvent.click(await screen.findByRole('button', { name: /Auswertung/ }));

    const total = await screen.findByTestId('analytics-total');
    expect(total.textContent).toBe('12');
    expect(invokeMock).toHaveBeenCalledWith(
      IPCChannels.Returns.Analytics,
      expect.objectContaining({ sinceDays: 90 }),
    );

    const reasons = await screen.findByTestId('analytics-reasons');
    expect(reasons.textContent).toContain('Falsche Größe');
    expect(reasons.textContent).toContain('Ohne Grund');
  });
});
