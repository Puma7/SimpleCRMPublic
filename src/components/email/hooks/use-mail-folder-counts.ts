"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { invokeRenderer } from "@/services/transport"
import type { MailAccountScope } from "../account-scope"
import { useMailWorkspace } from "../workspace-context"

export type MailFolderCounts = {
  inbox: number
  inboxUnread: number
  sentFailed: number
  drafts: number
  archived: number
  spamReview: number
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
  spamReview: 0,
  spam: 0,
  trash: 0,
  snoozed: 0,
}

export function useMailFolderCounts() {
  const { selectedAccountId, accountsRevision, mailView, mailMetricsRevision } =
    useMailWorkspace()
  const [counts, setCounts] = useState<MailFolderCounts>(EMPTY)

  const load = useCallback(async (accountScope: MailAccountScope) => {
    try {
      const c = await invokeRenderer(
        IPCChannels.Email.MailFolderCounts,
        accountScope,
      ) as MailFolderCounts
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
  }, [selectedAccountId, accountsRevision, mailView, mailMetricsRevision, load])

  return { counts, reloadCounts: load }
}
