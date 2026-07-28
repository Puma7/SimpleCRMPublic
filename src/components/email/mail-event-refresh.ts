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

/**
 * Entprellte Sammlung der Auffrischungen.
 *
 * Ereignisse kommen in Schueben (eine Gruppenmutation faechert je Mitglied ein
 * Ereignis auf); die Entprellung fasst sie zusammen. Fuer den ACL-ABGLEICH
 * gilt dabei eine Ausnahme: steht er aus, laeuft ein bereits geplanter Timer
 * weiter, statt neu zu starten. Sonst verhungert er — ein Tagging-Workflow
 * erzeugt auf einem belebten Postfach leicht dichter als die Entprellzeit ein
 * Ereignis, und die sicherheitsrelevante Auffrischung liefe nie. Verloren geht
 * dabei nur Verzoegerung, kein Auftrag: die Sammelanfrage waechst weiter.
 */
export function createMailEventRefreshScheduler(options: Readonly<{
  delayMs: number
  flush: (request: MailEventRefreshRequest) => void
}>) {
  let pending: MailEventRefreshRequest = NO_MAIL_EVENT_REFRESH
  let timer: ReturnType<typeof setTimeout> | null = null

  return {
    schedule(request: Partial<MailEventRefreshRequest>): void {
      pending = mergeMailEventRefreshRequests(pending, request)
      if (timer !== null) {
        if (pending.listReconcile) return
        clearTimeout(timer)
      }
      timer = setTimeout(() => {
        timer = null
        const flushed = pending
        pending = NO_MAIL_EVENT_REFRESH
        options.flush(flushed)
      }, options.delayMs)
    },
    cancel(): void {
      if (timer !== null) clearTimeout(timer)
      timer = null
      pending = NO_MAIL_EVENT_REFRESH
    },
  }
}
