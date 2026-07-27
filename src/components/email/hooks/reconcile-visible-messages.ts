/**
 * Abgleich der geladenen Nachrichtenliste nach einer ACL-Aenderung.
 *
 * Der normale stille Refresh ist ERHALTEND: was der Server nicht mehr liefert,
 * bleibt als `notInServer` am Ende der Liste stehen. Das ist richtig, solange
 * nur nachgeladen oder aktualisiert wird — die erste Seite beschreibt ja nicht
 * die tiefer geladenen.
 *
 * Nach einer ACL-Aenderung ist es falsch. Schreibt ein Workflow oder die
 * KI-Klassifizierung einer bereits geladenen Nachricht einen Tag oder eine
 * Kategorie, die in einem Ausschlussfilter vorkommt, verschwindet sie aus der
 * gescopten Serverliste — der erhaltende Refresh haengt sie postwendend wieder
 * an, und der Detail-Refresh protokolliert die abgelehnte Anfrage nur und
 * laesst den alten Inhalt stehen. Die Invalidierung erfuellte damit genau ihren
 * Zweck nicht: entzogene Inhalte blieben bis zu einem nicht-erhaltenden Reload
 * sichtbar.
 *
 * Hier ist „fehlt" deshalb gleichbedeutend mit „entzogen" — allerdings NUR
 * innerhalb des Fensters, das der Server ueberhaupt beurteilt hat. Der stille
 * Refresh holt immer die erste Seite; hat der Nutzer weiter geblaettert, sagt
 * eine volle erste Seite nichts ueber die Zeilen darunter. Die bleiben stehen
 * und gleichen sich beim naechsten vollen Reload ab. Liefert der Server
 * dagegen WENIGER als eine volle Seite, ist das die komplette Ergebnismenge —
 * dann faellt alles Fehlende weg.
 */
export type ReconcilableMessage = { id: number }

export type VisibilityReconcileResult<T extends ReconcilableMessage> = {
  messages: T[]
  /** Ids, die den Abgleich ueberlebt haben — fuer die Auswahl. */
  survivingIds: Set<number>
}

export function reconcileVisibleMessages<T extends ReconcilableMessage>(
  previous: readonly T[],
  server: readonly T[],
  pageSize: number,
): VisibilityReconcileResult<T> {
  const fresh = new Map(server.map((message) => [message.id, message]))
  const merged: T[] = previous.map((message) => fresh.get(message.id) ?? message)
  for (const message of server) {
    if (!previous.some((entry) => entry.id === message.id)) merged.push(message)
  }

  const order = new Map(server.map((message, index) => [message.id, index]))
  const inServer = merged
    .filter((message) => order.has(message.id))
    .sort((a, b) => order.get(a.id)! - order.get(b.id)!)

  // Weniger als eine volle Seite = der Server hat ALLES beurteilt.
  const serverListIsComplete = server.length < pageSize
  const previousIndex = new Map(previous.map((message, index) => [message.id, index]))
  const beyondWindow = serverListIsComplete
    ? []
    : merged.filter((message) => (
      !order.has(message.id)
      && (previousIndex.get(message.id) ?? Number.MAX_SAFE_INTEGER) >= server.length
    ))

  const messages = [...inServer, ...beyondWindow]
  return { messages, survivingIds: new Set(messages.map((message) => message.id)) }
}
