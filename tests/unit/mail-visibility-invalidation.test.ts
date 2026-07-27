import {
  MAIL_VISIBILITY_INVALIDATION_CONCURRENCY,
  publishMailVisibilityInvalidation,
} from '../../packages/server/src/mail-access/visibility-invalidation';

/**
 * Die Invalidierung laeuft NACH dem Commit eines Workflow- oder
 * KI-Klassifizierungslaufs — auf jeder automatisch verarbeiteten Nachricht.
 * Steht ein haeufiger Tag hinter einem GRUPPEN-Binding, sind das viele
 * Empfaenger, und der produktive Ereignisport oeffnet je publish eine eigene
 * Workspace-Transaktion.
 */
describe('mail visibility invalidation', () => {
  const collector = () => {
    const published: Array<Record<string, unknown>> = [];
    let inFlight = 0;
    let peak = 0;
    const events = {
      async publish(event: Record<string, unknown>) {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        published.push(event);
        inFlight -= 1;
      },
    };
    return { events, published, peak: () => peak };
  };

  test('publishes one bounded-parallel event per distinct user', async () => {
    // Sequenziell kostete das einen Roundtrip je Nutzer und staute bei grossen
    // Gruppen den Worker auf. Unbegrenzt parallel raeumte es den
    // Verbindungspool leer, den die eigentliche Verarbeitung braucht.
    const sink = collector();
    const targets = Array.from({ length: 40 }, (_, index) => `user-${index}`);

    await publishMailVisibilityInvalidation({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      targetUserIds: [...targets, ...targets],
      events: sink.events,
      logPrefix: '[test]',
    });

    // Ein Ereignis je Nutzer, Duplikate faellt raus.
    expect(sink.published).toHaveLength(40);
    expect(new Set(sink.published.map((event) => event.entityId)).size).toBe(40);
    expect(sink.peak()).toBeGreaterThan(1);
    expect(sink.peak()).toBeLessThanOrEqual(MAIL_VISIBILITY_INVALIDATION_CONCURRENCY);
  });

  test('a failing recipient does not take the others down', async () => {
    // Der Lauf ist committed: ein fehlgeschlagenes Publish darf ihn nicht
    // nachtraeglich scheitern lassen und die uebrigen Empfaenger nicht
    // mitreissen.
    const published: string[] = [];
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await publishMailVisibilityInvalidation({
        workspaceId: '11111111-1111-4111-8111-111111111111',
        actorUserId: 'user-actor',
        targetUserIds: ['a', 'boom', 'c'],
        events: {
          async publish(event: { entityId: string }) {
            if (event.entityId === 'boom') throw new Error('event port down');
            published.push(event.entityId);
          },
        },
        logPrefix: '[test]',
      });
    } finally {
      warn.mockRestore();
    }

    expect(published.sort()).toEqual(['a', 'c']);
  });

  test('the payload carries the visibility reason and one shared timestamp', async () => {
    // `reason` haelt AuthProvider, Konten-/Teamliste und Delegationstabelle
    // ruhig; nur die Nachrichtenliste laedt neu. Ohne sie erneuerte jeder
    // Betroffene bei jeder getaggten Nachricht seine Sitzung.
    const sink = collector();
    await publishMailVisibilityInvalidation({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      targetUserIds: ['a', 'b'],
      events: sink.events,
      logPrefix: '[test]',
    });

    expect(sink.published.map((event) => event.payload)).toEqual([
      { targetUserId: 'a', state: 'changed', reason: 'visibility_filter' },
      { targetUserId: 'b', state: 'changed', reason: 'visibility_filter' },
    ]);
    // Ohne menschlichen Akteur: 'system'.
    expect(new Set(sink.published.map((event) => event.actorUserId))).toEqual(new Set(['system']));
    expect(new Set(sink.published.map((event) => event.occurredAt)).size).toBe(1);
  });

  test('no targets means no work at all', async () => {
    const sink = collector();
    await publishMailVisibilityInvalidation({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      targetUserIds: [],
      events: sink.events,
      logPrefix: '[test]',
    });
    expect(sink.published).toHaveLength(0);
  });
});
