"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import DOMPurify from "dompurify"
import {
  blockRemoteImagesInHtml,
  htmlHasRemoteResources,
} from "@shared/email-html-remote-images"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import {
  Archive,
  Code2,
  Copy,
  Download,
  Eye,
  Forward,
  Clock,
  Languages,
  Lock,
  Printer,
  Mail,
  MailOpen,
  PanelRightClose,
  PanelRightOpen,
  Reply,
  ReplyAll,
  RotateCcw,
  CheckCircle2,
  Circle,
  ShieldAlert,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { scrollToMetadataConversationSection } from "@/lib/scroll-metadata-conversation"
import { MessageAddressesBlock } from "./message-addresses-block"
import { WorkflowRunDetailDialog } from "./workflow/workflow-run-detail-dialog"
import { getTranslationSettings } from "@/lib/translation-settings"
import {
  firstAddress,
  formatFrom,
  formatMessageFrom,
  hasLocalIpc,
  invokeIpc,
  isActivelySnoozedMessage,
  isDraftFolderMessage,
  isEditableDraftMessage,
  isInboxMessage,
  isTrashedMessage,
  needsFullMessageBody,
  stripHtmlToText,
  type CategoryRow,
  type ConversationLockRecord,
  type EmailAccount,
  type EmailMessage,
  type InternalNote,
  type MessageAttachment,
  type TeamMember,
} from "./types"
import { useMailWorkspace } from "./workspace-context"
import { MessageMetadataPanel } from "./message-metadata-panel"
import { setMailDragData } from "./mail-drag"
import { MessageAiSuggestions } from "./message-ai-suggestions"
import { EmailHtmlFrame } from "./email-html-frame"
import { formatSnoozeWakeLabel } from "@shared/snooze-datetime"
import { SnoozePopover } from "@/components/snooze/snooze-popover"
import { ApplyWorkflowMenu } from "./apply-workflow-menu"
import {
  decryptServerPgpAttachment,
  getRendererTransport,
  getServerAccessToken,
  invokeRenderer,
  verifyServerPgpAttachment,
} from "@/services/transport"
import { useAuth } from "@/components/auth/auth-context"
import { lockOwnerLabel } from "./use-conversation-locks"
import { isSafeAttachmentMimeTypeForInlineOpen } from "@shared/email-attachment-open-policy"

type Props = {
  accounts: EmailAccount[]
  teamMembers: TeamMember[]
  messageTags: string[]
  internalNotes: InternalNote[]
  messageAttachments: MessageAttachment[]
  reloadNotes: () => void | Promise<void>
  refreshCurrentMessage: () => void | Promise<void>
  refreshList: (opts?: {
    preserveSelection?: boolean
    selectMessageId?: number | null
    advanceFromRemovedId?: number
  }) => void | Promise<void>
  advanceSelectionAfterMessageRemoved: (removedId: number) => void | Promise<void>
  patchMessageInList?: (messageId: number, partial: Partial<EmailMessage>) => void
  categories: CategoryRow[]
  reloadTags: () => void | Promise<void>
  onReply: (m: EmailMessage, initialReplyHtml?: string) => void
  onReplyAll: (m: EmailMessage, initialReplyHtml?: string) => void
  onForward: (m: EmailMessage) => void
  onOpenMessage?: (m: EmailMessage) => void | Promise<void>
  /** Beta layout: Metadaten in eigener Spalte. */
  metadataPlacement?: "inline" | "external"
  remoteContentPolicyRefreshKey?: number
}

type ExportMessageEmlResult =
  | { success: true; path?: string | null; rawEml?: string | null; emlSource?: string | null }
  | { success: false; error?: string }

function downloadBlob(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = objectUrl
  link.download = fileName
  link.rel = "noopener"
  document.body.appendChild(link)
  try {
    link.click()
  } finally {
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
  }
}

function blobFromBase64(base64: string, contentType: string | null | undefined): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: contentType || "application/octet-stream" })
}

function isPgpEncryptedAttachment(att: MessageAttachment): boolean {
  const filename = att.filename_display.toLowerCase()
  const contentType = (att.content_type ?? "").toLowerCase()
  return contentType.includes("pgp-encrypted") || /\.(?:pgp|gpg)$/i.test(filename)
}

function isPgpSignatureAttachment(att: MessageAttachment): boolean {
  const filename = att.filename_display.toLowerCase()
  const contentType = (att.content_type ?? "").toLowerCase()
  return contentType.includes("pgp-signature") || /\.asc$/i.test(filename)
}

function findDetachedSignatureAttachment(
  attachments: readonly MessageAttachment[],
  target: MessageAttachment,
): MessageAttachment | undefined {
  const expected = `${target.filename_display}.asc`.toLowerCase()
  const encryptedBase = target.filename_display.replace(/\.(?:pgp|gpg)$/i, "")
  const expectedForEncryptedBase = `${encryptedBase}.asc`.toLowerCase()
  return attachments.find((att) => (
    att.id !== target.id
    && isPgpSignatureAttachment(att)
    && (
      att.filename_display.toLowerCase() === expected
      || att.filename_display.toLowerCase() === expectedForEncryptedBase
    )
  ))
}

