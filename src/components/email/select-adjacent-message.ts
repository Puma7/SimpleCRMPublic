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
    return messages[0]?.id ?? null
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
 * After bulk remove, pick the next visible row skipping all bulk-selected ids
 * (immediate neighbor may also be removed).
 */
export function pickBulkAdvanceTargetId(
  messages: ReadonlyArray<{ id: number }>,
  selectedIds: ReadonlySet<number>,
  focusedMessageId: number | null | undefined,
): number | null {
  const anchor = pickBulkAdvanceAnchorId(messages, selectedIds, focusedMessageId)
  if (anchor == null) return null
  const idx = messages.findIndex((m) => m.id === anchor)
  if (idx === -1) return null
  for (let i = idx + 1; i < messages.length; i++) {
    const id = messages[i]?.id
    if (id != null && !selectedIds.has(id)) return id
  }
  for (let i = idx - 1; i >= 0; i--) {
    const id = messages[i]?.id
    if (id != null && !selectedIds.has(id)) return id
  }
  return null
}
