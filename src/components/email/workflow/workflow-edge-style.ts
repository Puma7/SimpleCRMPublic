import { MarkerType } from "@xyflow/react"

/**
 * Shared edge styling for the workflow editor. Lives in its own module so
 * both the canvas (defaultEdgeOptions for newly drawn edges) and the editor
 * store (edges loaded from graph_json) can apply identical styling without
 * importing each other. Never persisted — toGraphDocument whitelists fields.
 */
export const WORKFLOW_EDGE_STROKE = "hsl(var(--muted-foreground) / 0.7)"

export const WORKFLOW_EDGE_STYLE = {
  strokeWidth: 2,
  stroke: WORKFLOW_EDGE_STROKE,
} as const

export const WORKFLOW_EDGE_MARKER_END = {
  type: MarkerType.ArrowClosed,
  width: 16,
  height: 16,
  color: WORKFLOW_EDGE_STROKE,
} as const
