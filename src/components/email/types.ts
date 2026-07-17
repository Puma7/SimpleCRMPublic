import { getRendererTransport } from "@/services/transport"

export type MailView =
  | "inbox"
  | "sent"
  | "archived"
  | "drafts"
  | "scheduled_send"
  | "spam_review"
  | "spam"
  | "trash"
  | "snoozed"

export type EmailAccount = {
  id: number
  display_name: string
  email_address: string
  imap_host: string
  imap_port: number
  imap_tls: number
  imap_username: string
  keytar_account_key: string
  protocol?: string
  pop3_host?: string | null
  pop3_port?: number | null
  pop3_tls?: number | null
  smtp_host?: string | null
  smtp_port?: number | null
  smtp_tls?: number | null
  smtp_username?: string | null
  smtp_use_imap_auth?: number | null
  sent_folder_path?: string | null
  sync_spam_folder_path?: string | null
  sync_archive_folder_path?: string | null
  imap_sync_sent?: number | null
  imap_sync_archive?: number | null
  imap_sync_spam?: number | null
  /** IMAP: mark \\Seen on server when opening a message locally (POP3: ignored). */
  imap_sync_seen_on_open?: number | null
  vacation_enabled?: number
  vacation_subject?: string | null
  vacation_body_text?: string | null
  request_read_receipt?: number
  imap_delete_opt_in?: number | null
  created_at: string
  updated_at: string
}

export type TeamMember = {
  id: string
  display_name: string
  role: string
  signature_html?: string | null
}

export type ConversationLockReason = "reply" | "forward" | "edit"

export type ConversationLockRecord = {
  messageId: number
  userId: string
  workspaceId: string
  acquiredAt: string
  lastHeartbeatAt: string
  reason: ConversationLockReason
  takeoverCount: number
  displayName?: string
  email?: string
}

export type AccountSignature = {
  account_id: number
  display_name: string
  email_address: string
  signature_html: string | null
}

export type EmailMessage = {
  id: number
  account_id: number
  folder_id: number
  uid: number
  /** POP3: stable server UIDL when uid is synthetic. */
  pop3_uidl?: string | null
  subject: string | null
  snippet: string | null
  /** Nur in Suchergebnissen: sentinel-markierter Treffer-Ausschnitt (kein HTML). */
  search_snippet?: string | null
  date_received: string | null
  from_json: string | null
  to_json?: string | null
  cc_json?: string | null
  bcc_json?: string | null
  body_text: string | null
  body_html: string | null
  seen_local: number
  done_local?: number
  is_spam?: number
  spam_status?: "clean" | "review" | "spam" | string | null
  spam_score?: number | null
  spam_score_label?: string | null
  spam_decision_source?: string | null
  spam_score_breakdown_json?: string | null
  spam_decided_at?: string | null
  archived?: number
  soft_deleted?: number
  outbound_hold?: number
  outbound_block_reason?: string | null
  /** KI-Gegenlese: 'pending' = Entwurf wartet auf menschliche Freigabe. */
  approval_state?: string | null
  approval_reason?: string | null
  ticket_code?: string | null
  thread_id?: string | null
  thread_message_count?: number | null
  customer_id?: number | null
  folder_kind?: string
  assigned_to?: string | null
  has_attachments?: number
  imap_thread_id?: string | null
  attachments_json?: string | null
  draft_attachment_paths_json?: string | null
  reply_parent_message_id?: number | null
  raw_headers?: string | null
  snoozed_until?: string | null
  pgp_status?: string | null
  pgp_signer_fingerprint?: string | null
}

export type CategoryRow = {
  id: number
  /** Stable cross-instance id (server edition). Used for rename-safe references. */
  source_sqlite_id?: number
  parent_id: number | null
  name: string
  sort_order: number
}
export type CatCount = { categoryId: number; count: number }
export type CustomerOpt = {
  id: number
  name: string
  firstName?: string | null
  email?: string | null
  customerNumber?: string | null
}
export type CannedResponse = {
  id: number
  title: string
  body: string
  account_id?: number | null
  override_key?: string | null
}
export type AiPrompt = {
  id: number
  label: string
  user_template: string
  target?: string
  profile_id?: number | null
  sort_order?: number
  account_id?: number | null
  override_key?: string | null
}
export type InternalNote = { id: number; body: string; created_at: string }
export type MessageAttachment = {
  id: number
  filename_display: string
  size_bytes: number
  content_type: string | null
}

type ElectronInvoke = (channel: string, ...args: unknown[]) => Promise<unknown>

