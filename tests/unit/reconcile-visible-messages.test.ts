import { reconcileVisibleMessages } from '@/components/email/hooks/reconcile-visible-messages';

/**
 * Der stille Refresh ist normalerweise ERHALTEND — nach einer ACL-Aenderung
 * waere das ein Sicherheitsloch: schreibt ein Workflow einer geladenen
 * Nachricht einen Ausschluss-Tag, faellt sie aus der gescopten Serverliste,
 * und der erhaltende Pfad haengt sie postwendend wieder an.
 */
describe('reconcileVisibleMessages', () => {
  const rows = (...ids: number[]) => ids.map((id) => ({ id, subject: `m${id}` }));

  test('drops what the server no longer returns', () => {
    const result = reconcileVisibleMessages(rows(1, 2, 3), rows(1, 3), 100);
    expect(result.messages.map((m) => m.id)).toEqual([1, 3]);
    expect(result.survivingIds.has(2)).toBe(false);
  });

  test('takes the server order and the server payload', () => {
    const previous = [{ id: 1, subject: 'alt' }, { id: 2, subject: 'alt' }];
    const server = [{ id: 2, subject: 'neu' }, { id: 1, subject: 'neu' }];
    const result = reconcileVisibleMessages(previous, server, 100);
    expect(result.messages).toEqual([{ id: 2, subject: 'neu' }, { id: 1, subject: 'neu' }]);
  });

  test('adds rows that became visible', () => {
    const result = reconcileVisibleMessages(rows(1), rows(1, 9), 100);
    expect(result.messages.map((m) => m.id)).toEqual([1, 9]);
  });

  test('keeps rows BELOW the fetched window — the server never judged them', () => {
    // Der stille Refresh holt immer nur die erste Seite. Wer weiter geblaettert
    // hat, darf seine tieferen Seiten nicht bei jeder getaggten Nachricht
    // verlieren; eine VOLLE erste Seite sagt ueber sie nichts aus.
    const previous = rows(...Array.from({ length: 5 }, (_, index) => index + 1));
    const server = rows(1, 3);
    const result = reconcileVisibleMessages(previous, server, 2);
    // 2 fehlt und lag INNERHALB des Fensters (Index 1 < 2) — entzogen.
    // 4 und 5 lagen darunter — unbeurteilt, bleiben.
    expect(result.messages.map((m) => m.id)).toEqual([1, 3, 4, 5]);
  });

  test('a short server page IS the complete set — everything missing goes', () => {
    const previous = rows(1, 2, 3, 4, 5);
    const result = reconcileVisibleMessages(previous, rows(1, 4), 100);
    expect(result.messages.map((m) => m.id)).toEqual([1, 4]);
  });

  test('an empty server list clears everything', () => {
    const result = reconcileVisibleMessages(rows(1, 2), [], 100);
    expect(result.messages).toEqual([]);
    expect(result.survivingIds.size).toBe(0);
  });
});
