import {
  aclReconcileLimit,
  MAX_ACL_RECONCILE_ROWS,
} from '@/components/email/hooks/reconcile-visible-messages';

/**
 * Der Abgleich nach einer ACL-Aenderung muss den GESAMTEN geladenen Bereich
 * pruefen. Nur die erste Seite abzufragen und den Rest als „ungeprueft" stehen
 * zu lassen waere genau das Loch, das er schliessen soll — die entzogene (und
 * womoeglich gerade geoeffnete) Nachricht kann tiefer liegen.
 */
describe('aclReconcileLimit', () => {
  test('asks for at least one page', () => {
    expect(aclReconcileLimit(0, 100)).toBe(100);
    expect(aclReconcileLimit(42, 100)).toBe(100);
  });

  test('asks for the whole loaded range once it exceeds a page', () => {
    expect(aclReconcileLimit(250, 100)).toBe(250);
  });

  test('caps the query — beyond the cap rows are dropped, not trusted', () => {
    // Ohne Deckel loeste eine sehr tief geblaetterte Liste bei jeder getaggten
    // Nachricht eine sehr grosse Abfrage aus. Der Rest faellt fail-closed weg.
    expect(aclReconcileLimit(50_000, 100)).toBe(MAX_ACL_RECONCILE_ROWS);
  });

  test('tolerates nonsense counts', () => {
    expect(aclReconcileLimit(Number.NaN, 100)).toBe(100);
    expect(aclReconcileLimit(-5, 100)).toBe(100);
    expect(aclReconcileLimit(250.7, 100)).toBe(250);
  });
});
