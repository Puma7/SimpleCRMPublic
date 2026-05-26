"use client"

import { useState } from "react"
import DOMPurify from "dompurify"
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
import { correspondentEmailForMessage } from "@shared/email-correspondent"
import {
  firstAddress,
  formatFrom,
  hasElectron,
  invokeIpc,
  stripHtmlToText,
  type CategoryRow,
  type EmailMessage,
  type InternalNote,
  type MessageAttachment,
  type TeamMember,
} from "./types"
import { useMailWorkspace } from "./workspace-context"
import { MessageMetadataPanel } from "./message-metadata-panel"
import { setMailDragData } from "./mail-drag"
import { MessageAiSuggestions } from "./message-ai-suggestions"
import { formatSnoozeWakeLabel } from "@shared/snooze-datetime"
import { SnoozePopover } from "@/components/snooze/snooze-popover"
import { scrollToMetadataConversationSection } from "@/lib/scroll-metadata-conversation"
import { ApplyWorkflowMenu } from "./apply-workflow-menu"

type Props = {
  teamMembers: TeamMember[]
  messageTags: string[]
  internalNotes: InternalNote[]
  messageAttachments: MessageAttachment[]
  reloadNotes: () => void | Promise<void>
  refreshCurrentMessage: () => void | Promise<void>
  refreshList: (opts?: { preserveSelection?: boolean }) => void | Promise<void>
  categories: CategoryRow[]
  reloadTags: () => void | Promise<void>
  onReply: (m: EmailMessage, initialReplyHtml?: string) => void
  onReplyAll: (m: EmailMessage, initialReplyHtml?: string) => void
  onForward: (m: EmailMessage) => void
  /** Beta layout: Metadaten in eigener Spalte. */
  metadataPlacement?: "inline" | "external"
}

