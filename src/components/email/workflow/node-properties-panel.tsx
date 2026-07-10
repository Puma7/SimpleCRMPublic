"use client"

import { useEffect, useState } from "react"
import type { Edge, Node } from "@xyflow/react"
import { IPCChannels } from "@shared/ipc/channels"
import {
  WORKFLOW_ACTION_LABELS,
  resolveRegistryNodeLabel,
} from "@shared/workflow-ui-labels"
import { Filter, GitBranch, Play, Plus, Sparkles, Trash2, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useWorkflowNodeCatalog } from "./use-workflow-node-catalog"
import { AppMonacoEditor } from "@/components/shared/app-monaco-editor"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { ExpertJsonEditor } from "./expert-json-editor"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useWorkflowEditorStore } from "@/app/email/stores/workflow-editor-store"
import {
  AiProfileSelect,
  profileIdFromConfig,
} from "../ai-profile-select"
import { WorkflowCategorySelect } from "./workflow-category-select"
import type { AiPrompt } from "../types"
import { invokeRenderer } from "@/services/transport"
import {
  edgeLabelOptionsForSource,
  edgeSourceHandleFromLabel,
  isEdgeLabelValidForSource,
  normalizeEdgeLabelForSource,
  parseSwitchCases,
  stringifySwitchCases,
} from "./workflow-edge-labels"

type Props = {
  selectedNodeId: string | null
  selectedEdgeId: string | null
  onClearSelection: () => void
}

