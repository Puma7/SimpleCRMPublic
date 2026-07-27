import {
  mailEventRefreshRequestFor,
  mergeMailEventRefreshRequests,
  NO_MAIL_EVENT_REFRESH,
} from '@/components/email/mail-event-refresh';

/**
 * Die Zuordnung Ereignis → aufzufrischende Bereiche ist die Stelle, an der eine
 * neue Ereignisart still ins Leere laeuft. Deshalb hier ohne Komponentenbaum.
 */
describe('mail event refresh mapping', () => {
  const event = (over: Record<string, unknown> = {}) => ({
    type: 'email_acl.changed',
    workspaceId: 'workspace-a',
    entityType: 'email_acl',
    entityId: 'user-b',
    occurredAt: '2026-07-27T12:00:00.000Z',
    payload: { targetUserId: 'user-b', state: 'changed' },
    ...over,
  }) as never;

  test('an ACL change refreshes the list AND demands a reconcile', () => {
    // Ohne listReconcile laedt die Liste zwar neu, haengt die entzogenen Zeilen
    // aber als notInServer wieder an — die Invalidierung waere wirkungslos.
    const request = mailEventRefreshRequestFor(event());
    expect(request).toMatchObject({ list: true, listReconcile: true, accounts: true });
  });

  test('the pure visibility refresh reconciles too, but leaves accounts alone', () => {
    const request = mailEventRefreshRequestFor(event({
      payload: { targetUserId: 'user-b', state: 'changed', reason: 'visibility_filter' },
    }));
    expect(request).toMatchObject({ list: true, listReconcile: true, accounts: false });
  });

  test('an ordinary message event refreshes the list WITHOUT reconciling', () => {
    // Der alltaegliche stille Refresh muss erhaltend bleiben: die erste Seite
    // beschreibt die tiefer geladenen Seiten nicht.
    const request = mailEventRefreshRequestFor(event({
      type: 'email_message.updated',
      entityType: 'email_message',
      entityId: '5',
      payload: { id: 5 },
    }));
    expect(request).toMatchObject({ list: true, listReconcile: false });
  });

  test('an unrelated event asks for nothing', () => {
    expect(mailEventRefreshRequestFor(event({
      type: 'customer.updated',
      entityType: 'customer',
      entityId: '3',
      payload: { id: 3 },
    }))).toBeNull();
  });

  test('merging keeps every flag that any event in the burst asked for', () => {
    const merged = mergeMailEventRefreshRequests(
      { ...NO_MAIL_EVENT_REFRESH, list: true },
      { listReconcile: true },
    );
    expect(merged).toMatchObject({ list: true, listReconcile: true });
    // Und der Ausgangswert bleibt unberuehrt — er ist die geteilte Konstante.
    expect(NO_MAIL_EVENT_REFRESH.listReconcile).toBe(false);
  });
});
