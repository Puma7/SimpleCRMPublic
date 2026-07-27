import type { ServerEvent } from "@/services/transport"
import {
  isMailAccountDataRefreshEvent,
  isMailAclRefreshEvent,
  isMailComposeAuxDataRefreshEvent,
  isMailListRefreshEvent,
  isMailMetadataRefreshEvent,
  isMailRemoteContentPolicyRefreshEvent,
} from "@/services/transport"

/**
 * Welche Teile der Mail-Oberflaeche ein Server-Ereignis auffrischen muss.
 *
 * Bewusst als reine Funktion neben der mail-shell: die Zuordnung ist die
 * Stelle, an der eine neue Ereignisart still ins Leere laufen kann — sie
 * gehoert testbar, ohne den ganzen Komponentenbaum zu mounten.
 */
export type MailEventRefreshRequest = {
  accounts: boolean
  composeAux: boolean
  list: boolean
  /**
   * Der Listen-Refresh muss ABGLEICHEN statt zu erhalten. Eine ACL-Aenderung
   * kann Sichtbarkeit ENTZIEHEN, und der erhaltende Pfad haengt genau die
   * Zeilen wieder an, die der Server nicht mehr liefert (siehe
   * reconcile-visible-messages). Das gilt ausdruecklich auch fuer die reine
   * Sichtbarkeitsauffrischung — die existiert ja genau dafuer.
   */
  listReconcile: boolean
  metadata: boolean
  remotePolicy: boolean
}

export const NO_MAIL_EVENT_REFRESH: MailEventRefreshRequest = {
  accounts: false,
  composeAux: false,
  list: false,
  listReconcile: false,
  metadata: false,
  remotePolicy: false,
}

export function mailEventRefreshRequestFor(event: ServerEvent): MailEventRefreshRequest | null {
  const list = isMailListRefreshEvent(event)
  const metadata = isMailMetadataRefreshEvent(event)
  const accounts = isMailAccountDataRefreshEvent(event)
  const composeAux = isMailComposeAuxDataRefreshEvent(event)
  const remotePolicy = isMailRemoteContentPolicyRefreshEvent(event)
  if (!list && !metadata && !accounts && !composeAux && !remotePolicy) return null
  return {
    accounts,
    composeAux,
    list,
    listReconcile: isMailAclRefreshEvent(event),
    metadata,
    remotePolicy,
  }
}

export function mergeMailEventRefreshRequests(
  current: MailEventRefreshRequest,
  next: Partial<MailEventRefreshRequest>,
): MailEventRefreshRequest {
  return {
    accounts: current.accounts || next.accounts === true,
    composeAux: current.composeAux || next.composeAux === true,
    list: current.list || next.list === true,
    listReconcile: current.listReconcile || next.listReconcile === true,
    metadata: current.metadata || next.metadata === true,
    remotePolicy: current.remotePolicy || next.remotePolicy === true,
  }
}
