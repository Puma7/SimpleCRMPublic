import { create } from "zustand"
import type { Edge, Node } from "@xyflow/react"
import type { WorkflowGraphDocument } from "@shared/email-workflow-graph"

type State = {
  nodes: Node[]
  edges: Edge[]
  setNodes: (n: Node[]) => void
  setEdges: (e: Edge[]) => void
  resetFromGraph: (doc: WorkflowGraphDocument | null) => void
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

function layoutNodes(doc: WorkflowGraphDocument): { nodes: Node[]; edges: Edge[] } {
  let y = 0
  const nodes: Node[] = doc.nodes.map((n, i) => {
    const node = {
      id: n.id,
      type: n.type,
      position: { x: 40, y: y + i * 100 },
      data: { ...n.data },
    }
    return node
  })
  const edges: Edge[] = doc.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
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
    const { nodes, edges } = layoutNodes(d)
    set({ nodes, edges })
  },
  toGraphDocument: () => {
    const { nodes, edges } = get()
    const gn = nodes.map((n) => ({
      id: n.id,
      type: n.type as "trigger" | "condition" | "action",
      data: n.data as WorkflowGraphDocument["nodes"][number]["data"],
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