function getElectronInvoke(): ElectronInvoke | null {
  if (typeof window === "undefined") return null
  const w = window as {
    electronAPI?: { invoke?: ElectronInvoke }
    electron?: { ipcRenderer?: { invoke?: ElectronInvoke } }
  }
  if (typeof w.electronAPI?.invoke === "function") {
    return w.electronAPI.invoke.bind(w.electronAPI)
  }
  if (typeof w.electron?.ipcRenderer?.invoke === "function") {
    return w.electron.ipcRenderer.invoke.bind(w.electron.ipcRenderer)
  }
  return null
}

export const hasElectron = (): boolean => getElectronInvoke() != null

export const hasLocalIpc = (): boolean => hasElectron() && getRendererTransport().kind === "ipc"

export const invokeIpc = <T,>(channel: string, ...args: unknown[]): Promise<T> => {
  const invoke = getElectronInvoke()
  if (!invoke) {
    return Promise.reject(new Error(`Electron API not available for '${channel}'`))
  }
  return invoke(channel, ...args) as Promise<T>
}

export function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** List/conversation rows often ship without body fields — only snippet. */
export function needsFullMessageBody(message: Pick<EmailMessage, "body_text" | "body_html">): boolean {
  return !message.body_text?.trim() && !message.body_html?.trim()
}

export function firstAddress(fromJson: string | null): string {
  if (!fromJson) return ""
  try {
    const parsed = JSON.parse(fromJson) as { value?: { address?: string }[] }
    return parsed?.value?.[0]?.address ?? ""
  } catch {
    return ""
  }
}

export function formatFrom(fromJson: string | null): string {
  if (!fromJson) return "—"
  try {
    const parsed = JSON.parse(fromJson) as {
      value?: { name?: string; address?: string }[]
    }
    const v = parsed?.value?.[0]
    if (v?.name && v?.address) return `${v.name} <${v.address}>`
    if (v?.address) return v.address
    return fromJson
  } catch {
    return fromJson
  }
}

/** From line with account fallback for outbound drafts/sent missing from_json. */
export function formatMessageFrom(
  message: Pick<EmailMessage, "from_json" | "folder_kind" | "account_id">,
  accounts?: readonly EmailAccount[],
): string {
  if (message.from_json?.trim()) return formatFrom(message.from_json)
  if (message.folder_kind === "sent" || message.folder_kind === "draft") {
    const acc = accounts?.find((a) => a.id === message.account_id)
    if (acc?.email_address) {
      const json = JSON.stringify({
        value: [{
          address: acc.email_address,
          ...(acc.display_name?.trim() ? { name: acc.display_name.trim() } : {}),
        }],
      })
      return formatFrom(json)
    }
  }
  return formatFrom(message.from_json)
}

/**
 * Message-basierte Draft-Erkennung (statt View-basiert), damit Compose-/
 * Scheduled-Drafts auch als Treffer der Broad-Suche (ausserhalb der
 * drafts/scheduled_send-Views) Bearbeiten-/Loeschen-Controls bekommen.
 * Spiegelt die View-Mitgliedschaft der Store-Logik: lokale Drafts (uid < 0)
 * liegen in folder_kind 'draft'; die drafts/scheduled_send-Views verlangen
 * soft_deleted = 0, deshalb zeigen soft-geloeschte Drafts weiterhin
 * Papierkorb-Controls. Outbound-held bleibt wie die bisherige Viewer-Logik
 * view- und loesch-unabhaengig (Inbox-Verhalten unveraendert).
 */
export function isEditableDraftMessage(
  message:
    | Pick<EmailMessage, "uid" | "folder_kind" | "soft_deleted" | "outbound_hold">
    | null
    | undefined,
): boolean {
  if (!message || message.uid >= 0) return false
  if ((message.outbound_hold ?? 0) > 0) return true
  return message.folder_kind === "draft" && (message.soft_deleted ?? 0) === 0
}

/**
 * Papierkorb-Erkennung an der Nachricht statt an der View: Die Broad-Suche
 * mit "Papierkorb einbeziehen" liefert soft-geloeschte Treffer, waehrend die
 * aktive View z. B. 'inbox' ist — solche Zeilen brauchen Wiederherstellen-
 * statt der normalen destruktiven Controls. In der Trash-View selbst sind
 * alle Zeilen soft-geloescht (View-Filter), das Verhalten dort bleibt
 * identisch.
 */
