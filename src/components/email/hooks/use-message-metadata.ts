"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import type { InternalNote, MessageAttachment } from "../types"
import { logError } from "../log"
import { useMailWorkspace } from "../workspace-context"
import { invokeRenderer } from "@/services/transport"

export function useMessageMetadata() {
  const { selectedMessage } = useMailWorkspace()
  const [messageTags, setMessageTags] = useState<string[]>([])
  const [internalNotes, setInternalNotes] = useState<InternalNote[]>([])
  const [messageAttachments, setMessageAttachments] = useState<MessageAttachment[]>([])

  useEffect(() => {
    if (!selectedMessage) {
      setMessageTags([])
      setInternalNotes([])
      setMessageAttachments([])
      return
    }
    void (async () => {
      try {
        setMessageTags(
          await invokeRenderer(IPCChannels.Email.ListMessageTags, selectedMessage.id) as string[],
        )
        setInternalNotes(
          await invokeRenderer(
            IPCChannels.Email.ListInternalNotes,
            selectedMessage.id,
          ) as InternalNote[],
        )
        setMessageAttachments(
          await invokeRenderer(
            IPCChannels.Email.ListMessageAttachments,
            selectedMessage.id,
          ) as MessageAttachment[],
        )
      } catch (e) {
        logError("use-message-metadata: load", e)
        setMessageTags([])
        setInternalNotes([])
        setMessageAttachments([])
      }
    })()
  }, [selectedMessage])

  const reloadNotes = useCallback(async () => {
    if (!selectedMessage) return
    try {
      setInternalNotes(
        await invokeRenderer(IPCChannels.Email.ListInternalNotes, selectedMessage.id) as InternalNote[],
      )
    } catch (e) {
      logError("use-message-metadata: reload notes", e)
    }
  }, [selectedMessage])

  const reloadTags = useCallback(async () => {
    if (!selectedMessage) return
    try {
      setMessageTags(
        await invokeRenderer(IPCChannels.Email.ListMessageTags, selectedMessage.id) as string[],
      )
    } catch (e) {
      logError("use-message-metadata: reload tags", e)
    }
  }, [selectedMessage])

  return {
    messageTags,
    internalNotes,
    messageAttachments,
    reloadNotes,
    reloadTags,
  }
}
