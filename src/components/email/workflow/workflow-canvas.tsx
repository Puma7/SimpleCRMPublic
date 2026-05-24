"use client"

import { useCallback } from "react"
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  type Connection,
  type NodeChange,
  type EdgeChange,
  type NodeProps,
  type OnSelectionChangeParams,
  Handle,
  Position,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { cn } from "@/lib/utils"
import { WORKFLOW_ACTION_LABELS } from "@shared/workflow-ui-labels"
import { Filter, GitBranch, Play } from "lucide-react"
import { useWorkflowEditorStore } from "@/app/email/stores/workflow-editor-store"

const TRIGGER_LABELS: Record<string, string> = {
  inbound: "E-Mail eingehend",
  outbound: "E-Mail ausgehend",
  draft_created: "Entwurf erstellt",
  schedule: "Zeitplan (Cron)",
}

const CONDITION_FIELD_LABELS: Record<string, string> = {
  subject: "Betreff",
  body_text: "Text",
  snippet: "Snippet",
  from_address: "Von",
  to_address: "An",
  cc_address: "CC",
  combined_text: "Kombiniert",
}

const CONDITION_OP_LABELS: Record<string, string> = {
  contains: "enthält",
  equals: "gleich",
  regex: "Regex",
  domain_ends_with: "Domain endet mit",
}

function TriggerNodeCard({ data, selected }: NodeProps) {
  const d = data as { kind?: string }
  return (
    <div
      className={cn(
        "min-w-[180px] rounded-lg border-2 bg-emerald-50 p-3 shadow-sm transition-all dark:bg-emerald-950/40",
        selected ? "border-emerald-500" : "border-emerald-300 dark:border-emerald-800",
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-emerald-500" />
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
        <Play className="h-3 w-3" />
        Trigger
      </div>
      <div className="text-sm font-medium text-foreground">
        {TRIGGER_LABELS[d.kind ?? "inbound"] ?? d.kind}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-emerald-500" />
    </div>
  )
}

function ConditionNodeCard({ data, selected }: NodeProps) {
  const d = data as { field?: string; op?: string; value?: string }
  const valueMissing = !d.value?.trim()
  return (
    <div
      className={cn(
        "min-w-[220px] rounded-lg border-2 bg-amber-50 p-3 shadow-sm transition-all dark:bg-amber-950/40",
        selected ? "border-amber-500" : "border-amber-300 dark:border-amber-800",
        valueMissing && !selected && "border-dashed border-amber-400/80 dark:border-amber-600/80",
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-amber-500" />
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
        <Filter className="h-3 w-3" />
        Bedingung
      </div>
      <div className="text-xs text-muted-foreground">
        {CONDITION_FIELD_LABELS[d.field ?? "subject"]}{" "}
        <span className="text-amber-700 dark:text-amber-400">
          {CONDITION_OP_LABELS[d.op ?? "contains"]}
        </span>
      </div>
      {valueMissing ? (
        <p className="mt-0.5 text-sm italic text-amber-700/90 dark:text-amber-300/90">
          Wert fehlt
        </p>
      ) : (
        <div className="truncate text-sm font-medium">{d.value}</div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-amber-500" />
    </div>
  )
}

function ActionNodeCard({ data, selected }: NodeProps) {
  const d = data as { actionType?: string; tag?: string; path?: string; to?: string }
  const t = d.actionType ?? "tag"
  let detail = ""
  if ((t === "tag" || t === "tag_attachment_meta") && d.tag) detail = d.tag
  else if (t === "set_category" && d.path) detail = d.path
  else if (t === "forward_copy" && d.to) detail = d.to
  return (
    <div
      className={cn(
        "min-w-[200px] rounded-lg border-2 bg-sky-50 p-3 shadow-sm transition-all dark:bg-sky-950/40",
        selected ? "border-sky-500" : "border-sky-300 dark:border-sky-800",
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-sky-500" />
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-400">
        <GitBranch className="h-3 w-3" />
        Aktion
      </div>
      <div className="text-sm font-medium">{WORKFLOW_ACTION_LABELS[t] ?? t}</div>
      {detail ? (
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</div>
      ) : null}
      <Handle type="source" position={Position.Bottom} className="!bg-sky-500" />
    </div>
  )
}

function RegistryNodeCard({ data, selected }: NodeProps) {
  const d = data as { nodeType?: string; label?: string }
  const title = d.label?.trim() || d.nodeType || "Erweiterter Knoten"
  return (
    <div
      className={cn(
        "min-w-[200px] rounded-lg border-2 bg-violet-50 p-3 shadow-sm transition-all dark:bg-violet-950/40",
        selected ? "border-violet-500" : "border-violet-300 dark:border-violet-800",
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-violet-500" />
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-400">
        Erweitert
      </div>
      <div className="text-sm font-medium">{title}</div>
      <Handle type="source" position={Position.Bottom} className="!bg-violet-500" />
    </div>
  )
}

const nodeTypes = {
  trigger: TriggerNodeCard,
  condition: ConditionNodeCard,
  action: ActionNodeCard,
  registry: RegistryNodeCard,
}

type Props = {
  onSelectionChange: (selectedNodeId: string | null) => void
}

export function WorkflowCanvas({ onSelectionChange }: Props) {
  const nodes = useWorkflowEditorStore((s) => s.nodes)
  const edges = useWorkflowEditorStore((s) => s.edges)
  const setNodes = useWorkflowEditorStore((s) => s.setNodes)
  const setEdges = useWorkflowEditorStore((s) => s.setEdges)

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes(applyNodeChanges(changes, useWorkflowEditorStore.getState().nodes))
    },
    [setNodes],
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges(applyEdgeChanges(changes, useWorkflowEditorStore.getState().edges))
    },
    [setEdges],
  )

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges(addEdge(params, useWorkflowEditorStore.getState().edges))
    },
    [setEdges],
  )

  const handleSelectionChange = useCallback(
    (params: OnSelectionChangeParams) => {
      const first = params.nodes[0]
      onSelectionChange(first ? first.id : null)
    },
    [onSelectionChange],
  )

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onSelectionChange={handleSelectionChange}
      nodeTypes={nodeTypes}
      fitView
      className="bg-muted/20"
    >
      <Background gap={16} size={1} />
      <MiniMap pannable zoomable className="!bg-background" />
      <Controls />
    </ReactFlow>
  )
}