export function NodePropertiesPanel({
  selectedNodeId,
  selectedEdgeId,
  onClearSelection,
}: Props) {
  const { labelByType, descriptionByType } = useWorkflowNodeCatalog()
  const nodes = useWorkflowEditorStore((s) => s.nodes)
  const edges = useWorkflowEditorStore((s) => s.edges)
  const setNodes = useWorkflowEditorStore((s) => s.setNodes)
  const setEdges = useWorkflowEditorStore((s) => s.setEdges)

  const node: Node | undefined = selectedNodeId
    ? nodes.find((n) => n.id === selectedNodeId)
    : undefined
  const edge: Edge | undefined =
    !node && selectedEdgeId ? edges.find((e) => e.id === selectedEdgeId) : undefined

  const patch = (partial: Record<string, unknown>) => {
    if (!node) return
    const nextData = { ...node.data, ...partial }
    const nextNode = { ...node, data: nextData }
    setNodes(
      nodes.map((n) =>
        n.id === node.id ? nextNode : n,
      ),
    )
    setEdges(resyncOutgoingEdgeHandles(edges, nextNode))
  }

  // Replaces the node's entire `data` object. Used when switching action
  // types so that stale fields (e.g. `tag` left over after switching from
  // "tag setzen" to "archivieren") don't end up in the compiled workflow.
  const replaceData = (next: Record<string, unknown>) => {
    if (!node) return
    const nextNode = { ...node, data: next }
    setNodes(nodes.map((n) => (n.id === node.id ? nextNode : n)))
    setEdges(resyncOutgoingEdgeHandles(edges, nextNode))
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
    if (edge) {
      return (
        <EdgePropertiesPanel
          edge={edge}
          edges={edges}
          nodes={nodes}
          labelByType={labelByType}
          setEdges={setEdges}
          onClearSelection={onClearSelection}
        />
      )
    }
    return (
      <aside className="flex min-h-0 flex-1 flex-col border-l bg-muted/10">
        <div className="shrink-0 border-b px-4 py-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Eigenschaften
          </h3>
        </div>
        <div className="flex flex-1 items-center justify-center p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Wählen Sie einen Knoten oder eine Kante im Graph aus, um seine Eigenschaften zu bearbeiten.
          </p>
        </div>
      </aside>
    )
  }

  const registryData =
    node.type === "registry"
      ? (node.data as { nodeType?: string; label?: string })
      : null
  const panelTitle =
    node.type === "trigger"
      ? "Trigger"
      : node.type === "condition"
        ? "Bedingung"
        : node.type === "action"
          ? WORKFLOW_ACTION_LABELS[
              (node.data as { actionType?: string }).actionType ?? "tag"
            ] ?? "Aktion"
          : resolveRegistryNodeLabel(
              registryData?.nodeType,
              labelByType,
              registryData?.label,
            )

  return (
    <aside className="flex min-h-0 flex-1 flex-col border-l bg-muted/10">
      <div className="shrink-0 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          {node.type === "trigger" ? (
            <Play className="h-4 w-4 text-emerald-500" />
          ) : node.type === "condition" ? (
            <Filter className="h-4 w-4 text-amber-500" />
          ) : node.type === "registry" ? (
            <Sparkles className="h-4 w-4 text-violet-500" />
          ) : (
            <GitBranch className="h-4 w-4 text-sky-500" />
          )}
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">{panelTitle}</h3>
            {node.type === "registry" ? (
              <p className="truncate text-[10px] text-muted-foreground">Erweiterter Knoten</p>
            ) : null}
          </div>
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
          {node.type === "registry" ? (
            <RegistryFields node={node} patch={patch} labelByType={labelByType} descriptionByType={descriptionByType} />
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

type EdgePropertiesPanelProps = {
  edge: Edge
  edges: Edge[]
  nodes: Node[]
  labelByType: Map<string, string>
  setEdges: (edges: Edge[]) => void
  onClearSelection: () => void
}

function EdgePropertiesPanel({
  edge,
  edges,
  nodes,
  labelByType,
  setEdges,
  onClearSelection,
}: EdgePropertiesPanelProps) {
  const sourceNode = nodes.find((n) => n.id === edge.source)
  const targetNode = nodes.find((n) => n.id === edge.target)
  const rawLabel = typeof edge.label === "string" ? edge.label : ""
  const normalizedLabel = normalizeEdgeLabelForSource(sourceNode, rawLabel)
  const options = edgeLabelOptionsForSource(sourceNode)
  const labelValid = isEdgeLabelValidForSource(sourceNode, rawLabel)
  const selectValue = labelValid && normalizedLabel ? normalizedLabel : "__invalid__"

  const updateLabel = (label: string) => {
    const nextLabel = label.trim()
      ? normalizeEdgeLabelForSource(sourceNode, label)
      : undefined
    setEdges(
      edges.map((candidate) =>
        candidate.id === edge.id
          ? {
              ...candidate,
              label: nextLabel,
              sourceHandle: edgeSourceHandleFromLabel(nextLabel, sourceNode),
            }
          : candidate,
      ),
    )
  }

  const deleteEdge = () => {
    setEdges(edges.filter((candidate) => candidate.id !== edge.id))
    onClearSelection()
  }

  return (
    <aside className="flex min-h-0 flex-1 flex-col border-l bg-muted/10">
      <div className="shrink-0 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-sky-500" />
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">Kante</h3>
            <p className="truncate text-[10px] text-muted-foreground">
              {nodeDisplayName(sourceNode, labelByType)} → {nodeDisplayName(targetNode, labelByType)}
            </p>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-4 p-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Label</Label>
            {options.restricted ? (
              <Select value={selectValue} onValueChange={updateLabel}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {!labelValid || !normalizedLabel ? (
                    <SelectItem value="__invalid__" disabled>
                      {rawLabel ? `Ungültig: ${rawLabel}` : "Kein Label"}
                    </SelectItem>
                  ) : null}
                  {options.labels.map((label) => (
                    <SelectItem key={label} value={label}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                className="h-9"
                value={rawLabel}
                onChange={(e) => updateLabel(e.target.value)}
                placeholder="Optionales Label"
              />
            )}
            {options.restricted && (!labelValid || !normalizedLabel) ? (
              <p className="text-[11px] text-amber-600">
                Aktuelles Label passt nicht zu den Ausgängen dieses Knotens.
              </p>
            ) : null}
          </div>

          <div className="space-y-2 rounded-md border p-3 text-[11px] text-muted-foreground">
            <div className="min-w-0">
              <span className="font-medium text-foreground">Quelle:</span>{" "}
              <span className="break-all">{sourceNode?.id ?? edge.source}</span>
            </div>
            <div className="min-w-0">
              <span className="font-medium text-foreground">Ziel:</span>{" "}
              <span className="break-all">{targetNode?.id ?? edge.target}</span>
            </div>
            {edge.sourceHandle ? (
              <div className="min-w-0">
                <span className="font-medium text-foreground">Handle:</span>{" "}
                <span className="break-all">{edge.sourceHandle}</span>
              </div>
            ) : null}
          </div>

          <Separator />
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="w-full gap-2"
            onClick={deleteEdge}
          >
            <Trash2 className="h-4 w-4" />
            Kante löschen
          </Button>
        </div>
      </ScrollArea>
    </aside>
  )
}

function nodeDisplayName(
  node: Node | null | undefined,
  labelByType: Map<string, string>,
): string {
  if (!node) return "Unbekannt"
  if (node.type === "trigger") return "Trigger"
  if (node.type === "condition") return "Bedingung"
  if (node.type === "action") {
    const actionType = (node.data as { actionType?: string }).actionType ?? "tag"
    return WORKFLOW_ACTION_LABELS[actionType] ?? "Aktion"
  }
  if (node.type === "registry") {
    const data = node.data as { nodeType?: string; label?: string }
    return resolveRegistryNodeLabel(data.nodeType, labelByType, data.label)
  }
  return node.id
}

function resyncOutgoingEdgeHandles(edges: Edge[], sourceNode: Node): Edge[] {
  return edges.map((edge) =>
    edge.source === sourceNode.id
      ? { ...edge, sourceHandle: edgeSourceHandleFromLabel(edge.label, sourceNode) }
      : edge,
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
      <Select
        value={d.kind ?? "inbound"}
        onValueChange={(kind) => patch({ kind })}
      >
        <SelectTrigger className="h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="inbound">E-Mail eingehend</SelectItem>
          <SelectItem value="outbound">E-Mail ausgehend</SelectItem>
          <SelectItem value="draft_created">Entwurf erstellt</SelectItem>
          <SelectItem value="schedule">Zeitplan (Cron)</SelectItem>
          <SelectItem value="manual">Manuell</SelectItem>
          <SelectItem value="crm.deal_stage_changed">Deal-Phase geändert</SelectItem>
          <SelectItem value="task.due">Aufgabe fällig</SelectItem>
          <SelectItem value="calendar.event_start">Termin beginnt</SelectItem>
          <SelectItem value="webhook.incoming">Webhook (eingehend)</SelectItem>
          <SelectItem value="crm.customer_created">Kunde angelegt</SelectItem>
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
  const field = d.field ?? "subject"
  const isAttachmentBool = field === "has_attachments"
  return (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs">Feld</Label>
        <Select
          value={field}
          onValueChange={(f) => {
            if (f === "has_attachments") {
              patch({ field: f, op: "is_true", value: "" })
            } else {
              patch({ field: f, op: d.op === "is_true" || d.op === "is_false" ? "contains" : d.op })
            }
          }}
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
            <SelectItem value="has_attachments">Hat Anhang</SelectItem>
            <SelectItem value="attachment_names">Anhang-Dateinamen</SelectItem>
            <SelectItem value="attachment_types">Anhang-MIME-Typ</SelectItem>
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
            {isAttachmentBool ? (
              <>
                <SelectItem value="is_true">ja</SelectItem>
                <SelectItem value="is_false">nein</SelectItem>
              </>
            ) : (
              <>
                <SelectItem value="contains">enthält</SelectItem>
                <SelectItem value="equals">gleich</SelectItem>
                <SelectItem value="regex">Regex</SelectItem>
                <SelectItem value="domain_ends_with">Domain endet mit</SelectItem>
              </>
            )}
          </SelectContent>
        </Select>
      </div>
      {!isAttachmentBool ? (
      <div className="space-y-1.5">
        <Label className="text-xs">Wert</Label>
        <Input
          value={d.value ?? ""}
          onChange={(e) => patch({ value: e.target.value })}
          placeholder="Suchtext…"
          className={cn(!d.value?.trim() && "border-amber-500/60 focus-visible:ring-amber-500/30")}
          aria-invalid={!d.value?.trim()}
        />
        {!d.value?.trim() ? (
          <p className="text-[11px] text-amber-700 dark:text-amber-400">
            Ohne Wert trifft diese Bedingung keine Nachrichten.
          </p>
        ) : null}
      </div>
      ) : null}
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

type RegistryFieldProps = FieldProps & {
  labelByType: Map<string, string>
  descriptionByType: Map<string, string>
}

function patchConfig(
  patch: (p: Record<string, unknown>) => void,
  config: Record<string, unknown>,
  key: string,
  value: unknown,
) {
  patch({ config: { ...config, [key]: value } })
}

/** UI shows first prompt when promptId is 0 — persist so runtime matches the Select. */
function effectivePromptId(
  config: Record<string, unknown>,
  prompts: AiPrompt[],
): number | null {
  const raw = Number(config.promptId ?? 0)
  if (raw > 0 && prompts.some((p) => p.id === raw)) return raw
  return prompts[0]?.id ?? null
}

function usePersistDefaultPromptId(
  config: Record<string, unknown>,
  patch: (p: Record<string, unknown>) => void,
  prompts: AiPrompt[],
) {
  useEffect(() => {
    if (prompts.length === 0) return
    const resolved = effectivePromptId(config, prompts)
    const current = Number(config.promptId ?? 0)
    if (resolved != null && current !== resolved) {
      patchConfig(patch, config, "promptId", resolved)
    }
  }, [config.promptId, prompts, patch, config])
}

function AiProfileConfigField({
  config,
  patch,
  hint,
}: {
  config: Record<string, unknown>
  patch: (p: Record<string, unknown>) => void
  hint?: string
}) {
  return (
    <AiProfileSelect
      value={profileIdFromConfig(config)}
      onChange={(profileId) =>
        patchConfig(patch, config, "profileId", profileId)
      }
      hint={
        hint ??
        "Überschreibt das Standard-Profil für diesen Knoten. Bei Prompt-Knoten gilt: Knoten-Profil vor Prompt-Profil."
      }
    />
  )
}

function SenderFilterFields({
  config,
  patch,
}: {
  config: Record<string, unknown>
  patch: (p: Record<string, unknown>) => void
}) {
  return (
    <div className="space-y-3 rounded-md border p-3">
      <p className="text-[11px] text-muted-foreground">
        Kanten: <strong>whitelist</strong> (vertrauenswürdig), <strong>blacklist</strong> (Spam),
        <strong> default</strong> (weiter zur KI).
      </p>
      <div className="flex items-center gap-2">
        <Switch
          checked={config.useGlobalLists !== false}
          onCheckedChange={(v) => patchConfig(patch, config, "useGlobalLists", v)}
        />
        <Label className="text-xs font-normal">Globale Listen aus Einstellungen</Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch
          checked={config.useBuiltinTrusted !== false}
          onCheckedChange={(v) => patchConfig(patch, config, "useBuiltinTrusted", v)}
        />
        <Label className="text-xs font-normal">PayPal/Amazon/Lidl-Standardliste</Label>
      </div>
    </div>
  )
}

function SpamScoreFields({
  config,
  patch,
}: {
  config: Record<string, unknown>
  patch: (p: Record<string, unknown>) => void
}) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <AiProfileConfigField config={config} patch={patch} />
      <div className="space-y-1.5">
        <Label className="text-xs">Kontext für KI</Label>
        <Select
          value={String(config.contextMode ?? "metadata")}
          onValueChange={(v) => patchConfig(patch, config, "contextMode", v)}
        >
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="metadata">Nur Metadaten (DSGVO)</SelectItem>
            <SelectItem value="full">Volltext (nicht empfohlen)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Variable <code className="text-[10px]">ai.spam_score</code> (1–100). Danach Knoten
        „Schwellwert“ verwenden.
      </p>
    </div>
  )
}

function ThresholdFields({
  config,
  patch,
}: {
  config: Record<string, unknown>
  patch: (p: Record<string, unknown>) => void
}) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Variable</Label>
        <Input
          className="h-9"
          value={String(config.variable ?? "ai.spam_score")}
          onChange={(e) => patchConfig(patch, config, "variable", e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Operator</Label>
          <Select
            value={String(config.operator ?? "gte")}
            onValueChange={(v) => patchConfig(patch, config, "operator", v)}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="gte">≥ (Spam ab Wert)</SelectItem>
              <SelectItem value="lte">≤</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Schwellwert (1–100)</Label>
          <Input
            type="number"
            min={1}
            max={100}
            className="h-9"
            disabled={config.useGlobalThreshold === true}
            value={String(config.value ?? 70)}
            onChange={(e) => patchConfig(patch, config, "value", parseInt(e.target.value, 10) || 70)}
          />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">Globaler Spam-Schwellwert (Einstellungen)</Label>
        <Switch
          checked={config.useGlobalThreshold === true}
          onCheckedChange={(on) => patchConfig(patch, config, "useGlobalThreshold", on)}
        />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Kanten: <strong>yes</strong> / <strong>no</strong> (auch „ja“/„nein“).
      </p>
    </div>
  )
}

function MarkSpamFields({
  config,
  patch,
}: {
  config: Record<string, unknown>
  patch: (p: Record<string, unknown>) => void
}) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Tag</Label>
        <Input
          className="h-9"
          value={String(config.tag ?? "auto-spam")}
          onChange={(e) => patchConfig(patch, config, "tag", e.target.value)}
        />
      </div>
      <div className="flex items-center gap-2">
        <Switch
          checked={config.moveImap === true}
          onCheckedChange={(v) => patchConfig(patch, config, "moveImap", v)}
        />
        <Label className="text-xs font-normal">Zusätzlich IMAP-Ordner Spam</Label>
      </div>
    </div>
  )
}

function AssignFields({
  config,
  patch,
}: {
  config: Record<string, unknown>
  patch: (p: Record<string, unknown>) => void
}) {
  return (
    <div className="space-y-1.5 rounded-md border p-3">
      <Label className="text-xs">Team-Mitglied-ID</Label>
      <Input
        className="h-9 font-mono text-xs"
        value={String(config.teamMemberId ?? "")}
        onChange={(e) => patchConfig(patch, config, "teamMemberId", e.target.value)}
        placeholder="UUID aus Team-Einstellungen"
      />
    </div>
  )
}

function OutboundReviewFields({
  config,
  patch,
}: {
  config: Record<string, unknown>
  patch: (p: Record<string, unknown>) => void
}) {
  const [aiPrompts, setAiPrompts] = useState<AiPrompt[]>([])
  useEffect(() => {
    void invokeRenderer(IPCChannels.Email.ListAiPrompts)
      .then((rows) => setAiPrompts(rows as AiPrompt[]))
      .catch(() => {})
  }, [])

  return (
    <div className="space-y-2 rounded-md border p-3">
      <AiProfileConfigField
        config={config}
        patch={patch}
        hint="Optional: anderes Profil als im KI-Prompt hinterlegt."
      />
      <div className="space-y-1.5">
        <Label className="text-xs">KI-Prompt (optional)</Label>
        <Select
          value={String(config.promptId ?? 0)}
          onValueChange={(v) => patchConfig(patch, config, "promptId", parseInt(v, 10))}
        >
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="0">Standard (Ton, Anhang, Betrug)</SelectItem>
            {aiPrompts.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">Antwort-Kontext prüfen</Label>
        <Switch
          checked={config.checkReplyContext !== false}
          onCheckedChange={(on) => patchConfig(patch, config, "checkReplyContext", on)}
        />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Blockierte Entwürfe landen im Posteingang mit gelbem Hinweis im Text.
      </p>
    </div>
  )
}

function ClassifyFields({
  config,
  patch,
}: {
  config: Record<string, unknown>
  patch: (p: Record<string, unknown>) => void
}) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <AiProfileConfigField config={config} patch={patch} />
      <div className="space-y-1.5">
        <Label className="text-xs">Kategorien (kommagetrennt)</Label>
        <Input
          className="h-9"
          value={String(config.labels ?? "")}
          onChange={(e) => patchConfig(patch, config, "labels", e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Kontext</Label>
        <Select
          value={String(config.contextMode ?? "metadata")}
          onValueChange={(v) => patchConfig(patch, config, "contextMode", v)}
        >
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="metadata">Nur Metadaten</SelectItem>
            <SelectItem value="full">Volltext</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

function AgentFields({
  config,
  patch,
}: {
  config: Record<string, unknown>
  patch: (p: Record<string, unknown>) => void
}) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <AiProfileConfigField config={config} patch={patch} />
      <div className="space-y-1.5">
        <Label className="text-xs">System-Prompt</Label>
        <Input
          className="h-9 text-xs"
          value={String(config.systemPrompt ?? "")}
          onChange={(e) => patchConfig(patch, config, "systemPrompt", e.target.value)}
        />
      </div>
      <div className="flex items-center gap-2">
        <Switch
          checked={config.createDraft !== false}
          onCheckedChange={(v) => patchConfig(patch, config, "createDraft", v)}
        />
        <Label className="text-xs font-normal">Antwort-Entwurf anlegen</Label>
      </div>
    </div>
  )
}

function TransformTextFields({
  config,
  patch,
}: {
  config: Record<string, unknown>
  patch: (p: Record<string, unknown>) => void
}) {
  const [aiPrompts, setAiPrompts] = useState<AiPrompt[]>([])
  useEffect(() => {
    void invokeRenderer(IPCChannels.Email.ListAiPrompts)
      .then((rows) => setAiPrompts(rows as AiPrompt[]))
      .catch(() => {})
  }, [])

  usePersistDefaultPromptId(config, patch, aiPrompts)
  const selectedPromptId = effectivePromptId(config, aiPrompts)

  return (
    <div className="space-y-2 rounded-md border p-3">
      <AiProfileConfigField
        config={config}
        patch={patch}
        hint="Knoten-Profil hat Vorrang vor dem Profil des gewählten Prompts."
      />
      <div className="space-y-1.5">
        <Label className="text-xs">KI-Prompt</Label>
        {aiPrompts.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            Keine Prompts vorhanden — unter E-Mail → Einstellungen → KI anlegen.
          </p>
        ) : (
          <Select
            value={selectedPromptId != null ? String(selectedPromptId) : ""}
            onValueChange={(v) => patchConfig(patch, config, "promptId", parseInt(v, 10))}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Prompt wählen" />
            </SelectTrigger>
            <SelectContent>
              {aiPrompts.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  )
}

function SwitchCaseBuilderFields({
  config,
  patch,
}: {
  config: Record<string, unknown>
  patch: (p: Record<string, unknown>) => void
}) {
  const cases = parseSwitchCases(config.cases ?? "A,B,C")
  const updateCases = (nextCases: string[]) => {
    patchConfig(patch, config, "cases", stringifySwitchCases(nextCases))
  }
  const addCase = () => {
    let index = cases.length + 1
    let next = `fall${index}`
    while (cases.includes(next)) {
      index += 1
      next = `fall${index}`
    }
    updateCases([...cases, next])
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Feld / Variable</Label>
        <Input
          className="h-9 font-mono text-xs"
          value={String(config.field ?? "ai.class")}
          onChange={(e) => patchConfig(patch, config, "field", e.target.value)}
          placeholder="ai.class"
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs">Fälle</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-2"
            onClick={addCase}
          >
            <Plus className="h-3.5 w-3.5" />
            Fall
          </Button>
        </div>
        {cases.length > 0 ? (
          <div className="space-y-2">
            {cases.map((caseLabel, index) => (
              <div key={`${caseLabel}-${index}`} className="flex items-center gap-2">
                <Input
                  className="h-9 font-mono text-xs"
                  value={caseLabel}
                  onChange={(e) => {
                    const next = [...cases]
                    next[index] = e.target.value
                    updateCases(next)
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  onClick={() => updateCases(cases.filter((_, i) => i !== index))}
                  aria-label="Fall löschen"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Keine Fälle konfiguriert. Die Kante <strong>default</strong> bleibt verfügbar.
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Standard-Ausgang</Label>
        <Input className="h-9 font-mono text-xs" value="default" disabled />
      </div>
    </div>
  )
}

function clampLoopMaxItems(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 50
  return Math.min(500, Math.max(1, Math.trunc(parsed)))
}

function LoopConfigFields({
  config,
  patch,
}: {
  config: Record<string, unknown>
  patch: (p: Record<string, unknown>) => void
}) {
  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Listen-Variable</Label>
        <Input
          className="h-9 font-mono text-xs"
          value={String(config.sourceVariable ?? "attachment_names")}
          onChange={(e) => patchConfig(patch, config, "sourceVariable", e.target.value)}
          placeholder="attachment_names"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Fallback-Items</Label>
        <Textarea
          className="min-h-[90px] font-mono text-xs"
          value={String(config.items ?? "")}
          onChange={(e) => patchConfig(patch, config, "items", e.target.value)}
          placeholder="eins, zwei, drei"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Max. Items</Label>
        <Input
          type="number"
          min={1}
          max={500}
          className="h-9"
          value={String(config.maxItems ?? 50)}
          onChange={(e) =>
            patchConfig(patch, config, "maxItems", clampLoopMaxItems(e.target.value))
          }
        />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Kanten: <strong>each</strong> für jedes Element und <strong>done</strong> nach der Schleife.
      </p>
    </div>
  )
}

function CodeConfigFields({
  config,
  patch,
  language,
}: {
  config: Record<string, unknown>
  patch: (p: Record<string, unknown>) => void
  language: "javascript" | "python"
}) {
  const value = String(config.code ?? "")
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Code</Label>
        <div className="overflow-hidden rounded-md border bg-background">
          <AppMonacoEditor
            value={value}
            language={language}
            theme="vs-dark"
            height="260px"
            onChange={(next) => patchConfig(patch, config, "code", next ?? "")}
            options={{
              automaticLayout: true,
              fontSize: 12,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
            }}
            loadingFallback={
              <Textarea
                className="min-h-[260px] rounded-none border-0 font-mono text-xs"
                value={value}
                disabled
              />
            }
          />
        </div>
      </div>
    </div>
  )
}

function RegistryFields({ node, patch, labelByType, descriptionByType }: RegistryFieldProps) {
  const d = node.data as {
    nodeType?: string
    label?: string
    config?: Record<string, unknown>
    expertJson?: string
  }
  const config = d.config ?? {}
  const displayLabel = resolveRegistryNodeLabel(d.nodeType, labelByType, d.label)
  const description = d.nodeType ? descriptionByType.get(d.nodeType) : undefined
  return (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs">Knoten</Label>
        <Input value={displayLabel} disabled className="h-9 text-sm" />
        {d.nodeType ? (
          <p className="font-mono text-[10px] text-muted-foreground">{d.nodeType}</p>
        ) : null}
        {description ? (
          <p className="rounded-md bg-muted/50 p-2 text-[11px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {d.nodeType === "logic.switch" ? (
        <SwitchCaseBuilderFields config={config} patch={patch} />
      ) : null}
      {d.nodeType === "logic.loop" ? <LoopConfigFields config={config} patch={patch} /> : null}
      {d.nodeType === "code.javascript" ? (
        <CodeConfigFields config={config} patch={patch} language="javascript" />
      ) : null}
      {d.nodeType === "code.python" ? (
        <CodeConfigFields config={config} patch={patch} language="python" />
      ) : null}
      {d.nodeType === "email.sender_filter" ? (
        <SenderFilterFields config={config} patch={patch} />
      ) : null}
      {d.nodeType === "ai.spam_score" ? (
        <SpamScoreFields config={config} patch={patch} />
      ) : null}
      {d.nodeType === "logic.threshold" ? (
        <ThresholdFields config={config} patch={patch} />
      ) : null}
      {d.nodeType === "email.mark_spam" ? (
        <MarkSpamFields config={config} patch={patch} />
      ) : null}
      {d.nodeType === "email.assign" ? (
        <AssignFields config={config} patch={patch} />
      ) : null}
      {d.nodeType === "ai.classify" ? (
        <ClassifyFields config={config} patch={patch} />
      ) : null}
      {d.nodeType === "ai.outbound_review" ? (
        <OutboundReviewFields config={config} patch={patch} />
      ) : null}
      {d.nodeType === "ai.agent" ? (
        <AgentFields config={config} patch={patch} />
      ) : null}
      {d.nodeType === "ai.transform_text" ? (
        <TransformTextFields config={config} patch={patch} />
      ) : null}
      {d.nodeType === "email.forward_copy" ? (
        <ForwardCopyFields config={config} patch={patch} />
      ) : null}
      {d.nodeType === "email.release_outbound" ? (
        <ReleaseOutboundFields config={config} patch={patch} />
      ) : null}
      {d.nodeType === "email.send_draft" ? (
        <SendDraftFields config={config} patch={patch} />
      ) : null}
      {d.nodeType === "email.auto_reply" ? (
        <AutoReplyFields config={config} patch={patch} />
      ) : null}
      {d.nodeType === "ai.pick_canned" ? (
        <PickCannedFields config={config} patch={patch} />
      ) : null}
      {d.nodeType === "logic.delay" ? (
        <DelayFields config={config} patch={patch} />
      ) : null}
      {d.nodeType === "logic.set_variable" ? (
        <SetVariableFields config={config} patch={patch} />
      ) : null}
      {d.nodeType === "http.request" ? (
        <HttpRequestFields config={config} patch={patch} />
      ) : null}
      {d.nodeType === "workflow.subflow" ? (
        <SubflowFields config={config} patch={patch} />
      ) : null}
      {d.nodeType === "sync.run" ? (
        <SyncRunFields config={config} patch={patch} />
      ) : null}
      {d.nodeType === "crm.create_task" ? (
        <CrmCreateTaskFields config={config} patch={patch} />
      ) : null}
      {d.nodeType === "mssql.query" ? (
        <MssqlQueryFields config={config} patch={patch} />
      ) : null}
      {d.nodeType === "jtl.order_context" ? (
        <JtlOrderContextFields config={config} patch={patch} />
      ) : null}
      {d.nodeType === "jtl.prepare_action" ? (
        <JtlPrepareActionFields config={config} patch={patch} />
      ) : null}
      {d.nodeType === "email.tag" || d.nodeType === "email.tag_attachment_meta" ? (
        <TagFields config={config} patch={patch} />
      ) : null}
      {d.nodeType === "email.set_category" ? (
        <SetCategoryFields config={config} patch={patch} />
      ) : null}
      {d.nodeType === "email.set_priority" ? (
        <SetPriorityFields config={config} patch={patch} />
      ) : null}
      {d.nodeType === "email.set_spam_status" ? (
        <SetSpamStatusFields config={config} patch={patch} />
      ) : null}
      {d.nodeType === "email.move_imap" ? (
        <MoveImapFields config={config} patch={patch} />
      ) : null}
      {d.nodeType === "email.create_draft" ? (
        <CreateDraftFields config={config} patch={patch} />
      ) : null}
      {d.nodeType === "email.hold_outbound" ? (
        <HoldOutboundFields config={config} patch={patch} />
      ) : null}
      {d.nodeType === "email.auth_check" ? (
        <AuthCheckFields config={config} patch={patch} />
      ) : null}
      {d.nodeType === "ai.review" ? (
        <AiReviewFields config={config} patch={patch} />
      ) : null}
      {d.nodeType === "ai.agent_tool" ? (
        <AgentToolFields config={config} patch={patch} />
      ) : null}
      {d.nodeType === "ai.reply_suggestion" ? (
        <ReplySuggestionFields config={config} patch={patch} />
      ) : null}
      {d.nodeType === "crm.log_activity" ? (
        <CrmLogActivityFields config={config} patch={patch} />
      ) : null}
      {d.nodeType === "crm.update_deal" ? (
        <CrmUpdateDealFields config={config} patch={patch} />
      ) : null}
      {d.nodeType === "jtl.lookup" ? (
        <JtlLookupFields config={config} patch={patch} />
      ) : null}
      <details className="space-y-1.5">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
          Experten-JSON (config) — Fallback für selten genutzte Felder
        </summary>
        <ExpertJsonEditor
          value={d.expertJson ?? JSON.stringify(d.config ?? {}, null, 2)}
          onChange={(text) => {
            try {
              const parsed = JSON.parse(text) as Record<string, unknown>
              patch({ config: parsed, expertJson: text })
            } catch {
              patch({ expertJson: text })
            }
          }}
          height="220px"
        />
        {expertJsonError(d.expertJson) ? (
          <p className="text-[11px] text-destructive">
            Ungültiges JSON — Änderungen werden erst übernommen, wenn die Syntax stimmt:{" "}
            {expertJsonError(d.expertJson)}
          </p>
        ) : null}
      </details>
    </>
  )
}

type FieldFnProps = { config: Record<string, unknown>; patch: (p: Record<string, unknown>) => void }

function expertJsonError(expertJson: string | undefined): string | null {
  if (expertJson == null || expertJson.trim() === "") return null
  try {
    JSON.parse(expertJson)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

function ReplySuggestionFields({ config, patch }: FieldFnProps) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Prompt-ID</Label>
        <Input
          type="number"
          min={0}
          className="h-9"
          value={Number(config.promptId ?? 0)}
          onChange={(e) => patchConfig(patch, config, "promptId", parseInt(e.target.value, 10) || 0)}
        />
        <p className="text-[11px] text-muted-foreground">0 = Standard-Prompt für Antwortvorschläge verwenden.</p>
      </div>
      <div className="flex items-start gap-2">
        <Switch
          checked={config.skipIfReady !== false}
          onCheckedChange={(v) => patchConfig(patch, config, "skipIfReady", v)}
        />
        <div className="space-y-0.5">
          <Label className="text-xs font-normal">Überspringen, wenn schon ein Vorschlag existiert</Label>
          <p className="text-[11px] text-muted-foreground">
            Ergebnis erscheint als Vorschlag im Lesebereich (Variable{" "}
            <code>reply_suggestion.text</code>). Legt KEINEN Entwurf an — zum automatischen
            Versenden „KI: Textbaustein wählen“ oder „Antwort-Entwurf erstellen“ nutzen.
          </p>
        </div>
      </div>
    </div>
  )
}

function ForwardCopyFields({ config, patch }: FieldFnProps) {
  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Empfänger (kommagetrennt, max. 10)</Label>
        <Textarea
          className="min-h-[60px] text-sm"
          placeholder="bank@example.com, buchhaltung@example.com"
          value={String(config.to ?? "")}
          onChange={(e) => patchConfig(patch, config, "to", e.target.value)}
        />
        <p className="text-[11px] text-muted-foreground">
          Trenner: Komma oder Semikolon. Adressen werden validiert und entdupliziert.
        </p>
      </div>
      <div className="flex items-start gap-2">
        <Switch
          checked={config.includeAttachments === true}
          onCheckedChange={(v) => patchConfig(patch, config, "includeAttachments", v)}
        />
        <div className="space-y-0.5">
          <Label className="text-xs font-normal">Original-Anhänge mitschicken</Label>
          <p className="text-[11px] text-muted-foreground">Limit insgesamt 25 MB. Unlesbare Dateien werden übersprungen.</p>
        </div>
      </div>
      <div className="flex items-start gap-2">
        <Switch
          checked={config.runOutboundReview === true}
          onCheckedChange={(v) => patchConfig(patch, config, "runOutboundReview", v)}
        />
        <div className="space-y-0.5">
          <Label className="text-xs font-normal">Mit Ausgangsprüfung</Label>
          <p className="text-[11px] text-muted-foreground">
            Standard: aus (Weiterleitungen umgehen die Prüfung, Anti-Loop via Auto-Submitted-Header + Dedup).
            Ein: fail-closed bei aktiven Outbound-Workflows.
          </p>
        </div>
      </div>
    </div>
  )
}

function SendDraftFields({ config, patch }: FieldFnProps) {
  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Workflow-Variable mit Draft-ID</Label>
        <Input
          className="h-9 font-mono text-sm"
          placeholder="draft.id"
          value={String(config.draftIdVariable ?? "draft.id")}
          onChange={(e) => patchConfig(patch, config, "draftIdVariable", e.target.value)}
        />
        <p className="text-[11px] text-muted-foreground">
          Die Variable <code>draft.id</code> wird von „Antwort-Entwurf erstellen“, „KI-Agent“
          und „KI: Textbaustein wählen“ gesetzt. „Antwortvorschlag erzeugen“ legt KEINEN
          Entwurf an und funktioniert hier nicht.
        </p>
      </div>
      <div className="flex items-start gap-2">
        <Switch
          checked={config.runOutboundReview === true}
          onCheckedChange={(v) => patchConfig(patch, config, "runOutboundReview", v)}
        />
        <div className="space-y-0.5">
          <Label className="text-xs font-normal">Zusätzlich durch Outbound-Workflows prüfen</Label>
          <p className="text-[11px] text-muted-foreground">
            Aus (Standard): KI-Antwort geht direkt raus, ohne erneute Prüfung. Ein: die KI-Antwort durchläuft
            die Outbound-Workflows (z. B. KI-Ausgangsprüfung), genau wie eine getippte Mail.
          </p>
        </div>
      </div>
    </div>
  )
}

function ReleaseOutboundFields({ config, patch }: FieldFnProps) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-start gap-2">
        <Switch
          checked={config.autoSend !== false}
          onCheckedChange={(v) => patchConfig(patch, config, "autoSend", v)}
        />
        <div className="space-y-0.5">
          <Label className="text-xs font-normal">Auto-senden nach Freigabe</Label>
          <p className="text-[11px] text-muted-foreground">
            Standard: ein. Markiert den Entwurf als geprüft und lässt den scheduled-send-Worker sofort versenden.
            Aus: nur Sperre lösen, Versand per Klick.
          </p>
        </div>
      </div>
    </div>
  )
}

function AutoReplyFields({ config, patch }: FieldFnProps) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Confidence-Variable</Label>
        <Input
          className="h-9 font-mono text-sm"
          value={String(config.confidenceVar ?? "ai.class_confidence")}
          onChange={(e) => patchConfig(patch, config, "confidenceVar", e.target.value)}
        />
        <p className="text-[11px] text-muted-foreground">
          Woher die Sicherheit kommt: <code>ai.class_confidence</code> setzt der Knoten
          „KI-Klassifizierung“ (Selbsteinschätzung der KI, 0–100).
        </p>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Mindest-Sicherheit der KI (0–100)</Label>
        <Input
          type="number"
          min={0}
          max={100}
          className="h-9"
          value={Number(config.minConfidence ?? 70)}
          onChange={(e) => {
            const parsed = parseInt(e.target.value, 10)
            const clamped = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 0
            patchConfig(patch, config, "minConfidence", clamped)
          }}
        />
        <p className="text-[11px] text-muted-foreground">
          Nur wenn die KI sich mindestens so sicher ist, geht es am Ausgang „approved“ weiter —
          sonst „blocked“.
        </p>
      </div>
    </div>
  )
}

function PickCannedFields({ config, patch }: FieldFnProps) {
  // Canned responses have no tag column today, so a tag-filter field would
  // be misleading (UI-only, not enforced on the server). When tags land on
  // email_canned_responses, re-add the input here AND thread it through
  // scheduleAiPickCannedJob → selectCannedResponses.
  return (
    <div className="space-y-2 rounded-md border p-3">
      <AiProfileConfigField config={config} patch={patch} />
      <div className="flex items-start gap-2">
        <Switch
          checked={config.createDraft !== false}
          onCheckedChange={(v) => patchConfig(patch, config, "createDraft", v)}
        />
        <div className="space-y-0.5">
          <Label className="text-xs font-normal">Entwurf direkt anlegen</Label>
          <p className="text-[11px] text-muted-foreground">
            Legt eine adressierte Antwort mit dem gewählten Textbaustein an und setzt{" "}
            <code>draft.id</code>. Voraussetzung: mindestens ein Textbaustein unter
            Einstellungen → E-Mail → Textbausteine.
          </p>
        </div>
      </div>
    </div>
  )
}

function DelayFields({ config, patch }: FieldFnProps) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Verzögerung (Sekunden)</Label>
        <Input
          type="number"
          min={1}
          className="h-9"
          value={Number(config.delaySeconds ?? 60)}
          onChange={(e) => patchConfig(patch, config, "delaySeconds", Math.max(1, parseInt(e.target.value, 10) || 1))}
        />
      </div>
    </div>
  )
}

function SetVariableFields({ config, patch }: FieldFnProps) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Name</Label>
        <Input
          className="h-9 font-mono text-sm"
          placeholder="z.B. priority"
          value={String(config.name ?? "")}
          onChange={(e) => patchConfig(patch, config, "name", e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Wert</Label>
        <Input
          className="h-9 text-sm"
          value={String(config.value ?? "")}
          onChange={(e) => patchConfig(patch, config, "value", e.target.value)}
        />
        <p className="text-[11px] text-muted-foreground">Text, Zahl oder Boolean (true/false).</p>
      </div>
    </div>
  )
}

function HttpRequestFields({ config, patch }: FieldFnProps) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Methode</Label>
        <Input
          className="h-9 font-mono text-sm uppercase"
          value={String(config.method ?? "GET")}
          onChange={(e) => patchConfig(patch, config, "method", e.target.value.toUpperCase())}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">URL</Label>
        <Input
          className="h-9 text-sm"
          placeholder="https://api.example.com/hook"
          value={String(config.url ?? "")}
          onChange={(e) => patchConfig(patch, config, "url", e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Body (optional)</Label>
        <Textarea
          className="min-h-[80px] font-mono text-xs"
          value={String(config.body ?? "")}
          onChange={(e) => patchConfig(patch, config, "body", e.target.value)}
        />
      </div>
    </div>
  )
}

function SubflowFields({ config, patch }: FieldFnProps) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Subflow Workflow-ID</Label>
        <Input
          type="number"
          min={0}
          className="h-9"
          value={Number(config.workflowId ?? 0)}
          onChange={(e) => patchConfig(patch, config, "workflowId", parseInt(e.target.value, 10) || 0)}
        />
        <p className="text-[11px] text-muted-foreground">ID aus der Workflow-Liste. Subflow muss im selben Workspace existieren.</p>
      </div>
    </div>
  )
}

function SyncRunFields({ config, patch }: FieldFnProps) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Konto-ID (optional)</Label>
        <Input
          type="number"
          min={0}
          className="h-9"
          value={Number(config.accountId ?? 0)}
          onChange={(e) => patchConfig(patch, config, "accountId", parseInt(e.target.value, 10) || 0)}
        />
        <p className="text-[11px] text-muted-foreground">0 = alle Konten des Workspaces synchronisieren.</p>
      </div>
    </div>
  )
}

