"use client"

import { useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
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
import {
  invokeIpc,
  type CustomerOpt,
  type InternalNote,
  type TeamMember,
} from "./types"
import { useMailWorkspace } from "./workspace-context"

type Props = {
  teamMembers: TeamMember[]
  customers: CustomerOpt[]
  messageTags: string[]
  internalNotes: InternalNote[]
  reloadNotes: () => void | Promise<void>
  refreshCurrentMessage: () => void | Promise<void>
}

export function MessageMetadataPanel({
  teamMembers,
  customers,
  messageTags,
  internalNotes,
  reloadNotes,
  refreshCurrentMessage,
}: Props) {
  const { selectedMessage } = useMailWorkspace()
  const [newNote, setNewNote] = useState("")

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
            <Select
              value={
                selectedMessage.customer_id ? String(selectedMessage.customer_id) : "none"
              }
              onValueChange={async (v) => {
                const cid = v === "none" ? null : parseInt(v, 10)
                await invokeIpc(IPCChannels.Email.LinkCustomer, {
                  messageId: selectedMessage.id,
                  customerId: cid,
                })
                await refreshCurrentMessage()
                toast.success("Verknüpfung gespeichert")
              }}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Kunde" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— keiner —</SelectItem>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

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
