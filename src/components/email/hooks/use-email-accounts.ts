"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { hasElectron, invokeIpc, type EmailAccount, type TeamMember } from "../types"
import { useMailWorkspace } from "../workspace-context"

export function useEmailAccounts() {
  const { selectedAccountId, setSelectedAccountId } = useMailWorkspace()
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
      setSelectedAccountId(
        selectedAccountId === null && list.length > 0 ? list[0]!.id : selectedAccountId,
      )
      try {
        setTeamMembers(await invokeIpc<TeamMember[]>(IPCChannels.Email.ListTeamMembers))
      } catch {
        setTeamMembers([])
      }
    } catch (e) {
      console.error(e)
      toast.error("Konten konnten nicht geladen werden.")
    } finally {
      setLoadingAccounts(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
