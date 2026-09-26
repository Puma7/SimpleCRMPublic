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

// TA-P4: Der Editor braucht den Zustand „scharf/nicht scharf" des Zeitplans.
describe('renderer transport: workflow schedule state', () => {
  beforeEach(() => {
    resetRendererTransportForTests();
    localStorage.clear();
  });

  test('maps scheduleLastSlotAt to schedule_last_slot_at and omits it when the server does not send it', async () => {
    const record = {
      id: 41,
      sourceSqliteId: 41,
      name: 'Morgens',
      triggerName: 'schedule',
      enabled: true,
      priority: 100,
      definition: {},
      graph: null,
      cronExpr: '0 6 * * *',
      scheduleAccountId: null,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    };
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [
            { ...record, scheduleLastSlotAt: null },
            { ...record, id: 42, sourceSqliteId: 42, scheduleLastSlotAt: '2026-09-28T04:00:00.000Z' },
            { ...record, id: 43, sourceSqliteId: 43 },
          ],
          nextCursor: null,
        },
      }));
    const transport = createHttpRendererTransport({ baseUrl: 'https://crm.example.com', fetchImpl });
    const rows = await transport.invoke(IPCChannels.Email.ListWorkflows) as Array<Record<string, unknown>>;
    expect(rows[0]!.schedule_last_slot_at).toBeNull();
    expect(rows[1]!.schedule_last_slot_at).toBe('2026-09-28T04:00:00.000Z');
    expect(rows[2]).not.toHaveProperty('schedule_last_slot_at');
  });
});
