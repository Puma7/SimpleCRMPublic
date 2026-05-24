import type { Node } from "@xyflow/react"
import type { WorkflowGraphDocument } from "@shared/email-workflow-graph"
import { resolveRegistryNodeLabel } from "@shared/workflow-ui-labels"

export function enrichRegistryGraphDocument(
  doc: WorkflowGraphDocument | null,
  labelByType: Map<string, string>,
): WorkflowGraphDocument | null {
  if (!doc) return doc
  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      if (n.type !== "registry") return n
      const d = n.data as { nodeType: string; label?: string; config: Record<string, unknown> }
      const label = resolveRegistryNodeLabel(d.nodeType, labelByType, d.label)
      if (d.label === label) return n
      return { ...n, data: { ...d, label } }
    }),
  }
}

export function enrichRegistryFlowNodes(
  nodes: Node[],
  labelByType: Map<string, string>,
): Node[] {
  let changed = false
  const next = nodes.map((n) => {
    if (n.type !== "registry") return n
    const d = n.data as { nodeType?: string; label?: string }
    const label = resolveRegistryNodeLabel(d.nodeType, labelByType, d.label)
    if (d.label === label) return n
    changed = true
    return { ...n, data: { ...n.data, label } }
  })
  return changed ? next : nodes
}