function CrmCreateTaskFields({ config, patch }: FieldFnProps) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Titel</Label>
        <Input
          className="h-9 text-sm"
          value={String(config.title ?? "E-Mail nachverfolgen")}
          onChange={(e) => patchConfig(patch, config, "title", e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Priorität</Label>
        <Input
          className="h-9 text-sm"
          placeholder="low | medium | high"
          value={String(config.priority ?? "medium")}
          onChange={(e) => patchConfig(patch, config, "priority", e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Fälligkeit in Tagen</Label>
        <Input
          type="number"
          min={0}
          className="h-9"
          value={Number(config.daysUntilDue ?? 2)}
          onChange={(e) => patchConfig(patch, config, "daysUntilDue", parseInt(e.target.value, 10) || 0)}
        />
      </div>
    </div>
  )
}

function MssqlQueryFields({ config, patch }: FieldFnProps) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="space-y-1.5">
        <Label className="text-xs">SQL (read-only, SELECT)</Label>
        <Textarea
          className="min-h-[100px] font-mono text-xs"
          value={String(config.sql ?? "")}
          onChange={(e) => patchConfig(patch, config, "sql", e.target.value)}
        />
        <p className="text-[11px] text-muted-foreground">
          Nur lesende Statements (SELECT). Hinweis: Dieser generische Knoten
          interpoliert keine Platzhalter — für {`{{email}}`}/{`{{orderNo}}`} den
          Knoten „JTL Bestell-Kontext" verwenden.
        </p>
      </div>
    </div>
  )
}

