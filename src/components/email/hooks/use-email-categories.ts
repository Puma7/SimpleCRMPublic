"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { hasElectron, invokeIpc, type CategoryRow, type CatCount } from "../types"
import { logError } from "../log"
import { useMailWorkspace } from "../workspace-context"

export function useEmailCategories() {
  const { selectedAccountId } = useMailWorkspace()
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [catCounts, setCatCounts] = useState<CatCount[]>([])

  const loadCategories = useCallback(async (accountId: number) => {
    if (!hasElectron()) return
    try {
      const cats = await invokeIpc<CategoryRow[]>(IPCChannels.Email.ListCategories)
      setCategories(cats)
      const counts = await invokeIpc<CatCount[]>(IPCChannels.Email.CategoryCounts, accountId)
      setCatCounts(counts)
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
  }, [selectedAccountId, loadCategories])

  const countForCategory = useCallback(
    (id: number) => catCounts.find((c) => c.categoryId === id)?.count ?? 0,
    [catCounts],
  )

  return { categories, catCounts, countForCategory, loadCategories }
}
