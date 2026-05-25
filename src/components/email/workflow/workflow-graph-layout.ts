import type { WorkflowGraphDocument } from "@shared/email-workflow-graph"

const NODE_WIDTH = 240
const LAYER_GAP_Y = 140
const NODE_GAP_X = 48
const ORIGIN_X = 40
const ORIGIN_Y = 40

export function isValidGraphPosition(
  pos: { x: number; y: number } | undefined,
): pos is { x: number; y: number } {
  return pos != null && Number.isFinite(pos.x) && Number.isFinite(pos.y)
}

/** Layered top-to-bottom layout from trigger / roots (for auto-sort). */
export function computeAutoLayoutPositions(
  doc: WorkflowGraphDocument,
): Record<string, { x: number; y: number }> {
  const { nodes, edges } = doc
  if (nodes.length === 0) return {}

  const inDegree = new Map<string, number>()
  for (const n of nodes) inDegree.set(n.id, 0)
  for (const e of edges) {
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1)
  }

  const triggers = nodes.filter((n) => n.type === "trigger")
  let roots =
    triggers.length > 0
      ? triggers.map((t) => t.id)
      : nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0).map((n) => n.id)
  if (roots.length === 0) roots = [nodes[0]!.id]

  const layer = new Map<string, number>()
  const queue = [...roots]
  for (const r of roots) layer.set(r, 0)

  while (queue.length > 0) {
    const id = queue.shift()!
    const depth = layer.get(id) ?? 0
    for (const e of edges.filter((ed) => ed.source === id)) {
      const next = depth + 1
      if ((layer.get(e.target) ?? -1) < next) {
        layer.set(e.target, next)
        queue.push(e.target)
      }
    }
  }

  let maxLayer = 0
  for (const l of layer.values()) maxLayer = Math.max(maxLayer, l)
  for (const n of nodes) {
    if (!layer.has(n.id)) layer.set(n.id, maxLayer + 1)
  }

  const byLayer = new Map<number, string[]>()
  for (const n of nodes) {
    const l = layer.get(n.id) ?? 0
    const list = byLayer.get(l) ?? []
    list.push(n.id)
    byLayer.set(l, list)
  }

  const positions: Record<string, { x: number; y: number }> = {}
  const sortedLayers = [...byLayer.keys()].sort((a, b) => a - b)
  for (const l of sortedLayers) {
    const ids = [...(byLayer.get(l) ?? [])].sort()
    const rowWidth = ids.length * NODE_WIDTH + Math.max(0, ids.length - 1) * NODE_GAP_X
    let x = ORIGIN_X + Math.max(0, (640 - rowWidth) / 2)
    const y = ORIGIN_Y + l * LAYER_GAP_Y
    for (const id of ids) {
      positions[id] = { x, y }
      x += NODE_WIDTH + NODE_GAP_X
    }
  }
  return positions
}

export function applyAutoLayoutToDocument(
  doc: WorkflowGraphDocument,
): WorkflowGraphDocument {
  const positions = computeAutoLayoutPositions(doc)
  return {
    ...doc,
    nodes: doc.nodes.map((n) => ({
      ...n,
      position: positions[n.id] ?? n.position,
    })),
  }
}

export function documentWithResolvedPositions(
  doc: WorkflowGraphDocument,
  opts?: { autoLayoutMissing?: boolean },
): WorkflowGraphDocument {
  const auto = opts?.autoLayoutMissing !== false ? computeAutoLayoutPositions(doc) : {}
  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      if (isValidGraphPosition(n.position)) return n
      const fallback = auto[n.id]
      if (fallback) return { ...n, position: fallback }
      return n
    }),
  }
}
