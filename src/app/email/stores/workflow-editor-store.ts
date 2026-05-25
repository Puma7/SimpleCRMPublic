import { create } from "zustand"
import type { Edge, Node } from "@xyflow/react"
import type { WorkflowGraphDocument } from "@shared/email-workflow-graph"
import {
  applyAutoLayoutToDocument,
  documentWithResolvedPositions,
  isValidGraphPosition,
} from "@/components/email/workflow/workflow-graph-layout"

type State = {
  nodes: Node[]
  edges: Edge[]
  setNodes: (n: Node[]) => void
  setEdges: (e: Edge[]) => void
  resetFromGraph: (doc: WorkflowGraphDocument | null) => void
  applyAutoLayout: () => void
  toGraphDocument: () => WorkflowGraphDocument
}

function defaultDoc(): WorkflowGraphDocument {
  return {
    version: 1,
    nodes: [
      { id: "t1", type: "trigger", data: { kind: "inbound" } },
      {
        id: "c1",
        type: "condition",
        data: { field: "subject", op: "contains", value: "", caseInsensitive: true },
      },
      { id: "a1", type: "action", data: { actionType: "tag", tag: "neu" } },
    ],
    edges: [
      { id: "e1", source: "t1", target: "c1" },
      { id: "e2", source: "c1", target: "a1", label: "ja" },
    ],
  }
}

function graphToFlow(doc: WorkflowGraphDocument): { nodes: Node[]; edges: Edge[] } {
  const resolved = documentWithResolvedPositions(doc)
  const nodes: Node[] = resolved.nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: isValidGraphPosition(n.position) ? { ...n.position } : { x: 40, y: 0 },
    data: { ...n.data },
  }))
  const edges: Edge[] = doc.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    sourceHandle: edgeSourceHandleFromLabel(e.label, e.source, resolved),
  }))
  return { nodes, edges }
}

/** Map stored edge labels back to React Flow source handles where needed. */
function edgeSourceHandleFromLabel(
  label: string | undefined,
  sourceId: string,
  doc: WorkflowGraphDocument,
): string | undefined {
  if (!label) return undefined
  const source = doc.nodes.find((n) => n.id === sourceId)
  if (source?.type === "condition") {
    const l = label.toLowerCase()
    if (l === "nein" || l === "no" || l === "false") return "no"
    if (l === "ja" || l === "yes" || l === "true" || !l) return "yes"
  }
  if (source?.type === "registry") {
    const nt = (source.data as { nodeType?: string }).nodeType
    const l = label.toLowerCase()
    if (nt === "logic.loop") {
      if (l === "done" || l === "fertig" || l === "end") return "done"
      if (l === "each" || l === "je" || l === "loop") return "each"
    }
    if (nt === "logic.threshold") {
      if (l === "no" || l === "nein") return "no"
      if (l === "yes" || l === "ja") return "yes"
    }
    if (nt === "email.sender_filter") return label
    if (nt === "logic.switch") return label
  }
  return undefined
}

export const useWorkflowEditorStore = create<State>((set, get) => ({
  nodes: [],
  edges: [],
  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),
  resetFromGraph: (doc) => {
    const d = doc && doc.nodes?.length ? doc : defaultDoc()
    const { nodes, edges } = graphToFlow(d)
    set({ nodes, edges })
  },
  applyAutoLayout: () => {
    const doc = get().toGraphDocument()
    const laid = applyAutoLayoutToDocument(doc)
    const { nodes, edges } = graphToFlow(laid)
    set({ nodes, edges })
  },
  toGraphDocument: () => {
    const { nodes, edges } = get()
    const gn = nodes.map((n) => ({
      id: n.id,
      type: n.type as "trigger" | "condition" | "action" | "registry",
      data: n.data as WorkflowGraphDocument["nodes"][number]["data"],
      position: {
        x: Math.round(n.position.x),
        y: Math.round(n.position.y),
      },
    }))
    const ge = edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: typeof e.label === "string" ? e.label : undefined,
    }))
    return { version: 1 as const, nodes: gn, edges: ge }
  },
}))