function JtlOrderContextFields({ config, patch }: FieldFnProps) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="space-y-1.5">
        <Label className="text-xs">SQL (MSSQL, read-only)</Label>
        <Textarea
          className="min-h-[100px] font-mono text-xs"
          value={String(config.query ?? "")}
          onChange={(e) => patchConfig(patch, config, "query", e.target.value)}
        />
        <p className="text-[11px] text-muted-foreground">
          Platzhalter: {`{{email}}`}, {`{{orderNo}}`}. Die erste Zeile wird auf {`jtl.*`}-Variablen gemappt.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Mapping (optional)</Label>
        <Textarea
          className="min-h-[60px] font-mono text-xs"
          placeholder="cStatus:jtl.status, dDatum:jtl.date"
          value={String(config.mapping ?? "")}
          onChange={(e) => patchConfig(patch, config, "mapping", e.target.value)}
        />
      </div>
    </div>
  )
}

function JtlPrepareActionFields({ config, patch }: FieldFnProps) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Aktion</Label>
        <Input
          className="h-9 text-sm"
          placeholder="resend_invoice | create_return | send_tracking | refund_status | custom"
          value={String(config.kind ?? "send_tracking")}
          onChange={(e) => patchConfig(patch, config, "kind", e.target.value)}
        />
      </div>
      <div className="flex items-start gap-2">
        <Switch
          checked={config.requireApproval !== false}
          onCheckedChange={(v) => patchConfig(patch, config, "requireApproval", v)}
        />
        <div className="space-y-0.5">
          <Label className="text-xs font-normal">Vorher freigeben lassen</Label>
          <p className="text-[11px] text-muted-foreground">Knoten bereitet nur vor — führt die Aktion nicht selbst aus.</p>
        </div>
      </div>
    </div>
  )
}

