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
  Handle,
  Position,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useWorkflowEditorStore } from "./stores/workflow-editor-store"

function TriggerNode({ id, data }: NodeProps) {
  const d = data as { kind?: string }
  const setNodes = useWorkflowEditorStore((s) => s.setNodes)
  const setKind = (kind: string) => {
    const nodes = useWorkflowEditorStore.getState().nodes
    setNodes(nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, kind } } : n)))
  }
  return (
    <div className="min-w-[200px] rounded-md border bg-card p-3 shadow-sm">
      <Handle type="target" position={Position.Top} className="!bg-primary" />
      <Label className="text-xs">Trigger</Label>
      <Select value={d.kind ?? "inbound"} onValueChange={setKind}>
        <SelectTrigger className="mt-1 h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="inbound">E-Mail eingehend</SelectItem>
          <SelectItem value="outbound">E-Mail ausgehend</SelectItem>
          <SelectItem value="draft_created">Entwurf erstellt</SelectItem>
          <SelectItem value="schedule">Zeitplan (Cron)</SelectItem>
        </SelectContent>
      </Select>
      <Handle type="source" position={Position.Bottom} className="!bg-primary" />
    </div>
  )
}

function ConditionNode({ id, data }: NodeProps) {
  const d = data as { field?: string; op?: string; value?: string; caseInsensitive?: boolean }
  const setNodes = useWorkflowEditorStore((s) => s.setNodes)
  const patch = (partial: Record<string, unknown>) => {
    const nodes = useWorkflowEditorStore.getState().nodes
    setNodes(nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...partial } } : n)))
  }
  return (
    <div className="min-w-[240px] rounded-md border bg-card p-3 shadow-sm">
      <Handle type="target" position={Position.Top} className="!bg-primary" />
      <Label className="text-xs">Bedingung</Label>
      <Select value={d.field ?? "subject"} onValueChange={(field) => patch({ field })}>
        <SelectTrigger className="mt-1 h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="subject">Betreff</SelectItem>
          <SelectItem value="body_text">Text</SelectItem>
          <SelectItem value="snippet">Snippet</SelectItem>
          <SelectItem value="from_address">Von</SelectItem>
          <SelectItem value="to_address">An</SelectItem>
          <SelectItem value="cc_address">CC</SelectItem>
          <SelectItem value="combined_text">Kombiniert</SelectItem>
        </SelectContent>
      </Select>
      <Select value={d.op ?? "contains"} onValueChange={(op) => patch({ op })}>
        <SelectTrigger className="mt-1 h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="contains">enthält</SelectItem>
          <SelectItem value="equals">gleich</SelectItem>
          <SelectItem value="regex">Regex</SelectItem>
          <SelectItem value="domain_ends_with">Domain endet mit</SelectItem>
        </SelectContent>
      </Select>
      <Input
        className="mt-1 h-8 text-xs"
        placeholder="Wert"
        value={d.value ?? ""}
        onChange={(e) => patch({ value: e.target.value })}
      />
      <Handle type="source" position={Position.Bottom} className="!bg-primary" />
    </div>
  )
}

function ActionNode({ id, data }: NodeProps) {
  const d = data as { actionType?: string; tag?: string; path?: string; reason?: string; to?: string }
  const setNodes = useWorkflowEditorStore((s) => s.setNodes)
  const patch = (partial: Record<string, unknown>) => {
    const nodes = useWorkflowEditorStore.getState().nodes
    setNodes(nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...partial } } : n)))
  }
  const t = d.actionType ?? "tag"
  return (
    <div className="min-w-[220px] rounded-md border bg-card p-3 shadow-sm">
      <Handle type="target" position={Position.Top} className="!bg-primary" />
      <Label className="text-xs">Aktion</Label>
      <Select value={t} onValueChange={(actionType) => patch({ actionType })}>
        <SelectTrigger className="mt-1 h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="tag">Tag setzen</SelectItem>
          <SelectItem value="mark_seen">Gelesen</SelectItem>
          <SelectItem value="archive">Archivieren</SelectItem>
          <SelectItem value="hold_outbound">Versand sperren</SelectItem>
          <SelectItem value="set_category">Kategorie</SelectItem>
          <SelectItem value="link_customer">Kunde verknüpfen</SelectItem>
          <SelectItem value="forward_copy">Kopie weiterleiten</SelectItem>
          <SelectItem value="tag_attachment_meta">Tag bei Anhang</SelectItem>
          <SelectItem value="stop">Stopp</SelectItem>
        </SelectContent>
      </Select>
      {t === "tag" || t === "tag_attachment_meta" ? (
        <Input
          className="mt-1 h-8 text-xs"
          placeholder="Tag"
          value={d.tag ?? ""}
          onChange={(e) => patch({ tag: e.target.value })}
        />
      ) : null}
      {t === "set_category" ? (
        <Input
          className="mt-1 h-8 text-xs"
          placeholder="Pfad z. B. Rechnungen/Unbezahlt"
          value={d.path ?? ""}
          onChange={(e) => patch({ path: e.target.value })}
        />
      ) : null}
      {t === "hold_outbound" ? (
        <Input
          className="mt-1 h-8 text-xs"
          placeholder="Grund"
          value={d.reason ?? ""}
          onChange={(e) => patch({ reason: e.target.value })}
        />
      ) : null}
      {t === "forward_copy" ? (
        <Input
          className="mt-1 h-8 text-xs"
          placeholder="Weiterleiten an E-Mail"
          value={d.to ?? ""}
          onChange={(e) => patch({ to: e.target.value })}
        />
      ) : null}
      <Handle type="source" position={Position.Bottom} className="!bg-primary" />
    </div>
  )
}

const nodeTypes = {
  trigger: TriggerNode,
  condition: ConditionNode,
  action: ActionNode,
}

export function WorkflowFlowEditor() {
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

  const addNode = (type: "condition" | "action") => {
    const id = `${type}-${Date.now()}`
    const cur = useWorkflowEditorStore.getState().nodes
    const last = cur[cur.length - 1]
    const y = last ? last.position.y + 120 : 0
    const n =
      type === "condition"
        ? {
            id,
            type: "condition" as const,
            position: { x: 40, y },
            data: { field: "subject", op: "contains", value: "", caseInsensitive: true },
          }
        : {
            id,
            type: "action" as const,
            position: { x: 40, y },
            data: { actionType: "tag", tag: "" },
          }
    setNodes([...cur, n])
  }

  return (
    <div className="h-[420px] w-full rounded-md border">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
        className="bg-muted/20"
      >
        <Background />
        <MiniMap />
        <Controls />
      </ReactFlow>
      <div className="flex flex-wrap gap-2 border-t bg-background p-2">
        <Button type="button" size="sm" variant="secondary" onClick={() => addNode("condition")}>
          + Bedingung
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => addNode("action")}>
          + Aktion
        </Button>
      </div>
    </div>
  )
}
