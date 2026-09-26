import { IPCChannels } from '../../shared/ipc/channels';
import { getPayloadSchema, getResultSchema } from '../../shared/ipc/schemas';

function relayRecord(): Record<string, unknown> {
  return {
    id: '3f0e8a3e-1111-4222-8333-444455556666',
    label: 'JTL Mahnwesen',
    enabled: true,
    trackingMode: 'rule',
    trackingSubjectPatterns: 'Mahnung',
    allowHeaderOverride: true,
    maxRecipients: 25,
    maxMessageBytes: 26214400,
    rateLimitPerMin: 60,
    followupWorkflowId: null,
    createdAt: '2026-07-01T10:00:00.000Z',
    allowedAccounts: [],
    credentials: [],
  };
}

// F-A3b-04 (E8): the relay setting allowArbitraryRecipients was never enforced
// and is removed; the IPC contract must not require it any more and must drop
// it when an old renderer still sends it.
describe('SMTP relay IPC schemas without allowArbitraryRecipients', () => {
  test('the relay list result no longer requires the removed field', () => {
    const parsed = getResultSchema(IPCChannels.Email.ListSmtpRelays).parse([relayRecord()]) as Array<Record<string, unknown>>;
    expect(parsed[0]).not.toHaveProperty('allowArbitraryRecipients');
  });

  test('create and update payloads drop the field instead of passing it on', () => {
    const created = getPayloadSchema(IPCChannels.Email.CreateSmtpRelay).parse({
      label: 'ERP',
      allowArbitraryRecipients: true,
    }) as Record<string, unknown>;
    expect(created).toEqual({ label: 'ERP' });

    const updated = getPayloadSchema(IPCChannels.Email.UpdateSmtpRelay).parse({
      relayId: 'relay-1',
      allowArbitraryRecipients: false,
      maxRecipients: 10,
    }) as Record<string, unknown>;
    expect(updated).toEqual({ relayId: 'relay-1', maxRecipients: 10 });
  });
});
