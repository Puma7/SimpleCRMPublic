"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { hasElectron, invokeIpc, type EmailAccount, type TeamMember } from "../types"
import { logError } from "../log"
import { useMailWorkspace } from "../workspace-context"

export function useEmailAccounts() {
  const { setSelectedAccountId } = useMailWorkspace()
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(true)

  const loadAccounts = useCallback(async () => {
    if (!hasElectron()) {
      setLoadingAccounts(false)
      return
    }
    setLoadingAccounts(true)
    try {
      const list = await invokeIpc<EmailAccount[]>(IPCChannels.Email.ListAccounts)
      setAccounts(list)
      // Functional update avoids stale-closure: only initialise to list[0] when
      // the user has not picked an account yet. Preserves existing selection
      // on every subsequent reload (e.g. after adding an account in Settings).
      setSelectedAccountId((prev) =>
        prev === null && list.length > 0 ? list[0]!.id : prev,
      )
      try {
        setTeamMembers(await invokeIpc<TeamMember[]>(IPCChannels.Email.ListTeamMembers))
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

  useEffect(() => {
    void loadAccounts()
  }, [loadAccounts])

  return {
    accounts,
    teamMembers,
    loadingAccounts,
    loadAccounts,
  }
}
