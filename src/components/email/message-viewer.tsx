"use client"

import { useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import {
  Archive,
  Code2,
  Forward,
  Mail,
  MailOpen,
  PanelRightClose,
  PanelRightOpen,
  Reply,
  RotateCcw,
  ShieldAlert,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
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
  onReply: (m: EmailMessage) => void
  onForward: (m: EmailMessage) => void
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
    onForward,
  } = props
  const {
    selectedMessage,
    setSelectedMessage,
    metadataPanelOpen,
    setMetadataPanelOpen,
    mailView,
    setComposeIntent,
  } = useMailWorkspace()

  const [rawHeadersOpen, setRawHeadersOpen] = useState(false)
  const [rawHeadersText, setRawHeadersText] = useState<string | null>(null)
  const [rawHeadersLoading, setRawHeadersLoading] = useState(false)

  const isOutboundHeld =
    selectedMessage != null &&
    selectedMessage.uid < 0 &&
    (selectedMessage.outbound_hold ?? 0) > 0
  const isDraft =
    selectedMessage != null &&
    selectedMessage.uid < 0 &&
    (mailView === "drafts" || isOutboundHeld)

  const inTrash = mailView === "trash"

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
    toast.success("Ausgeblendet (soft)")
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
            ) : null}
            {selectedMessage.uid >= 0 && !inTrash ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => onReply(selectedMessage)}
                  className="gap-2"
                >
                  <Reply className="h-4 w-4" />
                  Antworten
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => onForward(selectedMessage)}
                  className="gap-2"
                >
                  <Forward className="h-4 w-4" />
                  Weiterleiten
                </Button>
                <div className="mx-1 h-6 w-px bg-border" />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="gap-1.5"
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
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="gap-1.5"
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
                  className="gap-1.5"
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
                  className="gap-1.5"
                  onClick={() => {
                    if (!hasElectron()) return
                    setRawHeadersOpen(true)
                    setRawHeadersLoading(true)
                    setRawHeadersText(null)
                    void invokeIpc<{
                      success: boolean
                      rawHeaders?: string | null
                      messageIdHeader?: string | null
                      fromJson?: string | null
                      error?: string
                    }>(IPCChannels.Email.GetMessageRawHeaders, selectedMessage.id)
                      .then((r) => {
                        if (!r.success) {
                          toast.error(r.error ?? "Header konnten nicht geladen werden.")
                          return
                        }
                        const parts: string[] = []
                        const fromAddr = firstAddress(r.fromJson ?? selectedMessage.from_json)
                        if (fromAddr) parts.push(`From (parsed): ${fromAddr}`)
                        if (r.messageIdHeader) parts.push(`Message-ID: ${r.messageIdHeader}`)
                        if (r.rawHeaders?.trim()) {
                          parts.push("", "--- RFC822 Header ---", r.rawHeaders)
                        } else {
                          parts.push(
                            "",
                            "(Keine gespeicherten Roh-Header — nur bei Mails nach Update/Sync verfügbar. Absender oben aus From.)",
                          )
                        }
                        setRawHeadersText(parts.join("\n"))
                      })
                      .catch(() => toast.error("Header konnten nicht geladen werden."))
                      .finally(() => setRawHeadersLoading(false))
                  }}
                >
                  <Code2 className="h-4 w-4" />
                  <span className="hidden lg:inline">Header</span>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="gap-1.5"
                  onClick={() => void handleSoftDelete()}
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="hidden lg:inline">Papierkorb</span>
                </Button>
              </>
            ) : null}
          </div>

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
        </div>

        {/* Body + metadata split */}
        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 flex-1 flex-col">
            <ScrollArea className="flex-1">
              <div className="mx-auto max-w-3xl space-y-4 p-6">
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

                <div className="rounded-md border bg-muted/30 px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="min-w-0 space-y-0.5">
                      <p className="font-medium">{formatFrom(selectedMessage.from_json)}</p>
                      {firstAddress(selectedMessage.from_json) ? (
                        <p className="font-mono text-xs text-primary break-all">
                          {firstAddress(selectedMessage.from_json)}
                        </p>
                      ) : null}
                    </div>
                    {selectedMessage.date_received ? (
                      <p className="text-xs text-muted-foreground shrink-0">
                        {new Date(selectedMessage.date_received).toLocaleString("de-DE")}
                      </p>
                    ) : null}
                  </div>
                  {selectedMessage.ticket_code ? (
                    <p className="pt-1 text-xs text-muted-foreground">
                      Ticket:{" "}
                      <span className="font-mono">{selectedMessage.ticket_code}</span>
                    </p>
                  ) : null}
                </div>

                {messageAttachments.length > 0 ? (
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
                    </ul>
                  </div>
                ) : null}

                <Separator />

                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                  {bodyText}
                </pre>
              </div>
            </ScrollArea>
          </div>

          {metadataPanelOpen ? (
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
        <DialogContent className="max-h-[85vh] max-w-2xl flex flex-col gap-3">
          <DialogHeader>
            <DialogTitle>E-Mail-Header / Rohdaten</DialogTitle>
            <DialogDescription>
              RFC822-Header und Message-ID zur Prüfung von Absender und Technik (Support).
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] rounded border bg-muted/30 p-3">
            {rawHeadersLoading ? (
              <p className="text-sm text-muted-foreground">Lädt…</p>
            ) : (
              <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-relaxed">
                {rawHeadersText ?? "—"}
              </pre>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  )
}