function TagFields({ config, patch }: FieldFnProps) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Tag</Label>
        <Input
          className="h-9"
          placeholder="z.B. rechnung, support, dringend"
          value={String(config.tag ?? "")}
          onChange={(e) => patchConfig(patch, config, "tag", e.target.value)}
        />
        <p className="text-[11px] text-muted-foreground">Tags sind lowercase und werden für Filter + Folge-Workflows verwendet.</p>
      </div>
    </div>
  )
}

function SetCategoryFields({ config, patch }: FieldFnProps) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Kategorie-Pfad</Label>
        <Input
          className="h-9 text-sm"
          placeholder="Support/Beschwerden"
          value={String(config.path ?? "")}
          onChange={(e) => patchConfig(patch, config, "path", e.target.value)}
        />
        <p className="text-[11px] text-muted-foreground">
          Pfad mit Schrägstrich-Trenner (legt fehlende Knoten an).
          Tipp: Im Aktions-Editor gibt es einen Kategorie-Picker mit Auto-Vervollständigung.
        </p>
      </div>
    </div>
  )
}

function SetPriorityFields({ config, patch }: FieldFnProps) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Level</Label>
        <Select
          value={String(config.level ?? "normal")}
          onValueChange={(v) => patchConfig(patch, config, "level", v)}
        >
          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="hoch">Hoch</SelectItem>
            <SelectItem value="normal">Normal</SelectItem>
            <SelectItem value="niedrig">Niedrig</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">Setzt Tag priority:&lt;level&gt; für Sortierung/Filter.</p>
      </div>
    </div>
  )
}

