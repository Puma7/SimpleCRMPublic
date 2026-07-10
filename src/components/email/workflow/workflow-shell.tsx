"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ChangeEvent } from "react"
import { Link } from "@tanstack/react-router"
import { IPCChannels } from "@shared/ipc/channels"
import type { WorkflowGraphDocument } from "@shared/email-workflow-graph"
import {
  compileGraphToDefinition,
  definitionToJson,
} from "@shared/email-workflow-graph-compile"
import {
  findOutboundGraphTraps,
  formatOutboundGraphTraps,
} from "@shared/email-workflow-graph-validate"
import {
  exportWorkflowBundle,
  parseWorkflowImport,
} from "@shared/workflow-export-import"
import { toast } from "sonner"
import { validateWorkflowCronExpr } from "@shared/cron-validate"
import {
  ChevronDown,
  Code2,
  Download,
  ExternalLink,
  LayoutGrid,
  Loader2,
  PlayCircle,
  Save,
  Trash2,
  Upload,
  Workflow,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { emailSettingsSearch } from "@/lib/email-settings-search"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useDefaultLayout } from "react-resizable-panels"
import { useWorkflowEditorStore } from "@/app/email/stores/workflow-editor-store"
import {
  getRendererTransport,
  invokeRenderer,
  isWorkflowListRefreshEvent,
  subscribeServerEvents,
} from "@/services/transport"
import { invokeIpc } from "../types"
import { useHasElectron } from "../use-has-electron"
import { logError } from "../log"
import { WorkflowList, type WorkflowRow } from "./workflow-list"
import {
  AccountScopeToolbar,
  listPayloadForScope,
  type AccountScopeValue,
} from "../settings/account-scope-toolbar"
import { NodePalette } from "./node-palette"
import { NodePropertiesPanel } from "./node-properties-panel"
import { JsonDevDrawer } from "./json-dev-drawer"
import { WorkflowTemplatesDialog } from "./workflow-templates-dialog"
import { WorkflowReferenceDialog } from "./workflow-reference-dialog"
import { WorkflowVersionsDialog } from "./workflow-versions-dialog"
import { WorkflowRunHistory } from "./workflow-run-history"
import { graphHasTriggerToActionShortcut } from "./workflow-graph-layout"
import type { WorkflowTemplateDto } from "@shared/workflow-types"
import { useWorkflowNodeCatalog } from "./use-workflow-node-catalog"
import { validateWorkflowGraphConfigs } from "@shared/workflow-config-validate"
import {
  enrichRegistryFlowNodes,
  enrichRegistryGraphDocument,
} from "./enrich-registry-labels"
import { workflowTriggerLabel } from "./trigger-labels"
import { WorkflowCanvas } from "./workflow-canvas"

type AccountOpt = { id: number; display_name: string }

type FullWorkflowRow = WorkflowRow & {
  definition_json: string
  graph_json: string | null
  cron_expr: string | null
  schedule_account_id: number | null
  created_at: string
  updated_at: string
}

/** Leerer Graph-Start — Nutzer baut modular aus Palette-Knoten (kein festes Regelprogramm). */
const BLANK_INBOUND_GRAPH = {
  version: 1 as const,
  nodes: [{ id: "trigger-1", type: "trigger" as const, data: { kind: "inbound" as const } }],
  edges: [] as { id: string; source: string; target: string; label?: string }[],
}

const EMPTY_DEF = `{"version":1,"rules":[]}`

const WORKFLOW_PANE_IDS = ["workflow-list", "workflow-canvas", "workflow-props"] as const

function safeWorkflowFileName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80)
  return `${cleaned || "workflow"}.json`
}

