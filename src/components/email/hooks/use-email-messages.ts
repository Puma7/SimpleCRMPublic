"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import type { MessageListSortMode } from "@shared/email-list-options"
import type { MessageListFilter } from "@shared/email-list-filters"
import type { MailAccountScope } from "../account-scope"
import { hasElectron, invokeIpc, type EmailMessage, type MailView } from "../types"
import { logError } from "../log"
import { useMailWorkspace } from "../workspace-context"

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
  } = useMailWorkspace()
  const [messages, setMessages] = useState<EmailMessage[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [debouncedSearchQ, setDebouncedSearchQ] = useState("")
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selectedMessageIdRef = useRef<number | null>(null)
  const offsetRef = useRef(0)

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
      opts?: { preserveSelection?: boolean; append?: boolean },
    ) => {
      if (!hasElectron()) return
      const append = opts?.append ?? false
      const offset = append ? offsetRef.current : 0
      const keepId = opts?.preserveSelection ? selectedMessageIdRef.current ?? undefined : undefined
      if (append) setLoadingMore(true)
      else setLoadingMessages(true)
      try {
        let list: EmailMessage[]
        if (query.trim() && view !== "trash") {
          const res = await invokeIpc<{
            messages: EmailMessage[]
            searchMode: "fts" | "like" | "regex"
            hasMore?: boolean
          }>(IPCChannels.Email.SearchMessages, {
            accountId: accountScope,
            query: query.trim(),
            limit: PAGE_SIZE,
            offset,
            view,
            categoryId: view === "inbox" ? catId : null,
          })
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
          list = await invokeIpc<EmailMessage[]>(IPCChannels.Email.ListMessagesByView, {
            accountId: accountScope,
            view,
            limit: PAGE_SIZE,
            offset,
            categoryId: view === "inbox" ? catId : null,
            sort,
            listFilter: listFilter === "all" ? undefined : listFilter,
          })
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
        if (keepId != null && !append) {
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
    [setSelectedMessage],
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
    loadMessages,
  ])

  const refreshList = useCallback(
    async (opts?: { preserveSelection?: boolean }) => {
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
      loadMessages,
    ],
  )

  const moveMessageToView = useCallback(
    async (messageId: number, targetView: MailView) => {
      if (!hasElectron()) return false
      try {
        const r = await invokeIpc<{ success: boolean; error?: string }>(
          IPCChannels.Email.MoveMessageToView,
          { messageId, view: targetView },
        )
        if (!r.success) {
          toast.error(r.error ?? "Verschieben fehlgeschlagen")
          return false
        }
        const labels: Record<MailView, string> = {
          inbox: "Posteingang",
          sent: "Gesendet",
          drafts: "Entwürfe",
          archived: "Archiv",
          spam: "Spam",
          trash: "Papierkorb",
        }
        toast.success(`Nachricht → ${labels[targetView]}`)
        if (selectedMessage?.id === messageId && targetView !== mailView) {
          setSelectedMessage(null)
        }
        await refreshList()
        return true
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Verschieben fehlgeschlagen")
        return false
      }
    },
    [mailView, refreshList, selectedMessage?.id, setSelectedMessage],
  )

  const handleSync = useCallback(
    async (opts?: HandleSyncOptions) => {
      if (!hasElectron() || selectedAccountId == null) return
      setSyncing(true)
      try {
        const accountIds =
          selectedAccountId === "all"
            ? (await invokeIpc<{ id: number }[]>(IPCChannels.Email.ListAccounts)).map((a) => a.id)
            : [selectedAccountId]
        let totalFetched = 0
        let hadError = false
        for (const accountId of accountIds) {
          const result = await invokeIpc<{
            success: boolean
            fetched?: number
            error?: string
          }>(IPCChannels.Email.SyncAccount, accountId)
          if (result.success) {
            totalFetched += result.fetched ?? 0
            if (opts?.onAfterSync) await opts.onAfterSync(accountId)
          } else {
            hadError = true
            toast.error(result.error ?? `Sync fehlgeschlagen (Konto ${accountId}).`)
          }
        }
        if (!hadError) {
          toast.success(
            `Synchronisation abgeschlossen (${totalFetched} neue/aktualisierte Nachrichten).`,
          )
        }
        await refreshList({ preserveSelection: true })
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
      if (!hasElectron()) {
        setSelectedMessage(m)
        return
      }
      try {
        const full = await invokeIpc<EmailMessage | null>(IPCChannels.Email.GetMessage, m.id)
        setSelectedMessage(full ?? m)
        if (!m.seen_local && m.uid >= 0) {
          await invokeIpc(IPCChannels.Email.SetMessageSeen, { messageId: m.id, seen: true })
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
    if (!selectedMessage || !hasElectron()) return
    try {
      const full = await invokeIpc<EmailMessage | null>(
        IPCChannels.Email.GetMessage,
        selectedMessage.id,
      )
      setSelectedMessage(full ?? selectedMessage)
    } catch (e) {
      logError("use-email-messages: refresh current", e)
    }
  }, [selectedMessage, setSelectedMessage])

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
  }
}
