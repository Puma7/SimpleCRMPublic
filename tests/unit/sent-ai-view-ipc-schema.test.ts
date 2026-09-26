import { IPCChannels } from '../../shared/ipc/channels';
import { getPayloadSchema } from '../../shared/ipc/schemas';

/**
 * Ansicht „Gesendet (KI)“ (Teilautomatisierung P3): Liste, ID-Liste und Suche
 * nehmen die Ansicht an; Verschieben in die Ansicht bleibt ausgeschlossen.
 */
describe('IPC-Schemas: Ansicht sent_ai', () => {
  test.each([
    IPCChannels.Email.ListMessagesByView,
    IPCChannels.Email.ListMessageIdsByView,
  ])('%s akzeptiert sent_ai und lehnt Unbekanntes ab', (channel) => {
    const schema = getPayloadSchema(channel);
    expect(schema.safeParse({ accountId: 'all', view: 'sent_ai' }).success).toBe(true);
    expect(schema.safeParse({ accountId: 'all', view: 'sent_robot' }).success).toBe(false);
  });

  test('view-gebundene Suche akzeptiert sent_ai', () => {
    const schema = getPayloadSchema(IPCChannels.Email.SearchMessages);
    expect(schema.safeParse({ accountId: 3, query: 'Frage', view: 'sent_ai' }).success).toBe(true);
  });

  test('Verschieben nach sent_ai ist kein gültiges Ziel', () => {
    const schema = getPayloadSchema(IPCChannels.Email.MoveMessageToView);
    expect(schema.safeParse({ messageId: 5, view: 'sent_ai' }).success).toBe(false);
  });
});