function SetSpamStatusFields({ config, patch }: FieldFnProps) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Status</Label>
        <Select
          value={String(config.status ?? "review")}
          onValueChange={(v) => patchConfig(patch, config, "status", v)}
        >
          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="clean">Sauber</SelectItem>
            <SelectItem value="review">Manuell prüfen</SelectItem>
            <SelectItem value="spam">Spam</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-start gap-2">
        <Switch checked={config.train === true} onCheckedChange={(v) => patchConfig(patch, config, "train", v)} />
        <Label className="text-xs font-normal">Lokalen Spam-Klassifikator anlernen</Label>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Optionaler Tag</Label>
        <Input
          className="h-9 text-sm"
          placeholder="z.B. trainings-set"
          value={String(config.tag ?? "")}
          onChange={(e) => patchConfig(patch, config, "tag", e.target.value)}
        />
      </div>
    </div>
  )
}

function MoveImapFields({ config, patch }: FieldFnProps) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="space-y-1.5">
        <Label className="text-xs">IMAP-Ordnerpfad</Label>
        <Input
          className="h-9 text-sm"
          placeholder="z.B. Rechnungen oder INBOX/Archiv/2026"
          value={String(config.folderPath ?? "")}
          onChange={(e) => patchConfig(patch, config, "folderPath", e.target.value)}
        />
        <p className="text-[11px] text-muted-foreground">Bestehende IMAP-Ordnernamen. Schrägstrich-getrennt für Unterordner.</p>
      </div>
    </div>
  )
}

