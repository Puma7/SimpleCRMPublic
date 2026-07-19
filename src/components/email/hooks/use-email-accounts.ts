"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import type { EmailAccount, TeamMember } from "../types"
import { logError } from "../log"
import { useMailWorkspace } from "../workspace-context"
import { invokeRenderer } from "@/services/transport"

export function useEmailAccounts() {
  const { setSelectedAccountId, accountsRevision } = useMailWorkspace()
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(true)

  const loadAccounts = useCallback(async () => {
    setLoadingAccounts(true)
    try {
      const list = await invokeRenderer(IPCChannels.Email.ListAccounts) as EmailAccount[]
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
        setTeamMembers(
          await invokeRenderer(IPCChannels.Email.ListTeamMembers) as TeamMember[],
        )
      } catch (e) {
        logError("use-email-accounts: list team members", e)
        setTeamMembers([])
      }
    } catch (e) {
      logError("use-email-accounts: list accounts", e)
      toast.error("Konten konnten nicht geladen werden.")
    } finally {
      setLoadingAccounts(false)
    }
  }, [setSelectedAccountId])

  // Re-run on mount AND whenever bumpAccountsRevision() is called from a
  // settings panel that mutated the account list.
  useEffect(() => {
    void loadAccounts()
  }, [loadAccounts, accountsRevision])

  return {
    accounts,
    teamMembers,
    loadingAccounts,
    loadAccounts,
  }
}