export function isTrashedMessage(
  message: Pick<EmailMessage, "soft_deleted"> | null | undefined,
): boolean {
  return (message?.soft_deleted ?? 0) !== 0
}

/**
 * Draft-Ordner-Zugehoerigkeit der Zeile (statt drafts/scheduled_send-View):
 * gated im Viewer die Controls, die fuer JEDE Draft-Zeile gelten — auch fuer
 * uid >= 0-IMAP-Drafts, die isEditableDraftMessage bewusst nicht abdeckt
 * (Antworten/Weiterleiten ausblenden, IMAP-Draft-Loeschen, Spam-Buttons).
 * In den drafts/scheduled_send-Views hat per View-Filter jede Zeile
 * folder_kind 'draft', dort aendert sich nichts.
 */
export function isDraftFolderMessage(
  message: Pick<EmailMessage, "folder_kind"> | null | undefined,
): boolean {
  return message?.folder_kind === "draft"
}

/**
 * Inbox-Zugehoerigkeit der Zeile — exakt die Inbox-View-Praedikat-Semantik
 * der Store-Logik (viewFilterClause 'inbox'): nicht geloescht, folder_kind
 * inbox/NULL/leer, nicht archiviert, kein Spam (inkl. spam_status 'review',
 * das in der spam_review-View lebt). uid >= 0 entspricht dem bisherigen
 * Toggle-Gating (outbound-held- und POP3-Zeilen mit synthetischer uid
 * behalten ihr Verhalten). Gated Controls, die nur fuer Inbox-Mails gelten
 * (Erledigt-Toggle), unabhaengig von der aktiven View: Broad-Treffer aus
 * sent/archived zeigen sie nicht mehr, Inbox-Treffer aus jeder View schon.
 */
export function isInboxMessage(
  message:
    | Pick<
        EmailMessage,
        "uid" | "folder_kind" | "soft_deleted" | "archived" | "is_spam" | "spam_status"
      >
    | null
    | undefined,
): boolean {
  if (!message || message.uid < 0) return false
  if ((message.soft_deleted ?? 0) !== 0) return false
  const kind = message.folder_kind ?? ""
  if (kind !== "" && kind !== "inbox") return false
  if ((message.archived ?? 0) !== 0) return false
  if ((message.is_spam ?? 0) !== 0) return false
  return (message.spam_status ?? "clean") === "clean"
}

/**
 * Aktiver Snooze der Zeile (statt snoozed-View): ein gesnoozter Broad-
 * Treffer braucht die Unsnooze-Aktion auch ausserhalb der snoozed-View,
 * sonst laesst er sich aus dem Viewer nicht zurueckholen. Spiegelt das
 * View-Praedikat der Store-Logik (snoozed_until gesetzt und in der
 * Zukunft); clientseitiger Zeitvergleich genuegt. In der snoozed-View
 * selbst ist jede Zeile aktiv gesnoozt — Verhalten dort identisch.
 */
export function isActivelySnoozedMessage(
  message: Pick<EmailMessage, "snoozed_until"> | null | undefined,
  now: Date = new Date(),
): boolean {
  const until = message?.snoozed_until
  if (!until) return false
  const ts = new Date(until).getTime()
  return Number.isFinite(ts) && ts > now.getTime()
}

export type CannedTemplateContext = {
  accountDisplayName?: string | null
  userName?: string | null
  userEmail?: string | null
  userPublicName?: string | null
}

/** Plain-text placeholder interpolation for canned responses (customer + account + user). */
export function applyCannedTemplate(
  body: string,
  customer?: CustomerOpt | null,
  context?: CannedTemplateContext,
): string {
  const c = customer ?? undefined
  const ctx = context ?? {}
  const publicName = (ctx.userPublicName ?? "").trim() || (ctx.userName ?? "").trim()
  return body
    .replace(/\{\{customer\.name\}\}/g, c?.name ?? "")
    .replace(
      /\{\{customer\.firstName\}\}/g,
      (c?.firstName ?? "").trim() || (c?.name ?? "").split(/\s+/)[0] || "",
    )
    .replace(/\{\{customer\.email\}\}/g, c?.email ?? "")
    .replace(/\{\{account\.display_name\}\}/g, (ctx.accountDisplayName ?? "").trim())
    .replace(/\{\{user\.publicName\}\}/g, publicName)
    .replace(/\{\{user\.name\}\}/g, (ctx.userName ?? "").trim())
    .replace(/\{\{user\.email\}\}/g, (ctx.userEmail ?? "").trim())
}
