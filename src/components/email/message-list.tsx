"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type { MessageListDisplayMode } from "@shared/email-list-options"
import { IPCChannels } from "@shared/ipc/channels"
import { ChevronDown, Loader2, Lock, Paperclip, Search, SlidersHorizontal } from "lucide-react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
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
import {
  highlightNeedlesInText,
  searchNeedlesFromQuery,
  splitHighlighted,
} from "@shared/email-search-highlight"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { isAllAccountsScope } from "./account-scope"
import {
  formatFrom,
  formatMessageFrom,
  type EmailAccount,
  type EmailMessage,
  type MailView,
} from "./types"
import { useMailWorkspace } from "./workspace-context"
import { setMailDragData } from "./mail-drag"
import { MessageFilterChips } from "./message-filter-chips"
import { MessageDoneFilterChips } from "./message-done-filter-chips"
import { pickBulkAdvanceTargetId } from "./select-adjacent-message"
import { invokeRenderer } from "@/services/transport"
import type { BulkListAction } from "./hooks/use-email-messages"

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
  onBulkListChanged?: (opts: {
    action: BulkListAction
    messageIds: number[]
    selectMessageId?: number | null
  }) => void | Promise<void>
  loadMore?: () => void
  hasMore?: boolean
  loadingMore?: boolean
  scrollToMessageId?: number | null
  onScrolledToMessage?: () => void
}

