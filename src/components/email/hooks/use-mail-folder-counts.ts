"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import type { MailAccountScope } from "../account-scope"
import { hasElectron, invokeIpc } from "../types"
import { useMailWorkspace } from "../workspace-context"

export type MailFolderCounts = {
  inbox: number
  inboxUnread: number
  sentFailed: number
  drafts: number
  archived: number
  spam: number
  trash: number
  snoozed: number
}

const EMPTY: MailFolderCounts = {
  inbox: 0,
  inboxUnread: 0,
  sentFailed: 0,
  drafts: 0,
  archived: 0,
  spam: 0,
  trash: 0,
  snoozed: 0,
}

export function useMailFolderCounts() {
  const { selectedAccountId, accountsRevision, mailView } = useMailWorkspace()
  const [counts, setCounts] = useState<MailFolderCounts>(EMPTY)

  const load = useCallback(async (accountScope: MailAccountScope) => {
    if (!hasElectron()) return
    try {
      const c = await invokeIpc<MailFolderCounts>(
        IPCChannels.Email.MailFolderCounts,
        accountScope,
      )
      setCounts(c)
    } catch {
      setCounts(EMPTY)
    }
  }, [])

  useEffect(() => {
    if (selectedAccountId != null) {
      void load(selectedAccountId)
    } else {
      setCounts(EMPTY)
    }
  }, [selectedAccountId, accountsRevision, mailView, load])

  return { counts, reloadCounts: load }
}
