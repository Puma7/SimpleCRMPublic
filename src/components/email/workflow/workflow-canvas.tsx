"use client"

import "@xyflow/react/dist/style.css"
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
import { cn } from "@/lib/utils"
import { WORKFLOW_ACTION_LABELS } from "@shared/workflow-ui-labels"
import { validateNodeConfig } from "@shared/workflow-config-validate"
import { Filter, GitBranch, Play } from "lucide-react"
import { useWorkflowEditorStore } from "@/app/email/stores/workflow-editor-store"
import { workflowTriggerLabel } from "./trigger-labels"
import { useWorkflowNodeCatalog } from "./use-workflow-node-catalog"
import {
  defaultLabelForConnection,
  switchCaseHandles,
} from "./workflow-edge-labels"

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
  is_true: "ist wahr",
  is_false: "ist falsch",
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
        {workflowTriggerLabel(d.kind)}
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
      <div className="relative mt-2 flex justify-between px-1 text-[9px] font-medium text-amber-800 dark:text-amber-300">
        <span>Ja</span>
        <span>Nein</span>
      </div>
      <Handle
        id="yes"
        type="source"
        position={Position.Bottom}
        style={{ left: "28%" }}
        className="!bg-emerald-600"
      />
      <Handle
        id="no"
        type="source"
        position={Position.Bottom}
        style={{ left: "72%" }}
        className="!bg-rose-600"
      />
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

const PORT_HANDLE_COLORS: Record<string, string> = {
  emerald: "!bg-emerald-600",
  amber: "!bg-amber-500",
  red: "!bg-rose-600",
  violet: "!bg-violet-500",
  sky: "!bg-sky-500",
}

function RegistryNodeCard({ data, selected }: NodeProps) {
  const d = data as {
    nodeType?: string
    label?: string
    config?: Record<string, unknown>
  }
  const { catalog } = useWorkflowNodeCatalog()
  const entry = d.nodeType ? catalog.find((e) => e.type === d.nodeType) : undefined
  const title = d.label?.trim() || entry?.label || d.nodeType || "Erweiterter Knoten"
  const isLoop = d.nodeType === "logic.loop"
  const isSwitch = d.nodeType === "logic.switch"
  const switchPorts = isSwitch ? switchCaseHandles(d.config) : []

  // Ausgänge aus dem deklarativen Schema (auto_reply, auth_check, sender_filter,
  // threshold, …) — sichtbar beschriftet, damit niemand „unsichtbare" Ports hat.
  const schemaPorts = !isLoop && !isSwitch ? (entry?.ports ?? []) : []

  const configIssues = entry ? validateNodeConfig(entry, d.config ?? {}) : []
  const hasError = configIssues.some((i) => i.severity === "error")

  return (
    <div
      className={cn(
        "min-w-[200px] rounded-lg border-2 bg-violet-50 p-3 shadow-sm transition-all dark:bg-violet-950/40",
        selected ? "border-violet-500" : "border-violet-300 dark:border-violet-800",
        isSwitch && "min-w-[240px]",
        hasError && !selected && "border-dashed border-rose-400 dark:border-rose-600",
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-violet-500" />
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-400">
          Erweitert
        </span>
        {hasError ? (
          <span
            className="rounded bg-rose-100 px-1 text-[9px] font-semibold text-rose-700 dark:bg-rose-900/60 dark:text-rose-300"
            title={configIssues
              .filter((i) => i.severity === "error")
              .map((i) => i.message)
              .join("\n")}
          >
            Unvollständig
          </span>
        ) : null}
      </div>
      <div className="text-sm font-medium">{title}</div>
      {isLoop ? (
        <>
          <div className="relative mt-2 flex justify-between px-1 text-[9px] font-medium text-violet-800 dark:text-violet-300">
            <span>Je Element</span>
            <span>Fertig</span>
          </div>
          <Handle
            id="each"
            type="source"
            position={Position.Bottom}
            style={{ left: "28%" }}
            className="!bg-violet-500"
          />
          <Handle
            id="done"
            type="source"
            position={Position.Bottom}
            style={{ left: "72%" }}
            className="!bg-violet-500"
          />
        </>
      ) : isSwitch ? (
        <>
          <div className="mt-2 flex flex-wrap justify-center gap-1 text-[9px] font-medium text-violet-800 dark:text-violet-300">
            {switchPorts.map((p) => (
              <span key={p}>{p}</span>
            ))}
          </div>
          {switchPorts.map((port, i) => {
            const n = switchPorts.length
            const left = n === 1 ? 50 : 12 + (i / Math.max(1, n - 1)) * 76
            return (
              <Handle
                key={port}
                id={port}
                type="source"
                position={Position.Bottom}
                style={{ left: `${left}%` }}
                className="!bg-violet-500"
              />
            )
          })}
        </>
      ) : schemaPorts.length > 0 ? (
        <>
          <div className="mt-2 flex flex-wrap justify-center gap-x-2 gap-y-0.5 px-1 text-[9px] font-medium text-violet-800 dark:text-violet-300">
            {schemaPorts.map((p) => (
              <span key={p.id} title={p.description}>
                {p.label}
              </span>
            ))}
          </div>
          {schemaPorts.map((port, i) => {
            const n = schemaPorts.length
            const left = n === 1 ? 50 : 12 + (i / Math.max(1, n - 1)) * 76
            return (
              <Handle
                key={port.id}
                id={port.id}
                type="source"
                position={Position.Bottom}
                style={{ left: `${left}%` }}
                className={PORT_HANDLE_COLORS[port.color ?? "violet"] ?? "!bg-violet-500"}
              />
            )
          })}
        </>
      ) : (
        <Handle type="source" position={Position.Bottom} className="!bg-violet-500" />
      )}
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
  onSelectionChange: (selection: { nodeId: string | null; edgeId: string | null }) => void
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
      const state = useWorkflowEditorStore.getState()
      const sourceNode = state.nodes.find((n) => n.id === params.source)
      const label = defaultLabelForConnection(
        sourceNode,
        params.sourceHandle,
        state.edges,
        params.source,
      )
      setEdges(
        addEdge(
          {
            ...params,
            ...(label ? { label } : {}),
          },
          state.edges,
        ),
      )
    },
    [setEdges],
  )

  const handleSelectionChange = useCallback(
    (params: OnSelectionChangeParams) => {
      const first = params.nodes[0]
      const firstEdge = params.edges[0]
      onSelectionChange({
        nodeId: first ? first.id : null,
        edgeId: first ? null : firstEdge?.id ?? null,
      })
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
      snapToGrid
      snapGrid={[16, 16]}
      fitView
      className="bg-muted/20"
      defaultEdgeOptions={{
        type: "smoothstep",
        labelShowBg: false,
        style: { strokeWidth: 1.5, stroke: "hsl(var(--muted-foreground) / 0.55)" },
        labelStyle: {
          fontSize: 10,
          fontWeight: 600,
          fill: "hsl(var(--foreground))",
        },
      }}
    >
      <Background gap={16} size={1} />
      <MiniMap pannable zoomable className="!bg-background" />
      <Controls />
    </ReactFlow>
  )
}
