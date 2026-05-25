"use client"

import { useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import {
  hasElectron,
  invokeIpc,
  type AiPrompt,
  type CannedResponse,
} from "../types"
import { logError } from "../log"
import { useMailWorkspace } from "../workspace-context"

/**
 * Shared lookup data for the compose dialog (canned responses, AI prompts).
 * Loaded lazily on first compose open.
 */
export function useMailAuxData() {
  const { composeIntent } = useMailWorkspace()
  const [cannedList, setCannedList] = useState<CannedResponse[]>([])
  const [aiPrompts, setAiPrompts] = useState<AiPrompt[]>([])

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

  return { cannedList, aiPrompts, reloadCanned, reloadPrompts }
}
