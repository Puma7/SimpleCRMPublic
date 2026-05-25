"use client"

import { useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { Copy } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CustomerCombobox } from "@/components/customer-combobox"
import {
  invokeIpc,
  type EmailMessage,
  type InternalNote,
  type TeamMember,
} from "./types"
import { useMailWorkspace } from "./workspace-context"

type Props = {
  teamMembers: TeamMember[]
  messageTags: string[]
  internalNotes: InternalNote[]
  reloadNotes: () => void | Promise<void>
  refreshCurrentMessage: () => void | Promise<void>
}

export function MessageMetadataPanel({
  teamMembers,
  messageTags,
  internalNotes,
  reloadNotes,
  refreshCurrentMessage,
}: Props) {
  const { selectedMessage, selectedAccountId } = useMailWorkspace()
  const [newNote, setNewNote] = useState("")
  const [conversation, setConversation] = useState<EmailMessage[]>([])

  useEffect(() => {
    if (!selectedMessage || selectedAccountId == null) {
      setConversation([])
      return
    }
    if (!selectedMessage.ticket_code && !selectedMessage.customer_id) {
      setConversation([])
      return
    }
    void invokeIpc<EmailMessage[]>(IPCChannels.Email.ListConversationMessages, {
      accountId: selectedAccountId,
      messageId: selectedMessage.id,
      ticketCode: selectedMessage.ticket_code,
      customerId: selectedMessage.customer_id,
      limit: 20,
    })
      .then(setConversation)
      .catch(() => setConversation([]))
  }, [
    selectedMessage?.id,
    selectedMessage?.ticket_code,
    selectedMessage?.customer_id,
    selectedAccountId,
  ])

  if (!selectedMessage) return null

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-l bg-muted/10">
      <div className="shrink-0 border-b px-4 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Details
        </h3>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-5 p-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Nachrichten-ID</Label>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded border bg-muted/50 px-2 py-1 font-mono text-xs">
                {selectedMessage.id}
              </code>
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="h-8 w-8 shrink-0"
                aria-label="ID kopieren"
                onClick={() => {
                  void navigator.clipboard.writeText(String(selectedMessage.id))
                  toast.success("Nachrichten-ID kopiert")
                }}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Für Workflow-Tests (Dry-Run) im Bereich Workflows → Erweitert.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Zuweisung</Label>
            <Select
              value={selectedMessage.assigned_to ?? "none"}
              onValueChange={async (v) => {
                const tid = v === "none" ? null : v
                await invokeIpc(IPCChannels.Email.AssignMessage, {
                  messageId: selectedMessage.id,
                  teamMemberId: tid,
                })
                await refreshCurrentMessage()
                toast.success("Zuweisung gespeichert")
              }}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Agent" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— niemand —</SelectItem>
                {teamMembers.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Kunde</Label>
            <CustomerCombobox
              value={selectedMessage.customer_id ?? undefined}
              placeholder="Kunde suchen…"
              onValueChange={async (v) => {
                const cid = v ? parseInt(v, 10) : null
                await invokeIpc(IPCChannels.Email.LinkCustomer, {
                  messageId: selectedMessage.id,
                  customerId: Number.isFinite(cid) ? cid : null,
                })
                await refreshCurrentMessage()
                toast.success("Verknüpfung gespeichert")
              }}
            />
            {selectedMessage.customer_id ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-0 text-xs text-muted-foreground"
                onClick={async () => {
                  await invokeIpc(IPCChannels.Email.LinkCustomer, {
                    messageId: selectedMessage.id,
                    customerId: null,
                  })
                  await refreshCurrentMessage()
                  toast.success("Kundenverknüpfung entfernt")
                }}
              >
                Verknüpfung entfernen
              </Button>
            ) : null}
          </div>

          {selectedMessage.archived ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-xs text-amber-900 dark:text-amber-200">
              <p className="font-medium">Im Archiv</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Eingehende Workflows können neue Mails automatisch archivieren
                (Einstellungen → Workflows). Nutzen Sie „Aus Archiv“ in der
                Toolbar, um die Nachricht wieder im Posteingang zu sehen.
              </p>
            </div>
          ) : null}

          {messageTags.length > 0 ? (
            <div className="space-y-1.5">
              <Label className="text-xs">Tags</Label>
              <div className="flex flex-wrap gap-1">
                {messageTags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {conversation.length > 0 ? (
            <div className="space-y-1.5">
              <Label className="text-xs">Kommunikation (Ticket/Kunde)</Label>
              <ul className="max-h-40 space-y-1 overflow-y-auto rounded border bg-background p-2 text-xs">
                {conversation.map((m) => (
                  <li key={m.id} className="border-b border-border/50 pb-1 last:border-0">
                    <p className="font-medium line-clamp-1">{m.subject || "(Ohne Betreff)"}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {m.date_received
                        ? new Date(m.date_received).toLocaleString("de-DE")
                        : "—"}
                      {m.ticket_code ? ` · ${m.ticket_code}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {selectedMessage.imap_thread_id ? (
            <div className="space-y-1">
              <Label className="text-xs">IMAP-Thread</Label>
              <p className="break-all font-mono text-[10px] text-muted-foreground">
                {selectedMessage.imap_thread_id}
              </p>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label className="text-xs">Interne Notizen</Label>
            {internalNotes.length === 0 ? (
              <p className="text-xs text-muted-foreground">Noch keine Notizen.</p>
            ) : (
              <ul className="space-y-1">
                {internalNotes.map((n) => (
                  <li
                    key={n.id}
                    className="rounded bg-background px-2 py-1.5 text-xs shadow-sm"
                  >
                    {n.body}
                  </li>
                ))}
              </ul>
            )}
            <Textarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Notiz hinzufügen…"
              className="min-h-[70px] text-sm"
            />
            <Button
              type="button"
              size="sm"
              className="w-full"
              onClick={async () => {
                if (!newNote.trim()) return
                await invokeIpc(IPCChannels.Email.AddInternalNote, {
                  messageId: selectedMessage.id,
                  body: newNote,
                })
                setNewNote("")
                await reloadNotes()
              }}
            >
              Speichern
            </Button>
          </div>
        </div>
      </ScrollArea>
    </aside>
  )
}