function CreateDraftFields({ config, patch }: FieldFnProps) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Body-Präfix (optional)</Label>
        <Textarea
          className="min-h-[80px] text-sm"
          placeholder="Sehr geehrte Damen und Herren,&#10;&#10;"
          value={String(config.bodyPrefix ?? "")}
          onChange={(e) => patchConfig(patch, config, "bodyPrefix", e.target.value)}
        />
      </div>
    </div>
  )
}

function HoldOutboundFields({ config, patch }: FieldFnProps) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Grund (im Banner sichtbar)</Label>
        <Input
          className="h-9 text-sm"
          placeholder="z.B. Manueller Versand-Stop nach 17 Uhr"
          value={String(config.reason ?? "")}
          onChange={(e) => patchConfig(patch, config, "reason", e.target.value)}
        />
      </div>
    </div>
  )
}

function AuthCheckFields({ config, patch }: FieldFnProps) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Protokoll</Label>
        <Select
          value={String(config.protocol ?? "dmarc")}
          onValueChange={(v) => patchConfig(patch, config, "protocol", v)}
        >
          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="spf">SPF</SelectItem>
            <SelectItem value="dkim">DKIM</SelectItem>
            <SelectItem value="dmarc">DMARC</SelectItem>
            <SelectItem value="arc">ARC</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-start gap-2">
        <Switch
          checked={config.treatSoftfailAsFail !== false}
          onCheckedChange={(v) => patchConfig(patch, config, "treatSoftfailAsFail", v)}
        />
        <Label className="text-xs font-normal">Softfail wie Fail behandeln</Label>
      </div>
      <p className="text-[11px] text-muted-foreground">Ausgangskanten: pass · fail · none · default.</p>
    </div>
  )
}

function AiReviewFields({ config, patch }: FieldFnProps) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <AiProfileConfigField
        config={config}
        patch={patch}
        hint="Knoten-Profil hat Vorrang vor dem Profil des gewählten Prompts."
      />
      <div className="space-y-1.5">
        <Label className="text-xs">Prompt-ID</Label>
        <Input
          type="number"
          min={0}
          className="h-9"
          value={Number(config.promptId ?? 0)}
          onChange={(e) => patchConfig(patch, config, "promptId", parseInt(e.target.value, 10) || 0)}
        />
        <p className="text-[11px] text-muted-foreground">0 = ersten verfügbaren Prompt verwenden.</p>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Blockwort</Label>
        <Input
          className="h-9 font-mono text-sm"
          value={String(config.blockKeyword ?? "BLOCK")}
          onChange={(e) => patchConfig(patch, config, "blockKeyword", e.target.value)}
        />
        <p className="text-[11px] text-muted-foreground">Wenn die KI-Antwort dieses Wort enthält → Knoten geht auf „blocked".</p>
      </div>
    </div>
  )
}

