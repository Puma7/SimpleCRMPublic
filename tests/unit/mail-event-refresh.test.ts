import {
  createMailEventRefreshScheduler,
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

describe('mail event refresh scheduler', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const aclEvent = { list: true, listReconcile: true } as const;
  const messageEvent = { list: true } as const;

  test('an ordinary burst collapses into one flush', () => {
    const flushed: unknown[] = [];
    const scheduler = createMailEventRefreshScheduler({ delayMs: 250, flush: (r) => flushed.push(r) });
    scheduler.schedule(messageEvent);
    jest.advanceTimersByTime(200);
    scheduler.schedule(messageEvent);
    jest.advanceTimersByTime(200);
    // Der Timer wurde neu gestartet — noch nichts geflossen.
    expect(flushed).toHaveLength(0);
    jest.advanceTimersByTime(100);
    expect(flushed).toHaveLength(1);
  });

  test('a pending ACL reconcile is NOT starved by a continuous event stream', () => {
    // Ein Tagging-Workflow erzeugt auf einem belebten Postfach leicht dichter
    // als das Sammelfenster ein Ereignis. Startete die Entprellung dabei jedes
    // Mal neu, liefe die sicherheitsrelevante Auffrischung nie — eine entzogene
    // Nachricht bliebe samt geladenem Inhalt unbegrenzt stehen.
    const flushed: Array<{ listReconcile: boolean }> = [];
    const scheduler = createMailEventRefreshScheduler({ delayMs: 250, flush: (r) => flushed.push(r) });
    scheduler.schedule(aclEvent);
    for (let tick = 0; tick < 20; tick += 1) {
      jest.advanceTimersByTime(100);
      scheduler.schedule(messageEvent);
    }
    expect(flushed).toHaveLength(1);
    expect(flushed[0]!.listReconcile).toBe(true);
  });

  test('events arriving during the wait still reach the flush', () => {
    const flushed: Array<Record<string, boolean>> = [];
    const scheduler = createMailEventRefreshScheduler({ delayMs: 250, flush: (r) => flushed.push(r) });
    scheduler.schedule(aclEvent);
    scheduler.schedule({ metadata: true });
    jest.advanceTimersByTime(250);
    expect(flushed[0]).toMatchObject({ list: true, listReconcile: true, metadata: true });
  });

  test('cancel drops the pending flush', () => {
    const flushed: unknown[] = [];
    const scheduler = createMailEventRefreshScheduler({ delayMs: 250, flush: (r) => flushed.push(r) });
    scheduler.schedule(aclEvent);
    scheduler.cancel();
    jest.advanceTimersByTime(1000);
    expect(flushed).toHaveLength(0);
  });
});
