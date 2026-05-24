"use client"

import type { Node } from "@xyflow/react"
import { Filter, GitBranch, Play, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useWorkflowEditorStore } from "@/app/email/stores/workflow-editor-store"

type Props = {
  selectedNodeId: string | null
  onClearSelection: () => void
}

export function NodePropertiesPanel({ selectedNodeId, onClearSelection }: Props) {
  const nodes = useWorkflowEditorStore((s) => s.nodes)
  const edges = useWorkflowEditorStore((s) => s.edges)
  const setNodes = useWorkflowEditorStore((s) => s.setNodes)
  const setEdges = useWorkflowEditorStore((s) => s.setEdges)

  const node: Node | undefined = selectedNodeId
    ? nodes.find((n) => n.id === selectedNodeId)
    : undefined

  const patch = (partial: Record<string, unknown>) => {
    if (!node) return
    setNodes(
      nodes.map((n) =>
        n.id === node.id ? { ...n, data: { ...n.data, ...partial } } : n,
      ),
    )
  }

  // Replaces the node's entire `data` object. Used when switching action
  // types so that stale fields (e.g. `tag` left over after switching from
  // "tag setzen" to "archivieren") don't end up in the compiled workflow.
  const replaceData = (next: Record<string, unknown>) => {
    if (!node) return
    setNodes(nodes.map((n) => (n.id === node.id ? { ...n, data: next } : n)))
  }

  const deleteNode = () => {
    if (!node) return
    // Protect trigger nodes from deletion.
    if (node.type === "trigger") return
    // Also strip any edges pointing to or from this node, otherwise the
    // workflow graph compiler will choke on dangling references at save time.
    setEdges(edges.filter((e) => e.source !== node.id && e.target !== node.id))
    setNodes(nodes.filter((n) => n.id !== node.id))
    onClearSelection()
  }

  if (!node) {
    return (
      <aside className="flex h-full flex-col border-l bg-muted/10">
        <div className="shrink-0 border-b px-4 py-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Eigenschaften
          </h3>
        </div>
        <div className="flex flex-1 items-center justify-center p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Wählen Sie einen Knoten im Graph aus, um seine Eigenschaften zu bearbeiten.
          </p>
        </div>
      </aside>
    )
  }

  return (
    <aside className="flex h-full min-h-0 flex-col border-l bg-muted/10">
      <div className="shrink-0 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          {node.type === "trigger" ? (
            <Play className="h-4 w-4 text-emerald-500" />
          ) : node.type === "condition" ? (
            <Filter className="h-4 w-4 text-amber-500" />
          ) : (
            <GitBranch className="h-4 w-4 text-sky-500" />
          )}
          <h3 className="text-sm font-semibold capitalize">{node.type}</h3>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-4 p-4">
          {node.type === "trigger" ? <TriggerFields node={node} patch={patch} /> : null}
          {node.type === "condition" ? (
            <ConditionFields node={node} patch={patch} />
          ) : null}
          {node.type === "action" ? (
            <ActionFields node={node} patch={patch} replaceData={replaceData} />
          ) : null}

          {node.type !== "trigger" ? (
            <>
              <Separator />
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="w-full gap-2"
                onClick={deleteNode}
              >
                <Trash2 className="h-4 w-4" />
                Knoten löschen
              </Button>
            </>
          ) : null}
        </div>
      </ScrollArea>
    </aside>
  )
}

type FieldProps = {
  node: Node
  patch: (partial: Record<string, unknown>) => void
}

type ActionFieldProps = FieldProps & {
  replaceData: (next: Record<string, unknown>) => void
}

