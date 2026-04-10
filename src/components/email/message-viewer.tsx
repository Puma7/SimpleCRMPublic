"use client"

import { useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import DOMPurify from "dompurify"
import {
  Archive,
  FileText,
  Mail,
  PanelRightClose,
  PanelRightOpen,
  Reply,
  RotateCcw,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import {
  formatFrom,
  hasElectron,
  invokeIpc,
  stripHtmlToText,
  type CustomerOpt,
  type EmailMessage,
  type InternalNote,
  type MessageAttachment,
  type TeamMember,
} from "./types"
import { useMailWorkspace } from "./workspace-context"
import { MessageMetadataPanel } from "./message-metadata-panel"

type Props = {
  teamMembers: TeamMember[]
  customers: CustomerOpt[]
  messageTags: string[]
  internalNotes: InternalNote[]
  messageAttachments: MessageAttachment[]
  reloadNotes: () => void | Promise<void>
  refreshCurrentMessage: () => void | Promise<void>
  refreshList: () => void | Promise<void>
  onReply: (m: EmailMessage) => void
}

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
}

export function MessageViewer(props: Props) {
  const {
    teamMembers,
    customers,
    messageTags,
    internalNotes,
    messageAttachments,
    reloadNotes,
    refreshCurrentMessage,
    refreshList,
    onReply,
  } = props
  const {
    selectedMessage,
    setSelectedMessage,
    metadataPanelOpen,
    setMetadataPanelOpen,
  } = useMailWorkspace()

  const [htmlView, setHtmlView] = useState(true)

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
    toast.success("Ausgeblendet")
    await refreshList()
    setSelectedMessage(null)
  }

  const handleRestore = async () => {
    await invokeIpc(IPCChannels.Email.RestoreMessage, selectedMessage.id)
    toast.success("Wiederhergestellt")
    await refreshList()
  }

  const handleArchive = async () => {
    await invokeIpc(IPCChannels.Email.SetMessageArchived, {
      messageId: selectedMessage.id,
      archived: !selectedMessage.archived,
    })
    toast.success(selectedMessage.archived ? "Aus Archiv geholt" : "Archiviert")
    await refreshCurrentMessage()
    await refreshList()
  }

  const bodyHtml = selectedMessage.body_html ? sanitizeHtml(selectedMessage.body_html) : ""
  const bodyText =
    selectedMessage.body_text?.trim() ||
    (selectedMessage.body_html ? stripHtmlToText(selectedMessage.body_html) : "") ||
    selectedMessage.snippet ||
    "—"

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex h-full min-h-0 flex-col">
        {/* Actions toolbar */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-b bg-background/95 px-4 py-2">
          <div className="flex items-center gap-1">
            {selectedMessage.uid >= 0 ? (
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
                <div className="mx-1 h-6 w-px bg-border" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => void handleArchive()}
                    >
                      <Archive className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {selectedMessage.archived ? "Aus Archiv holen" : "Archivieren"}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => void handleSoftDelete()}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Ausblenden</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => void handleRestore()}
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Wiederherstellen</TooltipContent>
                </Tooltip>
              </>
            ) : null}
          </div>

          <div className="flex items-center gap-1">
            {bodyHtml ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => setHtmlView((v) => !v)}
                  >
                    <FileText className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {htmlView ? "Nur Text anzeigen" : "HTML anzeigen"}
                </TooltipContent>
              </Tooltip>
            ) : null}
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
                  <h2 className="text-xl font-semibold leading-tight tracking-tight">
                    {selectedMessage.subject || "(Ohne Betreff)"}
                  </h2>
                  {selectedMessage.archived ? (
                    <span className="inline-block rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase text-amber-700 dark:text-amber-400">
                      Archiviert
                    </span>
                  ) : null}
                </div>

                <div className="rounded-md border bg-muted/30 px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium">{formatFrom(selectedMessage.from_json)}</p>
                    {selectedMessage.date_received ? (
                      <p className="text-xs text-muted-foreground">
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

                {htmlView && bodyHtml ? (
                  <div
                    className={cn(
                      "prose prose-sm max-w-none",
                      "prose-headings:font-semibold",
                      "dark:prose-invert",
                    )}
                    dangerouslySetInnerHTML={{ __html: bodyHtml }}
                  />
                ) : (
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                    {bodyText}
                  </pre>
                )}
              </div>
            </ScrollArea>
          </div>

          {metadataPanelOpen ? (
            <MessageMetadataPanel
              teamMembers={teamMembers}
              customers={customers}
              messageTags={messageTags}
              internalNotes={internalNotes}
              reloadNotes={reloadNotes}
              refreshCurrentMessage={refreshCurrentMessage}
            />
          ) : null}
        </div>
      </div>
    </TooltipProvider>
  )
}