function AgentToolFields({ config, patch }: FieldFnProps) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Tool</Label>
        <Select
          value={String(config.tool ?? "search_knowledge")}
          onValueChange={(v) => patchConfig(patch, config, "tool", v)}
        >
          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="search_knowledge">Wissensbasis durchsuchen</SelectItem>
            <SelectItem value="get_canned">Textbaustein abrufen</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Wissensbasis-ID (optional)</Label>
        <Input
          type="number"
          min={0}
          className="h-9"
          value={Number(config.knowledgeBaseId ?? 0)}
          onChange={(e) => patchConfig(patch, config, "knowledgeBaseId", parseInt(e.target.value, 10) || null)}
        />
      </div>
    </div>
  )
}

function CrmLogActivityFields({ config, patch }: FieldFnProps) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Aktivitätstyp</Label>
        <Input
          className="h-9 text-sm"
          placeholder="email, call, meeting, ..."
          value={String(config.activityType ?? "email")}
          onChange={(e) => patchConfig(patch, config, "activityType", e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Titel</Label>
        <Input
          className="h-9 text-sm"
          value={String(config.title ?? "")}
          onChange={(e) => patchConfig(patch, config, "title", e.target.value)}
        />
      </div>
    </div>
  )
}

function CrmUpdateDealFields({ config, patch }: FieldFnProps) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Deal-ID</Label>
        <Input
          type="number"
          min={0}
          className="h-9"
          value={Number(config.dealId ?? 0)}
          onChange={(e) => patchConfig(patch, config, "dealId", parseInt(e.target.value, 10) || 0)}
        />
        <p className="text-[11px] text-muted-foreground">0 = den am Absender verknüpften Deal nehmen.</p>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Neue Stage</Label>
        <Input
          className="h-9 text-sm"
          placeholder="z.B. proposal, won, lost"
          value={String(config.stage ?? "")}
          onChange={(e) => patchConfig(patch, config, "stage", e.target.value)}
        />
      </div>
    </div>
  )
}

function JtlLookupFields({ config, patch }: FieldFnProps) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Entität</Label>
        <Select
          value={String(config.entity ?? "firmen")}
          onValueChange={(v) => patchConfig(patch, config, "entity", v)}
        >
          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="firmen">Firmen</SelectItem>
            <SelectItem value="warenlager">Warenlager</SelectItem>
            <SelectItem value="zahlungsarten">Zahlungsarten</SelectItem>
            <SelectItem value="versandarten">Versandarten</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">Ergebnis steht als jtl.&lt;entity&gt;-Variable bereit.</p>
      </div>
    </div>
  )
}

function ActionFields({ node, patch, replaceData }: ActionFieldProps) {
  const [aiPrompts, setAiPrompts] = useState<AiPrompt[]>([])
  useEffect(() => {
    void invokeRenderer(IPCChannels.Email.ListAiPrompts)
      .then((rows) => setAiPrompts(rows as AiPrompt[]))
      .catch(() => {})
  }, [])

  const d = node.data as {
    actionType?: string
    tag?: string
    path?: string
    categorySourceSqliteId?: number
    reason?: string
    to?: string
    includeAttachments?: boolean
    runOutboundReview?: boolean
    promptId?: number
    blockKeyword?: string
  }
  const t = d.actionType ?? "tag"

  useEffect(() => {
    if (t !== "ai_review" || aiPrompts.length === 0) return
    const current = Number(d.promptId ?? 0)
    if (current > 0 && aiPrompts.some((p) => p.id === current)) return
    const first = aiPrompts[0]?.id
    if (first != null) patch({ promptId: first })
  }, [t, d.promptId, aiPrompts, patch])

  // Switching action types must wipe the type-specific fields of the old
  // action, otherwise stale data (e.g. a `tag` value left over after
  // switching to "archive") ends up in the compiled workflow graph.
  const changeActionType = (actionType: string) => {
    const next: Record<string, unknown> = { actionType }
    if (actionType === "tag" || actionType === "tag_attachment_meta") {
      next.tag = ""
    } else if (actionType === "set_category") {
      next.path = ""
      next.categorySourceSqliteId = undefined
    } else if (actionType === "hold_outbound") {
      next.reason = ""
    } else if (actionType === "forward_copy") {
      next.to = ""
      next.includeAttachments = false
      next.runOutboundReview = false
    } else if (actionType === "ai_review") {
      const firstPrompt = aiPrompts[0]?.id
      if (firstPrompt != null) {
        next.promptId = firstPrompt
      }
      next.blockKeyword = "BLOCK"
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
            <SelectItem value="ai_review">KI-Prüfung</SelectItem>
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
        <WorkflowCategorySelect
          path={d.path ?? ""}
          categorySourceSqliteId={typeof d.categorySourceSqliteId === "number" ? d.categorySourceSqliteId : undefined}
          onChange={(next) => patch({ path: next.path, categorySourceSqliteId: next.categorySourceSqliteId })}
        />
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
        <div className="space-y-3 rounded-md border p-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Weiterleiten an (kommagetrennt, max. 10)</Label>
            <Textarea
              className="min-h-[60px] text-sm"
              value={d.to ?? ""}
              onChange={(e) => patch({ to: e.target.value })}
              placeholder="bank@example.com, buchhaltung@example.com"
            />
          </div>
          <div className="flex items-start gap-2">
            <Switch
              checked={d.includeAttachments === true}
              onCheckedChange={(v) => patch({ includeAttachments: v })}
            />
            <Label className="text-xs font-normal">Original-Anhänge mitschicken (max. 25 MB)</Label>
          </div>
          <div className="flex items-start gap-2">
            <Switch
              checked={d.runOutboundReview === true}
              onCheckedChange={(v) => patch({ runOutboundReview: v })}
            />
            <div className="space-y-0.5">
              <Label className="text-xs font-normal">Mit Ausgangsprüfung</Label>
              <p className="text-[11px] text-muted-foreground">
                Aus: direkt senden (Standard). Ein: legt einen Entwurf an und durchläuft die Outbound-Workflows wie eine normale Mail.
              </p>
            </div>
          </div>
        </div>
      ) : null}
      {t === "ai_review" ? (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">KI-Prompt</Label>
            <Select
              value={String(
                d.promptId && d.promptId > 0
                  ? d.promptId
                  : aiPrompts[0]?.id ?? "",
              )}
              onValueChange={(v) => patch({ promptId: parseInt(v, 10) })}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Prompt wählen" />
              </SelectTrigger>
              <SelectContent>
                {aiPrompts.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Block-Schlüsselwort in Antwort</Label>
            <Input
              value={d.blockKeyword ?? "BLOCK"}
              onChange={(e) => patch({ blockKeyword: e.target.value })}
              placeholder="BLOCK"
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Ausgehend: blockiert Versand bei Treffer. Eingehend: setzt Tag „ki-review-block“.
          </p>
        </>
      ) : null}
    </>
  )
}
