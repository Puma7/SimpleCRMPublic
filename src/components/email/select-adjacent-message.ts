/** Pick the next message id after one is removed from the visible list (Gmail-style). */
export type AdjacentMessagePreference = "next_then_prev" | "prev_then_next"

export function pickAdjacentMessageId(
  messages: ReadonlyArray<{ id: number }>,
  removedId: number,
  preference: AdjacentMessagePreference = "next_then_prev",
): number | null {
  if (messages.length === 0) return null
  const idx = messages.findIndex((m) => m.id === removedId)
  if (idx === -1) {
    return null
  }
  if (preference === "next_then_prev") {
    const next = messages[idx + 1] ?? messages[idx - 1]
    return next?.id ?? null
  }
  const prev = messages[idx - 1] ?? messages[idx + 1]
  return prev?.id ?? null
}

/** Bulk actions: prefer focused row, else first selected in list order. */
export function pickBulkAdvanceAnchorId(
  messages: ReadonlyArray<{ id: number }>,
  selectedIds: ReadonlySet<number>,
  focusedMessageId: number | null | undefined,
): number | null {
  if (selectedIds.size === 0) return null
  if (focusedMessageId != null && selectedIds.has(focusedMessageId)) {
    return focusedMessageId
  }
  for (const m of messages) {
    if (selectedIds.has(m.id)) return m.id
  }
  return null
}

/**
 * After bulk-removing selected rows, pick the message to focus (Gmail-style).
 * Prefers the first visible row after the last selected index, then before the
 * first selected index; if selection is gapped (e.g. first and last), falls back
 * to the first remaining row in list order.
 */
export function pickBulkAdvanceTargetId(
  messages: ReadonlyArray<{ id: number }>,
  selectedIds: ReadonlySet<number>,
): number | null {
  if (selectedIds.size === 0 || messages.length === 0) return null

  const remaining = messages.filter((m) => !selectedIds.has(m.id))
  if (remaining.length === 0) return null

  let minIdx = messages.length
  let maxIdx = -1
  for (let i = 0; i < messages.length; i++) {
    if (selectedIds.has(messages[i].id)) {
      minIdx = Math.min(minIdx, i)
      maxIdx = Math.max(maxIdx, i)
    }
  }
  if (maxIdx === -1) return null

  for (let i = maxIdx + 1; i < messages.length; i++) {
    const m = messages[i]
    if (!selectedIds.has(m.id)) return m.id
  }

  for (let i = minIdx - 1; i >= 0; i--) {
    const m = messages[i]
    if (!selectedIds.has(m.id)) return m.id
  }

  return remaining[0]?.id ?? null
}