function TriggerFields({ node, patch }: FieldProps) {
  const d = node.data as { kind?: string }
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Typ</Label>
      <Select value={d.kind ?? "inbound"} onValueChange={(kind) => patch({ kind })}>
        <SelectTrigger className="h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="inbound">E-Mail eingehend</SelectItem>
          <SelectItem value="outbound">E-Mail ausgehend</SelectItem>
          <SelectItem value="draft_created">Entwurf erstellt</SelectItem>
          <SelectItem value="schedule">Zeitplan (Cron)</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

function ConditionFields({ node, patch }: FieldProps) {
  const d = node.data as {
    field?: string
    op?: string
    value?: string
    caseInsensitive?: boolean
  }
  return (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs">Feld</Label>
        <Select
          value={d.field ?? "subject"}
          onValueChange={(field) => patch({ field })}
        >
          <SelectTrigger className="h-9">
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
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Operator</Label>
        <Select value={d.op ?? "contains"} onValueChange={(op) => patch({ op })}>
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="contains">enthält</SelectItem>
            <SelectItem value="equals">gleich</SelectItem>
            <SelectItem value="regex">Regex</SelectItem>
            <SelectItem value="domain_ends_with">Domain endet mit</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Wert</Label>
        <Input
          value={d.value ?? ""}
          onChange={(e) => patch({ value: e.target.value })}
          placeholder="Suchtext…"
        />
      </div>
      <div className="flex items-center gap-2">
        <Switch
          id="cond-ci"
          checked={d.caseInsensitive !== false}
          onCheckedChange={(v) => patch({ caseInsensitive: v })}
        />
        <Label htmlFor="cond-ci" className="cursor-pointer text-xs font-normal">
          Groß-/Kleinschreibung ignorieren
        </Label>
      </div>
    </>
  )
}

function ActionFields({ node, patch, replaceData }: ActionFieldProps) {
  const d = node.data as {
    actionType?: string
    tag?: string
    path?: string
    reason?: string
    to?: string
  }
  const t = d.actionType ?? "tag"

  // Switching action types must wipe the type-specific fields of the old
  // action, otherwise stale data (e.g. a `tag` value left over after
  // switching to "archive") ends up in the compiled workflow graph.
  const changeActionType = (actionType: string) => {
    const next: Record<string, unknown> = { actionType }
    if (actionType === "tag" || actionType === "tag_attachment_meta") {
      next.tag = ""
    } else if (actionType === "set_category") {
      next.path = ""
    } else if (actionType === "hold_outbound") {
      next.reason = ""
    } else if (actionType === "forward_copy") {
      next.to = ""
    }
    replaceData(next)
  }

  return (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs">Aktion</Label>
        <Select value={t} onValueChange={changeActionType}>
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tag">Tag setzen</SelectItem>
            <SelectItem value="mark_seen">Als gelesen markieren</SelectItem>
            <SelectItem value="archive">Archivieren</SelectItem>
            <SelectItem value="hold_outbound">Versand sperren</SelectItem>
            <SelectItem value="set_category">Kategorie setzen</SelectItem>
            <SelectItem value="link_customer">Kunde verknüpfen</SelectItem>
            <SelectItem value="forward_copy">Kopie weiterleiten</SelectItem>
            <SelectItem value="tag_attachment_meta">Tag bei Anhang</SelectItem>
            <SelectItem value="stop">Stopp</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {t === "tag" || t === "tag_attachment_meta" ? (
        <div className="space-y-1.5">
          <Label className="text-xs">Tag</Label>
          <Input
            value={d.tag ?? ""}
            onChange={(e) => patch({ tag: e.target.value })}
          />
        </div>
      ) : null}
      {t === "set_category" ? (
        <div className="space-y-1.5">
          <Label className="text-xs">Kategorie-Pfad</Label>
          <Input
            value={d.path ?? ""}
            onChange={(e) => patch({ path: e.target.value })}
            placeholder="Rechnungen/Unbezahlt"
          />
        </div>
      ) : null}
      {t === "hold_outbound" ? (
        <div className="space-y-1.5">
          <Label className="text-xs">Grund</Label>
          <Input
            value={d.reason ?? ""}
            onChange={(e) => patch({ reason: e.target.value })}
          />
        </div>
      ) : null}
      {t === "forward_copy" ? (
        <div className="space-y-1.5">
          <Label className="text-xs">Weiterleiten an</Label>
          <Input
            value={d.to ?? ""}
            onChange={(e) => patch({ to: e.target.value })}
            placeholder="empfänger@example.com"
            type="email"
          />
        </div>
      ) : null}
    </>
  )
}
