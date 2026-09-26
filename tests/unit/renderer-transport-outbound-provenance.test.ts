import { IPCChannels } from '@shared/ipc/channels';
import {
  createHttpRendererTransport,
  resetRendererTransportForTests,
} from '@/services/transport';

/**
 * Server-Transport der Ausgangs-Felder (Teilautomatisierung P2/P3): Ohne diese
 * Felder zeigt die Server-Oberfläche angehaltene Entwürfe nicht als angehalten
 * und gesendete Mails ohne „gesendet von“-Kennzeichen.
 */
describe('renderer transport: Ausgang und Versand-Herkunft', () => {
  beforeEach(() => {
    resetRendererTransportForTests();
    localStorage.clear();
  });

  function serverMessage(overrides: Record<string, unknown>) {
    return {
      id: 801,
      sourceSqliteId: 21,
      accountId: 101,
      folderId: 201,
      uid: -801,
      subject: 'Re: Frage',
      from: null,
      to: { value: [{ address: 'kunde@example.com' }] },
      cc: null,
      dateReceived: '2026-09-26T10:00:00.000Z',
      snippet: 'Antwort',
      seenLocal: false,
      doneLocal: false,
      archived: false,
      folderKind: 'draft',
      threadId: null,
      ticketCode: null,
      customerId: null,
      hasAttachments: false,
      assignedTo: null,
      assignedToUserId: null,
      isSpam: false,
      spamStatus: 'clean',
      pgpStatus: null,
      remoteContentPolicy: 'ask',
      readReceiptRequested: false,
      snoozedUntil: null,
      updatedAt: '2026-09-26T10:05:00.000Z',
      ...overrides,
    };
  }

  test('angehaltener Entwurf behält outbound_hold und den Grund aus der Server-Liste', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: {
        items: [serverMessage({ outboundHold: true, outboundBlockReason: 'Preisangabe fehlt' })],
        nextCursor: null,
      },
    }));
    const transport = createHttpRendererTransport({ baseUrl: 'https://crm.example.com', fetchImpl });

    const rows = await transport.invoke(IPCChannels.Email.ListMessagesByView, {
      accountId: 'all',
      view: 'inbox',
      limit: 50,
    }) as Array<Record<string, unknown>>;

    expect(rows[0]).toEqual(expect.objectContaining({
      id: 801,
      outbound_hold: 1,
      outbound_block_reason: 'Preisangabe fehlt',
    }));
  });

  test('nicht angehaltene Nachricht meldet outbound_hold 0 und keinen Grund', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: serverMessage({ outboundHold: false }),
    }));
    const transport = createHttpRendererTransport({ baseUrl: 'https://crm.example.com', fetchImpl });

    const row = await transport.invoke(IPCChannels.Email.GetMessage, 801) as Record<string, unknown>;

    expect(row.outbound_hold).toBe(0);
    expect(row.outbound_block_reason).toBeNull();
  });
});

describe('renderer transport: Ohne Ausgangsprüfung senden (TA-P2)', () => {
  beforeEach(() => {
    resetRendererTransportForTests();
    localStorage.clear();
  });

  test('ruft die Server-Route mit der Entwurfs-ID auf und liefert das Ergebnis wie SendCompose', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: { success: true, warning: 'Kopie im Gesendet-Ordner fehlgeschlagen' },
    }));
    const transport = createHttpRendererTransport({ baseUrl: 'https://crm.example.com', fetchImpl });

    await expect(transport.invoke(IPCChannels.Email.SendDraftSkipOutboundReview, { draftId: 41 }))
      .resolves.toEqual({ success: true, warning: 'Kopie im Gesendet-Ordner fehlgeschlagen' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/email/messages/41/send-skip-outbound-review',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('Automatisierungs-Einstellung: Richtlinie lesen und schreiben', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          imapDeleteOptIn: false,
          httpAllowlist: '',
          senderWhitelist: '',
          senderBlacklist: '',
          spamScoreThreshold: '70',
          autoReplyEnabled: false,
          outboundReviewSkipPolicy: 'admins',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ data: { success: true } }));
    const transport = createHttpRendererTransport({ baseUrl: 'https://crm.example.com', fetchImpl });

    const settings = await transport.invoke(IPCChannels.Email.GetWorkflowAutomationSettings) as Record<string, unknown>;
    expect(settings.outboundReviewSkipPolicy).toBe('admins');

    await transport.invoke(IPCChannels.Email.SetWorkflowAutomationSettings, { outboundReviewSkipPolicy: 'none' });
    expect(fetchImpl).toHaveBeenLastCalledWith(
      'https://crm.example.com/api/v1/workflow/settings/automation',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ outboundReviewSkipPolicy: 'none' }) }),
    );
    await expect(
      transport.invoke(IPCChannels.Email.SetWorkflowAutomationSettings, { outboundReviewSkipPolicy: 'everyone' }),
    ).rejects.toThrow('outbound review skip policy');
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}
