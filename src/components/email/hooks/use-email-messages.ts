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

type HandleSyncOptions = {
  onAfterSync?: (accountId: number) => void | Promise<void>
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
  } = useMailWorkspace()
  const [messages, setMessages] = useState<EmailMessage[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [debouncedSearchQ, setDebouncedSearchQ] = useState("")
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selectedMessageIdRef = useRef<number | null>(null)
  const messagesRef = useRef<EmailMessage[]>([])
  const offsetRef = useRef(0)

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

  const loadMessages = useCallback(
    async (
      accountScope: MailAccountScope,
      view: MailView,
      catId: number | null,
      query: string,
      sort: MessageListSortMode,
      listFilter: MessageListFilter,
      opts?: {
        preserveSelection?: boolean
        append?: boolean
        /** After reload, select this id (full fetch). Falls back if id missing. */
        selectMessageId?: number | null
        /** Used with selectMessageId when preferred row is no longer in the list. */
        advanceFromRemovedId?: number
      },
    ) => {
      const append = opts?.append ?? false
      const offset = append ? offsetRef.current : 0
      const keepId = opts?.preserveSelection ? selectedMessageIdRef.current ?? undefined : undefined
      if (append) setLoadingMore(true)
      else setLoadingMessages(true)
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
          if (res.searchMode === "like") {
            toast.info("Erweiterte Suche (LIKE) — bei großen Postfächern kann das dauern.", {
              id: "search-like-fallback",
              duration: 4000,
            })
          } else if (res.searchMode === "regex") {
            toast.info("Regex-Suche aktiv (/muster/flags).", { id: "search-regex", duration: 3000 })
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
        } else {
          setMessages(list)
          offsetRef.current = list.length
        }
        if (!append && opts?.selectMessageId !== undefined) {
          let targetId = opts.selectMessageId
          if (targetId != null && !list.some((m) => m.id === targetId)) {
            const removed = opts.advanceFromRemovedId ?? targetId
            targetId = pickAdjacentMessageId(list, removed)
          }
          if (targetId == null) {
            setSelectedMessage(null)
          } else {
            const row = list.find((m) => m.id === targetId)
            if (row) {
              try {
                const full = await invokeRenderer(
                  IPCChannels.Email.GetMessage,
                  row.id,
                ) as EmailMessage | null
                setSelectedMessage(full ?? row)
              } catch {
                setSelectedMessage(row)
              }
            } else {
              setSelectedMessage(null)
            }
          }
        } else if (keepId != null && !append) {
          const still = list.find((m) => m.id === keepId)
          if (still) {
            setSelectedMessage((prev) =>
              prev?.id === keepId ? { ...prev, ...still } : still,
            )
          }
        } else if (!append && keepId == null) {
          setSelectedMessage(null)
        }
      } catch (e) {
        logError("use-email-messages: load", e)
        toast.error("Nachrichten konnten nicht geladen werden.")
      } finally {
        setLoadingMessages(false)
        setLoadingMore(false)
      }
    },
    [setSelectedMessage, messageDoneFilter],
  )

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
    }) => {
      offsetRef.current = 0
      if (selectedAccountId == null) return
      await loadMessages(
        selectedAccountId,
        mailView,
        categoryFilterId,
        debouncedSearchQ,
        listSortMode,
        messageListFilter,
        opts,
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
      const preferredId = pickAdjacentMessageId(messagesRef.current, removedId)
      await refreshList({
        selectMessageId: preferredId,
        advanceFromRemovedId: removedId,
      })
    },
    [refreshList],
  )

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
      // Drag-drop semantics: ADD the category (don't replace existing ones).
      // Idempotent per message: the transport reports { added, alreadyAssigned }.
      let added = 0
      let already = 0
      let noop = 0
      try {
        for (const id of ids) {
          const result = (await invokeRenderer(IPCChannels.Email.AddMessageCategory, {
            messageId: id,
            categoryId,
          })) as { added?: boolean; alreadyAssigned?: boolean }
          if (result?.added) added += 1
          else if (result?.alreadyAssigned) already += 1
          else noop += 1
        }
        if (added === 0 && already === 0) {
          toast.error(
            noop > 0
              ? "Kategorisieren fehlgeschlagen"
              : "Keine Nachricht konnte kategorisiert werden",
          )
          return false
        }
        if (added === 0 && already > 0) {
          toast.info(already === 1 ? "Bereits in dieser Kategorie" : `Alle ${already} Mails bereits in dieser Kategorie`)
        } else if (added > 0 && already > 0) {
          toast.success(`${added} hinzugefügt, ${already} bereits drin`)
        } else {
          toast.success(added === 1 ? "Kategorie hinzugefügt" : `${added} Nachrichten kategorisiert`)
        }
        await refreshList({ preserveSelection: true })
        return added > 0 || already > 0
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Kategorisieren fehlgeschlagen")
        if (added > 0) await refreshList({ preserveSelection: true })
        return false
      }
    },
    [refreshList],
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
          setMessages((prev) =>
            prev.map((row) => (row.id === m.id ? { ...row, seen_local: 1 } : row)),
          )
        }
      } catch (e) {
        logError("use-email-messages: open message", e)
        setSelectedMessage(m)
      }
    },
    [setSelectedMessage],
  )

  const refreshCurrentMessage = useCallback(async () => {
    if (!selectedMessage) return
    try {
      const full = await invokeRenderer(
        IPCChannels.Email.GetMessage,
        selectedMessage.id,
      ) as EmailMessage | null
      setSelectedMessage(full ?? selectedMessage)
    } catch (e) {
      logError("use-email-messages: refresh current", e)
    }
  }, [selectedMessage, setSelectedMessage])

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
        await refreshList({ preserveSelection: true })
        return true
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Kategorie konnte nicht zugewiesen werden")
        return false
      }
    },
    [refreshList, refreshCurrentMessage, selectedMessage?.id],
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
  }
}
