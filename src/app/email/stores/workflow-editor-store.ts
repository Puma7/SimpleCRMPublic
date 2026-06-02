import { create } from "zustand"
import type { Edge, Node } from "@xyflow/react"
import type { WorkflowGraphDocument } from "@shared/email-workflow-graph"
import {
  applyAutoLayoutToDocument,
  documentWithResolvedPositions,
  isValidGraphPosition,
} from "@/components/email/workflow/workflow-graph-layout"
import { edgeSourceHandleFromLabel } from "@/components/email/workflow/workflow-edge-labels"

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
    sourceHandle: edgeSourceHandleFromLabel(
      e.label,
      resolved.nodes.find((n) => n.id === e.source),
    ),
  }))
  return { nodes, edges }
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
