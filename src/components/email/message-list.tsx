"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { MessageListDisplayMode } from "@shared/email-list-options"
import { IPCChannels } from "@shared/ipc/channels"
import { ChevronDown, Loader2, Paperclip, Search } from "lucide-react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { MessageListSortMode } from "@shared/email-list-options"
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
import { MessageDoneFilterChips } from "./message-done-filter-chips"
import { pickBulkAdvanceTargetId } from "./select-adjacent-message"

type Props = {
  messages: EmailMessage[]
  accounts: EmailAccount[]
  loading: boolean
  onOpen: (m: EmailMessage) => void | Promise<void>
  onMoveMessageToView?: (messageId: number, view: MailView) => Promise<boolean>
  onListChanged?: (opts?: {
    advanceFromMessageId?: number
    selectMessageId?: number | null
  }) => void | Promise<void>
  loadMore?: () => void
  hasMore?: boolean
  loadingMore?: boolean
}

function threadKey(m: EmailMessage): string {
  const t = m.thread_id?.trim() || m.imap_thread_id?.trim() || m.ticket_code?.trim()
  if (t) return `t:${t}`
  return `m:${m.id}`
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
  loadMore,
  hasMore,
  loadingMore,
}: Props) {
  const {
    searchQuery,
    setSearchQuery,
    selectedMessage,
    selectedAccountId,
    messageListFilter,
    messageDoneFilter,
    mailView,
    categoryFilterId,
    listSortMode,
    setListSortMode,
    listDisplayMode,
    setListDisplayMode,
  } = useMailWorkspace()
  const visibleMessages = useMemo(() => {
    if (listDisplayMode !== "thread") return messages
    const seen = new Set<string>()
    const out: EmailMessage[] = []
    for (const m of messages) {
      const key = threadKey(m)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(m)
    }
    return out
  }, [messages, listDisplayMode])
  const showAccount = isAllAccountsScope(selectedAccountId)
  const accountLabel = (id: number) =>
    accounts.find((a) => a.id === id)?.display_name ?? `Konto ${id}`

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [selectAllDialogOpen, setSelectAllDialogOpen] = useState(false)
  const [pendingSelectAllCount, setPendingSelectAllCount] = useState(0)
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set())
  const [threadChildren, setThreadChildren] = useState<Record<string, EmailMessage[]>>({})
  const searchInputRef = useRef<HTMLInputElement>(null)
  const lastSelectionAnchorRef = useRef<number | null>(null)
  const pendingFolderSelectIdsRef = useRef<number[]>([])

  useEffect(() => {
    setSelectedIds(new Set())
  }, [mailView, selectedAccountId, categoryFilterId, messageListFilter, messageDoneFilter])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedIds.size > 0 && !bulkBusy) {
        setSelectedIds(new Set())
        return
      }
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (!target) return
      const tag = target.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return
      e.preventDefault()
      searchInputRef.current?.focus()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [selectedIds.size, bulkBusy])

  const isMessageSelectable = (m: EmailMessage) =>
    mailView === "drafts"
      ? m.uid < 0 && m.folder_kind === "draft"
      : m.uid >= 0 || Boolean(m.pop3_uidl)

  const selectableIds = visibleMessages.filter(isMessageSelectable).map((m) => m.id)
  const bulkAccountId = isAllAccountsScope(selectedAccountId) ? undefined : selectedAccountId
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

  const toggleCheckbox = useCallback(
    (id: number, checked: boolean, shiftKey: boolean) => {
      if (shiftKey && lastSelectionAnchorRef.current != null) {
        const anchor = lastSelectionAnchorRef.current
        const start = selectableIds.indexOf(anchor)
        const end = selectableIds.indexOf(id)
        if (start >= 0 && end >= 0) {
          const lo = Math.min(start, end)
          const hi = Math.max(start, end)
          setSelectedIds((prev) => {
            const next = new Set(prev)
            for (const rid of selectableIds.slice(lo, hi + 1)) {
              if (checked) next.add(rid)
              else next.delete(rid)
            }
            return next
          })
          lastSelectionAnchorRef.current = id
          return
        }
      }
      toggleOne(id, checked)
      if (checked) lastSelectionAnchorRef.current = id
      else if (lastSelectionAnchorRef.current === id) lastSelectionAnchorRef.current = null
    },
    [selectableIds, toggleOne],
  )

  const toggleAllLoaded = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set())
      lastSelectionAnchorRef.current = null
    } else {
      setSelectedIds(new Set(selectableIds))
      lastSelectionAnchorRef.current = selectableIds[0] ?? null
    }
  }, [allSelected, selectableIds])

  const requestSelectAllInView = useCallback(async () => {
    if (!hasElectron()) return
    if (selectedAccountId == null) {
      toast.error("Bitte zuerst ein Konto wählen")
      return
    }
    setBulkBusy(true)
    try {
      const ids = await invokeIpc<number[]>(IPCChannels.Email.ListMessageIdsByView, {
        accountId: selectedAccountId,
        view: mailView,
        categoryId: categoryFilterId,
        listFilter: messageListFilter === "all" ? undefined : messageListFilter,
        doneFilter:
          mailView === "inbox" && messageDoneFilter !== "all" ? messageDoneFilter : undefined,
        limit: 500,
      })
      if (ids.length === 0) {
        toast.message("Keine auswählbaren Nachrichten in dieser Ansicht")
        return
      }
      pendingFolderSelectIdsRef.current = ids
      setPendingSelectAllCount(ids.length)
      setSelectAllDialogOpen(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Auswahl konnte nicht geladen werden")
    } finally {
      setBulkBusy(false)
    }
  }, [
    selectedAccountId,
    mailView,
    categoryFilterId,
    messageListFilter,
    messageDoneFilter,
  ])

  const confirmSelectAllInView = useCallback(() => {
    setSelectedIds(new Set(pendingFolderSelectIdsRef.current))
    lastSelectionAnchorRef.current = pendingFolderSelectIdsRef.current[0] ?? null
    setSelectAllDialogOpen(false)
  }, [])

  type BulkAction =
    | "archive"
    | "unarchive"
    | "delete"
    | "spam"
    | "not-spam"
    | "restore"
    | "delete-drafts"
    | "unsnooze"
    | "mark-done"
    | "mark-open"

  const runBulk = useCallback(
    async (action: BulkAction) => {
      if (!hasElectron() || selectedIds.size === 0) return
      setBulkBusy(true)
      try {
        const ids = [...selectedIds]
        if (action === "delete-drafts") {
          const r = await invokeIpc<
            { success: true; count: number } | { success: false; error?: string }
          >(IPCChannels.Email.BulkDeleteComposeDrafts, { messageIds: ids })
          if (!r.success) {
            toast.error(r.error ?? "Entwürfe konnten nicht gelöscht werden")
            return
          }
          toast.success(
            r.count === 1 ? "1 Entwurf gelöscht" : `${r.count} Entwürfe gelöscht`,
          )
        } else if (action === "restore") {
          let restored = 0
          for (const id of ids) {
            const r = await invokeIpc<{ success: boolean }>(
              IPCChannels.Email.RestoreMessage,
              id,
            )
            if (r.success) restored += 1
          }
          toast.success(
            restored === 1
              ? "1 Nachricht wiederhergestellt"
              : `${restored} Nachrichten wiederhergestellt`,
          )
        } else if (action === "unsnooze") {
          for (const id of ids) {
            await invokeIpc(IPCChannels.Email.SnoozeMessage, { messageId: id, until: null })
          }
          toast.success(
            ids.length === 1 ? "1 Nachricht wieder im Posteingang" : `${ids.length} Nachrichten wieder im Posteingang`,
          )
        } else if (action === "archive" || action === "unarchive") {
          const r = await invokeIpc<
            { success: true; count: number } | { success: false; error?: string }
          >(IPCChannels.Email.BulkSetMessagesArchived, {
            messageIds: ids,
            archived: action === "archive",
            accountId: bulkAccountId,
          })
          if (!r.success) {
            toast.error(r.error ?? "Archivieren fehlgeschlagen")
            return
          }
          toast.success(
            r.count === 1
              ? action === "archive"
                ? "1 Nachricht archiviert"
                : "1 Nachricht aus dem Archiv geholt"
              : action === "archive"
                ? `${r.count} Nachrichten archiviert`
                : `${r.count} Nachrichten aus dem Archiv geholt`,
          )
        } else if (action === "mark-done" || action === "mark-open") {
          const r = await invokeIpc<
            { success: true; count: number } | { success: false; error?: string }
          >(IPCChannels.Email.BulkSetMessageDone, {
            messageIds: ids,
            done: action === "mark-done",
            accountId: bulkAccountId,
          })
          if (!r.success) {
            toast.error(r.error ?? "Erledigt-Status konnte nicht gesetzt werden")
            return
          }
          toast.success(
            r.count === 1
              ? action === "mark-done"
                ? "1 Nachricht als erledigt markiert"
                : "1 Nachricht wieder offen"
              : action === "mark-done"
                ? `${r.count} Nachrichten als erledigt markiert`
                : `${r.count} Nachrichten wieder offen`,
          )
        } else if (action === "spam" || action === "not-spam") {
          const r = await invokeIpc<
            { success: true; count: number } | { success: false; error?: string }
          >(IPCChannels.Email.BulkSetMessageSpam, {
            messageIds: ids,
            spam: action === "spam",
            accountId: bulkAccountId,
          })
          if (!r.success) {
            toast.error(r.error ?? "Aktion fehlgeschlagen")
            return
          }
          toast.success(
            action === "spam"
              ? r.count === 1
                ? "1 Nachricht als Spam markiert"
                : `${r.count} Nachrichten als Spam markiert`
              : r.count === 1
                ? "1 Nachricht als kein Spam markiert"
                : `${r.count} Nachrichten als kein Spam markiert`,
          )
        } else {
          const r = await invokeIpc<
            { success: true; count: number } | { success: false; error?: string }
          >(IPCChannels.Email.BulkSoftDeleteMessages, {
            messageIds: ids,
            accountId: bulkAccountId,
          })
          if (!r.success) {
            toast.error(r.error ?? "Löschen fehlgeschlagen")
            return
          }
          toast.success(
            r.count === 1
              ? "1 Nachricht in den Papierkorb verschoben"
              : `${r.count} Nachrichten in den Papierkorb verschoben`,
          )
        }
        const advanceActions: BulkAction[] = [
          "archive",
          "delete",
          "delete-drafts",
          "unsnooze",
          "spam",
          "not-spam",
          "restore",
          "unarchive",
          "mark-done",
        ]
        const advanceTargetId = pickBulkAdvanceTargetId(visibleMessages, selectedIds)
        setSelectedIds(new Set())
        if (advanceActions.includes(action)) {
          await onListChanged?.({ selectMessageId: advanceTargetId })
        } else {
          await onListChanged?.()
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Massenaktion fehlgeschlagen")
      } finally {
        setBulkBusy(false)
      }
    },
    [
      selectedIds,
      bulkAccountId,
      onListChanged,
      visibleMessages,
      mailView,
      messageDoneFilter,
    ],
  )

  const bulkButtons: { action: BulkAction; label: string; variant?: "secondary" | "outline" | "ghost" }[] =
    mailView === "drafts"
      ? [{ action: "delete-drafts", label: "Entwürfe löschen", variant: "outline" }]
      : mailView === "spam_review"
        ? [
            { action: "not-spam", label: "Kein Spam", variant: "secondary" },
            { action: "spam", label: "Spam", variant: "secondary" },
            { action: "delete", label: "Papierkorb", variant: "outline" },
          ]
      : mailView === "spam"
        ? [
            { action: "not-spam", label: "Kein Spam", variant: "secondary" },
            { action: "delete", label: "Papierkorb", variant: "outline" },
          ]
        : mailView === "trash"
          ? [
              { action: "restore", label: "Wiederherstellen", variant: "secondary" },
              { action: "delete", label: "Papierkorb", variant: "outline" },
            ]
          : mailView === "archived"
            ? [
                { action: "unarchive", label: "Aus Archiv", variant: "secondary" },
                { action: "delete", label: "Papierkorb", variant: "outline" },
              ]
            : mailView === "snoozed"
              ? [
                  { action: "unsnooze", label: "Wieder aktiv", variant: "secondary" },
                  { action: "delete", label: "Papierkorb", variant: "outline" },
                ]
              : mailView === "inbox"
                ? [
                    {
                      action: messageDoneFilter === "done" ? "mark-open" : "mark-done",
                      label: messageDoneFilter === "done" ? "Wieder offen" : "Erledigt",
                      variant: "secondary",
                    },
                    { action: "archive", label: "Archivieren", variant: "secondary" },
                    { action: "delete", label: "Papierkorb", variant: "outline" },
                  ]
                : [
                    { action: "archive", label: "Archivieren", variant: "secondary" },
                    { action: "delete", label: "Papierkorb", variant: "outline" },
                  ]

  return (
    <section className="flex h-full min-h-0 flex-col border-r">
      <div className="shrink-0 space-y-2 border-b bg-background p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            className="h-9 pl-8"
            placeholder="Nachrichten durchsuchen… (/)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            disabled={bulkBusy}
          />
        </div>
        <div className="space-y-2">
          {mailView === "inbox" ? <MessageDoneFilterChips /> : null}
          <MessageFilterChips />
        </div>
        <div className="flex flex-wrap gap-2">
          <Select
            value={listSortMode}
            onValueChange={(v) => setListSortMode(v as MessageListSortMode)}
          >
            <SelectTrigger className="h-8 w-[130px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date_desc">Neueste zuerst</SelectItem>
              <SelectItem value="date_asc">Älteste zuerst</SelectItem>
              <SelectItem value="priority">Priorität</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={listDisplayMode}
            onValueChange={(v) => setListDisplayMode(v as MessageListDisplayMode)}
          >
            <SelectTrigger
              className="h-8 w-[148px] text-xs"
              title="Threads: Wurzelzeilen mit Aufklappen für weitere Nachrichten."
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="flat">Einzelne Nachrichten</SelectItem>
              <SelectItem value="thread">Threads (Vorschau)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {selectedIds.size > 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5">
            <span className="text-xs text-muted-foreground">{selectedIds.size} ausgewählt</span>
            {bulkButtons.map(({ action, label, variant }) => (
              <Button
                key={action}
                type="button"
                size="sm"
                variant={variant ?? "outline"}
                className="h-7 text-xs"
                disabled={bulkBusy}
                onClick={() => void runBulk(action)}
              >
                {label}
              </Button>
            ))}
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
                  disabled={bulkBusy}
                  onCheckedChange={() => toggleAllLoaded()}
                  aria-label="Alle geladenen auswählen"
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 gap-0.5 px-1.5 text-[10px] uppercase tracking-wide text-muted-foreground"
                      disabled={bulkBusy}
                    >
                      Auswahl
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => toggleAllLoaded()}>
                      Alle geladenen auswählen
                      {hasMore ? ` (${selectableIds.length})` : ""}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void requestSelectAllInView()}>
                      Alle in dieser Ansicht (max. 500)
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ) : null}
            {visibleMessages.map((m) => {
              const isDraft = m.uid < 0
              const blocked = !!m.outbound_hold
              const unread = !m.seen_local && m.uid >= 0
              const open = mailView === "inbox" && !m.done_local && m.uid >= 0
              const active = selectedMessage?.id === m.id
              const canSelect = isMessageSelectable(m)
              const checked = selectedIds.has(m.id)
              const tKey = threadKey(m)
              const threadIdForExpand = m.thread_id?.trim() ?? ""
              const isThreadRoot = listDisplayMode === "thread" && threadIdForExpand.length > 0
              const expanded = expandedThreads.has(tKey)
              const children = threadChildren[tKey] ?? []
              return (
                <li key={m.id}>
                  <div
                    className={cn(
                      "flex w-full items-start gap-1 transition-colors hover:bg-muted/60",
                      active && "bg-muted",
                    )}
                  >
                    {isThreadRoot && threadIdForExpand ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="mt-2 h-6 w-6 shrink-0"
                        onClick={async (e) => {
                          e.stopPropagation()
                          const next = new Set(expandedThreads)
                          if (expanded) next.delete(tKey)
                          else {
                            next.add(tKey)
                            if (!threadChildren[tKey] && hasElectron() && threadIdForExpand) {
                              const rows = await invokeIpc(IPCChannels.Email.ListThreadMessages, {
                                threadId: threadIdForExpand,
                                limit: 50,
                              })
                              if (Array.isArray(rows)) {
                                setThreadChildren((prev) => ({
                                  ...prev,
                                  [tKey]: rows as EmailMessage[],
                                }))
                              }
                            }
                          }
                          setExpandedThreads(next)
                        }}
                      >
                        <ChevronDown
                          className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")}
                        />
                      </Button>
                    ) : (
                      <div className="w-6 shrink-0" />
                    )}
                    {canSelect ? (
                      <div className="flex shrink-0 items-center py-3 pl-2">
                        <Checkbox
                          checked={checked}
                          disabled={bulkBusy}
                          onCheckedChange={(v) => toggleCheckbox(m.id, v === true, false)}
                          aria-label={`Nachricht ${m.id} auswählen`}
                          onClick={(e) => {
                            e.stopPropagation()
                            if (e.shiftKey) {
                              e.preventDefault()
                              toggleCheckbox(m.id, true, true)
                            }
                          }}
                        />
                      </div>
                    ) : (
                      <div className="w-8 shrink-0" />
                    )}
                    <button
                      type="button"
                      draggable={m.uid >= 0 && !bulkBusy}
                      disabled={bulkBusy}
                      onDragStart={(e) => {
                        if (m.uid < 0 || bulkBusy) return
                        setMailDragData(e.dataTransfer, m.id)
                      }}
                      onClick={() => {
                        if (bulkBusy) return
                        void onOpen(m)
                      }}
                      className="min-w-0 flex-1 px-2 py-2.5 text-left disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <div className="flex items-start gap-2">
                        <div
                          className={cn(
                            "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                            unread
                              ? "bg-primary"
                              : open
                                ? "bg-amber-500"
                                : "bg-emerald-500/70",
                          )}
                          title={
                            unread
                              ? "Ungelesen"
                              : open
                                ? "Offen (unerledigt)"
                                : "Erledigt"
                          }
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
                          {mailView === "snoozed" && m.snoozed_until ? (
                            <span className="col-span-2 truncate text-[10px] text-amber-700 dark:text-amber-300">
                              Bis {formatListDateTime(m.snoozed_until)}
                            </span>
                          ) : null}
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
                  {expanded && children.length > 0
                    ? children
                        .filter((c) => c.id !== m.id)
                        .map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            className="flex w-full border-t border-muted/40 py-2 pl-12 pr-3 text-left text-xs hover:bg-muted/40"
                            onClick={() => void onOpen(c)}
                          >
                            <span className="truncate font-medium">{formatFrom(c.from_json)}</span>
                            <span className="mx-2 text-muted-foreground">·</span>
                            <span className="truncate text-muted-foreground">
                              {formatListDateTime(c.date_received)}
                            </span>
                          </button>
                        ))
                    : null}
                </li>
              )
            })}
          </ul>
        )}
        {hasMore && !loading && !searchQuery.trim() ? (
          <div className="border-t p-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full text-xs"
              disabled={loadingMore}
              onClick={() => loadMore?.()}
            >
              {loadingMore ? "Lädt…" : "Weitere laden"}
            </Button>
          </div>
        ) : null}
      </ScrollArea>

      <AlertDialog open={selectAllDialogOpen} onOpenChange={setSelectAllDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Viele Nachrichten auswählen?</AlertDialogTitle>
            <AlertDialogDescription>
              Es werden {pendingSelectAllCount} Nachrichten in dieser Ansicht ausgewählt (höchstens
              500). Massenaktionen betreffen alle ausgewählten Zeilen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSelectAllInView}>Auswählen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