function downloadWorkflowJson(filename: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json;charset=utf-8" }))
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function triggerFromGraph(doc: WorkflowGraphDocument): string {
  const t = doc.nodes.find((n) => n.type === "trigger")
  if (t && t.data && typeof t.data === "object" && "kind" in t.data) {
    return String((t.data as { kind: string }).kind)
  }
  return "inbound"
}

export function WorkflowShell() {
  const electronReady = useHasElectron()
  const serverClientMode = getRendererTransport().kind === "http"
  const workflowFileTransferAvailable = electronReady || serverClientMode
  const workflowBackfillAvailable = electronReady || serverClientMode
  const workflowDryRunAvailable = electronReady || serverClientMode
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "email-workflow-panes",
    panelIds: [...WORKFLOW_PANE_IDS],
  })
  const [rows, setRows] = useState<FullWorkflowRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [editName, setEditName] = useState("")
  const [editPriority, setEditPriority] = useState("100")
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [editEnabled, setEditEnabled] = useState(true)
  const [editCron, setEditCron] = useState("")
  const [editScheduleAccountId, setEditScheduleAccountId] = useState<number | "">("")
  const [editJson, setEditJson] = useState("")
  const [accounts, setAccounts] = useState<AccountOpt[]>([])
  const [saving, setSaving] = useState(false)
  const [backfilling, setBackfilling] = useState(false)
  // "Jetzt ausführen" startet einen ECHTEN Lauf (inkl. möglichem Versand) —
  // Doppelklick darf keine zweite Ausführung anstoßen.
  const [executingNow, setExecutingNow] = useState(false)
  const [jsonDrawerOpen, setJsonDrawerOpen] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [referenceOpen, setReferenceOpen] = useState(false)
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [testMessageId, setTestMessageId] = useState("")
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [triggerFilter, setTriggerFilter] = useState<
    "all" | "inbound" | "outbound" | "other"
  >("all")
  const [accountScope, setAccountScope] = useState<AccountScopeValue>("all")
  const browserImportInputRef = useRef<HTMLInputElement | null>(null)

  const { catalog, labelByType, catalogLoaded } = useWorkflowNodeCatalog()
  const graphNodes = useWorkflowEditorStore((s) => s.nodes)

  const filteredRows = useMemo(() => {
    if (triggerFilter === "all") return rows
    if (triggerFilter === "inbound") {
      return rows.filter((w) => w.trigger === "inbound" || w.trigger === "draft_created")
    }
    if (triggerFilter === "outbound") {
      return rows.filter((w) => w.trigger === "outbound")
    }
    return rows.filter(
      (w) => !["inbound", "outbound", "draft_created"].includes(w.trigger),
    )
  }, [rows, triggerFilter])

  const triggerKindDisplay = useMemo(() => {
    const triggerNode = graphNodes.find((n) => n.type === "trigger")
    const kind = (triggerNode?.data as { kind?: string } | undefined)?.kind
    return workflowTriggerLabel(kind)
  }, [graphNodes])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const list = await invokeRenderer(
        IPCChannels.Email.ListWorkflows,
        listPayloadForScope(accountScope),
      ) as FullWorkflowRow[]
      setRows(list)
      const acc = await invokeRenderer(IPCChannels.Email.ListAccounts) as AccountOpt[]
      setAccounts(acc.map((a) => ({ id: a.id, display_name: a.display_name })))
    } catch (e) {
      logError("workflow-shell: load", e)
      toast.error("Workflows konnten nicht geladen werden.")
    } finally {
      setLoading(false)
    }
  }, [accountScope])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const subscription = subscribeServerEvents({
      onEvent(event) {
        if (!isWorkflowListRefreshEvent(event)) return
        if (selectedId != null && event.type === "workflow.deleted" && event.entityId === String(selectedId)) {
          setSelectedId(null)
          setSelectedNodeId(null)
          setSelectedEdgeId(null)
        }
        void load()
      },
    })
    return () => subscription.unsubscribe()
  }, [load, selectedId])

  const applyRow = (w: FullWorkflowRow) => {
    setSelectedId(w.id)
    setEditName(w.name)
    setEditPriority(String(w.priority))
    setEditJson(w.definition_json)
    setEditCron(w.cron_expr ?? "")
    setEditScheduleAccountId(w.schedule_account_id ?? "")
    setEditEnabled(w.enabled === 1)
    setSelectedNodeId(null)
    setSelectedEdgeId(null)

    let doc: WorkflowGraphDocument | null = null
    if (w.graph_json) {
      try {
        doc = JSON.parse(w.graph_json) as WorkflowGraphDocument
      } catch (e) {
        logError(`workflow-shell: parse graph_json for workflow ${w.id}`, e)
        doc = null
      }
    }
    const enriched = catalogLoaded
      ? enrichRegistryGraphDocument(doc, labelByType)
      : doc
    useWorkflowEditorStore.getState().resetFromGraph(enriched)
  }

  useEffect(() => {
    if (!catalogLoaded || labelByType.size === 0) return
    const nodes = useWorkflowEditorStore.getState().nodes
    const next = enrichRegistryFlowNodes(nodes, labelByType)
    if (next !== nodes) {
      useWorkflowEditorStore.getState().setNodes(next)
    }
  }, [catalogLoaded, labelByType])

  const selectRowById = (id: number) => {
    const w = rows.find((r) => r.id === id)
    if (w) applyRow(w)
  }

  const handleCreate = async () => {
    try {
      const res = await invokeRenderer(
        IPCChannels.Email.CreateWorkflow,
        {
          name: "Neuer Workflow",
          trigger: "inbound",
          priority: 100,
          definitionJson: EMPTY_DEF,
          graphJson: JSON.stringify(BLANK_INBOUND_GRAPH),
          enabled: true,
        },
      ) as { success: boolean; id?: number }
      if (res.id != null) {
        toast.success("Workflow angelegt.")
        await load()
        const created = await invokeRenderer(
          IPCChannels.Email.GetWorkflow,
          res.id,
        ) as FullWorkflowRow | null
        if (created) {
          // Apply the freshly fetched row directly instead of looking it up in
          // the `rows` state — that closure is still the pre-load snapshot.
          applyRow(created)
        }
      }
    } catch (e) {
      logError("workflow-shell: create", e)
      toast.error("Anlegen fehlgeschlagen.")
    }
  }

  const handleSave = async () => {
    if (selectedId == null) return
    setSaving(true)
    try {
      const graphDoc = useWorkflowEditorStore.getState().toGraphDocument()
      const hasNodes = graphDoc.nodes.length > 0
      const definitionJson = definitionToJson(compileGraphToDefinition(graphDoc))
      if (!hasNodes) {
        throw new Error("Workflow braucht mindestens einen Trigger-Knoten.")
      }
      const trig = triggerFromGraph(graphDoc) || "inbound"
      if (trig === "inbound" && graphHasTriggerToActionShortcut(graphDoc)) {
        toast.warning(
          "Aktionen hängen direkt am Trigger ohne Bedingung — sie würden auf jede Mail angewendet. Bitte Trigger → Bedingung → (Ja) → Aktion verbinden.",
          { duration: 8000 },
        )
      }
      // Schema-Validierung: Pflichtfelder/Wertebereiche blockieren das
      // Speichern (Knoten wird markiert); Kanten-Probleme an Mehrfach-Port-
      // Knoten werden als Warnung gezeigt.
      {
        const state = useWorkflowEditorStore.getState()
        const catalogByType = new Map(catalog.map((entry) => [entry.type, entry]))
        const validationNodes = state.nodes.map((n) => {
          const data = n.data as {
            nodeType?: string
            label?: string
            config?: Record<string, unknown>
          }
          const nodeType = typeof data.nodeType === "string" ? data.nodeType : null
          return {
            id: n.id,
            nodeType,
            title:
              data.label?.trim() ||
              (nodeType ? labelByType.get(nodeType) ?? nodeType : n.id),
            config: data.config ?? {},
          }
        })
        const validationEdges = state.edges.map((e) => ({
          source: e.source,
          label: typeof e.label === "string" ? e.label : null,
        }))
        const issues = validateWorkflowGraphConfigs(validationNodes, validationEdges, catalogByType)
        const errors = issues.filter((i) => i.severity === "error")
        const warnings = issues.filter((i) => i.severity === "warning")
        for (const w of warnings.slice(0, 3)) {
          toast.warning(w.message, { duration: 8000 })
        }
        if (errors.length > 0) {
          setSelectedNodeId(errors[0]!.nodeId)
          setSelectedEdgeId(null)
          throw new Error(
            `Nicht gespeichert — ${errors.length === 1 ? "ein Knoten ist" : `${errors.length} Knoten sind`} unvollständig: ` +
              errors
                .slice(0, 3)
                .map((i) => `„${i.nodeTitle}“: ${i.message}`)
                .join(" · "),
          )
        }
      }
      // Server-client only: there the outbound review holds EVERY draft up front
      // and only sends it when a path reaches a release node, so a graph that
      // dead-ends (or loops) without releasing traps clean mail forever — block
      // the save before it hits the server's 422 and surface the exact reason.
      // Standalone Electron uses run-then-block semantics (the draft sends unless
      // a hold node stops it), so a release-less path is NOT a trap there; don't
      // reject workflows the standalone runtime would send correctly.
      if (serverClientMode && trig === "outbound" && editEnabled) {
        const traps = findOutboundGraphTraps(graphDoc, { effectiveTrigger: "outbound" })
        if (traps.length > 0) {
          throw new Error(
            `Ausgangs-Workflow blockiert Mails dauerhaft. ${formatOutboundGraphTraps(traps)}`,
          )
        }
      }
      if (selectedId != null) {
        await invokeRenderer(IPCChannels.Email.SaveWorkflowVersion, {
          workflowId: selectedId,
          label: "Vor Speichern",
        })
      }
      const cronTrim = editCron.trim()
      if (cronTrim && trig === "schedule") {
        const cronErr = validateWorkflowCronExpr(cronTrim)
        if (cronErr) {
          toast.error(cronErr)
          setSaving(false)
          return
        }
      }
      await invokeRenderer(IPCChannels.Email.UpdateWorkflow, {
        id: selectedId,
        name: editName.trim(),
        trigger: trig,
        priority: parseInt(editPriority, 10) || 100,
        definitionJson,
        graphJson: JSON.stringify(graphDoc),
        cronExpr: cronTrim || null,
        scheduleAccountId: editScheduleAccountId === "" ? null : editScheduleAccountId,
        enabled: editEnabled,
      })
      setEditJson(definitionJson)
      toast.success("Gespeichert.")
      await load()
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Ungültiges JSON oder Speichern fehlgeschlagen.",
      )
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteId = async (id: number) => {
    if (!window.confirm("Workflow wirklich löschen?")) return
    try {
      await invokeRenderer(IPCChannels.Email.DeleteWorkflow, id)
      toast.success("Gelöscht.")
      if (selectedId === id) {
        setSelectedId(null)
        setSelectedNodeId(null)
        setSelectedEdgeId(null)
      }
      await load()
    } catch (e) {
      logError("workflow-shell: delete", e)
      toast.error("Löschen fehlgeschlagen.")
    }
  }

  const handleDelete = async () => {
    if (selectedId == null) return
    await handleDeleteId(selectedId)
  }

  const handleExportFile = async () => {
    if (!workflowFileTransferAvailable || selectedId == null) return
    try {
      if (serverClientMode) {
        const row = await invokeRenderer(
          IPCChannels.Email.GetWorkflow,
          selectedId,
        ) as FullWorkflowRow | null
        if (!row) {
          toast.error("Workflow nicht gefunden.")
          return
        }
        const bundle = exportWorkflowBundle(row)
        downloadWorkflowJson(
          safeWorkflowFileName(row.name),
          JSON.stringify(bundle, null, 2),
        )
        toast.success("Workflow exportiert.")
        return
      }

      const res = await invokeIpc<{ success: boolean; error?: string; path?: string }>(
        IPCChannels.Email.ExportWorkflowBundleToFile,
        selectedId,
      )
      if (!res.success) {
        if (res.error !== "Abgebrochen") toast.error(res.error ?? "Export fehlgeschlagen")
        return
      }
      toast.success("Workflow exportiert.")
    } catch (e) {
      logError("workflow-shell: export file", e)
      toast.error("Export fehlgeschlagen.")
    }
  }

  const importWorkflowBundleJson = async (json: string) => {
    const bundle = parseWorkflowImport(json)
    const w = bundle.workflow
    const graphJson = w.graph_json ? JSON.stringify(w.graph_json) : null
    const definitionJson = w.graph_json
      ? definitionToJson(compileGraphToDefinition(w.graph_json))
      : w.definition_json
    const res = await invokeRenderer(IPCChannels.Email.CreateWorkflow, {
      name: `${w.name} (Import)`,
      trigger: w.trigger,
      priority: w.priority,
      definitionJson,
      graphJson,
      cronExpr: w.cron_expr,
      scheduleAccountId: w.schedule_account_id,
      enabled: w.enabled,
      executionMode: w.execution_mode ?? "graph",
      engineVersion: w.engine_version ?? 1,
    }) as { success: boolean; id?: number | null }
    toast.success("Workflow importiert.")
    await load()
    if (res.id != null) {
      const imported = await invokeRenderer(
        IPCChannels.Email.GetWorkflow,
        res.id,
      ) as FullWorkflowRow | null
      if (imported) applyRow(imported)
    }
  }

  const handleBrowserImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ""
    if (!file) return
    try {
      await importWorkflowBundleJson(await file.text())
    } catch (e) {
      logError("workflow-shell: import browser file", e)
      toast.error(e instanceof Error ? e.message : "Import fehlgeschlagen.")
    }
  }

  const handleImportFile = async () => {
    if (!workflowFileTransferAvailable) return
    if (serverClientMode) {
      browserImportInputRef.current?.click()
      return
    }
    try {
      const res = await invokeIpc<{
        success: boolean
        id?: number | null
        canceled?: boolean
      }>(IPCChannels.Email.ImportWorkflowBundleFromFile)
      if (res.canceled) return
      if (res.id != null) {
        toast.success("Workflow importiert.")
        await load()
        const imported = await invokeRenderer(
          IPCChannels.Email.GetWorkflow,
          res.id,
        ) as FullWorkflowRow | null
        if (imported) applyRow(imported)
      }
    } catch (e) {
      logError("workflow-shell: import file", e)
      toast.error(e instanceof Error ? e.message : "Import fehlgeschlagen.")
    }
  }

  const handleBackfill = async () => {
    if (!workflowBackfillAvailable) return
    setBackfilling(true)
    try {
      const res = await invokeRenderer(IPCChannels.Email.BackfillInboundWorkflows) as {
        success: boolean
        processed?: number
        queued?: number
      }
      toast.success(
        `Inbound-Workflows auf ${res.processed ?? 0} Nachrichten erneut ausgewertet (${res.queued ?? 0} Jobs eingereiht; Weiterleitungen werden nicht doppelt gesendet).`,
      )
      await load()
    } catch (e) {
      logError("workflow-shell: backfill", e)
      toast.error("Backfill fehlgeschlagen.")
    } finally {
      setBackfilling(false)
    }
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b bg-background/95 px-4">
          <div className="flex items-center gap-2">
            <Workflow className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold tracking-tight">Workflows</h1>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <input
              ref={browserImportInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(event) => void handleBrowserImportFile(event)}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!workflowFileTransferAvailable}
              onClick={() => void handleImportFile()}
              className="gap-2"
            >
              <Upload className="h-4 w-4" />
              Import
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!workflowFileTransferAvailable || selectedId == null}
              onClick={() => void handleExportFile()}
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              Export
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={selectedId == null}
              onClick={() => setTemplatesOpen(true)}
            >
              Vorlagen
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setReferenceOpen(true)}
              title="Knoten-Referenz, Auslöser, Variablen und Best Practices"
            >
              Referenz
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={selectedId == null}
              onClick={() => setVersionsOpen(true)}
            >
              Versionen
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => setJsonDrawerOpen((v) => !v)}
                >
                  <Code2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Kompilierte JSON-Definition</TooltipContent>
            </Tooltip>
          </div>
        </header>

        {selectedId != null ? (
          <div className="shrink-0 border-b bg-muted/20 px-4 py-2.5">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[200px] flex-1 space-y-1">
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Name
                </Label>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="h-8"
                />
              </div>
              <div className="w-[88px] space-y-1">
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Priorität
                </Label>
                <Input
                  value={editPriority}
                  onChange={(e) => setEditPriority(e.target.value)}
                  className="h-8"
                />
              </div>
              <div className="flex min-w-[200px] flex-col justify-end gap-1 pb-0.5">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Auslöser
                </span>
                <p className="text-sm font-medium leading-tight">{triggerKindDisplay}</p>
                <p className="text-[10px] text-muted-foreground">
                  Im Graph am Trigger-Knoten bearbeiten
                </p>
              </div>
              <div className="flex items-center gap-2 self-center pb-1">
                <Switch id="wf-en" checked={editEnabled} onCheckedChange={setEditEnabled} />
                <Label htmlFor="wf-en" className="cursor-pointer text-xs font-normal">
                  Aktiv
                </Label>
              </div>
              <div className="flex items-center gap-2 self-end pb-0.5">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-2"
                  title="Knoten automatisch anordnen (von oben nach unten)"
                  onClick={() => {
                    useWorkflowEditorStore.getState().applyAutoLayout()
                    toast.success("Layout angewendet — bitte speichern, um Positionen zu behalten.")
                  }}
                >
                  <LayoutGrid className="h-4 w-4" />
                  Anordnen
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleSave()}
                  disabled={saving}
                  className="gap-2"
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Speichern
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void handleDelete()}
                  aria-label="Workflow löschen"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className="mt-2">
              <CollapsibleTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="gap-1 px-0 text-xs">
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 transition-transform",
                      advancedOpen && "rotate-180",
                    )}
                  />
                  Erweitert (Zeitplan, Test, Backfill)
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                <div className="flex flex-wrap items-end gap-3 rounded-md border bg-background/80 p-3">
                  <div className="w-[180px] space-y-1">
                    <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Cron (Zeitplan)
                    </Label>
                    <Input
                      value={editCron}
                      onChange={(e) => setEditCron(e.target.value)}
                      placeholder="*/15 * * * *"
                      className="h-8 font-mono text-xs"
                    />
                  </div>
                  <div className="min-w-[180px] space-y-1">
                    <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Geplantes Konto
                    </Label>
                    <select
                      className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                      value={
                        editScheduleAccountId === "" ? "" : String(editScheduleAccountId)
                      }
                      onChange={(e) =>
                        setEditScheduleAccountId(
                          e.target.value ? parseInt(e.target.value, 10) : "",
                        )
                      }
                    >
                      <option value="">— keins (nur Graph-Lauf) —</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.display_name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="w-[120px] space-y-1">
                    <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Test-Nachricht-ID
                    </Label>
                    <Input
                      value={testMessageId}
                      onChange={(e) => setTestMessageId(e.target.value)}
                      className="h-8 font-mono text-xs"
                      placeholder="aus Details-Panel"
                    />
                  </div>
                  {(() => {
                    const trimmed = testMessageId.trim()
                    const parsedId = trimmed ? parseInt(trimmed, 10) : NaN
                    const idValid =
                      trimmed.length > 0 && Number.isFinite(parsedId) && parsedId > 0
                    return (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={!workflowDryRunAvailable || !idValid}
                        onClick={async () => {
                          if (!Number.isFinite(parsedId) || selectedId == null) return
                          const r = await invokeRenderer(
                            IPCChannels.Email.TestWorkflowOnMessage,
                            {
                              workflowId: selectedId,
                              messageId: parsedId,
                              dryRun: true,
                            },
                          ) as {
                            success: boolean
                            log?: string[]
                            error?: string
                          }
                          if (r.success) {
                            toast.success(
                              `Dry-Run OK: ${(r.log ?? []).slice(-3).join(", ")}`,
                            )
                          } else {
                            toast.error(r.error ?? "Test fehlgeschlagen")
                          }
                        }}
                      >
                        Dry-Run testen
                      </Button>
                    )
                  })()}
                  {(() => {
                    const row = rows.find((w) => w.id === selectedId)
                    const trig = row?.trigger ?? "inbound"
                    const needsMsg = trig === "inbound" || trig === "outbound" || trig === "draft_created"
                    const trimmed = testMessageId.trim()
                    const parsedId = trimmed ? parseInt(trimmed, 10) : NaN
                    const msgOk =
                      !needsMsg ||
                      (trimmed.length > 0 && Number.isFinite(parsedId) && parsedId > 0)
                    return (
                      <Button
                        type="button"
                        size="sm"
                        variant="default"
                        disabled={selectedId == null || !msgOk || executingNow}
                        onClick={async () => {
                          if (selectedId == null || executingNow) return
                          setExecutingNow(true)
                          try {
                            const r = await invokeRenderer(IPCChannels.Email.ExecuteWorkflowNow, {
                              workflowId: selectedId,
                              messageId: needsMsg ? parsedId : undefined,
                              dryRun: false,
                            }) as {
                              success: boolean
                              status?: string
                              queued?: boolean
                              blocked?: boolean
                              blockReason?: string | null
                              log?: string[]
                              error?: string
                            }
                            if (!r.success) {
                              toast.error(r.error ?? "Ausführung fehlgeschlagen")
                              return
                            }
                            if (r.queued) {
                              toast.success("Workflow-Job eingereiht.")
                              return
                            }
                            if (r.blocked) {
                              toast.warning(r.blockReason ?? "Workflow blockiert")
                            } else {
                              toast.success(
                                `Ausgeführt (${r.status ?? "ok"}): ${(r.log ?? []).slice(-2).join(", ")}`,
                              )
                            }
                          } finally {
                            setExecutingNow(false)
                          }
                        }}
                      >
                        {executingNow ? "Läuft …" : "Jetzt ausführen"}
                      </Button>
                    )
                  })()}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!workflowBackfillAvailable || backfilling}
                    onClick={() => void handleBackfill()}
                    className="gap-2"
                  >
                    {backfilling ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <PlayCircle className="h-4 w-4" />
                    )}
                    Inbound-Backfill
                  </Button>
                  <Button type="button" size="sm" variant="link" className="h-8 px-0" asChild>
                    <Link
                      to="/email/settings"
                      search={emailSettingsSearch({ tab: "mailSecurity" })}
                    >
                      <ExternalLink className="mr-1 h-3.5 w-3.5" />
                      Automatisierung (IMAP/HTTP)
                    </Link>
                  </Button>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1">
          <ResizablePanelGroup
            direction="horizontal"
            id="email-workflow-panes"
            defaultLayout={defaultLayout}
            onLayoutChanged={onLayoutChanged}
          >
            <ResizablePanel
              id={WORKFLOW_PANE_IDS[0]}
              defaultSize="20%"
              minSize="14%"
              maxSize="30%"
            >
              <div className="flex h-full min-h-0 flex-col">
                <div className="shrink-0 border-b p-2">
                  <AccountScopeToolbar
                    value={accountScope}
                    onChange={(next) => {
                      setAccountScope(next)
                      setSelectedId(null)
                    }}
                    description="Zeigt globale Workflows plus konto-spezifische Overrides."
                  />
                </div>
                <div className="flex shrink-0 gap-1 border-b p-2">
                  {(
                    [
                      ["all", "Alle"],
                      ["inbound", "Eingehend"],
                      ["outbound", "Ausgehend"],
                      ["other", "Sonstige"],
                    ] as const
                  ).map(([id, label]) => (
                    <Button
                      key={id}
                      type="button"
                      size="sm"
                      variant={triggerFilter === id ? "default" : "outline"}
                      className="h-7 flex-1 px-1 text-xs"
                      onClick={() => setTriggerFilter(id)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
                <WorkflowList
                  rows={filteredRows}
                  selectedId={selectedId}
                  loading={loading}
                  onSelect={selectRowById}
                  onCreate={() => void handleCreate()}
                  onDelete={(id) => void handleDeleteId(id)}
                />
              </div>
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel id={WORKFLOW_PANE_IDS[1]} defaultSize="55%">
              <div className="relative h-full w-full">
                {selectedId == null ? (
                  <div className="flex h-full items-center justify-center p-6 text-center">
                    <p className="text-sm text-muted-foreground">
                      Workflow auswählen oder „Neu" anlegen.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="absolute left-3 top-3 z-10">
                      <NodePalette />
                    </div>
                    <WorkflowCanvas
                      onSelectionChange={(selection) => {
                        setSelectedNodeId(selection.nodeId)
                        setSelectedEdgeId(selection.edgeId)
                      }}
                    />
                  </>
                )}
              </div>
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel
              id={WORKFLOW_PANE_IDS[2]}
              defaultSize="25%"
              minSize="18%"
            >
              {selectedId != null ? (
                <div className="flex h-full min-h-0 flex-col">
                  <div className="flex min-h-0 flex-[3] flex-col overflow-hidden">
                    <NodePropertiesPanel
                      selectedNodeId={selectedNodeId}
                      selectedEdgeId={selectedEdgeId}
                      onClearSelection={() => {
                        setSelectedNodeId(null)
                        setSelectedEdgeId(null)
                      }}
                    />
                  </div>
                  <div className="flex min-h-[200px] flex-[2] flex-col overflow-hidden border-t">
                    <WorkflowRunHistory workflowId={selectedId} graphNodes={graphNodes} />
                  </div>
                </div>
              ) : (
                <aside className="flex h-full items-center justify-center border-l bg-muted/10 p-6 text-center">
                  <p className="text-sm text-muted-foreground">
                    Eigenschaften erscheinen hier, sobald ein Workflow ausgewählt ist.
                  </p>
                </aside>
              )}
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>

        <JsonDevDrawer
          open={jsonDrawerOpen}
          onOpenChange={setJsonDrawerOpen}
          jsonValue={editJson}
          onJsonChange={setEditJson}
        />
        <WorkflowReferenceDialog open={referenceOpen} onOpenChange={setReferenceOpen} />
        <WorkflowTemplatesDialog
          open={templatesOpen}
          onOpenChange={setTemplatesOpen}
          onPick={(t: WorkflowTemplateDto) => {
            // Eine Vorlage ERSETZT den aktuellen Canvas — nie ohne Rückfrage
            // über bestehende Arbeit bügeln (mehr als nur der Trigger-Knoten).
            const currentNodes = useWorkflowEditorStore.getState().nodes
            if (currentNodes.length > 1) {
              const confirmed = window.confirm(
                `Vorlage „${t.name}" laden?\n\nDer aktuelle Graph dieses Workflows wird dabei ersetzt. ` +
                  'Über „Versionen" lässt sich der vorherige Stand wiederherstellen, sobald er gespeichert war.',
              )
              if (!confirmed) return
            }
            useWorkflowEditorStore.getState().resetFromGraph(t.graph)
            setSelectedNodeId(null)
            setSelectedEdgeId(null)
            toast.success(`Vorlage „${t.name}" geladen — bitte speichern.`)
          }}
        />
        <WorkflowVersionsDialog
          workflowId={selectedId}
          open={versionsOpen}
          onOpenChange={setVersionsOpen}
          onRestored={() => {
            if (selectedId != null) selectRowById(selectedId)
          }}
        />
      </div>
    </TooltipProvider>
  )
}
