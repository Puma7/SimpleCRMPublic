"use client"

import { useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import {
  hasElectron,
  invokeIpc,
  type AiPrompt,
  type CannedResponse,
  type CustomerOpt,
} from "../types"
import { logError } from "../log"
import { useMailWorkspace } from "../workspace-context"

/**
 * Shared lookup data used by the compose dialog and the metadata panel.
 *
 * Matches the split from the old page.tsx:
 *  - `customers` is loaded once on page mount (needed for the metadata panel
 *    regardless of whether the composer is open).
 *  - `cannedList` and `aiPrompts` are loaded lazily the first time the
 *    composer opens, so users who never touch the composer pay zero IPC cost.
 */
export function useMailAuxData() {
  const { composeIntent } = useMailWorkspace()
  const [customers, setCustomers] = useState<CustomerOpt[]>([])
  const [cannedList, setCannedList] = useState<CannedResponse[]>([])
  const [aiPrompts, setAiPrompts] = useState<AiPrompt[]>([])

  // Customers: on mount (parity with old page.tsx:274-284).
  useEffect(() => {
    if (!hasElectron()) return
    void (async () => {
      try {
        const dd = await invokeIpc<CustomerOpt[]>(IPCChannels.Db.GetCustomersDropdown)
        setCustomers(dd)
      } catch (e) {
        logError("use-mail-aux-data: load customers", e)
        setCustomers([])
      }
    })()
  }, [])

  // Canned responses + AI prompts: lazy on first compose open
  // (parity with old page.tsx:286-297).
  const composeOpen = composeIntent.mode !== "closed"
  useEffect(() => {
    if (!hasElectron() || !composeOpen) return
    void (async () => {
      try {
        setCannedList(
          await invokeIpc<CannedResponse[]>(IPCChannels.Email.ListCannedResponses),
        )
      } catch (e) {
        logError("use-mail-aux-data: load canned", e)
        setCannedList([])
      }
      try {
        setAiPrompts(await invokeIpc<AiPrompt[]>(IPCChannels.Email.ListAiPrompts))
      } catch (e) {
        logError("use-mail-aux-data: load prompts", e)
        setAiPrompts([])
      }
    })()
  }, [composeOpen])

  const reloadCanned = async () => {
    if (!hasElectron()) return
    try {
      setCannedList(
        await invokeIpc<CannedResponse[]>(IPCChannels.Email.ListCannedResponses),
      )
    } catch (e) {
      logError("use-mail-aux-data: reload canned", e)
    }
  }

  const reloadPrompts = async () => {
    if (!hasElectron()) return
    try {
      setAiPrompts(await invokeIpc<AiPrompt[]>(IPCChannels.Email.ListAiPrompts))
    } catch (e) {
      logError("use-mail-aux-data: reload prompts", e)
    }
  }

  return { customers, cannedList, aiPrompts, reloadCanned, reloadPrompts }
}
