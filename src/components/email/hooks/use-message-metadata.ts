"use client"

import { useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { hasElectron, invokeIpc, type InternalNote, type MessageAttachment } from "../types"
import { logError } from "../log"
import { useMailWorkspace } from "../workspace-context"

export function useMessageMetadata() {
  const { selectedMessage } = useMailWorkspace()
  const [messageTags, setMessageTags] = useState<string[]>([])
  const [internalNotes, setInternalNotes] = useState<InternalNote[]>([])
  const [messageAttachments, setMessageAttachments] = useState<MessageAttachment[]>([])

  useEffect(() => {
    if (!hasElectron() || !selectedMessage) {
      setMessageTags([])
      setInternalNotes([])
      setMessageAttachments([])
      return
    }
    void (async () => {
      try {
        setMessageTags(
          await invokeIpc<string[]>(IPCChannels.Email.ListMessageTags, selectedMessage.id),
        )
        setInternalNotes(
          await invokeIpc<InternalNote[]>(
            IPCChannels.Email.ListInternalNotes,
            selectedMessage.id,
          ),
        )
        setMessageAttachments(
          await invokeIpc<MessageAttachment[]>(
            IPCChannels.Email.ListMessageAttachments,
            selectedMessage.id,
          ),
        )
      } catch (e) {
        logError("use-message-metadata: load", e)
        setMessageTags([])
        setInternalNotes([])
        setMessageAttachments([])
      }
    })()
  }, [selectedMessage])

  const reloadNotes = async () => {
    if (!selectedMessage || !hasElectron()) return
    setInternalNotes(
      await invokeIpc<InternalNote[]>(IPCChannels.Email.ListInternalNotes, selectedMessage.id),
    )
  }

  return { messageTags, internalNotes, messageAttachments, reloadNotes }
}
