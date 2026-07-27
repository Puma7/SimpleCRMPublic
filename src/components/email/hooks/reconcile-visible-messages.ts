/**
 * Der Listen-Abgleich nach einer ACL-Aenderung.
 *
 * Der normale stille Refresh ist ERHALTEND: was der Server nicht mehr liefert,
 * bleibt als `notInServer` am Ende der Liste stehen. Das ist richtig, solange
 * nur nachgeladen oder aktualisiert wird — er holt ja nur die erste Seite, und
 * die beschreibt die tiefer geladenen nicht.
 *
 * Nach einer ACL-Aenderung ist es falsch. Schreibt ein Workflow oder die
 * KI-Klassifizierung einer bereits geladenen Nachricht einen Tag oder eine
 * Kategorie, die in einem Ausschlussfilter vorkommt, verschwindet sie aus der
 * gescopten Serverliste — der erhaltende Refresh haengt sie postwendend wieder
 * an, und der Detail-Refresh protokolliert die abgelehnte Anfrage nur und
 * laesst den alten Inhalt stehen. Die Invalidierung erfuellte damit genau ihren
 * Zweck nicht.
 *
 * Der Abgleich fragt deshalb den GESAMTEN geladenen Bereich neu ab und
 * uebernimmt die Antwort als Ganzes: was darin fehlt, ist entzogen. Nur die
 * erste Seite zu pruefen und den Rest als „ungeprueft" stehenzulassen waere
 * genau das Loch, das er schliessen soll — gerade die geoeffnete Nachricht
 * kann jenseits der ersten Seite liegen.
 */

/**
 * Wie viele Zeilen der Abgleich hoechstens neu abfragt.
 *
 * Ohne Deckel loeste eine sehr tief geblaetterte Liste bei jeder getaggten
 * eingehenden Nachricht eine sehr grosse Abfrage aus. Was jenseits des Deckels
 * liegt, wird nicht geprueft und faellt deshalb WEG — fail closed; der Nutzer
 * blaettert es bei Bedarf neu nach. Dasselbe gilt fuer Zeilen, die durch
 * frisch eingetroffene Nachrichten aus dem abgefragten Bereich rutschen: ein
 * ueberzaehliges Nachladen ist der harmlosere Fehler.
 */
export const MAX_ACL_RECONCILE_ROWS = 1000

export function aclReconcileLimit(loadedCount: number, pageSize: number): number {
  if (!Number.isFinite(loadedCount) || loadedCount <= 0) return pageSize
  return Math.max(pageSize, Math.min(Math.floor(loadedCount), MAX_ACL_RECONCILE_ROWS))
}
