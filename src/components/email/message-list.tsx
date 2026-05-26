"use client"

import { useCallback, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { Loader2, Paperclip, Search } from "lucide-react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { isAllAccountsScope } from "./account-scope"
import {
  formatFrom,
  hasElectron,
  invokeIpc,
  type EmailAccount,
  type EmailMessage,
  type MailView,
} from "./types"
import { useMailWorkspace } from "./workspace-context"
import { setMailDragData } from "./mail-drag"
import { MessageFilterChips } from "./message-filter-chips"
import { applyMessageListFilter } from "./message-list-filters"

type Props = {
  messages: EmailMessage[]
  accounts: EmailAccount[]
  loading: boolean
  onOpen: (m: EmailMessage) => void | Promise<void>
  onMoveMessageToView?: (messageId: number, view: MailView) => Promise<boolean>
  onListChanged?: () => void | Promise<void>
}

/** Compact date+time so the column stays readable when the list pane is narrow. */
function formatListDateTime(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function MessageList({
  messages,
  accounts,
  loading,
  onOpen,
  onListChanged,
}: Props) {
  const { searchQuery, setSearchQuery, selectedMessage, selectedAccountId, messageListFilter } =
    useMailWorkspace()
  const visibleMessages = applyMessageListFilter(messages, messageListFilter)
  const showAccount = isAllAccountsScope(selectedAccountId)
  const accountLabel = (id: number) =>
    accounts.find((a) => a.id === id)?.display_name ?? `Konto ${id}`

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  const selectableIds = visibleMessages.filter((m) => m.uid >= 0).map((m) => m.id)
  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id))

  const toggleOne = useCallback((id: number, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(selectableIds))
    }
  }, [allSelected, selectableIds])

  const runBulk = useCallback(
    async (action: "archive" | "delete") => {
      if (!hasElectron() || selectedIds.size === 0) return
      setBulkBusy(true)
      try {
        const ids = [...selectedIds]
        if (action === "archive") {
          const r = await invokeIpc<{ success: boolean; count: number }>(
            IPCChannels.Email.BulkSetMessagesArchived,
            { messageIds: ids, archived: true },
          )
          toast.success(
            r.count === 1 ? "1 Nachricht archiviert" : `${r.count} Nachrichten archiviert`,
          )
        } else {
          const r = await invokeIpc<{ success: boolean; count: number }>(
            IPCChannels.Email.BulkSoftDeleteMessages,
            { messageIds: ids },
          )
          toast.success(
            r.count === 1
              ? "1 Nachricht in den Papierkorb verschoben"
              : `${r.count} Nachrichten in den Papierkorb verschoben`,
          )
        }
        setSelectedIds(new Set())
        await onListChanged?.()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Massenaktion fehlgeschlagen")
      } finally {
        setBulkBusy(false)
      }
    },
    [selectedIds, onListChanged],
  )

  return (
    <section className="flex h-full min-h-0 flex-col border-r">
      <div className="shrink-0 space-y-2 border-b bg-background p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="h-9 pl-8"
            placeholder="Nachrichten durchsuchen… (/ demnächst)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <MessageFilterChips />
        {selectedIds.size > 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5">
            <span className="text-xs text-muted-foreground">{selectedIds.size} ausgewählt</span>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-7 text-xs"
              disabled={bulkBusy}
              onClick={() => void runBulk("archive")}
            >
              Archivieren
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={bulkBusy}
              onClick={() => void runBulk("delete")}
            >
              Papierkorb
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              disabled={bulkBusy}
              onClick={() => setSelectedIds(new Set())}
            >
              Aufheben
            </Button>
          </div>
        ) : null}
      </div>

      <ScrollArea className="flex-1">
        {loading ? (
          <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Lädt…
          </p>
        ) : visibleMessages.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Keine Nachrichten.</p>
        ) : (
          <ul className="divide-y">
            {selectableIds.length > 0 ? (
              <li className="flex items-center gap-2 border-b bg-muted/20 px-3 py-1.5">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={() => toggleAll()}
                  aria-label="Alle auswählen"
                />
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Auswahl
                </span>
              </li>
            ) : null}
            {visibleMessages.map((m) => {
              const isDraft = m.uid < 0
              const blocked = !!m.outbound_hold
              const unread = !m.seen_local && m.uid >= 0
              const active = selectedMessage?.id === m.id
              const canSelect = m.uid >= 0
              const checked = selectedIds.has(m.id)
              return (
                <li key={m.id}>
                  <div
                    className={cn(
                      "flex w-full items-start gap-1 transition-colors hover:bg-muted/60",
                      active && "bg-muted",
                    )}
                  >
                    {canSelect ? (
                      <div className="flex shrink-0 items-center py-3 pl-2">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => toggleOne(m.id, v === true)}
                          aria-label={`Nachricht ${m.id} auswählen`}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                    ) : (
                      <div className="w-8 shrink-0" />
                    )}
                    <button
                      type="button"
                      draggable={m.uid >= 0}
                      onDragStart={(e) => {
                        if (m.uid < 0) return
                        setMailDragData(e.dataTransfer, m.id)
                      }}
                      onClick={() => void onOpen(m)}
                      className="min-w-0 flex-1 px-2 py-2.5 text-left"
                    >
                      <div className="flex items-start gap-2">
                        <div
                          className={cn(
                            "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                            unread ? "bg-primary" : "bg-transparent",
                          )}
                        />
                        <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-0.5">
                          <span
                            className={cn(
                              "truncate text-xs",
                              unread ? "font-semibold" : "text-muted-foreground",
                            )}
                          >
                            {isDraft
                              ? blocked
                                ? "Entwurf (blockiert)"
                                : "Entwurf"
                              : formatFrom(m.from_json)}
                          </span>
                          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                            {formatListDateTime(m.date_received)}
                          </span>
                          <span
                            className={cn(
                              "col-span-2 truncate text-sm",
                              unread && "font-medium",
                            )}
                          >
                            {m.subject?.trim() || "(Ohne Betreff)"}
                          </span>
                          {showAccount ? (
                            <span className="col-span-2 truncate text-[10px] text-muted-foreground">
                              {accountLabel(m.account_id)}
                            </span>
                          ) : null}
                          {m.has_attachments ? (
                            <Paperclip className="col-span-2 h-3 w-3 text-muted-foreground" />
                          ) : null}
                        </div>
                      </div>
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </ScrollArea>
    </section>
  )
}
