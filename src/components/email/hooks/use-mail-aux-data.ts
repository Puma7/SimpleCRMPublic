"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import {
  type AiPrompt,
  type CannedResponse,
} from "../types"
import { logError } from "../log"
import { useMailWorkspace } from "../workspace-context"
import { invokeRenderer } from "@/services/transport"

/**
 * Shared lookup data for the compose dialog (canned responses, AI prompts).
 * Loaded lazily on first compose open.
 */
export function useMailAuxData() {
  const { composeIntent, selectedAccountScope } = useMailWorkspace()
  const [cannedList, setCannedList] = useState<CannedResponse[]>([])
  const [aiPrompts, setAiPrompts] = useState<AiPrompt[]>([])
  const composeMessageAccountId =
    composeIntent.mode === "reply" ||
    composeIntent.mode === "reply-all" ||
    composeIntent.mode === "forward"
      ? composeIntent.message.account_id ?? undefined
      : composeIntent.mode === "new" && typeof selectedAccountScope === "number"
        ? selectedAccountScope
        : undefined

  // Canned responses + AI prompts: lazy on first compose open
  // (parity with old page.tsx:286-297).
  const composeOpen = composeIntent.mode !== "closed"
  useEffect(() => {
    if (!composeOpen) return
    void (async () => {
      try {
        setCannedList(
          composeMessageAccountId != null
            ? await invokeRenderer(IPCChannels.Email.ListCannedResponses, { accountId: composeMessageAccountId }) as CannedResponse[]
            : await invokeRenderer(IPCChannels.Email.ListCannedResponses) as CannedResponse[],
        )
      } catch (e) {
        logError("use-mail-aux-data: load canned", e)
        setCannedList([])
      }
      try {
        setAiPrompts(
          composeMessageAccountId != null
            ? await invokeRenderer(IPCChannels.Email.ListAiPrompts, { accountId: composeMessageAccountId }) as AiPrompt[]
            : await invokeRenderer(IPCChannels.Email.ListAiPrompts) as AiPrompt[],
        )
      } catch (e) {
        logError("use-mail-aux-data: load prompts", e)
        setAiPrompts([])
      }
    })()
  }, [composeOpen, composeMessageAccountId])

  const reloadCanned = useCallback(async () => {
    try {
      setCannedList(
        composeMessageAccountId != null
          ? await invokeRenderer(IPCChannels.Email.ListCannedResponses, { accountId: composeMessageAccountId }) as CannedResponse[]
          : await invokeRenderer(IPCChannels.Email.ListCannedResponses) as CannedResponse[],
      )
    } catch (e) {
      logError("use-mail-aux-data: reload canned", e)
    }
  }, [composeMessageAccountId])

  const reloadPrompts = useCallback(async () => {
    try {
      setAiPrompts(
        composeMessageAccountId != null
          ? await invokeRenderer(IPCChannels.Email.ListAiPrompts, { accountId: composeMessageAccountId }) as AiPrompt[]
          : await invokeRenderer(IPCChannels.Email.ListAiPrompts) as AiPrompt[],
      )
    } catch (e) {
      logError("use-mail-aux-data: reload prompts", e)
    }
  }, [composeMessageAccountId])

  return { cannedList, aiPrompts, reloadCanned, reloadPrompts }
}
