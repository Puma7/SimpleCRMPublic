"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import type { MailAccountScope } from "../account-scope"
import { hasElectron, invokeIpc, type EmailMessage, type MailView } from "../types"
import { logError } from "../log"
import { useMailWorkspace } from "../workspace-context"

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
    async (accountScope: MailAccountScope, view: MailView, catId: number | null, query: string) => {
      if (!hasElectron()) return
      setLoadingMessages(true)
      try {
        let list: EmailMessage[]
        if (query.trim() && view !== "trash") {
          list = await invokeIpc<EmailMessage[]>(IPCChannels.Email.SearchMessages, {
            accountId: accountScope,
            query: query.trim(),
            limit: 150,
            view,
          })
        } else {
          list = await invokeIpc<EmailMessage[]>(IPCChannels.Email.ListMessagesByView, {
            accountId: accountScope,
            view,
            limit: 250,
            categoryId: view === "inbox" ? catId : null,
          })
        }
        setMessages(list)
        setSelectedMessage(null)
      } catch (e) {
        logError("use-email-messages: load", e)
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
        const msg = full ?? m
        setSelectedMessage(msg)
        if (m.uid >= 0 && !m.seen_local) {
          await invokeIpc(IPCChannels.Email.SetMessageSeen, {
            messageId: m.id,
            seen: true,
          })
          setSelectedMessage({ ...msg, seen_local: 1 })
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

  const refreshList = useCallback(async () => {
    if (selectedAccountId != null) {
      await loadMessages(selectedAccountId, mailView, categoryFilterId, debouncedSearchQ)
    }
  }, [selectedAccountId, mailView, categoryFilterId, debouncedSearchQ, loadMessages])

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
        await loadMessages(selectedAccountId, mailView, categoryFilterId, debouncedSearchQ)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Sync fehlgeschlagen.")
      } finally {
        setSyncing(false)
      }
    },
    [selectedAccountId, mailView, categoryFilterId, debouncedSearchQ, loadMessages],
  )

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
