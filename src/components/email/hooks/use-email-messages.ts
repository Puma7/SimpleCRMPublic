"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import type { MessageListSortMode } from "@shared/email-list-options"
import type { MessageListFilter } from "@shared/email-list-filters"
import { formatEmailSyncError } from "@shared/email-sync-error-hint"
import type { MailAccountScope } from "../account-scope"
import type { EmailMessage, MailView } from "../types"
import { logError } from "../log"
import { pickAdjacentMessageId } from "../select-adjacent-message"
import { useMailWorkspace } from "../workspace-context"
import { invokeRenderer } from "@/services/transport"

const PAGE_SIZE = 100
const SILENT_RECONCILE_MS = 800

type HandleSyncOptions = {
  onAfterSync?: (accountId: number) => void | Promise<void>
}

type LoadMessagesOpts = {
  preserveSelection?: boolean
  append?: boolean
  silent?: boolean
  selectMessageId?: number | null
  advanceFromRemovedId?: number
}

export function useEmailMessages() {
  const {
    selectedAccountId,
    mailView,
    categoryFilterId,
    searchQuery,
    selectedMessage,
    setSelectedMessage,
    listSortMode,
    messageListFilter,
    messageDoneFilter,
    bumpCategoryAssignmentRevision,
  } = useMailWorkspace()
  const [messages, setMessages] = useState<EmailMessage[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [scrollToMessageId, setScrollToMessageId] = useState<number | null>(null)
  const [debouncedSearchQ, setDebouncedSearchQ] = useState("")
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selectedMessageIdRef = useRef<number | null>(null)
  const messagesRef = useRef<EmailMessage[]>([])
  const offsetRef = useRef(0)
  const reconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadMessagesRef = useRef<(
    accountScope: MailAccountScope,
    view: MailView,
    catId: number | null,
    query: string,
    sort: MessageListSortMode,
    listFilter: MessageListFilter,
    opts?: LoadMessagesOpts,
  ) => Promise<void>>(async () => {})

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    selectedMessageIdRef.current = selectedMessage?.id ?? null
  }, [selectedMessage?.id])

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearchQ(searchQuery)
    }, 300)
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [searchQuery])

  const selectMessageById = useCallback(
    async (targetId: number | null, scroll = false) => {
      if (targetId == null) {
        setSelectedMessage(null)
        return
      }
      const row = messagesRef.current.find((m) => m.id === targetId)
      if (!row) {
        setSelectedMessage(null)
        return
      }
      if (scroll) setScrollToMessageId(targetId)
      try {
        const full = await invokeRenderer(
          IPCChannels.Email.GetMessage,
          row.id,
        ) as EmailMessage | null
        setSelectedMessage(full ?? row)
      } catch {
        setSelectedMessage(row)
      }
    },
    [setSelectedMessage],
  )

  const scheduleSilentReconcile = useCallback(() => {
    if (reconcileTimerRef.current) clearTimeout(reconcileTimerRef.current)
    reconcileTimerRef.current = setTimeout(() => {
      reconcileTimerRef.current = null
      if (selectedAccountId == null) return
      void loadMessagesRef.current(
        selectedAccountId,
        mailView,
        categoryFilterId,
        debouncedSearchQ,
        listSortMode,
        messageListFilter,
        { preserveSelection: true, silent: true },
      )
    }, SILENT_RECONCILE_MS)
  }, [
    selectedAccountId,
    mailView,
    categoryFilterId,
    debouncedSearchQ,
    listSortMode,
    messageListFilter,
  ])

  const removeMessagesFromList = useCallback((ids: number[]) => {
    const idSet = new Set(ids)
    if (idSet.size === 0) return
    setMessages((prev) => prev.filter((m) => !idSet.has(m.id)))
    offsetRef.current = Math.max(0, offsetRef.current - ids.length)
  }, [])

  const patchMessageInList = useCallback(
    (messageId: number, partial: Partial<EmailMessage>) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, ...partial } : m)),
      )
      setSelectedMessage((prev) =>
        prev?.id === messageId ? { ...prev, ...partial } : prev,
      )
    },
    [setSelectedMessage],
  )

  const loadMessages = useCallback(
    async (
      accountScope: MailAccountScope,
      view: MailView,
      catId: number | null,
      query: string,
      sort: MessageListSortMode,
      listFilter: MessageListFilter,
      opts?: LoadMessagesOpts,
    ) => {
      const append = opts?.append ?? false
      const silent = opts?.silent ?? false
      const offset = append ? offsetRef.current : silent ? 0 : 0
      const keepId = opts?.preserveSelection ? selectedMessageIdRef.current ?? undefined : undefined
      if (append) setLoadingMore(true)
      else if (!silent) setLoadingMessages(true)
      try {
        let list: EmailMessage[]
        const doneFilter = view === "inbox" ? messageDoneFilter : undefined
        if (query.trim() && view !== "trash") {
          const res = await invokeRenderer(IPCChannels.Email.SearchMessages, {
            accountId: accountScope,
            query: query.trim(),
            limit: PAGE_SIZE,
            offset,
            view,
            categoryId: view === "inbox" ? catId : null,
            doneFilter,
          }) as {
            messages: EmailMessage[]
            searchMode: "fts" | "like" | "regex"
            hasMore?: boolean
          }
          list = res.messages
          if (!silent) {
            if (res.searchMode === "like") {
              toast.info("Erweiterte Suche (LIKE) — bei großen Postfächern kann das dauern.", {
                id: "search-like-fallback",
                duration: 4000,
              })
            } else if (res.searchMode === "regex") {
              toast.info("Regex-Suche aktiv (/muster/flags).", { id: "search-regex", duration: 3000 })
            }
          }
          setHasMore(Boolean(res.hasMore))
        } else {
          list = await invokeRenderer(IPCChannels.Email.ListMessagesByView, {
            accountId: accountScope,
            view,
            limit: PAGE_SIZE,
            offset,
            categoryId: view === "inbox" ? catId : null,
            sort,
            listFilter: listFilter === "all" ? undefined : listFilter,
            doneFilter,
          }) as EmailMessage[]
          setHasMore(list.length >= PAGE_SIZE)
        }
        if (append) {
          setMessages((prev) => {
            const ids = new Set(prev.map((m) => m.id))
            return [...prev, ...list.filter((m) => !ids.has(m.id))]
          })
          offsetRef.current = offset + list.length
        } else if (silent && keepId != null) {
          setMessages((prev) => {
            const byId = new Map(list.map((m) => [m.id, m]))
            const merged = prev.map((m) => byId.get(m.id) ?? m)
            for (const m of list) {
              if (!prev.some((p) => p.id === m.id)) merged.push(m)
            }
            return merged
          })
          offsetRef.current = Math.max(offsetRef.current, list.length)
        } else {
          setMessages(list)
          offsetRef.current = list.length
        }
        if (!append && opts?.selectMessageId !== undefined) {
          let targetId = opts.selectMessageId
          if (targetId != null && !messagesRef.current.some((m) => m.id === targetId)) {
            const removed = opts.advanceFromRemovedId ?? targetId
            targetId = pickAdjacentMessageId(messagesRef.current, removed)
          }
          await selectMessageById(targetId, true)
        } else if (keepId != null && !append) {
          const still =
            messagesRef.current.find((m) => m.id === keepId) ??
            list.find((m) => m.id === keepId)
          if (still) {
            setSelectedMessage((prev) =>
              prev?.id === keepId ? { ...prev, ...still } : still,
            )
          }
        } else if (!append && keepId == null && !silent) {
          setSelectedMessage(null)
        }
      } catch (e) {
        logError("use-email-messages: load", e)
        if (!silent) toast.error("Nachrichten konnten nicht geladen werden.")
      } finally {
        setLoadingMessages(false)
        setLoadingMore(false)
      }
    },
    [setSelectedMessage, messageDoneFilter, selectMessageById],
  )

  useEffect(() => {
    loadMessagesRef.current = loadMessages
  }, [loadMessages])

  useEffect(() => {
    offsetRef.current = 0
    if (selectedAccountId != null) {
      void loadMessages(
        selectedAccountId,
        mailView,
        categoryFilterId,
        debouncedSearchQ,
        listSortMode,
        messageListFilter,
      )
    } else {
      setMessages([])
    }
  }, [
    selectedAccountId,
    mailView,
    categoryFilterId,
    debouncedSearchQ,
    listSortMode,
    messageListFilter,
    messageDoneFilter,
    loadMessages,
  ])

  const loadMore = useCallback(() => {
    if (!selectedAccountId) return
    void loadMessages(
      selectedAccountId,
      mailView,
      categoryFilterId,
      debouncedSearchQ,
      listSortMode,
      messageListFilter,
      { preserveSelection: true, append: true },
    )
  }, [
    selectedAccountId,
    mailView,
    categoryFilterId,
    debouncedSearchQ,
    listSortMode,
    messageListFilter,
    messageDoneFilter,
    loadMessages,
  ])

  const refreshList = useCallback(
    async (opts?: {
      preserveSelection?: boolean
      selectMessageId?: number | null
      advanceFromRemovedId?: number
      silent?: boolean
    }) => {
      if (!opts?.silent) offsetRef.current = 0
      if (selectedAccountId == null) return
      await loadMessages(
        selectedAccountId,
        mailView,
        categoryFilterId,
        debouncedSearchQ,
        listSortMode,
        messageListFilter,
        {
          ...opts,
          silent: opts?.silent ?? Boolean(opts?.preserveSelection),
        },
      )
    },
    [
      selectedAccountId,
      mailView,
      categoryFilterId,
      debouncedSearchQ,
      listSortMode,
      messageListFilter,
      messageDoneFilter,
      loadMessages,
    ],
  )

  const advanceSelectionAfterMessageRemoved = useCallback(
    async (removedId: number) => {
      const current = messagesRef.current
      const preferredId = pickAdjacentMessageId(current, removedId)
      removeMessagesFromList([removedId])
      await selectMessageById(preferredId, true)
      scheduleSilentReconcile()
    },
    [removeMessagesFromList, selectMessageById, scheduleSilentReconcile],
  )

  const clearScrollToMessage = useCallback(() => {
    setScrollToMessageId(null)
  }, [])

  const moveMessageToView = useCallback(
    async (messageId: number, targetView: MailView) => {
      try {
        const r = await invokeRenderer(
          IPCChannels.Email.MoveMessageToView,
          { messageId, view: targetView },
        ) as { success: boolean; error?: string }
        if (!r.success) {
          toast.error(r.error ?? "Verschieben fehlgeschlagen")
          return false
        }
        const labels: Record<MailView, string> = {
          inbox: "Posteingang",
          snoozed: "Zurückgestellt",
          sent: "Gesendet",
          drafts: "Entwürfe",
          archived: "Archiv",
          spam_review: "Spam prüfen",
          spam: "Spam",
          trash: "Papierkorb",
        }
        toast.success(`Nachricht → ${labels[targetView]}`)
        if (selectedMessage?.id === messageId && targetView !== mailView) {
          await advanceSelectionAfterMessageRemoved(messageId)
        } else {
          await refreshList({ preserveSelection: true })
        }
        return true
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Verschieben fehlgeschlagen")
        return false
      }
    },
    [mailView, refreshList, selectedMessage?.id, advanceSelectionAfterMessageRemoved],
  )

  // Bulk variants for drag-drop of a multi-selection: one toast + one list
  // refresh instead of N. Self-contained (loop the single IPC; there is no bulk
  // endpoint for category/move) so they don't depend on the single handlers.
  const assignMessagesCategory = useCallback(
    async (messageIds: number[], categoryId: number) => {
      const ids = messageIds.filter((id) => typeof id === "number" && id > 0)
      if (ids.length === 0) return false
      const CONCURRENCY = 6
      let added = 0
      let already = 0
      let failed = 0
      let firstError: unknown
      const runOne = async (id: number) => {
        try {
          const result = (await invokeRenderer(IPCChannels.Email.AddMessageCategory, {
            messageId: id,
            categoryId,
          })) as { added?: boolean; alreadyAssigned?: boolean }
          if (result?.added) added += 1
          else if (result?.alreadyAssigned) already += 1
        } catch (e) {
          failed += 1
          if (firstError === undefined) firstError = e
        }
      }
      const queue = [...ids]
      const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        for (;;) {
          const id = queue.shift()
          if (id === undefined) return
          await runOne(id)
        }
      })
      await Promise.all(workers)

      if (added === 0 && already === 0) {
        toast.error(failed > 0
          ? (firstError instanceof Error ? firstError.message : "Kategorisieren fehlgeschlagen")
          : "Kategorisieren fehlgeschlagen — unerwartete Serverantwort")
        return false
      }
      if (added === 0 && already > 0) {
        toast.info(already === 1 ? "Bereits in dieser Kategorie" : `Alle ${already} Mails bereits in dieser Kategorie`)
      } else if (added > 0 && already > 0) {
        toast.success(`${added} hinzugefügt, ${already} bereits drin`)
      } else {
        toast.success(added === 1 ? "Kategorie hinzugefügt" : `${added} Nachrichten kategorisiert`)
      }
      if (failed > 0) {
        toast.error(`${failed} ${failed === 1 ? "Nachricht" : "Nachrichten"} fehlgeschlagen`)
      }
      if (added > 0 || already > 0) bumpCategoryAssignmentRevision()
      await refreshList({ preserveSelection: true })
      return failed === 0
    },
    [refreshList, bumpCategoryAssignmentRevision],
  )

  const moveMessagesToView = useCallback(
    async (messageIds: number[], targetView: MailView) => {
      const ids = messageIds.filter((id) => typeof id === "number" && id > 0)
      if (ids.length === 0) return false
      const labels: Record<MailView, string> = {
        inbox: "Posteingang",
        snoozed: "Zurückgestellt",
        sent: "Gesendet",
        drafts: "Entwürfe",
        archived: "Archiv",
        spam_review: "Spam prüfen",
        spam: "Spam",
        trash: "Papierkorb",
      }
      let ok = 0
      try {
        for (const id of ids) {
          const r = (await invokeRenderer(IPCChannels.Email.MoveMessageToView, {
            messageId: id,
            view: targetView,
          })) as { success: boolean; error?: string }
          if (r.success) ok += 1
        }
        toast.success(
          ok === 1 ? `Nachricht → ${labels[targetView]}` : `${ok} Nachrichten → ${labels[targetView]}`,
        )
        await refreshList({ preserveSelection: true })
        return ok > 0
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Verschieben fehlgeschlagen")
        if (ok > 0) await refreshList({ preserveSelection: true })
        return false
      }
    },
    [refreshList],
  )

  const handleSync = useCallback(
    async (opts?: HandleSyncOptions) => {
      if (selectedAccountId == null) return
      setSyncing(true)
      try {
        const accountIds =
          selectedAccountId === "all"
            ? ((await invokeRenderer(IPCChannels.Email.ListAccounts) as { id: number }[]).map((a) => a.id))
            : [selectedAccountId]
        let totalFetched = 0
        let completedCount = 0
        let queuedCount = 0
        let hadError = false
        for (const accountId of accountIds) {
          const result = await invokeRenderer(IPCChannels.Email.SyncAccount, accountId) as {
            success: boolean
            fetched?: number
            queued?: boolean
            error?: string
          }
          if (result.success) {
            if (result.queued) {
              queuedCount += 1
            } else {
              completedCount += 1
              totalFetched += result.fetched ?? 0
              if (opts?.onAfterSync) await opts.onAfterSync(accountId)
            }
          } else {
            hadError = true
            toast.error(
              formatEmailSyncError(
                result.error ?? `Sync fehlgeschlagen (Konto ${accountId}).`,
                accountId,
              ),
            )
          }
        }
        if (!hadError) {
          if (queuedCount > 0 && completedCount === 0) {
            toast.success(`${queuedCount} Synchronisations-Job${queuedCount === 1 ? "" : "s"} eingereiht.`)
          } else if (queuedCount > 0) {
            toast.success(
              `Synchronisation abgeschlossen (${totalFetched} neue/aktualisierte Nachrichten, ${queuedCount} Job${queuedCount === 1 ? "" : "s"} eingereiht).`,
            )
          } else {
            toast.success(
              `Synchronisation abgeschlossen (${totalFetched} neue/aktualisierte Nachrichten).`,
            )
          }
        }
        if (completedCount > 0) await refreshList({ preserveSelection: true })
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Sync fehlgeschlagen.")
      } finally {
        setSyncing(false)
      }
    },
    [selectedAccountId, refreshList],
  )

  const openMessage = useCallback(
    async (m: EmailMessage) => {
      try {
        const full = await invokeRenderer(IPCChannels.Email.GetMessage, m.id) as EmailMessage | null
        setSelectedMessage(full ?? m)
        if (!m.seen_local && m.uid >= 0) {
          await invokeRenderer(IPCChannels.Email.SetMessageSeen, { messageId: m.id, seen: true })
          patchMessageInList(m.id, { seen_local: 1 })
        }
      } catch (e) {
        logError("use-email-messages: open message", e)
        setSelectedMessage(m)
      }
    },
    [setSelectedMessage, patchMessageInList],
  )

  const refreshCurrentMessage = useCallback(async () => {
    if (!selectedMessage) return
    try {
      const full = await invokeRenderer(
        IPCChannels.Email.GetMessage,
        selectedMessage.id,
      ) as EmailMessage | null
      if (full) {
        setSelectedMessage(full)
        patchMessageInList(full.id, full)
      }
    } catch (e) {
      logError("use-email-messages: refresh current", e)
    }
  }, [selectedMessage, setSelectedMessage, patchMessageInList])

  const assignMessageCategory = useCallback(
    async (messageId: number, categoryId: number) => {
      try {
        await invokeRenderer(IPCChannels.Email.SetMessageCategory, {
          messageId,
          categoryId,
        })
        toast.success("Kategorie zugewiesen")
        if (selectedMessage?.id === messageId) {
          await refreshCurrentMessage()
        }
        bumpCategoryAssignmentRevision()
        await refreshList({ preserveSelection: true })
        return true
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Kategorie konnte nicht zugewiesen werden")
        return false
      }
    },
    [refreshList, refreshCurrentMessage, selectedMessage?.id, bumpCategoryAssignmentRevision],
  )

  const snoozeMessageUntilTomorrow = useCallback(
    async (messageId: number) => {
      const until = new Date()
      until.setDate(until.getDate() + 1)
      until.setHours(8, 0, 0, 0)
      try {
        await invokeRenderer(IPCChannels.Email.SnoozeMessage, {
          messageId,
          until: until.toISOString(),
        })
        toast.success("Nachricht zurückgestellt (morgen 8:00)")
        if (selectedMessage?.id === messageId && mailView !== "snoozed") {
          await advanceSelectionAfterMessageRemoved(messageId)
        } else {
          await refreshList({ preserveSelection: true })
        }
        return true
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Zurückstellen fehlgeschlagen")
        return false
      }
    },
    [mailView, refreshList, selectedMessage?.id, advanceSelectionAfterMessageRemoved],
  )

  return {
    messages,
    loadingMessages,
    loadingMore,
    hasMore,
    loadMore,
    syncing,
    handleSync,
    refreshList,
    openMessage,
    refreshCurrentMessage,
    moveMessageToView,
    moveMessagesToView,
    assignMessageCategory,
    assignMessagesCategory,
    snoozeMessageUntilTomorrow,
    advanceSelectionAfterMessageRemoved,
    removeMessagesFromList,
    patchMessageInList,
    scrollToMessageId,
    clearScrollToMessage,
  }
}
