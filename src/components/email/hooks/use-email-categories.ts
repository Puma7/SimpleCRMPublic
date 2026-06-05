"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import type { MailAccountScope } from "../account-scope"
import type { CategoryRow, CatCount } from "../types"
import { logError } from "../log"
import { useMailWorkspace } from "../workspace-context"
import { invokeRenderer } from "@/services/transport"

export function useEmailCategories() {
  const { selectedAccountId, mailMetricsRevision } = useMailWorkspace()
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [catCounts, setCatCounts] = useState<CatCount[]>([])

  const loadCategories = useCallback(async (accountScope: MailAccountScope) => {
    try {
      const cats = await invokeRenderer(IPCChannels.Email.ListCategories) as CategoryRow[]
      setCategories(cats)
      try {
        const counts = await invokeRenderer(
          IPCChannels.Email.CategoryCounts,
          accountScope,
        ) as CatCount[]
        setCatCounts(counts)
      } catch (e) {
        logError("use-email-categories: counts", e)
        setCatCounts([])
      }
    } catch (e) {
      logError("use-email-categories: load", e)
      setCategories([])
      setCatCounts([])
    }
  }, [])

  useEffect(() => {
    if (selectedAccountId != null) {
      void loadCategories(selectedAccountId)
    }
  }, [selectedAccountId, mailMetricsRevision, loadCategories])

  const countForCategory = useCallback(
    (id: number) => catCounts.find((c) => c.categoryId === id)?.count ?? 0,
    [catCounts],
  )

  return { categories, catCounts, countForCategory, loadCategories }
}