function safeEmlFileName(message: EmailMessage): string {
  const subject = (message.subject ?? "").trim() || `message-${message.id}`
  const safeBase = subject
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
  return `${safeBase || `message-${message.id}`}.eml`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function recipientSummary(raw: string | null | undefined): string {
  if (!raw?.trim()) return ""
  try {
    const parsed = JSON.parse(raw) as { value?: { name?: string; address?: string }[] }
    return (parsed.value ?? [])
      .map((v) => {
        const name = (v.name ?? "").trim()
        const address = (v.address ?? "").trim()
        if (name && address) return `${name} <${address}>`
        return address || name
      })
      .filter(Boolean)
      .join(", ")
  } catch {
    return raw
  }
}

export function MessageViewer(props: Props) {
  const {
    accounts,
    teamMembers,
    messageTags,
    internalNotes,
    messageAttachments,
    reloadNotes,
    reloadTags,
    categories,
    refreshCurrentMessage,
    refreshList,
    advanceSelectionAfterMessageRemoved,
    patchMessageInList,
    onReply,
    onReplyAll,
    onForward,
    onOpenMessage,
    metadataPlacement = "inline",
    remoteContentPolicyRefreshKey = 0,
  } = props
  const {
    selectedMessage,
    setSelectedMessage,
    metadataPanelOpen,
    setMetadataPanelOpen,
    mailView,
    messageDoneFilter,
    setComposeIntent,
    conversationLocks,
    upsertConversationLock,
  } = useMailWorkspace()
  const { user } = useAuth()
  const rendererTransport = getRendererTransport()
  const serverClientMode = rendererTransport.kind === "http"
  const serverAttachmentBaseUrl =
    serverClientMode ? rendererTransport.serverBaseUrl ?? null : null

  const [rawHeadersOpen, setRawHeadersOpen] = useState(false)
  const [rawHeadersText, setRawHeadersText] = useState<string | null>(null)
  const [rawHeadersLoading, setRawHeadersLoading] = useState(false)
  const [translateOpen, setTranslateOpen] = useState(false)
  const [translateResult, setTranslateResult] = useState<string | null>(null)
  const [translateLoading, setTranslateLoading] = useState(false)
  const [deleteDraftOpen, setDeleteDraftOpen] = useState(false)
  // Freigabe-Banner ("Jetzt senden"/"Als Entwurf behalten"): ein Klick plant
  // einen echten Versand — Doppelklick darf keinen zweiten Aufruf auslösen.
  const [approvalBusy, setApprovalBusy] = useState(false)
  const [htmlView, setHtmlView] = useState(false)
  const [loadRemoteImages, setLoadRemoteImages] = useState(false)
  const [readReceiptRequested, setReadReceiptRequested] = useState(false)
  const [readReceiptRespond, setReadReceiptRespond] = useState<string>("never")
  const [workflowRunDetailId, setWorkflowRunDetailId] = useState<number | null>(null)
  const [workflowRunDetailOpen, setWorkflowRunDetailOpen] = useState(false)
  const [decryptedPlain, setDecryptedPlain] = useState<string | null>(null)
  const [pgpPassphrase, setPgpPassphrase] = useState("")
  const [threadAliasHint, setThreadAliasHint] = useState<string | null>(null)
  // Tracks the lazy full-body hydration so a failed/empty fetch surfaces a retry
  // affordance instead of silently showing the ~217-char snippet with no HTML
  // button. "idle" = body present or n/a; "loading" = fetch in flight;
  // "error" = fetch failed or returned no body.
  const [bodyLoadState, setBodyLoadState] = useState<"idle" | "loading" | "error">("idle")
  const [bodyRetryKey, setBodyRetryKey] = useState(0)
  const localIpcAvailable = !serverClientMode && hasLocalIpc()
  const selectedLock = selectedMessage ? conversationLocks[selectedMessage.id] : undefined
  const selectedLockOwner = selectedLock ? lockOwnerLabel(selectedLock) : ""
  const lockedByOther = Boolean(selectedLock && user?.id && selectedLock.userId !== user.id)
  const canTakeoverLock = lockedByOther && (user?.role === "owner" || user?.role === "admin")
  const hydratedBodyForIdRef = useRef<number | null>(null)

  useEffect(() => {
    if (!selectedMessage?.id) {
      hydratedBodyForIdRef.current = null
      return
    }
    if (!needsFullMessageBody(selectedMessage)) {
      hydratedBodyForIdRef.current = selectedMessage.id
      setBodyLoadState("idle")
      return
    }
    if (hydratedBodyForIdRef.current === selectedMessage.id) return
    hydratedBodyForIdRef.current = selectedMessage.id
    const messageId = selectedMessage.id
    // Guard against a stale in-flight fetch (user switched messages): only this
    // effect run may touch bodyLoadState, so a late resolve can't clear the
    // currently-selected message's error/retry state. `settled` records whether
    // this run reached a terminal state (idle/error) that updated React state.
    let cancelled = false
    let settled = false
    setBodyLoadState("loading")
    void (async () => {
      try {
        const full = await invokeRenderer(
          IPCChannels.Email.GetMessage,
          messageId,
        ) as EmailMessage | null
        if (cancelled) return
        settled = true
        if (full && !needsFullMessageBody(full)) {
          setSelectedMessage((prev) => (prev?.id === messageId ? full : prev))
          setBodyLoadState("idle")
        } else {
          // Server returned no body — surface it so the user can retry rather
          // than silently seeing only the snippet.
          setBodyLoadState("error")
        }
      } catch {
        if (cancelled) return
        settled = true
        // The fetch failed (e.g. a transient 429 from the rate limiter). Don't
        // silently fall back to the ~217-char snippet with no HTML button —
        // flag it so we render a retry affordance. The ref stays latched to
        // avoid an auto-retry loop; retryBody() clears it for a manual retry.
        setBodyLoadState("error")
      }
    })()
    return () => {
      cancelled = true
      // If this run's fetch is aborted before it settled — e.g. a
      // preserve-selection list refresh replaces `selectedMessage` with a new
      // object for the SAME id while the body is still loading — unlatch the ref
      // so the effect rerun starts a fresh hydration. Otherwise the rerun would
      // short-circuit on `ref === id` and leave the viewer stuck on
      // "Nachricht wird geladen…" with no retry affordance.
      if (!settled) hydratedBodyForIdRef.current = null
    }
  }, [selectedMessage, setSelectedMessage, bodyRetryKey])

  const retryBody = useCallback(() => {
    hydratedBodyForIdRef.current = null
    setBodyRetryKey((k) => k + 1)
  }, [])

  useEffect(() => {
    setHtmlView(false)
    setLoadRemoteImages(false)
    setReadReceiptRequested(false)
    setDecryptedPlain(null)
    setThreadAliasHint(null)
  }, [selectedMessage?.id])

  useEffect(() => {
    if (!selectedMessage?.id) return
    const messageId = selectedMessage.id
    void (async () => {
      const w = await invokeRenderer(IPCChannels.Email.ListThreadAliasWarnings)
      if (!Array.isArray(w)) return
      const hit = (w as { messageId: number }[]).find((x) => x.messageId === messageId)
      if (hit && selectedMessage?.id === messageId) {
        setThreadAliasHint(
          "Möglicherweise gleicher Thread in anderem Konto (Heuristik). Prüfen Sie Einstellungen → Threads.",
        )
      }
    })()
  }, [remoteContentPolicyRefreshKey, selectedMessage?.id])

  useEffect(() => {
    if (!selectedMessage?.id) return
    const messageId = selectedMessage.id
    void (async () => {
      try {
        const policy = await invokeRenderer(IPCChannels.Email.GetRemoteContentPolicy, {
          messageId,
        })
        if (policy && typeof policy === "object" && "allowRemote" in policy) {
          setLoadRemoteImages((prev) => {
            if (selectedMessage?.id !== messageId) return prev
            return Boolean((policy as { allowRemote: boolean }).allowRemote)
          })
        }
        const rr = await invokeRenderer(IPCChannels.Email.GetReadReceiptState, { messageId })
        if (rr && typeof rr === "object" && "success" in rr && (rr as { success: boolean }).success) {
          const s = rr as unknown as { requested: boolean; respond: string }
          if (selectedMessage?.id !== messageId) return
          setReadReceiptRequested(Boolean(s.requested))
          setReadReceiptRespond(s.respond)
        }
      } catch {
        /* ignore */
      }
    })()
  }, [selectedMessage?.id])

  const sanitizedHtml = useMemo(() => {
    if (!selectedMessage?.body_html) return ""
    // Neutralize anchors so a click cannot navigate the sandboxed iframe's own
    // browsing context (an empty `sandbox` still lets `<a href>` navigate). Links
    // render as inert styled text; this pairs with the frame's `navigate-to 'none'`
    // CSP as defense-in-depth.
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if (node.tagName === "A") {
        node.removeAttribute("href")
        node.removeAttribute("target")
      }
    })
    // try/finally so a sanitize throw can't leak the global hook into every
    // subsequent DOMPurify.sanitize call process-wide (which would strip href
    // from all later renders).
    let clean = ""
    try {
      clean = DOMPurify.sanitize(selectedMessage.body_html, {
        USE_PROFILES: { html: true },
        FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "link"],
        FORBID_ATTR: [
          "onerror",
          "onload",
          "onclick",
          "onmouseover",
          "onfocus",
          "onblur",
          "onchange",
          "onsubmit",
        ],
      })
    } finally {
      DOMPurify.removeHook("afterSanitizeAttributes")
    }
    return loadRemoteImages ? clean : blockRemoteImagesInHtml(clean)
  }, [selectedMessage?.body_html, loadRemoteImages])

  const htmlHasRemoteImages = useMemo(
    () => htmlHasRemoteResources(selectedMessage?.body_html ?? ""),
    [selectedMessage?.body_html],
  )

  const omittedAttachments = (() => {
    const raw = selectedMessage?.attachments_json
    if (!raw) return [] as { name: string; size: number; reason: string }[]
    try {
      const parsed = JSON.parse(raw) as {
        omitted?: { name: string; size: number; reason: string }[]
      }
      return Array.isArray(parsed.omitted) ? parsed.omitted : []
    } catch {
      return []
    }
  })()

  const fetchServerAttachmentBlob = async (att: MessageAttachment): Promise<Blob> => {
    if (!serverAttachmentBaseUrl) throw new Error("Server-Anhang nicht verfuegbar")
    const url = new URL(
      `/api/v1/email/attachments/${att.id}/content`,
      serverAttachmentBaseUrl,
    )
    const token = getServerAccessToken(undefined, undefined, serverAttachmentBaseUrl)
    const response = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
    if (!response.ok) {
      throw new Error(`Download fehlgeschlagen (${response.status})`)
    }
    return response.blob()
  }

  const downloadServerAttachment = async (att: MessageAttachment) => {
    const blob = await fetchServerAttachmentBlob(att)
    downloadBlob(blob, att.filename_display || `attachment-${att.id}`)
  }

  const openServerAttachment = async (att: MessageAttachment) => {
    const blob = await fetchServerAttachmentBlob(att)
    if (!isSafeAttachmentMimeTypeForInlineOpen(blob.type || att.content_type)) {
      downloadBlob(blob, att.filename_display || `attachment-${att.id}`)
      toast.info("Dieser Dateityp wird aus Sicherheitsgründen heruntergeladen statt im Browser geöffnet.")
      return
    }
    const objectUrl = URL.createObjectURL(blob)
    const opened = window.open(objectUrl, "simplecrm-mail-attachment-preview")
    if (!opened) {
      URL.revokeObjectURL(objectUrl)
      throw new Error("Anhang konnte nicht geoeffnet werden. Popup-Blocker pruefen.")
    }
    opened.opener = null
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
  }

  const decryptPgpAttachment = async (att: MessageAttachment) => {
    if (!pgpPassphrase) {
      toast.info("PGP-Passphrase erforderlich")
      return
    }
    const result = await decryptServerPgpAttachment({
      attachmentId: att.id,
      passphrase: pgpPassphrase,
    })
    downloadBlob(
      blobFromBase64(result.contentBase64, result.contentType),
      result.filename || att.filename_display.replace(/\.(?:pgp|gpg|asc)$/i, "") || `attachment-${att.id}`,
    )
    toast.success("PGP-Anhang entschluesselt")
  }

  const verifyPgpAttachmentSignature = async (att: MessageAttachment, signature: MessageAttachment) => {
    const result = await verifyServerPgpAttachment({
      attachmentId: att.id,
      signatureAttachmentId: signature.id,
    })
    if (result.valid) {
      toast.success(result.fingerprint
        ? `Signatur gueltig: ${result.fingerprint.slice(0, 16)}...`
        : "Signatur gueltig")
      return
    }
    toast.warning(`Signatur nicht gueltig: ${result.status}`)
  }

  const exportMessageEml = async () => {
    if (!selectedMessage) return
    const result = await invokeRenderer(
      IPCChannels.Email.ExportMessageEml,
      selectedMessage.id,
    ) as ExportMessageEmlResult
    if (!result.success) {
      if (result.error && result.error !== "Abgebrochen") toast.error(result.error)
      return
    }
    if (result.path) {
      toast.success(`Gespeichert: ${result.path}`)
      return
    }
    if (result.rawEml) {
      downloadBlob(
        new Blob([result.rawEml], { type: "message/rfc822;charset=utf-8" }),
        safeEmlFileName(selectedMessage),
      )
      toast.success("EML heruntergeladen.")
      return
    }
    toast.error("EML-Export lieferte keine Rohdaten.")
  }

  const isOutboundHeld =
    selectedMessage != null &&
    selectedMessage.uid < 0 &&
    (selectedMessage.outbound_hold ?? 0) > 0
  // Neutraler Zustand (kein Fehler): Die Gegenlese-KI hat den KI-Entwurf zur
  // menschlichen Freigabe vorgelegt (gesetzt vom Workflow-Knoten ai.review_draft).
  // Message-basiert wie die übrigen Controls — Freigabe-Entwürfe erscheinen
  // auch in der Inbox-View und in der Broad-Suche.
  const isAwaitingApproval =
    selectedMessage != null &&
    selectedMessage.uid < 0 &&
    selectedMessage.approval_state === "pending"
  // Message-basiert statt view-basiert: Drafts aus der Broad-Suche (Treffer
  // ausserhalb der drafts/scheduled_send-Views) sind sonst nicht editierbar.
  const isDraft = isEditableDraftMessage(selectedMessage)

  // Message-basiert statt view-basiert: soft-geloeschte Treffer der Broad-
  // Suche ("Papierkorb einbeziehen") brauchen Wiederherstellen- statt der
  // normalen destruktiven Controls; in der Trash-View selbst ist jede Zeile
  // soft-geloescht, dort aendert sich nichts.
  const inTrash = isTrashedMessage(selectedMessage)
  // Message-basiert statt view-basiert: Draft-Zeilen aus der Broad-Suche
  // (auch uid >= 0-IMAP-Drafts) verhalten sich wie in der Drafts-View —
  // keine Antworten-/Spam-Controls, dafuer der IMAP-Draft-Loeschen-Button.
  const inDraftFolder = isDraftFolderMessage(selectedMessage)
  const inSnoozed = mailView === "snoozed"
  // Message-basiert statt view-basiert: aktiv gesnoozte Broad-Treffer
  // brauchen Unsnooze/"Snooze ändern" auch ausserhalb der snoozed-View.
  const isSnoozedRow = isActivelySnoozedMessage(selectedMessage)

  const handleSnoozeMessage = async (until: string | null) => {
    if (!selectedMessage) return
    await invokeRenderer(IPCChannels.Email.SnoozeMessage, {
      messageId: selectedMessage.id,
      until,
    })
    if (until) {
      toast.success(`Zurückgestellt bis ${formatSnoozeWakeLabel(until)}`)
    } else {
      toast.success("Wieder im Posteingang")
    }
    // Bewusst view-basiert (nicht zeilenbasiert): entscheidet nur, ob nach
    // dem Snooze/Unsnooze die Auswahl weiterspringt oder die Liste
    // refresht — fuer Broad-Suche-Treffer schlimmstenfalls ein Refresh
    // statt Weiterspringen; rein kosmetisch.
    const leavesCurrentView =
      (until != null && mailView === "inbox") || (until == null && inSnoozed)
    if (leavesCurrentView) {
      await advanceSelectionAfterMessageRemoved(selectedMessage.id)
    } else {
      await refreshList({ preserveSelection: true })
      await refreshCurrentMessage()
    }
  }

  if (!selectedMessage) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-muted/10 text-center">
        <Mail className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">Wählen Sie eine Nachricht.</p>
      </div>
    )
  }

  const handleSoftDelete = async () => {
    await invokeRenderer(IPCChannels.Email.SoftDeleteMessage, selectedMessage.id)
    toast.success("In den Papierkorb verschoben")
    await advanceSelectionAfterMessageRemoved(selectedMessage.id)
  }

  const handleDeleteLocalDraft = async () => {
    const r = await invokeRenderer(
      IPCChannels.Email.DeleteComposeDraft,
      selectedMessage.id,
    ) as { success: boolean; error?: string }
    if (!r.success) {
      toast.error(r.error ?? "Entwurf konnte nicht gelöscht werden")
      return
    }
    toast.success("Entwurf endgültig gelöscht")
    setDeleteDraftOpen(false)
    await advanceSelectionAfterMessageRemoved(selectedMessage.id)
  }

  const handleRestore = async () => {
    await invokeRenderer(IPCChannels.Email.RestoreMessage, selectedMessage.id)
    toast.success("Wiederhergestellt (vorheriger Ordner)")
    await refreshCurrentMessage()
    await refreshList({ preserveSelection: true })
  }

  const handleApproveDraftSend = async () => {
    if (approvalBusy) return
    setApprovalBusy(true)
    try {
      const result = await invokeRenderer(IPCChannels.Email.ApproveDraftSend, {
        draftId: selectedMessage.id,
      }) as { success: boolean; error?: string }
      if (!result.success) {
        toast.error(result.error ?? "Freigabe fehlgeschlagen.")
        return
      }
      toast.success("Freigegeben — Antwort wird gesendet.")
      await refreshCurrentMessage()
      await refreshList({ preserveSelection: true })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Freigabe fehlgeschlagen.")
    } finally {
      setApprovalBusy(false)
    }
  }

  const handleDismissDraftApproval = async () => {
    if (approvalBusy) return
    setApprovalBusy(true)
    try {
      const result = await invokeRenderer(IPCChannels.Email.DismissDraftApproval, {
        draftId: selectedMessage.id,
      }) as { success: boolean; error?: string }
      if (!result.success) {
        toast.error(result.error ?? "Aktion fehlgeschlagen.")
        return
      }
      toast.success("Als Entwurf behalten.")
      await refreshCurrentMessage()
      await refreshList({ preserveSelection: true })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Aktion fehlgeschlagen.")
    } finally {
      setApprovalBusy(false)
    }
  }

  const handleArchive = async () => {
    const wasArchived = !!selectedMessage.archived
    await invokeRenderer(IPCChannels.Email.SetMessageArchived, {
      messageId: selectedMessage.id,
      archived: !wasArchived,
    })
    toast.success(wasArchived ? "Wieder im Posteingang sichtbar" : "Archiviert")
    if (!wasArchived) {
      await advanceSelectionAfterMessageRemoved(selectedMessage.id)
    } else {
      await refreshCurrentMessage()
      await refreshList({ preserveSelection: true })
    }
  }

  const handleToggleSeen = async () => {
    const seen = !!selectedMessage.seen_local
    await invokeRenderer(IPCChannels.Email.SetMessageSeen, {
      messageId: selectedMessage.id,
      seen: !seen,
    })
    toast.success(seen ? "Als ungelesen markiert" : "Als gelesen markiert")
    patchMessageInList?.(selectedMessage.id, { seen_local: seen ? 0 : 1 })
  }

  const handleToggleDone = async () => {
    const done = !!selectedMessage.done_local
    await invokeRenderer(IPCChannels.Email.SetMessageDone, {
      messageId: selectedMessage.id,
      done: !done,
    })
    toast.success(done ? "Wieder als offen markiert" : "Als erledigt markiert")
    const hideFromOpenInbox = !done && mailView === "inbox" && messageDoneFilter === "open"
    if (hideFromOpenInbox) {
      await advanceSelectionAfterMessageRemoved(selectedMessage.id)
    } else {
      patchMessageInList?.(selectedMessage.id, { done_local: done ? 0 : 1 })
    }
  }

  const handleSetSpamStatus = async (status: "clean" | "review" | "spam") => {
    try {
      const result = await invokeRenderer(
        IPCChannels.Email.SetMessageSpamStatus,
        {
          messageId: selectedMessage.id,
          status,
          train: true,
        },
      ) as { success: boolean; error?: string }
      if (!result.success) {
        toast.error(result.error ?? "Spam-Status konnte nicht gesetzt werden.")
        return
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Spam-Status konnte nicht gesetzt werden.")
      return
    }
    const label =
      status === "spam" ? "Als Spam markiert" : status === "review" ? "Zur Prüfung markiert" : "Kein Spam mehr"
    toast.success(label)
    const targetView =
      status === "spam" ? "spam" : status === "review" ? "spam_review" : "inbox"
    if (targetView !== mailView) {
      await advanceSelectionAfterMessageRemoved(selectedMessage.id)
    } else {
      patchMessageInList?.(selectedMessage.id, {
        spam_status: status,
      } as Partial<EmailMessage>)
    }
  }

  // Text-only rendering — prefer the richer source (blocked compose drafts often store
  // only the warning banner in body_text while the letter lives in body_html).
  const handleTakeoverConversationLock = async () => {
    try {
      const result = await invokeRenderer(IPCChannels.Email.TakeoverConversationLock, {
        messageId: selectedMessage.id,
        reason: "reply",
      }) as { lock?: ConversationLockRecord }
      if (result.lock) upsertConversationLock(result.lock)
      toast.success("Conversation Lock uebernommen.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Conversation Lock konnte nicht uebernommen werden.")
    }
  }

  const bodyFromText = selectedMessage.body_text?.trim() ?? ""
  const bodyFromHtml = selectedMessage.body_html
    ? stripHtmlToText(selectedMessage.body_html)
    : ""
  const bodyText =
    bodyFromHtml.length > bodyFromText.length + 30
      ? bodyFromHtml
      : bodyFromText || bodyFromHtml || selectedMessage.snippet || "—"

  const handlePrintMessageOnly = () => {
    const bodyMarkup =
      htmlView && selectedMessage.body_html
        ? blockRemoteImagesInHtml(sanitizedHtml)
        : `<pre>${escapeHtml(decryptedPlain ?? bodyText)}</pre>`
    const metaRows = [
      ["Von", formatMessageFrom(selectedMessage, accounts)],
      ["An", recipientSummary(selectedMessage.to_json)],
      ["CC", recipientSummary(selectedMessage.cc_json)],
      ["BCC", recipientSummary(selectedMessage.bcc_json)],
      [
        "Datum",
        selectedMessage.date_received
          ? new Date(selectedMessage.date_received).toLocaleString("de-DE")
          : "—",
      ],
    ].filter(([, value]) => value)

    const printWindow = window.open("", "simplecrm-mail-print", "width=900,height=700")
    if (!printWindow) {
      toast.error("Druckfenster konnte nicht geöffnet werden.")
      return
    }
    printWindow.document.write(`<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline';" />
  <title>${escapeHtml(selectedMessage.subject || "E-Mail")}</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 32px; color: #111827; }
    h1 { font-size: 20px; margin: 0 0 16px; }
    .meta { border: 1px solid #d1d5db; border-radius: 8px; padding: 12px; margin-bottom: 20px; font-size: 12px; }
    .row { display: grid; grid-template-columns: 72px 1fr; gap: 12px; margin: 4px 0; }
    .label { color: #6b7280; font-weight: 600; }
    .value { overflow-wrap: anywhere; }
    .body { font-size: 14px; line-height: 1.55; }
    pre { white-space: pre-wrap; font-family: inherit; }
    img { max-width: 100%; }
    a { color: #1d4ed8; }
  </style>
</head>
<body>
  <h1>${escapeHtml(selectedMessage.subject || "(Ohne Betreff)")}</h1>
  <div class="meta">
    ${metaRows.map(([label, value]) => `<div class="row"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>`).join("")}
  </div>
  <main class="body">${bodyMarkup}</main>
</body>
</html>`)
    printWindow.document.close()
    printWindow.focus()
    printWindow.setTimeout(() => {
      printWindow.print()
    }, 100)
  }

  const isSignedPgpMessage =
    selectedMessage.pgp_status?.startsWith("signed_") ||
    bodyText.startsWith("-----BEGIN PGP SIGNED MESSAGE-----")
  const isSyncableMail = selectedMessage.uid >= 0 || Boolean(selectedMessage.pop3_uidl)
  const hasServerPgpEncryptedAttachment =
    serverClientMode && messageAttachments.some(isPgpEncryptedAttachment)

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex h-full min-h-0 flex-col">
        {/* Actions toolbar */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-b bg-background/95 px-4 py-2">
          <div className="flex items-center gap-1">
            {inTrash ? (
              <Button
                type="button"
                size="sm"
                variant="default"
                onClick={() => void handleRestore()}
                className="gap-2"
              >
                <RotateCcw className="h-4 w-4" />
                Wiederherstellen
              </Button>
            ) : null}
            {isDraft ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  className="gap-2"
                  onClick={() =>
                    setComposeIntent({ mode: "draft", messageId: selectedMessage.id })
                  }
                >
                  Bearbeiten
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  className="gap-2"
                  onClick={() => setDeleteDraftOpen(true)}
                >
                  <Trash2 className="h-4 w-4" />
                  Entwurf löschen
                </Button>
                <ApplyWorkflowMenu
                  message={selectedMessage}
                  onApplied={async () => {
                    await refreshCurrentMessage()
                    await refreshList({ preserveSelection: true })
                    await reloadTags()
                  }}
                />
              </>
            ) : null}
            {inDraftFolder && !inTrash && selectedMessage.uid >= 0 ? (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                className="gap-2"
                onClick={() => void handleSoftDelete()}
              >
                <Trash2 className="h-4 w-4" />
                Löschen
              </Button>
            ) : null}
            {selectedMessage.uid >= 0 && !inTrash && !inDraftFolder ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={lockedByOther}
                  title={lockedByOther ? `Gesperrt durch ${selectedLockOwner}` : undefined}
                  onClick={() => onReply(selectedMessage)}
                  className="gap-2 bg-sky-500/12 text-sky-900 hover:bg-sky-500/20 dark:text-sky-100"
                >
                  <Reply className="h-4 w-4" />
                  Antworten
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={lockedByOther}
                  title={lockedByOther ? `Gesperrt durch ${selectedLockOwner}` : undefined}
                  onClick={() => onReplyAll(selectedMessage)}
                  className="gap-2 bg-sky-500/8 text-sky-800 hover:bg-sky-500/16 dark:text-sky-200"
                >
                  <ReplyAll className="h-4 w-4" />
                  Allen antworten
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={lockedByOther}
                  title={lockedByOther ? `Gesperrt durch ${selectedLockOwner}` : undefined}
                  onClick={() => onForward(selectedMessage)}
                  className="gap-2 bg-indigo-500/12 text-indigo-900 hover:bg-indigo-500/20 dark:text-indigo-100"
                >
                  <Forward className="h-4 w-4" />
                  Weiterleiten
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={translateLoading}
                  title={`Markierten Text (oder die ganze Nachricht) nach ${getTranslationSettings().localLanguage} übersetzen`}
                  onClick={() => {
                    void (async () => {
                      const sel =
                        typeof window !== "undefined"
                          ? window.getSelection()?.toString().trim() ?? ""
                          : ""
                      const source = sel || (selectedMessage.body_text ?? "").trim()
                      if (!source) {
                        toast.error("Kein Text zum Übersetzen.")
                        return
                      }
                      setTranslateResult(null)
                      setTranslateLoading(true)
                      setTranslateOpen(true)
                      try {
                        const r = (await invokeRenderer(IPCChannels.Email.AiTransformText, {
                          text: source.slice(0, 12000),
                          targetLanguage: getTranslationSettings().localLanguage,
                        })) as { success: boolean; text?: string; error?: string }
                        if (r.success && r.text?.trim()) {
                          setTranslateResult(r.text.trim())
                        } else {
                          setTranslateOpen(false)
                          toast.error(
                            r.error ??
                              "Übersetzung fehlgeschlagen. Prüfen Sie Einstellungen → E-Mail → KI (API-Schlüssel).",
                          )
                        }
                      } catch (e) {
                        setTranslateOpen(false)
                        toast.error(e instanceof Error ? e.message : "Übersetzung fehlgeschlagen")
                      } finally {
                        setTranslateLoading(false)
                      }
                    })()
                  }}
                  className="gap-2 bg-teal-500/12 text-teal-900 hover:bg-teal-500/20 dark:text-teal-100"
                >
                  <Languages className="h-4 w-4" />
                  Übersetzen
                </Button>
                <ApplyWorkflowMenu
                  message={selectedMessage}
                  onApplied={async () => {
                    await refreshCurrentMessage()
                    await refreshList({ preserveSelection: true })
                    await reloadTags()
                  }}
                />
                <div className="mx-1 h-6 w-px bg-border" />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="gap-1.5 bg-slate-500/10 text-slate-800 hover:bg-slate-500/18 dark:text-slate-200"
                  onClick={() => void handleToggleSeen()}
                >
                  {selectedMessage.seen_local ? (
                    <Mail className="h-4 w-4" />
                  ) : (
                    <MailOpen className="h-4 w-4" />
                  )}
                  <span className="hidden lg:inline">
                    {selectedMessage.seen_local ? "Ungelesen" : "Gelesen"}
                  </span>
                </Button>
                {isInboxMessage(selectedMessage) ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className={cn(
                      "gap-1.5",
                      selectedMessage.done_local
                        ? "bg-emerald-500/12 text-emerald-900 hover:bg-emerald-500/20 dark:text-emerald-100"
                        : "bg-amber-500/10 text-amber-950 hover:bg-amber-500/18 dark:text-amber-100",
                    )}
                    onClick={() => void handleToggleDone()}
                  >
                    {selectedMessage.done_local ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <Circle className="h-4 w-4" />
                    )}
                    <span className="hidden lg:inline">
                      {selectedMessage.done_local ? "Wieder offen" : "Erledigt"}
                    </span>
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="gap-1.5 bg-amber-500/12 text-amber-900 hover:bg-amber-500/20 dark:text-amber-100"
                  onClick={() => void handleArchive()}
                >
                  <Archive className="h-4 w-4" />
                  <span className="hidden lg:inline">
                    {selectedMessage.archived ? "Aus Archiv" : "Archiv"}
                  </span>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="gap-1.5 bg-violet-500/10 text-violet-900 hover:bg-violet-500/18 dark:text-violet-100"
                  onClick={() => {
                    setRawHeadersOpen(true)
                    setRawHeadersLoading(true)
                    setRawHeadersText(null)
                    void (invokeRenderer(IPCChannels.Email.GetMessageRawHeaders, selectedMessage.id) as Promise<{
                      success: boolean
                      rawEml?: string
                      emlSource?: "original" | "reconstructed"
                      error?: string
                    }>)
                      .then((r) => {
                        const result = r as {
                          success: boolean
                          rawEml?: string
                          emlSource?: "original" | "reconstructed"
                          error?: string
                        }
                        if (!result.success) {
                          toast.error(result.error ?? "Rohdaten konnten nicht geladen werden.")
                          return
                        }
                        setRawHeadersText(r.rawEml ?? "—")
                      })
                      .catch(() => toast.error("Rohdaten konnten nicht geladen werden."))
                      .finally(() => setRawHeadersLoading(false))
                  }}
                >
                  <Code2 className="h-4 w-4" />
                  <span className="hidden lg:inline">Rohdaten</span>
                </Button>
              </>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {isSyncableMail && !inTrash && !inDraftFolder && !isDraft ? (
              <>
                {selectedMessage.spam_status === "review" || selectedMessage.spam_status === "spam" || selectedMessage.is_spam ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="gap-1.5 bg-emerald-500/12 text-emerald-900 hover:bg-emerald-500/20 dark:text-emerald-100"
                    onClick={() => void handleSetSpamStatus("clean")}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    <span className="hidden lg:inline">Kein Spam</span>
                  </Button>
                ) : null}
                {selectedMessage.spam_status !== "spam" && !selectedMessage.is_spam ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="gap-1.5 bg-orange-500/12 text-orange-900 hover:bg-orange-500/20 dark:text-orange-100"
                    onClick={() => void handleSetSpamStatus("spam")}
                  >
                    <ShieldAlert className="h-4 w-4" />
                    <span className="hidden lg:inline">Spam</span>
                  </Button>
                ) : null}
              </>
            ) : null}
            {selectedMessage.uid >= 0 && !inTrash && !isDraft ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="gap-1.5 bg-red-500/10 text-red-800 hover:bg-red-500/18 dark:text-red-200"
                onClick={() => void handleSoftDelete()}
              >
                <Trash2 className="h-4 w-4" />
                <span className="hidden lg:inline">Papierkorb</span>
              </Button>
            ) : null}
            {metadataPlacement === "inline" ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => setMetadataPanelOpen(!metadataPanelOpen)}
                  >
                    {metadataPanelOpen ? (
                      <PanelRightClose className="h-4 w-4" />
                    ) : (
                      <PanelRightOpen className="h-4 w-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {metadataPanelOpen ? "Details ausblenden" : "Details einblenden"}
                </TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        </div>

        {selectedLock ? (
          <div
            className={cn(
              "flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2 text-sm",
              lockedByOther
                ? "border-amber-500/30 bg-amber-500/10 text-amber-950 dark:text-amber-100"
                : "border-emerald-500/25 bg-emerald-500/10 text-emerald-950 dark:text-emerald-100",
            )}
            role={lockedByOther ? "alert" : "status"}
          >
            <div className="flex min-w-0 items-center gap-2">
              <Lock className="h-4 w-4 shrink-0" />
              <span className="min-w-0 truncate">
                {lockedByOther
                  ? `Bearbeitung gesperrt durch ${selectedLockOwner}.`
                  : "Sie bearbeiten diese Nachricht."}
              </span>
            </div>
            {canTakeoverLock ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 shrink-0 gap-1.5 text-xs"
                onClick={() => void handleTakeoverConversationLock()}
              >
                <ShieldAlert className="h-3.5 w-3.5" />
                Uebernehmen
              </Button>
            ) : null}
          </div>
        ) : null}

        {/* Body + metadata split */}
        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 flex-1 flex-col">
            <ScrollArea className="flex-1">
              <div className="w-full space-y-4 px-4 py-4 sm:px-6">
                <div className="space-y-1">
                  <h2
                    className={cn(
                      "text-xl font-semibold leading-tight tracking-tight",
                      selectedMessage.uid >= 0 && "cursor-grab active:cursor-grabbing",
                    )}
                    draggable={selectedMessage.uid >= 0}
                    onDragStart={(e) => {
                      if (selectedMessage.uid < 0) return
                      setMailDragData(e.dataTransfer, selectedMessage.id)
                    }}
                    title={
                      selectedMessage.uid >= 0
                        ? "In einen Ordner in der Seitenleiste ziehen"
                        : undefined
                    }
                  >
                    {selectedMessage.subject || "(Ohne Betreff)"}
                  </h2>
                  {isOutboundHeld ? (
                    <div
                      role="alert"
                      className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200"
                    >
                      <p className="font-semibold">Ausgangsprüfung — Versand blockiert</p>
                      <p className="mt-1 text-[13px] leading-snug">
                        {selectedMessage.outbound_block_reason ||
                          "Die E-Mail entspricht nicht den Prüfkriterien. Bitte korrigieren und erneut senden."}
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="mt-2 h-7 text-xs"
                        onClick={() => {
                          void (async () => {
                            try {
                              const run = await invokeRenderer(IPCChannels.Email.GetLatestWorkflowRunForMessage, {
                                messageId: selectedMessage.id,
                              }) as {
                                id: number
                              } | null
                              if (run?.id) {
                                setWorkflowRunDetailId(run.id)
                                setWorkflowRunDetailOpen(true)
                              } else {
                                toast.info("Kein Workflow-Lauf für diese Nachricht gefunden.")
                              }
                            } catch {
                              toast.error("Workflow-Details konnten nicht geladen werden.")
                            }
                          })()
                        }}
                      >
                        Workflow-Details ansehen
                      </Button>
                    </div>
                  ) : null}
                  {isAwaitingApproval ? (
                    <div
                      role="status"
                      className="rounded-md border border-sky-500/50 bg-sky-500/10 px-3 py-2 text-sm text-sky-900 dark:text-sky-200"
                    >
                      <p className="font-semibold">Wartet auf Freigabe</p>
                      <p className="mt-1 text-[13px] leading-snug">
                        {selectedMessage.approval_reason ||
                          "Die Gegenlese-KI empfiehlt eine menschliche Prüfung."}{" "}
                        Diese Antwort wurde von der KI entworfen und gegengelesen.
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          className="h-7 text-xs"
                          disabled={approvalBusy}
                          onClick={() => void handleApproveDraftSend()}
                        >
                          {approvalBusy ? "Wird verarbeitet …" : "Jetzt senden"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          disabled={approvalBusy}
                          onClick={() => void handleDismissDraftApproval()}
                        >
                          Als Entwurf behalten
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  {selectedMessage.archived ? (
                    <span className="inline-block rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase text-amber-700 dark:text-amber-400">
                      Archiviert
                    </span>
                  ) : null}
                  {selectedMessage.spam_status === "review" ? (
                    <span className="ml-1 inline-block rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase text-amber-700 dark:text-amber-400">
                      Spam prüfen
                    </span>
                  ) : null}
                  {selectedMessage.is_spam || selectedMessage.spam_status === "spam" ? (
                    <span className="ml-1 inline-block rounded bg-red-500/10 px-2 py-0.5 text-[10px] font-medium uppercase text-red-700 dark:text-red-400">
                      Spam
                    </span>
                  ) : null}
                </div>

                <MessageAiSuggestions
                  message={selectedMessage}
                  messageTags={messageTags}
                  onDraftReply={(opts) =>
                    onReply(selectedMessage, opts?.initialReplyHtml)
                  }
                  onTagsChanged={reloadTags}
                />

                <div className="flex flex-wrap gap-2">
                  {selectedMessage.body_html ? (
                    <Button
                      type="button"
                      size="sm"
                      variant={htmlView ? "secondary" : "outline"}
                      className="h-8 gap-1.5 text-xs"
                      onClick={() => {
                        setHtmlView((v) => {
                          if (v) setLoadRemoteImages(false)
                          return !v
                        })
                      }}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      {htmlView ? "Klartext" : "HTML anzeigen"}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5 text-xs"
                    onClick={handlePrintMessageOnly}
                  >
                    <Printer className="h-3.5 w-3.5" />
                    Drucken
                  </Button>
                  {selectedMessage.uid >= 0 ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 text-xs"
                        onClick={() => {
                          void exportMessageEml().catch((e) => {
                            toast.error(e instanceof Error ? e.message : "EML-Export fehlgeschlagen.")
                          })
                        }}
                        disabled={!localIpcAvailable && !serverAttachmentBaseUrl}
                      >
                        <Download className="h-3.5 w-3.5" />
                        Als .eml
                      </Button>
                      <SnoozePopover
                        showUnsnooze={isSnoozedRow}
                        onUnsnooze={() => void handleSnoozeMessage(null)}
                        onSnooze={(until) => void handleSnoozeMessage(until)}
                      >
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1.5 text-xs"
                        >
                          <Clock className="h-3.5 w-3.5" />
                          {isSnoozedRow ? "Snooze ändern" : "Zurückstellen"}
                        </Button>
                      </SnoozePopover>
                    </>
                  ) : null}
                </div>

                <MessageAddressesBlock
                  message={selectedMessage}
                  accounts={accounts}
                  onShowCorrespondentHistory={() => {
                    if (metadataPlacement === "inline" && !metadataPanelOpen) {
                      setMetadataPanelOpen(true)
                    }
                    window.setTimeout(() => {
                      if (!scrollToMetadataConversationSection()) {
                        toast.info(
                          "Verlauf im Detailpanel rechts — Abschnitt „Alle Mails mit …“.",
                        )
                      }
                    }, metadataPlacement === "inline" && !metadataPanelOpen ? 120 : 0)
                  }}
                />

                {selectedMessage.pgp_status === "encrypted_unread" ||
                bodyText.startsWith("-----BEGIN PGP MESSAGE-----") ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
                    <span>Verschlüsselte PGP-Nachricht.</span>
                    <Input
                      type="password"
                      placeholder="PGP-Passphrase"
                      className="h-7 max-w-[180px] text-xs"
                      value={pgpPassphrase}
                      onChange={(e) => setPgpPassphrase(e.target.value)}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={async () => {
                        if (!selectedMessage || !pgpPassphrase) return
                        const pass = pgpPassphrase
                        try {
                          const res = await invokeRenderer(IPCChannels.Pgp.DecryptMessage, {
                            messageId: selectedMessage.id,
                            passphrase: pass,
                          })
                          if (res && typeof res === "object" && "text" in res) {
                            setDecryptedPlain(String((res as { text: string }).text))
                            toast.success("Entschlüsselt (nur in dieser Ansicht, nicht gespeichert)")
                          }
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Entschlüsselung fehlgeschlagen")
                        }
                      }}
                    >
                      Entschlüsseln
                    </Button>
                  </div>
                ) : null}
                {isSignedPgpMessage ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-md border border-muted px-3 py-2 text-xs text-muted-foreground">
                    <ShieldAlert className="h-3.5 w-3.5" />
                    <span>PGP-Signatur</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={async () => {
                        if (!selectedMessage) return
                        try {
                          const res = await invokeRenderer(IPCChannels.Pgp.VerifyMessage, {
                            messageId: selectedMessage.id,
                          })
                          const status = res && typeof res === "object" && "status" in res
                            ? String((res as { status?: string }).status ?? "")
                            : ""
                          toast.success(status ? `Signatur geprueft: ${status}` : "Signatur geprueft")
                          await refreshCurrentMessage()
                          await refreshList({ preserveSelection: true })
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Signaturpruefung fehlgeschlagen")
                        }
                      }}
                    >
                      Pruefen
                    </Button>
                  </div>
                ) : null}
                {selectedMessage.pgp_status?.startsWith("signed_") ? (
                  <p className="rounded-md border border-muted px-3 py-2 text-xs text-muted-foreground">
                    PGP-Signatur: {selectedMessage.pgp_status.replace("signed_", "")}
                    {selectedMessage.pgp_signer_fingerprint
                      ? ` (${selectedMessage.pgp_signer_fingerprint.slice(0, 16)}…)`
                      : ""}
                  </p>
                ) : null}

                <Separator />

                {htmlView && selectedMessage.body_html ? (
                  <div className="space-y-2">
                    <p className="text-[10px] text-muted-foreground">
                      HTML-Ansicht: Wird isoliert in einer Sandbox (iframe) ohne Skripte,
                      Formulare oder aktive Links angezeigt. Externe Bilder werden nur nach
                      explizitem Laden angezeigt.
                    </p>
                    {htmlHasRemoteImages && !loadRemoteImages ? (
                      <div className="flex flex-wrap items-center gap-2 rounded-md border border-muted bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                        <span>Remote-Inhalte sind blockiert (Datenschutz).</span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => setLoadRemoteImages(true)}
                        >
                          Einmal laden
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={async () => {
                            if (!selectedMessage) return
                            await invokeRenderer(IPCChannels.Email.SetRemoteContentPolicy, {
                              messageId: selectedMessage.id,
                              policy: "allowed_sender",
                              rememberSender: true,
                            })
                            setLoadRemoteImages(true)
                          }}
                        >
                          Absender erlauben
                        </Button>
                      </div>
                    ) : null}
                    {threadAliasHint ? (
                      <p className="rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs">
                        {threadAliasHint}
                      </p>
                    ) : null}
                    {readReceiptRequested && readReceiptRespond === "ask" ? (
                      <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
                        <span>Absender bittet um Lesebestätigung.</span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={async () => {
                            if (!selectedMessage) return
                            try {
                              const r = await invokeRenderer(IPCChannels.Email.RespondReadReceipt, {
                                messageId: selectedMessage.id,
                                action: "send",
                              }) as { success?: boolean; error?: string }
                              if (r?.success) {
                                toast.success("Lesebestätigung gesendet")
                                setReadReceiptRequested(false)
                              } else {
                                toast.error(r?.error ?? "MDN konnte nicht gesendet werden")
                              }
                            } catch (error) {
                              toast.error(error instanceof Error ? error.message : "MDN konnte nicht gesendet werden")
                            }
                          }}
                        >
                          Bestätigen senden
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={async () => {
                            if (!selectedMessage) return
                            try {
                              const r = await invokeRenderer(IPCChannels.Email.RespondReadReceipt, {
                                messageId: selectedMessage.id,
                                action: "decline",
                              }) as { success?: boolean; error?: string }
                              if (r?.success) {
                                setReadReceiptRequested(false)
                              } else {
                                toast.error(r?.error ?? "Lesebestätigung konnte nicht ignoriert werden")
                              }
                            } catch (error) {
                              toast.error(error instanceof Error ? error.message : "Lesebestätigung konnte nicht ignoriert werden")
                            }
                          }}
                        >
                          Ignorieren
                        </Button>
                      </div>
                    ) : null}
                    <EmailHtmlFrame
                      html={sanitizedHtml}
                      allowRemote={loadRemoteImages}
                      title={selectedMessage.subject || "E-Mail-Inhalt"}
                      className="h-[min(70vh,900px)] w-full rounded-md border bg-white"
                    />
                  </div>
                ) : (
                  <div className="space-y-2">
                    {bodyLoadState === "loading" && !decryptedPlain && needsFullMessageBody(selectedMessage) ? (
                      // Keep the already-available preview snippet visible while the
                      // full body loads (a few hundred ms on the happy path); show
                      // the hint additionally, not instead of the text, so the
                      // everyday case still renders a readable preview immediately.
                      <p className="text-xs text-muted-foreground">Vollständige Nachricht wird geladen…</p>
                    ) : null}
                    {bodyLoadState === "error" && !decryptedPlain && needsFullMessageBody(selectedMessage) ? (
                      <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                        <span>Vollständige Nachricht konnte nicht geladen werden — nur Vorschau.</span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={retryBody}
                        >
                          Erneut laden
                        </Button>
                      </div>
                    ) : null}
                    <pre className="max-w-[80ch] whitespace-pre-wrap font-sans text-sm leading-relaxed">
                      {decryptedPlain ?? bodyText}
                    </pre>
                  </div>
                )}

                {messageAttachments.length > 0 || omittedAttachments.length > 0 ? (
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Anhänge
                      </p>
                      {hasServerPgpEncryptedAttachment ? (
                        <Input
                          type="password"
                          placeholder="PGP-Passphrase"
                          className="h-7 max-w-[180px] text-xs"
                          value={pgpPassphrase}
                          onChange={(e) => setPgpPassphrase(e.target.value)}
                        />
                      ) : null}
                    </div>
                    <ul className="space-y-1">
                      {messageAttachments.map((att) => {
                        const detachedSignature = findDetachedSignatureAttachment(messageAttachments, att)
                        return (
                        <li
                          key={att.id}
                          className="flex flex-wrap items-center gap-2 rounded border bg-background px-3 py-2 text-xs"
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {att.filename_display}
                          </span>
                          <span className="text-muted-foreground">
                            {(att.size_bytes / 1024).toFixed(1)} KB
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="h-7 text-xs"
                            onClick={async () => {
                              if (!localIpcAvailable) {
                                try {
                                  await openServerAttachment(att)
                                } catch (e) {
                                  toast.error(e instanceof Error ? e.message : "Oeffnen fehlgeschlagen")
                                }
                                return
                              }
                              type OpenAtt =
                                | { success: true }
                                | {
                                    success: false
                                    error?: string
                                    needsConfirmation?: boolean
                                    reason?: string
                                  }
                              let r = await invokeIpc<OpenAtt>(
                                IPCChannels.Email.OpenAttachmentPath,
                                { attachmentId: att.id },
                              )
                              if (
                                !r.success &&
                                "needsConfirmation" in r &&
                                r.needsConfirmation &&
                                r.reason === "risky_file_type"
                              ) {
                                const ok = window.confirm(
                                  "Dieser Dateityp kann beim Öffnen Schadcode ausführen. Trotzdem mit der Standard-App öffnen?",
                                )
                                if (!ok) return
                                r = await invokeIpc<OpenAtt>(
                                  IPCChannels.Email.OpenAttachmentPath,
                                  { attachmentId: att.id, confirmOpenRisky: true },
                                )
                              }
                              if (!r.success) {
                                const msg =
                                  "error" in r && typeof r.error === "string"
                                    ? r.error
                                    : "Öffnen fehlgeschlagen"
                                toast.error(msg)
                              }
                            }}
                            disabled={!localIpcAvailable && !serverAttachmentBaseUrl}
                          >
                            Öffnen
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={async () => {
                              if (localIpcAvailable) {
                                const r = await invokeIpc<{
                                  success: boolean
                                  error?: string
                                }>(IPCChannels.Email.SaveAttachmentToDisk, {
                                  attachmentId: att.id,
                                })
                                if (r.success) toast.success("Gespeichert")
                                else toast.error(r.error ?? "Speichern fehlgeschlagen")
                                return
                              }
                              try {
                                await downloadServerAttachment(att)
                              } catch (e) {
                                toast.error(e instanceof Error ? e.message : "Download fehlgeschlagen")
                              }
                            }}
                            disabled={!localIpcAvailable && !serverAttachmentBaseUrl}
                          >
                            Speichern…
                          </Button>
                          {serverClientMode && isPgpEncryptedAttachment(att) ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={async () => {
                                try {
                                  await decryptPgpAttachment(att)
                                } catch (e) {
                                  toast.error(e instanceof Error ? e.message : "PGP-Anhang konnte nicht entschluesselt werden")
                                }
                              }}
                              disabled={!pgpPassphrase}
                            >
                              Entschl.
                            </Button>
                          ) : null}
                          {serverClientMode && detachedSignature && !isPgpSignatureAttachment(att) ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={async () => {
                                try {
                                  await verifyPgpAttachmentSignature(att, detachedSignature)
                                } catch (e) {
                                  toast.error(e instanceof Error ? e.message : "PGP-Anhangsignatur konnte nicht geprueft werden")
                                }
                              }}
                            >
                              Signatur
                            </Button>
                          ) : null}
                        </li>
                        )
                      })}
                      {omittedAttachments.map((om, i) => (
                        <li
                          key={`omitted-${i}-${om.name}`}
                          className="flex flex-wrap items-center gap-2 rounded border border-dashed border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs"
                        >
                          <span className="min-w-0 flex-1 truncate text-muted-foreground">
                            {om.name}
                          </span>
                          <span className="text-muted-foreground">
                            {(om.size / 1024).toFixed(1)} KB
                          </span>
                          <span className="text-amber-700 dark:text-amber-400">
                            {om.reason === "too_large"
                              ? "Nicht gespeichert (zu groß)"
                              : "Nicht gespeichert"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

              </div>
            </ScrollArea>
          </div>

          {metadataPlacement === "inline" && metadataPanelOpen ? (
            <MessageMetadataPanel
              teamMembers={teamMembers}
              categories={categories}
              messageTags={messageTags}
              internalNotes={internalNotes}
              reloadNotes={reloadNotes}
              reloadTags={reloadTags}
              refreshCurrentMessage={refreshCurrentMessage}
              onOpenMessage={onOpenMessage}
            />
          ) : null}
        </div>
      </div>
      <Dialog open={rawHeadersOpen} onOpenChange={setRawHeadersOpen}>
        <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col gap-3 overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>E-Mail-Rohdaten (.eml)</DialogTitle>
            <DialogDescription>
              {serverClientMode
                ? "Vollstaendige Nachricht im RFC822-Format. Serverseitig gespeicherte Rohmails werden direkt ausgegeben; rekonstruierte EML-Dateien enthalten keine lokalen Dateianhaenge."
                : "Vollstaendige Nachricht im RFC822-Format (wie eine .eml-Datei): Header, Body und - bei Sync ab dieser Version - die Original-Rohmail. Anhaenge sind eingebettet, wenn sie lokal vorliegen; sonst siehe Hinweis am Ende."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex shrink-0 justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!rawHeadersText || rawHeadersLoading}
              onClick={() => {
                if (!rawHeadersText) return
                void navigator.clipboard.writeText(rawHeadersText).then(
                  () => toast.success("In Zwischenablage kopiert."),
                  () => toast.error("Kopieren fehlgeschlagen."),
                )
              }}
            >
              <Copy className="mr-1 h-3.5 w-3.5" />
              Kopieren
            </Button>
          </div>
          <div className="h-[min(65vh,720px)] shrink-0 overflow-y-auto overflow-x-auto rounded-md border bg-muted/30 p-3">
            {rawHeadersLoading ? (
              <p className="text-sm text-muted-foreground">Lädt…</p>
            ) : (
              <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed">
                {rawHeadersText ?? "—"}
              </pre>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={translateOpen} onOpenChange={setTranslateOpen}>
        <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col gap-3 overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>Übersetzung ({getTranslationSettings().localLanguage})</DialogTitle>
            <DialogDescription>
              KI-Übersetzung des markierten Texts (oder der ganzen Nachricht). Nur zur Ansicht.
            </DialogDescription>
          </DialogHeader>
          {translateResult ? (
            <div className="flex shrink-0 justify-end">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  void navigator.clipboard.writeText(translateResult).then(
                    () => toast.success("In Zwischenablage kopiert."),
                    () => toast.error("Kopieren fehlgeschlagen."),
                  )
                }
              >
                <Copy className="mr-1 h-3.5 w-3.5" />
                Kopieren
              </Button>
            </div>
          ) : null}
          <div className="min-h-[6rem] max-h-[60vh] overflow-y-auto rounded-md border bg-muted/30 p-3">
            {translateLoading ? (
              <p className="text-sm text-muted-foreground">Übersetze…</p>
            ) : (
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{translateResult ?? "—"}</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDraftOpen} onOpenChange={setDeleteDraftOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Entwurf endgültig löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              {serverClientMode
                ? "Der SimpleCRM-Entwurf wird unwiderruflich entfernt (inkl. leerer Entwuerfe aus fehlgeschlagenem Verfassen). Dies ersetzt keinen Server-Entwurf auf dem Mailserver."
                : "Der lokale Entwurf wird unwiderruflich entfernt (inkl. leerer Entwuerfe aus fehlgeschlagenem Verfassen). Dies ersetzt keinen Server-Entwurf auf dem Mailserver."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void handleDeleteLocalDraft()}
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <WorkflowRunDetailDialog
        runId={workflowRunDetailId}
        open={workflowRunDetailOpen}
        onOpenChange={setWorkflowRunDetailOpen}
      />
    </TooltipProvider>
  )
}
