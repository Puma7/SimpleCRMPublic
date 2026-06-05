import { useCallback, useEffect, useMemo } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { useAuth } from "@/components/auth/auth-context"
import {
  getRendererTransport,
  invokeRenderer,
  subscribeServerEvents,
  type ServerEvent,
} from "@/services/transport"
import { useMailWorkspace, type ComposeIntent } from "./workspace-context"
import type {
  ConversationLockReason,
  ConversationLockRecord,
  EmailMessage,
} from "./types"

type LockResult =
  | { ok: true; lock?: ConversationLockRecord }
  | { ok: false; lock?: ConversationLockRecord; message: string }

const LOCK_EVENT_TYPES = new Set([
  "conversation_lock.acquired",
  "conversation_lock.heartbeat",
  "conversation_lock.released",
  "conversation_lock.force_takeover",
])

export function useConversationLocks(messages: EmailMessage[]) {
  const {
    conversationLocks,
    setConversationLocks,
    upsertConversationLock,
    removeConversationLock,
    composeIntent,
  } = useMailWorkspace()
  const { user } = useAuth()
  const serverLocksEnabled = getRendererTransport().kind === "http"
  const visibleMessageIds = useMemo(
    () => uniquePositiveIds(messages.map((message) => message.id)),
    [messages],
  )

  useEffect(() => {
    if (!serverLocksEnabled || visibleMessageIds.length === 0) return
    let cancelled = false
    void (async () => {
      try {
        const result = await invokeRenderer(IPCChannels.Email.ListConversationLocks, {
          messageIds: visibleMessageIds,
        }) as { locks?: unknown }
        if (cancelled) return
        const locks = Array.isArray(result.locks)
          ? result.locks.filter(isConversationLockRecord)
          : []
        setConversationLocks((prev) => {
          const next = { ...prev }
          for (const messageId of visibleMessageIds) delete next[messageId]
          for (const lock of locks) next[lock.messageId] = lock
          return next
        })
      } catch {
        /* keep last known lock state; composer acquire remains fail-closed */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [serverLocksEnabled, setConversationLocks, visibleMessageIds])

  const refreshLock = useCallback(async (messageId: number) => {
    if (!serverLocksEnabled) return null
    try {
      const result = await invokeRenderer(IPCChannels.Email.GetConversationLock, messageId) as { lock?: unknown }
      const lock = isConversationLockRecord(result.lock) ? result.lock : null
      if (lock) upsertConversationLock(lock)
      else removeConversationLock(messageId)
      return lock
    } catch {
      return null
    }
  }, [removeConversationLock, serverLocksEnabled, upsertConversationLock])

  useEffect(() => {
    if (!serverLocksEnabled) return
    const subscription = subscribeServerEvents({
      onEvent(event) {
        if (!LOCK_EVENT_TYPES.has(event.type)) return
        const messageId = messageIdFromLockEvent(event)
        if (!messageId) return
        if (event.type === "conversation_lock.released") {
          removeConversationLock(messageId)
          return
        }
        void refreshLock(messageId)
      },
    })
    return () => subscription.unsubscribe()
  }, [refreshLock, removeConversationLock, serverLocksEnabled])

  const acquireConversationLock = useCallback(async (
    messageId: number,
    reason: ConversationLockReason,
  ): Promise<LockResult> => {
    if (!serverLocksEnabled) return { ok: true }
    const existing = conversationLocks[messageId]
    if (existing?.userId === user?.id) return { ok: true, lock: existing }

    try {
      const result = await invokeRenderer(IPCChannels.Email.AcquireConversationLock, {
        messageId,
        reason,
      }) as { lock?: unknown }
      const lock = isConversationLockRecord(result.lock) ? result.lock : undefined
      if (lock) upsertConversationLock(lock)
      return { ok: true, lock }
    } catch (error) {
      const conflictLock = lockFromError(error)
      if (conflictLock) {
        upsertConversationLock(conflictLock)
        if (conflictLock.userId === user?.id) return { ok: true, lock: conflictLock }
        return {
          ok: false,
          lock: conflictLock,
          message: `Nachricht ist gesperrt durch ${lockOwnerLabel(conflictLock)}.`,
        }
      }
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Conversation Lock konnte nicht gesetzt werden.",
      }
    }
  }, [conversationLocks, serverLocksEnabled, upsertConversationLock, user?.id])

  const releaseConversationLock = useCallback(async (messageId: number): Promise<void> => {
    if (!serverLocksEnabled) return
    try {
      await invokeRenderer(IPCChannels.Email.ReleaseConversationLock, messageId)
    } catch {
      /* 404 is harmless here: stale cleanup or takeover may have removed it already */
    } finally {
      removeConversationLock(messageId)
    }
  }, [removeConversationLock, serverLocksEnabled])

  const heartbeatConversationLock = useCallback(async (messageId: number): Promise<void> => {
    if (!serverLocksEnabled) return
    try {
      const result = await invokeRenderer(IPCChannels.Email.HeartbeatConversationLock, messageId) as { lock?: unknown }
      if (isConversationLockRecord(result.lock)) upsertConversationLock(result.lock)
    } catch {
      removeConversationLock(messageId)
    }
  }, [removeConversationLock, serverLocksEnabled, upsertConversationLock])

  const takeoverConversationLock = useCallback(async (
    messageId: number,
    reason: ConversationLockReason,
  ): Promise<LockResult> => {
    if (!serverLocksEnabled) return { ok: true }
    try {
      const result = await invokeRenderer(IPCChannels.Email.TakeoverConversationLock, {
        messageId,
        reason,
      }) as { lock?: unknown }
      const lock = isConversationLockRecord(result.lock) ? result.lock : undefined
      if (lock) upsertConversationLock(lock)
      return { ok: true, lock }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Conversation Lock konnte nicht uebernommen werden.",
      }
    }
  }, [serverLocksEnabled, upsertConversationLock])

  const activeComposeLockMessageId = composeLockMessageId(composeIntent)
  useEffect(() => {
    if (!serverLocksEnabled || activeComposeLockMessageId === null) return
    const timer = setInterval(() => {
      void heartbeatConversationLock(activeComposeLockMessageId)
    }, 30_000)
    return () => {
      clearInterval(timer)
      void releaseConversationLock(activeComposeLockMessageId)
    }
  }, [
    activeComposeLockMessageId,
    heartbeatConversationLock,
    releaseConversationLock,
    serverLocksEnabled,
  ])

  return {
    locks: conversationLocks,
    acquireConversationLock,
    releaseConversationLock,
    heartbeatConversationLock,
    takeoverConversationLock,
    refreshLock,
  }
}

export function lockOwnerLabel(lock: ConversationLockRecord): string {
  return lock.displayName?.trim() || lock.email?.trim() || lock.userId
}

function composeLockMessageId(composeIntent: ComposeIntent): number | null {
  if (
    composeIntent.mode === "reply" ||
    composeIntent.mode === "reply-all" ||
    composeIntent.mode === "forward"
  ) {
    return composeIntent.message.id
  }
  return null
}

function messageIdFromLockEvent(event: ServerEvent): number | null {
  const fromPayload = Number(event.payload?.messageId)
  if (Number.isSafeInteger(fromPayload) && fromPayload > 0) return fromPayload
  const fromEntity = Number(event.entityId)
  return Number.isSafeInteger(fromEntity) && fromEntity > 0 ? fromEntity : null
}

function uniquePositiveIds(values: number[]): number[] {
  return [...new Set(values)]
    .filter((value) => Number.isSafeInteger(value) && value > 0)
    .slice(0, 500)
}

function lockFromError(error: unknown): ConversationLockRecord | null {
  if (!error || typeof error !== "object") return null
  const details = "details" in error ? (error as { details?: unknown }).details : undefined
  if (!details || typeof details !== "object") return null
  const lock = "lock" in details ? (details as { lock?: unknown }).lock : undefined
  return isConversationLockRecord(lock) ? lock : null
}

function isConversationLockRecord(value: unknown): value is ConversationLockRecord {
  if (!value || typeof value !== "object") return false
  const record = value as Partial<ConversationLockRecord>
  return (
    typeof record.messageId === "number" &&
    Number.isSafeInteger(record.messageId) &&
    record.messageId > 0 &&
    typeof record.userId === "string" &&
    typeof record.workspaceId === "string" &&
    typeof record.acquiredAt === "string" &&
    typeof record.lastHeartbeatAt === "string" &&
    (record.reason === "reply" || record.reason === "forward" || record.reason === "edit") &&
    typeof record.takeoverCount === "number"
  )
}
