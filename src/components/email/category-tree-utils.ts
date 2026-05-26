import { MAX_EMAIL_CATEGORY_DEPTH } from "@shared/email-constants"
import type { CategoryRow } from "./types"

export type FlatCategory = CategoryRow & { depth: number }

export function flattenCategoryTree(categories: CategoryRow[]): FlatCategory[] {
  const childrenOf = (pid: number) =>
    categories
      .filter((c) => c.parent_id === pid)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "de"))

  const roots = categories
    .filter((c) => c.parent_id == null)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "de"))

  const out: FlatCategory[] = []
  const walk = (nodes: CategoryRow[], depth: number) => {
    if (depth >= MAX_EMAIL_CATEGORY_DEPTH) return
    for (const n of nodes) {
      out.push({ ...n, depth })
      walk(childrenOf(n.id), depth + 1)
    }
  }
  walk(roots, 0)
  return out
}

export function flatToReorderUpdates(
  flat: { id: number; depth: number }[],
): { id: number; parentId: number | null; sortOrder: number }[] {
  const updates: { id: number; parentId: number | null; sortOrder: number }[] = []
  const siblingCounter = new Map<string, number>()

  for (let i = 0; i < flat.length; i++) {
    const item = flat[i]!
    let parentId: number | null = null
    if (item.depth > 0) {
      for (let j = i - 1; j >= 0; j--) {
        if (flat[j]!.depth === item.depth - 1) {
          parentId = flat[j]!.id
          break
        }
      }
    }
    const key = parentId == null ? "root" : String(parentId)
    const sortOrder = siblingCounter.get(key) ?? 0
    siblingCounter.set(key, sortOrder + 1)
    updates.push({ id: item.id, parentId, sortOrder })
  }
  return updates
}

export function indentFlatCategory(flat: FlatCategory[], id: number): FlatCategory[] {
  const idx = flat.findIndex((c) => c.id === id)
  if (idx <= 0) return flat
  const item = flat[idx]!
  if (item.depth >= MAX_EMAIL_CATEGORY_DEPTH - 1) return flat
  const newParent = flat[idx - 1]!
  if (newParent.depth + 1 > MAX_EMAIL_CATEGORY_DEPTH - 1) return flat
  const next = flat.map((c) => (c.id === id ? { ...c, depth: newParent.depth + 1 } : c))
  return next
}

export function outdentFlatCategory(flat: FlatCategory[], id: number): FlatCategory[] {
  const idx = flat.findIndex((c) => c.id === id)
  if (idx < 0) return flat
  const item = flat[idx]!
  if (item.depth <= 0) return flat
  const next = flat.map((c) => (c.id === id ? { ...c, depth: item.depth - 1 } : c))
  return next
}

/** When dropping on another row, optionally nest under it (max depth). */
export function moveFlatCategory(
  flat: FlatCategory[],
  activeId: number,
  overId: number,
  nestUnder: boolean,
): FlatCategory[] {
  const oldIndex = flat.findIndex((c) => c.id === activeId)
  const newIndex = flat.findIndex((c) => c.id === overId)
  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return flat

  const next = [...flat]
  const [moved] = next.splice(oldIndex, 1)
  if (!moved) return flat
  const insertAt = oldIndex < newIndex ? newIndex : newIndex
  const over = flat[newIndex]!
  const targetDepth = nestUnder
    ? Math.min(over.depth + 1, MAX_EMAIL_CATEGORY_DEPTH - 1)
    : over.depth
  next.splice(insertAt, 0, { ...moved, depth: targetDepth })
  return next
}