export function MessageViewer(props: Props) {
  const {
    teamMembers,
    messageTags,
    internalNotes,
    messageAttachments,
    reloadNotes,
    reloadTags,
    categories,
    refreshCurrentMessage,
    refreshList,
    onReply,
    onReplyAll,
    onForward,
    metadataPlacement = "inline",
  } = props
  const {
    selectedMessage,
    setSelectedMessage,
    metadataPanelOpen,
    setMetadataPanelOpen,
    mailView,
    messageDoneFilter,
    setComposeIntent,
  } = useMailWorkspace()

  const [rawHeadersOpen, setRawHeadersOpen] = useState(false)
  const [rawHeadersText, setRawHeadersText] = useState<string | null>(null)
  const [rawHeadersLoading, setRawHeadersLoading] = useState(false)
  const [deleteDraftOpen, setDeleteDraftOpen] = useState(false)
  const [htmlView, setHtmlView] = useState(false)

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

  const isOutboundHeld =
    selectedMessage != null &&
    selectedMessage.uid < 0 &&
    (selectedMessage.outbound_hold ?? 0) > 0
  const isDraft =
    selectedMessage != null &&
    selectedMessage.uid < 0 &&
    (mailView === "drafts" || isOutboundHeld)

  const inTrash = mailView === "trash"
  const inDraftsView = mailView === "drafts"
  const inSnoozed = mailView === "snoozed"

  const handleSnoozeMessage = async (until: string | null) => {
    if (!selectedMessage) return
    await invokeIpc(IPCChannels.Email.SnoozeMessage, {
      messageId: selectedMessage.id,
      until,
    })
    if (until) {
      toast.success(`Zurückgestellt bis ${formatSnoozeWakeLabel(until)}`)
    } else {
      toast.success("Wieder im Posteingang")
    }
    await refreshList({ preserveSelection: until != null && inSnoozed })
    if (!until || !inSnoozed) {
      setSelectedMessage(null)
    } else {
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
    await invokeIpc(IPCChannels.Email.SoftDeleteMessage, selectedMessage.id)
    toast.success("In den Papierkorb verschoben")
    await refreshList()
    setSelectedMessage(null)
  }

  const handleDeleteLocalDraft = async () => {
    const r = await invokeIpc<{ success: boolean; error?: string }>(
      IPCChannels.Email.DeleteComposeDraft,
      selectedMessage.id,
    )
    if (!r.success) {
      toast.error(r.error ?? "Entwurf konnte nicht gelöscht werden")
      return
    }
    toast.success("Entwurf endgültig gelöscht")
    setDeleteDraftOpen(false)
    await refreshList()
    setSelectedMessage(null)
  }

  const handleRestore = async () => {
    await invokeIpc(IPCChannels.Email.RestoreMessage, selectedMessage.id)
    toast.success("Wiederhergestellt (vorheriger Ordner)")
    await refreshCurrentMessage()
    await refreshList({ preserveSelection: true })
  }

  const handleArchive = async () => {
    const wasArchived = !!selectedMessage.archived
    await invokeIpc(IPCChannels.Email.SetMessageArchived, {
      messageId: selectedMessage.id,
      archived: !wasArchived,
    })
    toast.success(wasArchived ? "Wieder im Posteingang sichtbar" : "Archiviert")
    await refreshCurrentMessage()
    await refreshList()
  }

  const handleToggleSeen = async () => {
    const seen = !!selectedMessage.seen_local
    await invokeIpc(IPCChannels.Email.SetMessageSeen, {
      messageId: selectedMessage.id,
      seen: !seen,
    })
    toast.success(seen ? "Als ungelesen markiert" : "Als gelesen markiert")
    await refreshCurrentMessage()
    await refreshList({ preserveSelection: true })
  }

  const handleToggleDone = async () => {
    const done = !!selectedMessage.done_local
    await invokeIpc(IPCChannels.Email.SetMessageDone, {
      messageId: selectedMessage.id,
      done: !done,
    })
    toast.success(done ? "Wieder als offen markiert" : "Als erledigt markiert")
    const hideFromInbox = !done && mailView === "inbox" && messageDoneFilter === "open"
    await refreshList({ preserveSelection: !hideFromInbox })
    if (hideFromInbox) {
      setSelectedMessage(null)
    } else {
      await refreshCurrentMessage()
    }
  }

  const handleToggleSpam = async () => {
    const spam = !!selectedMessage.is_spam
    await invokeIpc(IPCChannels.Email.SetMessageSpam, {
      messageId: selectedMessage.id,
      spam: !spam,
    })
    toast.success(spam ? "Kein Spam mehr" : "Als Spam markiert")
    await refreshList()
    if (!spam) setSelectedMessage(null)
    else await refreshCurrentMessage()
  }

  // Text-only rendering — prefer the richer source (blocked compose drafts often store
  // only the warning banner in body_text while the letter lives in body_html).
  const bodyFromText = selectedMessage.body_text?.trim() ?? ""
  const bodyFromHtml = selectedMessage.body_html
    ? stripHtmlToText(selectedMessage.body_html)
    : ""
  const bodyText =
    bodyFromHtml.length > bodyFromText.length + 30
      ? bodyFromHtml
      : bodyFromText || bodyFromHtml || selectedMessage.snippet || "—"

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
            {inDraftsView && !inTrash && selectedMessage.uid >= 0 ? (
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
            {selectedMessage.uid >= 0 && !inTrash && !inDraftsView ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
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
                  onClick={() => onForward(selectedMessage)}
                  className="gap-2 bg-indigo-500/12 text-indigo-900 hover:bg-indigo-500/20 dark:text-indigo-100"
                >
                  <Forward className="h-4 w-4" />
                  Weiterleiten
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
                {mailView === "inbox" && selectedMessage.uid >= 0 ? (
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
                  className="gap-1.5 bg-orange-500/12 text-orange-900 hover:bg-orange-500/20 dark:text-orange-100"
                  onClick={() => void handleToggleSpam()}
                >
                  <ShieldAlert className="h-4 w-4" />
                  <span className="hidden lg:inline">
                    {selectedMessage.is_spam ? "Kein Spam" : "Spam"}
                  </span>
                </Button>
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
                    if (!hasElectron()) return
                    setRawHeadersOpen(true)
                    setRawHeadersLoading(true)
                    setRawHeadersText(null)
                    void invokeIpc<{
                      success: boolean
                      rawEml?: string
                      emlSource?: "original" | "reconstructed"
                      error?: string
                    }>(IPCChannels.Email.GetMessageRawHeaders, selectedMessage.id)
                      .then((r) => {
                        if (!r.success) {
                          toast.error(r.error ?? "Rohdaten konnten nicht geladen werden.")
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
              </>
            ) : null}
          </div>

          {metadataPlacement === "inline" ? (
            <div className="flex items-center gap-1">
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
            </div>
          ) : null}
        </div>

        {/* Body + metadata split */}
        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 flex-1 flex-col">
            <ScrollArea className="flex-1">
              <div className="mx-auto w-full max-w-5xl space-y-4 px-5 py-6 sm:px-8">
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
                    </div>
                  ) : null}
                  {selectedMessage.archived ? (
                    <span className="inline-block rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase text-amber-700 dark:text-amber-400">
                      Archiviert
                    </span>
                  ) : null}
                  {selectedMessage.is_spam ? (
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

                <div className="rounded-md border bg-muted/30 px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="min-w-0 space-y-0.5">
                      <p className="font-medium">{formatFrom(selectedMessage.from_json)}</p>
                      {correspondentEmailForMessage(selectedMessage) ? (
                        <p className="font-mono text-xs text-primary break-all">
                          {correspondentEmailForMessage(selectedMessage)}
                        </p>
                      ) : null}
                    </div>
                    {selectedMessage.date_received ? (
                      <p className="text-xs text-muted-foreground shrink-0">
                        {new Date(selectedMessage.date_received).toLocaleString("de-DE")}
                      </p>
                    ) : null}
                  </div>
                  {correspondentEmailForMessage(selectedMessage) ? (
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto px-0 pt-1 text-xs text-primary"
                      onClick={() => {
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
                    >
                      Alle Mails mit dieser Adresse anzeigen →
                    </Button>
                  ) : null}
                  {selectedMessage.ticket_code ? (
                    <p className="pt-1 text-xs text-muted-foreground">
                      Ticket:{" "}
                      <span className="font-mono">{selectedMessage.ticket_code}</span>
                    </p>
                  ) : null}
                </div>

                {messageAttachments.length > 0 || omittedAttachments.length > 0 ? (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Anhänge
                    </p>
                    <ul className="space-y-1">
                      {messageAttachments.map((att) => (
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
                          >
                            Öffnen
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={async () => {
                              if (!hasElectron()) return
                              const r = await invokeIpc<{
                                success: boolean
                                error?: string
                              }>(IPCChannels.Email.SaveAttachmentToDisk, {
                                attachmentId: att.id,
                              })
                              if (r.success) toast.success("Gespeichert")
                              else toast.error(r.error ?? "Speichern fehlgeschlagen")
                            }}
                          >
                            Speichern…
                          </Button>
                        </li>
                      ))}
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

                <div className="flex flex-wrap gap-2">
                  {selectedMessage.body_html ? (
                    <Button
                      type="button"
                      size="sm"
                      variant={htmlView ? "secondary" : "outline"}
                      className="h-8 gap-1.5 text-xs"
                      onClick={() => setHtmlView((v) => !v)}
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
                    onClick={() => window.print()}
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
                          void invokeIpc<{ success: boolean; path?: string; error?: string }>(
                            IPCChannels.Email.ExportMessageEml,
                            selectedMessage.id,
                          ).then((r) => {
                            if (r.success && r.path) toast.success(`Gespeichert: ${r.path}`)
                            else if (!r.success && r.error && r.error !== "Abgebrochen")
                              toast.error(r.error)
                          })
                        }}
                      >
                        <Download className="h-3.5 w-3.5" />
                        Als .eml
                      </Button>
                      <SnoozePopover
                        showUnsnooze={inSnoozed}
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
                          {inSnoozed ? "Snooze ändern" : "Zurückstellen"}
                        </Button>
                      </SnoozePopover>
                    </>
                  ) : null}
                </div>

                {bodyText.startsWith("-----BEGIN PGP MESSAGE-----") ? (
                  <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
                    Diese Nachricht scheint verschlüsselt (PGP/S/MIME). Entschlüsselung ist in
                    SimpleCRM nicht integriert.
                  </p>
                ) : null}

                <Separator />

                {htmlView && selectedMessage.body_html ? (
                  <div
                    className="prose prose-sm dark:prose-invert max-w-none rounded-md border bg-background p-3"
                    dangerouslySetInnerHTML={{
                      __html: DOMPurify.sanitize(selectedMessage.body_html, {
                        USE_PROFILES: { html: true },
                      }),
                    }}
                  />
                ) : (
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                    {bodyText}
                  </pre>
                )}
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
            />
          ) : null}
        </div>
      </div>
      <Dialog open={rawHeadersOpen} onOpenChange={setRawHeadersOpen}>
        <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col gap-3 overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>E-Mail-Rohdaten (.eml)</DialogTitle>
            <DialogDescription>
              Vollständige Nachricht im RFC822-Format (wie eine .eml-Datei): Header, Body und — bei
              Sync ab dieser Version — die Original-Rohmail. Anhänge sind eingebettet, wenn sie lokal
              vorliegen; sonst siehe Hinweis am Ende.
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

      <AlertDialog open={deleteDraftOpen} onOpenChange={setDeleteDraftOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Entwurf endgültig löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Der lokale Entwurf wird unwiderruflich entfernt (inkl. leerer Entwürfe aus
              fehlgeschlagenem Verfassen). Dies ersetzt keinen Server-Entwurf auf dem Mailserver.
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
    </TooltipProvider>
  )
}
