/**
 * KI-Antwortvorschlag im Viewer: Das Anstossen beim Oeffnen (EnsureReplySuggestion)
 * ist ein Hintergrundaufruf. Lehnt der Main-Prozess ihn ab (z. B. nur Lese-Freigabe
 * auf dem Konto), darf daraus keine unbehandelte Promise-Ablehnung werden.
 */
import React from 'react';
import { act, render } from '@testing-library/react';
import { IPCChannels } from '@shared/ipc/channels';

const mockInvoke = jest.fn();

jest.mock('sonner', () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn(), info: jest.fn() }),
}));

jest.mock('@tanstack/react-router', () => ({
  useNavigate: () => jest.fn(),
}));

jest.mock('@/services/transport', () => ({
  invokeRenderer: (...args: unknown[]) => mockInvoke(...args),
}));

jest.mock('../../src/components/email/message-more-actions-menu', () => ({ MessageMoreActionsMenu: () => null }));

import { MessageAiSuggestions } from '../../src/components/email/message-ai-suggestions';
import type { EmailMessage } from '../../src/components/email/types';

const message = {
  id: 7,
  account_id: 1,
  folder_id: 1,
  uid: 70,
  folder_kind: 'inbox',
  subject: 'Anfrage',
  snippet: 'Hallo',
  date_received: '2026-09-20T10:00:00.000Z',
  from_json: JSON.stringify({ value: [{ address: 'kunde@example.com' }] }),
} as unknown as EmailMessage;

describe('MessageAiSuggestions', () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason);
  };

  beforeEach(() => {
    unhandled.length = 0;
    process.on('unhandledRejection', onUnhandled);
    mockInvoke.mockReset();
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === IPCChannels.Email.EnsureReplySuggestion) {
        return Promise.reject(new Error('Kein Zugriff auf dieses Konto'));
      }
      if (channel === IPCChannels.Email.GetReplySuggestion) {
        return Promise.resolve({ status: 'none', text: null, error: null, updatedAt: null });
      }
      return Promise.resolve(null);
    });
  });

  afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
  });

  // C-A2-Folge: EnsureReplySuggestion verlangt rw; die Ablehnung lief als unbehandelte Promise-Ablehnung auf.
  test('eine abgelehnte EnsureReplySuggestion bleibt behandelt', async () => {
    render(<MessageAiSuggestions message={message} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(mockInvoke).toHaveBeenCalledWith(IPCChannels.Email.EnsureReplySuggestion, {
      messageId: 7,
      trigger: 'open',
    });
    expect(mockInvoke).toHaveBeenCalledWith(IPCChannels.Email.GetReplySuggestion, 7);
    expect(unhandled).toEqual([]);
  });
});
