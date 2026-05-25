export type MailView = "inbox" | "sent" | "archived" | "drafts" | "spam" | "trash"

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
  /** IMAP: mark \\Seen on server when opening a message locally (POP3: ignored). */
  imap_sync_seen_on_open?: number | null
  created_at: string
  updated_at: string
}

export type TeamMember = {
  id: string
  display_name: string
  role: string
  signature_html?: string | null
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
  subject: string | null
  snippet: string | null
  date_received: string | null
  from_json: string | null
  to_json?: string | null
  cc_json?: string | null
  body_text: string | null
  body_html: string | null
  seen_local: number
  is_spam?: number
  archived?: number
  outbound_hold?: number
  outbound_block_reason?: string | null
  ticket_code?: string | null
  customer_id?: number | null
  folder_kind?: string
  assigned_to?: string | null
  has_attachments?: number
  imap_thread_id?: string | null
  attachments_json?: string | null
}

export type CategoryRow = {
  id: number
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
export type CannedResponse = { id: number; title: string; body: string }
export type AiPrompt = {
  id: number
  label: string
  user_template: string
  target?: string
  profile_id?: number | null
  sort_order?: number
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

export function applyCannedTemplate(body: string, customer?: CustomerOpt | null): string {
  const c = customer ?? undefined
  return body
    .replace(/\{\{customer\.name\}\}/g, c?.name ?? "")
    .replace(
      /\{\{customer\.firstName\}\}/g,
      (c?.firstName ?? "").trim() || (c?.name ?? "").split(/\s+/)[0] || "",
    )
    .replace(/\{\{customer\.email\}\}/g, c?.email ?? "")
}
