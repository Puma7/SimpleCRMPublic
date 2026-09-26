import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

import { AiPanel } from '@/components/email/settings/ai-panel';
import {
  configureRendererTransport,
  createHttpRendererTransport,
  createIpcRendererTransport,
  resetRendererTransportForTests,
} from '@/services/transport';
import { IPCChannels } from '@shared/ipc/channels';

jest.mock('sonner', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => ({ user: { id: 'admin-1', role: 'admin' }, loading: false, hasCapability: () => true }),
}));

// Radix-Select öffnet sich in jsdom nicht; ein natives <select> zeigt dieselben
// Einträge und dieselbe onValueChange-Verdrahtung.
jest.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, disabled, children }: any) => (
    <select data-testid="ui-select" value={value} disabled={disabled} onChange={(e) => onValueChange?.(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));

jest.mock('@/components/email/settings/reply-suggestion-settings-section', () => ({
  ReplySuggestionSettingsSection: () => null,
}));
jest.mock('@/components/email/settings/translation-settings-section', () => ({
  TranslationSettingsSection: () => null,
}));

function decisionsProfileRow() {
  return {
    id: 21,
    label: 'Jev',
    provider: 'openrouter_decisions',
    baseUrl: 'https://openrouter.ai/api',
    model: 'typesafe/jev-1.13',
    embeddingModel: null,
    isDefault: true,
    hasApiKey: true,
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(value),
  } as Response;
}

describe('KI-Profil: Entscheidungsmodell und „Verbindung testen“', () => {
  afterEach(() => {
    resetRendererTransportForTests();
  });

  test('Desktop: Hinweis beim Entscheidungsmodell, Test über email:test-ai-profile', async () => {
    jest.clearAllMocks();
    const invoke = jest.fn(async (channel: string) => {
      if (channel === IPCChannels.Email.ListAiProfiles) return [decisionsProfileRow()];
      if (channel === IPCChannels.Email.TestAiProfile) {
        return {
          ok: true,
          message: 'Verbindung erfolgreich (Ja-Wahrscheinlichkeit 97 %)',
          model: 'typesafe/jev-1.13',
          latencyMs: 812,
          probability: 97,
        };
      }
      return undefined;
    });
    configureRendererTransport(createIpcRendererTransport({ invoke } as any));

    render(<AiPanel />);

    await screen.findByDisplayValue('Jev');
    expect(screen.getByTestId('ai-decisions-preset-hint')).toHaveTextContent(
      'Nur für den Baustein KI-Entscheidung. Modelle z. B. typesafe/jev-1.13, respan/span-01.',
    );
    expect(screen.getByText('Entscheidungsmodell', { selector: 'label' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Verbindung testen' }));
    });

    expect(invoke).toHaveBeenCalledWith(IPCChannels.Email.TestAiProfile, 21);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Verbindung erfolgreich (Ja-Wahrscheinlichkeit 97 %)'));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Verbindung OK: Verbindung erfolgreich (Ja-Wahrscheinlichkeit 97 %) · Modell typesafe/jev-1.13 · 812 ms',
    );
  });

  test('Vorlage „Entscheidungsmodell“ füllt Base-URL und Modell vor und zeigt den Hinweis', async () => {
    jest.clearAllMocks();
    const invoke = jest.fn(async (channel: string) => {
      if (channel === IPCChannels.Email.ListAiProfiles) {
        return [{ ...decisionsProfileRow(), provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', embeddingModel: 'text-embedding-3-small' }];
      }
      return undefined;
    });
    configureRendererTransport(createIpcRendererTransport({ invoke } as any));

    render(<AiPanel />);
    await screen.findByDisplayValue('Jev');
    expect(screen.queryByTestId('ai-decisions-preset-hint')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('ui-select'), { target: { value: 'openrouter_decisions' } });

    expect(screen.getByTestId('ai-decisions-preset-hint')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://openrouter.ai/api')).toBeInTheDocument();
    expect(screen.getByDisplayValue('typesafe/jev-1.13')).toBeInTheDocument();
    // Entscheidungsmodelle haben kein Embedding: das Feld wird geleert.
    expect(screen.queryByDisplayValue('text-embedding-3-small')).not.toBeInTheDocument();
  });

  test('Desktop: Fehlschlag wird gemeldet', async () => {
    jest.clearAllMocks();
    const invoke = jest.fn(async (channel: string) => {
      if (channel === IPCChannels.Email.ListAiProfiles) return [{ ...decisionsProfileRow(), provider: 'openai' }];
      if (channel === IPCChannels.Email.TestAiProfile) {
        return { ok: false, message: 'KI-Anfrage fehlgeschlagen: 401', model: 'typesafe/jev-1.13', latencyMs: 40 };
      }
      return undefined;
    });
    configureRendererTransport(createIpcRendererTransport({ invoke } as any));

    render(<AiPanel />);
    await screen.findByDisplayValue('Jev');
    expect(screen.queryByTestId('ai-decisions-preset-hint')).not.toBeInTheDocument();
    expect(screen.getByText('Chat-Modell', { selector: 'label' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Verbindung testen' }));
    });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Verbindungstest fehlgeschlagen: KI-Anfrage fehlgeschlagen: 401',
    ));
    expect(screen.getByRole('status')).toHaveTextContent('Verbindung fehlgeschlagen');
  });

  test('Server-Modus: Preset wählbar, Test über POST /ai/profiles/:id/test-connection', async () => {
    jest.clearAllMocks();
    const fetchImpl = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/test-connection')) {
        return jsonResponse({ data: { ok: true, message: 'Verbindung erfolgreich – Antwort: OK', model: 'gpt-4o-mini', latencyMs: 90 } });
      }
      if (String(input).includes('/api/v1/ai/profiles')) {
        return jsonResponse({ data: { items: [{ ...decisionsProfileRow(), apiKeyConfigured: true }], nextCursor: null } });
      }
      return jsonResponse({ data: null }, init?.method === 'GET' ? 404 : 405);
    });
    configureRendererTransport(createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl: fetchImpl as typeof fetch,
    }));

    render(<AiPanel />);
    await screen.findByDisplayValue('Jev');

    const select = screen.getByTestId('ui-select') as HTMLSelectElement;
    const options = Array.from(select.options).map((option) => [option.value, option.textContent]);
    expect(options).toContainEqual(['openrouter_decisions', 'OpenRouter Entscheidungsmodell (Decisions API)']);
    expect(options.map(([value]) => value)).not.toContain('ollama');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Verbindung testen' }));
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Verbindung erfolgreich – Antwort: OK'));
    const testCall = fetchImpl.mock.calls.find(([input]) => String(input).includes('/test-connection'));
    expect(String(testCall?.[0])).toBe('https://crm.example.com/api/v1/ai/profiles/21/test-connection');
    expect(testCall?.[1]?.method).toBe('POST');
  });
});
