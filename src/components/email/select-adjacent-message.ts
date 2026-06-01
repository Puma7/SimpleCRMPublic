/** Pick the next list row after one or more messages leave the current view. */

export function selectAdjacentMessageId(
  messages: readonly { id: number }[],
  removedId: number,
): number | null {
  const idx = messages.findIndex((m) => m.id === removedId)
  if (idx < 0) return null
  const below = messages[idx + 1]
  if (below) return below.id
  const above = messages[idx - 1]
  if (above) return above.id
  return null
}

export function selectAdjacentAfterBulkRemove(
  messages: readonly { id: number }[],
  removedIds: ReadonlySet<number>,
): number | null {
  if (removedIds.size === 0) return null
  let maxRemovedIdx = -1
  let minRemovedIdx = messages.length
  for (let i = 0; i < messages.length; i++) {
    if (removedIds.has(messages[i]!.id)) {
      maxRemovedIdx = Math.max(maxRemovedIdx, i)
      minRemovedIdx = Math.min(minRemovedIdx, i)
    }
  }
  if (maxRemovedIdx < 0) return null
  for (let i = maxRemovedIdx + 1; i < messages.length; i++) {
    if (!removedIds.has(messages[i]!.id)) return messages[i]!.id
  }
  for (let i = minRemovedIdx - 1; i >= 0; i--) {
    if (!removedIds.has(messages[i]!.id)) return messages[i]!.id
  }
  return null
}

/** @returns id of the message to select next, or null if the list becomes empty */
export function advanceSelectionAfterMessageRemoved(
  messages: readonly { id: number }[],
  removed: number | readonly number[],
): number | null {
  if (typeof removed === "number") {
    return selectAdjacentMessageId(messages, removed)
  }
  if (removed.length === 0) return null
  if (removed.length === 1) return selectAdjacentMessageId(messages, removed[0]!)
  return selectAdjacentAfterBulkRemove(messages, new Set(removed))
}
