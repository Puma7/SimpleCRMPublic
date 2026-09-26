import { IPCChannels } from '@shared/ipc/channels';
import { createHttpRendererTransport, resetRendererTransportForTests } from '@/services/transport';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

// TA-P4: Die Workspace-Zeitzone der Zeitplan-Workflows reist ueber dieselbe
// Automatisierungs-Route wie die Nachbar-Einstellungen.
describe('renderer transport: workflow schedule time zone', () => {
  beforeEach(() => {
    resetRendererTransportForTests();
    localStorage.clear();
  });

  test('reads and writes scheduleTimezone through /workflow/settings/automation', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          imapDeleteOptIn: false,
          httpAllowlist: '',
          senderWhitelist: '',
          senderBlacklist: '',
          spamScoreThreshold: '70',
          autoReplyEnabled: false,
          autoReplyMaxPerSenderPerDay: 1,
          scheduleTimezone: 'Europe/Berlin',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ data: { success: true } }));
    const transport = createHttpRendererTransport({ baseUrl: 'https://crm.example.com', fetchImpl });

    await expect(transport.invoke(IPCChannels.Email.GetWorkflowAutomationSettings))
      .resolves.toMatchObject({ scheduleTimezone: 'Europe/Berlin' });
    await expect(transport.invoke(IPCChannels.Email.SetWorkflowAutomationSettings, {
      scheduleTimezone: ' Europe/Vienna ',
    })).resolves.toEqual({ success: true });

    const [url, init] = fetchImpl.mock.calls[1]!;
    expect(String(url)).toContain('/api/v1/workflow/settings/automation');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({ scheduleTimezone: 'Europe/Vienna' });
  });

  test('rejects a malformed value before sending', async () => {
    const fetchImpl = jest.fn();
    const transport = createHttpRendererTransport({ baseUrl: 'https://crm.example.com', fetchImpl });
    await expect(transport.invoke(IPCChannels.Email.SetWorkflowAutomationSettings, {
      scheduleTimezone: 42,
    })).rejects.toThrow(/workflow schedule timezone/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
