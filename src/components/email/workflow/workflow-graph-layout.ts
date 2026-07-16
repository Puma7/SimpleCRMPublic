import dagre from "@dagrejs/dagre"
import type { WorkflowGraphDocument } from "@shared/email-workflow-graph"

const NODE_WIDTH = 240
/** Approximate rendered card heights per node type (dagre needs box sizes). */
const NODE_HEIGHTS: Record<string, number> = {
  trigger: 84,
  condition: 128,
  action: 96,
  registry: 116,
}
const DEFAULT_NODE_HEIGHT = 104
const NODE_GAP_X = 48
const LAYER_GAP_Y = 88
const ORIGIN_X = 40
const ORIGIN_Y = 40
/** Keep in sync with snapGrid in workflow-canvas.tsx. */
const GRID = 16

export function isValidGraphPosition(
  pos: { x: number; y: number } | undefined,
): pos is { x: number; y: number } {
  return pos != null && Number.isFinite(pos.x) && Number.isFinite(pos.y)
}

/**
 * Layered top-to-bottom layout via dagre (crossing minimization, handles
 * diamonds, cycles, multi-edges and disconnected nodes) — used for auto-sort
 * ("Anordnen") and for templates that ship without positions.
 */
export function computeAutoLayoutPositions(
  doc: WorkflowGraphDocument,
): Record<string, { x: number; y: number }> {
  const { nodes, edges } = doc
  if (nodes.length === 0) return {}

  const g = new dagre.graphlib.Graph()
  g.setGraph({
    rankdir: "TB",
    nodesep: NODE_GAP_X,
    ranksep: LAYER_GAP_Y,
    marginx: 0,
    marginy: 0,
  })
  g.setDefaultEdgeLabel(() => ({}))
  for (const n of nodes) {
    g.setNode(n.id, {
      width: NODE_WIDTH,
      height: NODE_HEIGHTS[n.type] ?? DEFAULT_NODE_HEIGHT,
    })
  }
  // Insertion order feeds dagre's ordering heuristic, so branch handles
  // (ja/nein, Ports) keep a stable left-to-right arrangement.
  for (const e of edges) g.setEdge(e.source, e.target)

  dagre.layout(g)

  // dagre returns box centers; convert to top-left, normalize to the origin
  // and round onto the canvas snap grid.
  let minX = Infinity
  let minY = Infinity
  for (const n of nodes) {
    const p = g.node(n.id)
    minX = Math.min(minX, p.x - p.width / 2)
    minY = Math.min(minY, p.y - p.height / 2)
  }
  const positions: Record<string, { x: number; y: number }> = {}
  for (const n of nodes) {
    const p = g.node(n.id)
    positions[n.id] = {
      x: Math.round((p.x - p.width / 2 - minX + ORIGIN_X) / GRID) * GRID,
      y: Math.round((p.y - p.height / 2 - minY + ORIGIN_Y) / GRID) * GRID,
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

/** True if Trigger connects directly to an Aktion (Bedingung übersprungen). */
export function graphHasTriggerToActionShortcut(doc: WorkflowGraphDocument): boolean {
  const typeById = new Map(doc.nodes.map((n) => [n.id, n.type]));
  return doc.edges.some((e) => {
    if (typeById.get(e.source) !== "trigger") return false
    const tgt = typeById.get(e.target)
    return tgt === "action" || tgt === "registry"
  })
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
