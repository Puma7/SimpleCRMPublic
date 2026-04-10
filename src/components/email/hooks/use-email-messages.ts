"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { hasElectron, invokeIpc, type EmailMessage, type MailView } from "../types"
import { useMailWorkspace } from "../workspace-context"

export function useEmailMessages() {
  const {
    selectedAccountId,
    mailView,
    categoryFilterId,
    searchQuery,
    selectedMessage,
    setSelectedMessage,
  } = useMailWorkspace()
  const [messages, setMessages] = useState<EmailMessage[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [debouncedSearchQ, setDebouncedSearchQ] = useState("")
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    async (accountId: number, view: MailView, catId: number | null, query: string) => {
      if (!hasElectron()) return
      setLoadingMessages(true)
      try {
        let list: EmailMessage[]
        if (query.trim()) {
          list = await invokeIpc<EmailMessage[]>(IPCChannels.Email.SearchMessages, {
            accountId,
            query: query.trim(),
            limit: 150,
          })
        } else {
          list = await invokeIpc<EmailMessage[]>(IPCChannels.Email.ListMessagesByView, {
            accountId,
            view,
            limit: 250,
            categoryId: view === "inbox" ? catId : null,
          })
        }
        setMessages(list)
        setSelectedMessage(null)
      } catch (e) {
        console.error(e)
        toast.error("Nachrichten konnten nicht geladen werden.")
      } finally {
        setLoadingMessages(false)
      }
    },
    [setSelectedMessage],
  )

  useEffect(() => {
    if (selectedAccountId != null) {
      void loadMessages(selectedAccountId, mailView, categoryFilterId, debouncedSearchQ)
    } else {
      setMessages([])
    }
  }, [selectedAccountId, mailView, categoryFilterId, debouncedSearchQ, loadMessages])

  const openMessage = useCallback(
    async (m: EmailMessage) => {
      if (!hasElectron()) {
        setSelectedMessage(m)
        return
      }
      try {
        const full = await invokeIpc<EmailMessage | null>(IPCChannels.Email.GetMessage, m.id)
        setSelectedMessage(full ?? m)
      } catch {
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
    } catch {
      /* ignore */
    }
  }, [selectedMessage, setSelectedMessage])

  const refreshList = useCallback(async () => {
    if (selectedAccountId != null) {
      await loadMessages(selectedAccountId, mailView, categoryFilterId, debouncedSearchQ)
    }
  }, [selectedAccountId, mailView, categoryFilterId, debouncedSearchQ, loadMessages])

  const handleSync = useCallback(async () => {
    if (!hasElectron() || selectedAccountId == null) return
    setSyncing(true)
    try {
      const result = await invokeIpc<{ success: boolean; fetched?: number; error?: string }>(
        IPCChannels.Email.SyncAccount,
        selectedAccountId,
      )
      if (result.success) {
        toast.success(
          `Synchronisation abgeschlossen (${result.fetched ?? 0} neue/aktualisierte Nachrichten).`,
        )
        await loadMessages(selectedAccountId, mailView, categoryFilterId, debouncedSearchQ)
      } else toast.error(result.error ?? "Sync fehlgeschlagen.")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync fehlgeschlagen.")
    } finally {
      setSyncing(false)
    }
  }, [selectedAccountId, mailView, categoryFilterId, debouncedSearchQ, loadMessages])

  return {
    messages,
    loadingMessages,
    syncing,
    openMessage,
    refreshList,
    refreshCurrentMessage,
    handleSync,
  }
}
