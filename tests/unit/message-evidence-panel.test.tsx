import { act, render, screen, waitFor } from '@testing-library/react';

import { MessageEvidencePanel } from '@/components/email/message-evidence-panel';
import { invokeRenderer } from '@/services/transport';

jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => ({
    user: { id: 'admin-1', role: 'admin' },
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
