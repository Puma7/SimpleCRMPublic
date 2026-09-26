import { render, screen } from '@testing-library/react';

import { PgpPanel } from '@/components/email/settings/pgp-panel';
import {
  configureRendererTransport,
  createHttpRendererTransport,
  resetRendererTransportForTests,
} from '@/services/transport';

jest.mock('@/services/transport/server-events', () => ({
  ...jest.requireActual('@/services/transport/server-events'),
  subscribeServerEvents: jest.fn(() => ({ unsubscribe: jest.fn() })),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

function peerKeyRecord(id: number, email: string, fingerprint: string) {
  return {
    id,
    sourceSqliteId: null,
    email,
    fingerprint,
    publicKeyArmor: 'peer-public-key',
    source: 'manual',
    trustLevel: 'imported',
    verifiedAt: null,
    createdAt: '2026-09-25T08:00:00.000Z',
    updatedAt: '2026-09-25T08:00:00.000Z',
  };
}

describe('PgpPanel peer keys in server-client mode', () => {
  afterEach(() => {
    resetRendererTransportForTests();
  });

  // F-N-pgp-01: Der Server speicherte importierte Schluessel unter '[object Object]'; das Panel muss sie auch im Server-Modus zum Neu-Import markieren.
  test('flags server peer keys stored without an e-mail address for re-import', async () => {
    const fetchImpl = jest.fn(async (url: string | URL | Request) => {
      const path = new URL(String(url)).pathname;
      if (path === '/api/v1/pgp/identities') return jsonResponse({ data: { items: [], nextCursor: null } });
      if (path === '/api/v1/pgp/peer-keys') {
        return jsonResponse({
          data: {
            items: [
              peerKeyRecord(1, '[object Object]', 'aaaaaaaaaaaaaaaaaaaa'),
              peerKeyRecord(2, 'bob@example.com', 'bbbbbbbbbbbbbbbbbbbb'),
            ],
            nextCursor: null,
          },
        });
      }
      throw new Error(`unexpected request ${path}`);
    });
    configureRendererTransport(createHttpRendererTransport({ baseUrl: 'https://crm.example.com', fetchImpl }));

    render(<PgpPanel />);

    expect(await screen.findByText(/bitte neu importieren/i)).toBeTruthy();
    expect(screen.getAllByText(/bitte neu importieren/i)).toHaveLength(1);
    expect(screen.getByText(/bob@example\.com/)).toBeTruthy();
    expect(screen.queryByText(/\[object Object\]/)).toBeNull();
  });
});