function threadKey(m: EmailMessage): string {
  // thread_id is a globally-unique th-<hex>, so it keys directly. ticket_code and
  // imap_thread_id are BOTH account-scoped: server ticket threads are unique per
  // (account, ticket) and IMAP THREAD numbers restart at 1 per mailbox, so per
  // account the same visible value can recur. Both must therefore be scoped by
  // account_id — otherwise, in the "all accounts" view, two unrelated accounts
  // sharing a ticket code or imap_thread_id collapse into one expandable thread
  // and a mitarbeiter sees a foreign account's mail under another customer's thread.
  const tid = m.thread_id?.trim()
  if (tid) return `t:${tid}`
  const ticket = m.ticket_code?.trim()
  if (ticket) return `t:${m.account_id}:${ticket}`
  const imapKey = m.imap_thread_id?.trim()
  if (imapKey) return `i:${m.account_id}:${imapKey}`
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

/** Sentinel-markierten Text als React-Knoten mit <mark> rendern (kein HTML-Parsing). */
function renderHighlighted(sentinelText: string): ReactNode {
  const parts = splitHighlighted(sentinelText)
  return parts.map((part, i) =>
    part.marked ? (
      <mark
        key={i}
        className="rounded-sm bg-yellow-200/80 px-0.5 text-inherit dark:bg-yellow-500/30"
      >
        {part.text}
      </mark>
    ) : (
      <span key={i}>{part.text}</span>
    ),
  )
}

export function MessageList({
  messages,
  accounts,
  loading,
  onOpen,
  onListChanged,
  onBulkListChanged,
  loadMore,
  hasMore,
  loadingMore,
  scrollToMessageId,
  onScrolledToMessage,
}: Props) {
  const {
    searchQuery,
    setSearchQuery,
    searchScope,
    setSearchScope,
    searchSortMode,
    setSearchSortMode,
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
    conversationLocks,
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
  // All loaded rows grouped by threadKey, so a collapsed thread can be expanded
  // from the messages already on the page — even ones grouped only by
  // imap_thread_id / ticket_code (no internal thread_id yet). This makes the
  // "Threads (Vorschau)" mode usable immediately, before the server thread
  // resolver has backfilled thread_id.
  const threadGroups = useMemo(() => {
    const map = new Map<string, EmailMessage[]>()
    for (const m of messages) {
      const key = threadKey(m)
      const arr = map.get(key)
      if (arr) arr.push(m)
      else map.set(key, [m])
    }
    return map
  }, [messages])
  const showAccount = isAllAccountsScope(selectedAccountId)
  const accountLabel = (id: number) =>
    accounts.find((a) => a.id === id)?.display_name ?? `Konto ${id}`
  const searchActive = searchQuery.trim().length > 0
  const broadSearchActive = searchScope.allFolders && searchActive
  const searchNeedles = useMemo(
    () => (searchActive ? searchNeedlesFromQuery(searchQuery) : []),
    [searchActive, searchQuery],
  )

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [selectAllDialogOpen, setSelectAllDialogOpen] = useState(false)
  const [pendingSelectAllCount, setPendingSelectAllCount] = useState(0)
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set())
  const [threadChildren, setThreadChildren] = useState<Record<string, EmailMessage[]>>({})

  useEffect(() => {
    if (scrollToMessageId == null) return
    const el = document.querySelector(`[data-message-id="${scrollToMessageId}"]`)
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: "nearest" })
      onScrolledToMessage?.()
    }
  }, [scrollToMessageId, messages, onScrolledToMessage])
  const searchInputRef = useRef<HTMLInputElement>(null)
  const lastSelectionAnchorRef = useRef<number | null>(null)
  const pendingFolderSelectIdsRef = useRef<number[]>([])

  useEffect(() => {
    setSelectedIds(new Set())
  }, [mailView, selectedAccountId, categoryFilterId, messageListFilter, messageDoneFilter])

  // Selektionen ueberleben keinen Suchkontext-Wechsel: Broad-Treffer aus
  // fremden Ordnern (sent/archived) blieben sonst ausgewaehlt, wenn die
  // Query geleert oder "Alle Ordner" umgeschaltet wird — Inbox-Bulk-Aktionen
  // (Spam/Erledigt) wuerden auf ordnerfremde IDs anwendbar. Truth-Table:
  // - Query leeren:        trimmedSearchQuery aendert sich -> Auswahl leer
  //   (broadSearchActive kippt dabei ggf. ebenfalls auf false)
  // - Scope-Toggle:        broadSearchActive kippt            -> Auswahl leer
  // - Query tippen/aendern: Ergebnismenge wechselt            -> Auswahl leer
  // - View-/Konto-Wechsel: Effect oben (mailView/... Deps)    -> Auswahl leer
  const trimmedSearchQuery = searchQuery.trim()
  useEffect(() => {
    setSelectedIds(new Set())
  }, [broadSearchActive, trimmedSearchQuery])

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
    mailView === "drafts" || mailView === "scheduled_send"
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
    if (selectedAccountId == null) {
      toast.error("Bitte zuerst ein Konto wählen")
      return
    }
    setBulkBusy(true)
    try {
      const ids = await invokeRenderer(IPCChannels.Email.ListMessageIdsByView, {
        accountId: selectedAccountId,
        view: mailView,
        categoryId: categoryFilterId,
        listFilter: messageListFilter === "all" ? undefined : messageListFilter,
        doneFilter:
          mailView === "inbox" && messageDoneFilter !== "all" ? messageDoneFilter : undefined,
        limit: 500,
      }) as number[]
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
      if (selectedIds.size === 0) return
      setBulkBusy(true)
      try {
        const ids = [...selectedIds]
        if (action === "delete-drafts") {
          const r = await invokeRenderer(IPCChannels.Email.BulkDeleteComposeDrafts, { messageIds: ids }) as
            | { success: true; count: number }
            | { success: false; error?: string }
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
            const r = await invokeRenderer(IPCChannels.Email.RestoreMessage, id) as { success: boolean }
            if (r.success) restored += 1
          }
          toast.success(
            restored === 1
              ? "1 Nachricht wiederhergestellt"
              : `${restored} Nachrichten wiederhergestellt`,
          )
        } else if (action === "unsnooze") {
          for (const id of ids) {
            await invokeRenderer(IPCChannels.Email.SnoozeMessage, { messageId: id, until: null })
          }
          toast.success(
            ids.length === 1 ? "1 Nachricht wieder im Posteingang" : `${ids.length} Nachrichten wieder im Posteingang`,
          )
        } else if (action === "archive" || action === "unarchive") {
          const r = await invokeRenderer(IPCChannels.Email.BulkSetMessagesArchived, {
            messageIds: ids,
            archived: action === "archive",
            accountId: bulkAccountId,
          }) as { success: true; count: number } | { success: false; error?: string }
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
          const r = await invokeRenderer(IPCChannels.Email.BulkSetMessageDone, {
            messageIds: ids,
            done: action === "mark-done",
            accountId: bulkAccountId,
          }) as { success: true; count: number } | { success: false; error?: string }
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
          const r = await invokeRenderer(IPCChannels.Email.BulkSetMessageSpam, {
            messageIds: ids,
            spam: action === "spam",
            accountId: bulkAccountId,
          }) as { success: true; count: number } | { success: false; error?: string }
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
          const r = await invokeRenderer(IPCChannels.Email.BulkSoftDeleteMessages, {
            messageIds: ids,
            accountId: bulkAccountId,
          }) as { success: true; count: number } | { success: false; error?: string }
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
          "mark-open",
        ]
        const advanceTargetId = pickBulkAdvanceTargetId(visibleMessages, selectedIds)
        setSelectedIds(new Set())
        if (onBulkListChanged) {
          if (advanceActions.includes(action)) {
            onBulkListChanged({
              action,
              messageIds: ids,
              selectMessageId: advanceTargetId,
            })
          } else {
            onBulkListChanged({ action, messageIds: ids })
          }
        } else if (advanceActions.includes(action)) {
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
      onBulkListChanged,
      visibleMessages,
      mailView,
      messageDoneFilter,
    ],
  )

  const bulkButtons: { action: BulkAction; label: string; variant?: "secondary" | "outline" | "ghost" }[] =
    mailView === "drafts" || mailView === "scheduled_send"
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
                    { action: "spam", label: "Spam", variant: "secondary" },
                    { action: "delete", label: "Papierkorb", variant: "outline" },
                  ]
                : [
                    { action: "archive", label: "Archivieren", variant: "secondary" },
                    { action: "delete", label: "Papierkorb", variant: "outline" },
                  ]

  return (
    <section className="flex h-full min-h-0 flex-col border-r">
      <div className="shrink-0 space-y-2 border-b bg-background p-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            className="h-9 pl-8 pr-9"
            placeholder="Nachrichten durchsuchen… (/)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            disabled={bulkBusy}
          />
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1 h-7 w-7 text-muted-foreground"
                title="Suchoptionen"
                aria-label="Suchoptionen"
              >
                <SlidersHorizontal className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="search-scope-all-folders" className="text-xs">
                  Alle Ordner durchsuchen
                </Label>
                <Switch
                  id="search-scope-all-folders"
                  checked={searchScope.allFolders}
                  onCheckedChange={(v) =>
                    setSearchScope((prev) => ({ ...prev, allFolders: v === true }))
                  }
                />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="search-scope-include-spam"
                  disabled={!searchScope.allFolders}
                  checked={searchScope.includeSpam}
                  onCheckedChange={(v) =>
                    setSearchScope((prev) => ({ ...prev, includeSpam: v === true }))
                  }
                />
                <Label
                  htmlFor="search-scope-include-spam"
                  className={cn("text-xs", !searchScope.allFolders && "text-muted-foreground")}
                >
                  Spam einbeziehen
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="search-scope-include-trash"
                  disabled={!searchScope.allFolders}
                  checked={searchScope.includeTrash}
                  onCheckedChange={(v) =>
                    setSearchScope((prev) => ({ ...prev, includeTrash: v === true }))
                  }
                />
                <Label
                  htmlFor="search-scope-include-trash"
                  className={cn("text-xs", !searchScope.allFolders && "text-muted-foreground")}
                >
                  Papierkorb einbeziehen
                </Label>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        {broadSearchActive ? (
          <p className="text-[11px] leading-tight text-muted-foreground">
            Ergebnisse aus allen Ordnern
            {searchScope.includeSpam || mailView === "spam" || mailView === "spam_review"
              ? " · inkl. Spam"
              : ""}
            {searchScope.includeTrash || mailView === "trash" ? " · inkl. Papierkorb" : ""}
          </p>
        ) : null}
        <div className="space-y-2">
          {mailView === "inbox" ? (
            <MessageDoneFilterChips
              disabled={broadSearchActive}
              disabledTitle="Bei Suche über alle Ordner nicht verfügbar"
            />
          ) : null}
          <MessageFilterChips />
        </div>
        <div className="flex flex-wrap gap-2">
          <Select
            // Während aktiver Suche zeigt das Select den EFFEKTIVEN Zustand:
            // die Suche unterstützt nur "Neueste zuerst" und "Relevanz" —
            // eine andere Listen-Sortierung (Älteste/Priorität) bleibt
            // erhalten und greift wieder, sobald die Suche verlassen wird.
            value={
              searchActive
                ? searchSortMode === "relevance"
                  ? "relevance"
                  : "date_desc"
                : listSortMode
            }
            onValueChange={(v) => {
              if (searchActive) {
                setSearchSortMode(v === "relevance" ? "relevance" : "date")
                return
              }
              setListSortMode(v as MessageListSortMode)
            }}
          >
            <SelectTrigger className="h-8 w-[130px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date_desc">Neueste zuerst</SelectItem>
              {searchActive ? null : <SelectItem value="date_asc">Älteste zuerst</SelectItem>}
              {searchActive ? null : <SelectItem value="priority">Priorität</SelectItem>}
              {searchActive ? <SelectItem value="relevance">Relevanz</SelectItem> : null}
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
                // Broad-Suche: Auswahl kann Mails aus fremden Ordnern enthalten
                // (Gesendet/Archiv) — view-spezifische Aktionen wie Spam/Erledigt
                // waeren dort Datenmurks (Muster wie die Erledigt-Chips).
                disabled={bulkBusy || broadSearchActive}
                title={
                  broadSearchActive
                    ? "Bei Suche über alle Ordner nicht verfügbar"
                    : undefined
                }
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
              <li className="flex items-center gap-2 border-b bg-muted/20 px-2 py-1.5">
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
              const isDraft = m.folder_kind === "draft"
              const blocked = !!m.outbound_hold
              const unread = !m.seen_local && m.uid >= 0
              const open = mailView === "inbox" && !m.done_local && m.uid >= 0
              const active = selectedMessage?.id === m.id
              const canSelect = isMessageSelectable(m)
              const checked = selectedIds.has(m.id)
              const tKey = threadKey(m)
              const threadIdForExpand = m.thread_id?.trim() ?? ""
              const localSiblings = threadGroups.get(tKey) ?? []
              const hasLocalSiblings = localSiblings.length > 1
              // Every message carries a thread_id since backfill, so a bare
              // thread_id no longer implies a real thread. Prefer the
              // authoritative server count (chevron only when >1); fall back to
              // loaded siblings when the count isn't available (e.g. local mode).
              const serverThreadCount =
                typeof m.thread_message_count === "number" ? m.thread_message_count : null
              const isThreadRoot =
                listDisplayMode === "thread"
                && (serverThreadCount !== null ? serverThreadCount > 1 : hasLocalSiblings)
              const expanded = expandedThreads.has(tKey)
              // Prefer server-fetched thread messages; fall back to the siblings
              // already loaded on this page (covers imap_thread_id / ticket_code
              // groups with no thread_id). The child render filters out `m`.
              const children = threadChildren[tKey] ?? (expanded ? localSiblings : [])
              const lock = conversationLocks[m.id]
              const lockOwner = lock?.displayName?.trim() || lock?.email?.trim() || lock?.userId
              return (
                <li key={m.id}>
                  <div
                    className={cn(
                      "flex w-full items-start transition-colors hover:bg-muted/60",
                      active && "bg-muted",
                    )}
                  >
                    <div className="flex w-7 shrink-0 flex-col items-center gap-0.5 pt-2">
                      {canSelect ? (
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
                      ) : (
                        <span className="h-4 w-4" />
                      )}
                      {isThreadRoot ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          onClick={async (e) => {
                            e.stopPropagation()
                            const next = new Set(expandedThreads)
                            if (expanded) next.delete(tKey)
                            else {
                              next.add(tKey)
                              if (!threadChildren[tKey] && threadIdForExpand) {
                                const rows = await invokeRenderer(IPCChannels.Email.ListThreadMessages, {
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
                            className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")}
                          />
                        </Button>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      data-message-id={m.id}
                      draggable={m.uid >= 0 && !bulkBusy}
                      disabled={bulkBusy}
                      onDragStart={(e) => {
                        if (m.uid < 0 || bulkBusy) return
                        // If the dragged row is part of the current multi-
                        // selection, drag the whole selection; otherwise just
                        // this one. Only selectable (server-backed) rows count.
                        const dragIds =
                          selectedIds.has(m.id) && selectedIds.size > 1
                            ? visibleMessages
                                .filter((vm) => selectedIds.has(vm.id) && vm.uid >= 0)
                                .map((vm) => vm.id)
                            : [m.id]
                        setMailDragData(e.dataTransfer, dragIds)
                      }}
                      onClick={(e) => {
                        if (bulkBusy) return
                        // Modifier-click selects (like a typical mail client):
                        // Shift = range from the anchor, Ctrl/Cmd = toggle this
                        // row. A plain click opens the message.
                        if (canSelect && (e.shiftKey || e.ctrlKey || e.metaKey)) {
                          e.preventDefault()
                          if (e.shiftKey) toggleCheckbox(m.id, true, true)
                          else toggleCheckbox(m.id, !checked, false)
                          return
                        }
                        void onOpen(m)
                      }}
                      className="min-w-0 flex-1 py-2 pl-0.5 pr-2 text-left disabled:cursor-not-allowed disabled:opacity-60"
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
                              isDraft && blocked && "text-amber-700 dark:text-amber-300",
                            )}
                            title={
                              isDraft && blocked
                                ? (m.outbound_block_reason || "Ausgangsprüfung: Versand blockiert").toString()
                                : undefined
                            }
                          >
                            {isDraft
                              ? blocked
                                ? "Entwurf — Ausgang blockiert"
                                : "Entwurf"
                              : formatMessageFrom(m, accounts)}
                          </span>
                          <span className="flex shrink-0 items-center justify-end gap-1 text-[10px] tabular-nums text-muted-foreground">
                            {m.approval_state === "pending" ? (
                              <span
                                className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-sky-700 dark:text-sky-400"
                                title={(m.approval_reason || "Wartet auf Freigabe").toString()}
                              >
                                Freigabe
                              </span>
                            ) : null}
                            {m.has_attachments ? (
                              <Paperclip
                                className="h-3 w-3 text-muted-foreground"
                                aria-label="Hat Anhang"
                              />
                            ) : null}
                            {lock ? (
                              <Lock
                                className="h-3 w-3 text-amber-600 dark:text-amber-300"
                                aria-label={`Gesperrt durch ${lockOwner}`}
                              />
                            ) : null}
                            {formatListDateTime(m.date_received)}
                          </span>
                          <span
                            className={cn(
                              "col-span-2 truncate text-sm",
                              unread && "font-medium",
                            )}
                          >
                            {searchActive && searchNeedles.length > 0
                              ? renderHighlighted(
                                  highlightNeedlesInText(
                                    m.subject?.trim() || "(Ohne Betreff)",
                                    searchNeedles,
                                  ),
                                )
                              : m.subject?.trim() || "(Ohne Betreff)"}
                          </span>
                          {searchActive && m.search_snippet ? (
                            <span className="col-span-2 truncate text-[11px] text-muted-foreground">
                              {renderHighlighted(m.search_snippet)}
                            </span>
                          ) : null}
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
                            className="flex w-full border-t border-muted/40 py-2 pl-8 pr-3 text-left text-xs hover:bg-muted/40"
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
        {hasMore && !loading ? (
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
