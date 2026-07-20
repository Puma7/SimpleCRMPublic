"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import type { EmailAccount, TeamMember } from "../types"
import { logError } from "../log"
import { useMailWorkspace } from "../workspace-context"
import {
  invokeRenderer,
  isMailAclRefreshEvent,
  subscribeServerEvents,
} from "@/services/transport"

export function useEmailAccounts() {
  const {
    setCategoryFilterId,
    setMailView,
    setSelectedAccountId,
    setSelectedMessage,
    accountsRevision,
  } = useMailWorkspace()
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(true)
  const mountedRef = useRef(true)
  const loadGenerationRef = useRef(0)

  const loadAccounts = useCallback(async () => {
    const generation = ++loadGenerationRef.current
    if (!mountedRef.current) return
    setLoadingAccounts(true)
    try {
      const list = await invokeRenderer(IPCChannels.Email.ListAccounts) as EmailAccount[]
      if (!mountedRef.current || generation !== loadGenerationRef.current) return
      setAccounts(list)
      // Functional update avoids stale-closure and drops selections that became
      // invisible after a server-side ACL change.
      setSelectedAccountId((prev) => {
        if (list.length === 0) return null
        const stillVisible = typeof prev === "number" && list.some((account) => account.id === prev)
        if (prev === "all" && list.length < 2) return list[0]!.id
        if (prev === "all") return "all"
        if (stillVisible) return prev
        if (list.length > 1) return "all"
        return list[0]!.id
      })
      try {
        const members = await invokeRenderer(IPCChannels.Email.ListTeamMembers) as TeamMember[]
        if (!mountedRef.current || generation !== loadGenerationRef.current) return
        setTeamMembers(members)
      } catch (e) {
        if (!mountedRef.current || generation !== loadGenerationRef.current) return
        logError("use-email-accounts: list team members", e)
        setTeamMembers([])
      }
    } catch (e) {
      if (!mountedRef.current || generation !== loadGenerationRef.current) return
      logError("use-email-accounts: list accounts", e)
      toast.error("Konten konnten nicht geladen werden.")
    } finally {
      if (mountedRef.current && generation === loadGenerationRef.current) {
        setLoadingAccounts(false)
      }
    }
  }, [setSelectedAccountId])

  const invalidateAclState = useCallback(() => {
    loadGenerationRef.current += 1
    if (!mountedRef.current) return
    setAccounts([])
    setTeamMembers([])
    setSelectedAccountId(null)
    setMailView("inbox")
    setCategoryFilterId(null)
    setSelectedMessage(null)
    setLoadingAccounts(true)
  }, [setCategoryFilterId, setMailView, setSelectedAccountId, setSelectedMessage])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      loadGenerationRef.current += 1
    }
  }, [])

  // Re-run on mount AND whenever bumpAccountsRevision() is called from a
  // settings panel that mutated the account list.
  useEffect(() => {
    void loadAccounts()
  }, [loadAccounts, accountsRevision])

  useEffect(() => {
    const subscription = subscribeServerEvents({
      onEvent(event) {
        if (!isMailAclRefreshEvent(event)) return
        invalidateAclState()
        void loadAccounts()
      },
    })
    return () => subscription.unsubscribe()
  }, [invalidateAclState, loadAccounts])

  return {
    accounts,
    teamMembers,
    loadingAccounts,
    loadAccounts,
  }
}
