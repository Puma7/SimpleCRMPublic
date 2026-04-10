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

/**
 * Shared lookup data used by the compose dialog, metadata panel and settings.
 * Customers, canned responses and AI prompts.
 */
export function useMailAuxData() {
  const [customers, setCustomers] = useState<CustomerOpt[]>([])
  const [cannedList, setCannedList] = useState<CannedResponse[]>([])
  const [aiPrompts, setAiPrompts] = useState<AiPrompt[]>([])

  useEffect(() => {
    if (!hasElectron()) return
    void (async () => {
      try {
        const dd = await invokeIpc<CustomerOpt[]>(IPCChannels.Db.GetCustomersDropdown)
        setCustomers(dd)
      } catch {
        setCustomers([])
      }
      try {
        setCannedList(await invokeIpc<CannedResponse[]>(IPCChannels.Email.ListCannedResponses))
      } catch {
        setCannedList([])
      }
      try {
        setAiPrompts(await invokeIpc<AiPrompt[]>(IPCChannels.Email.ListAiPrompts))
      } catch {
        setAiPrompts([])
      }
    })()
  }, [])

  const reloadCanned = async () => {
    if (!hasElectron()) return
    try {
      setCannedList(await invokeIpc<CannedResponse[]>(IPCChannels.Email.ListCannedResponses))
    } catch {
      /* ignore */
    }
  }

  const reloadPrompts = async () => {
    if (!hasElectron()) return
    try {
      setAiPrompts(await invokeIpc<AiPrompt[]>(IPCChannels.Email.ListAiPrompts))
    } catch {
      /* ignore */
    }
  }

  return { customers, cannedList, aiPrompts, reloadCanned, reloadPrompts }
}
