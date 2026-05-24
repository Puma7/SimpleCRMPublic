"use client"

import { lazy, Suspense, useCallback, useEffect, useState } from "react"
import { Link } from "@tanstack/react-router"
import { IPCChannels } from "@shared/ipc/channels"
import type { WorkflowGraphDocument } from "@shared/email-workflow-graph"
import { toast } from "sonner"
import {
  ArrowLeft,
  Code2,
  Loader2,
  PlayCircle,
  Save,
  Trash2,
  Workflow,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
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
import { useWorkflowEditorStore } from "@/app/email/stores/workflow-editor-store"
import { hasElectron, invokeIpc } from "../types"
import { logError } from "../log"
import { WorkflowList, type WorkflowRow } from "./workflow-list"
import { NodePalette } from "./node-palette"
import { NodePropertiesPanel } from "./node-properties-panel"
import { JsonDevDrawer } from "./json-dev-drawer"
import { WorkflowTemplatesDialog } from "./workflow-templates-dialog"
import { WorkflowVersionsDialog } from "./workflow-versions-dialog"
import { WorkflowRunHistory } from "./workflow-run-history"
import type { WorkflowTemplateDto } from "@shared/workflow-types"
import { useWorkflowNodeCatalog } from "./use-workflow-node-catalog"
import {
  enrichRegistryFlowNodes,
  enrichRegistryGraphDocument,
} from "./enrich-registry-labels"

const WorkflowCanvas = lazy(async () => {
  const m = await import("./workflow-canvas")
  return { default: m.WorkflowCanvas }
})

type AccountOpt = { id: number; display_name: string }

type FullWorkflowRow = WorkflowRow & {
  definition_json: string
  graph_json: string | null
  cron_expr: string | null
  schedule_account_id: number | null
  created_at: string
  updated_at: string
}

const EMPTY_DEF = `{
  "version": 1,
  "rules": [
    {
      "when": {
        "field": "subject",
        "op": "contains",
        "value": "Beispiel",
        "caseInsensitive": true
      },
      "then": [{ "type": "tag", "tag": "Beispiel" }]
    }
  ]
}`

function triggerFromGraph(doc: WorkflowGraphDocument): string {
  const t = doc.nodes.find((n) => n.type === "trigger")
  if (t && t.data && typeof t.data === "object" && "kind" in t.data) {
    return String((t.data as { kind: string }).kind)
  }
  return "inbound"
}

export function WorkflowShell() {
  const [rows, setRows] = useState<FullWorkflowRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [editName, setEditName] = useState("")
  const [editTrigger, setEditTrigger] = useState("inbound")
  const [editPriority, setEditPriority] = useState("100")
  const [editEnabled, setEditEnabled] = useState(true)
  const [editCron, setEditCron] = useState("")
  const [editScheduleAccountId, setEditScheduleAccountId] = useState<number | "">("")
  const [editJson, setEditJson] = useState("")
  const [accounts, setAccounts] = useState<AccountOpt[]>([])
  const [saving, setSaving] = useState(false)
  const [backfilling, setBackfilling] = useState(false)
  const [jsonDrawerOpen, setJsonDrawerOpen] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [testMessageId, setTestMessageId] = useState("")
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  const { labelByType, catalogLoaded } = useWorkflowNodeCatalog()
  const graphNodes = useWorkflowEditorStore((s) => s.nodes)

  const load = useCallback(async () => {
    if (!hasElectron()) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const list = await invokeIpc<FullWorkflowRow[]>(IPCChannels.Email.ListWorkflows)
      setRows(list)
      const acc = await invokeIpc<AccountOpt[]>(IPCChannels.Email.ListAccounts)
      setAccounts(acc.map((a) => ({ id: a.id, display_name: a.display_name })))
    } catch (e) {
      logError("workflow-shell: load", e)
      toast.error("Workflows konnten nicht geladen werden.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const applyRow = (w: FullWorkflowRow) => {
    setSelectedId(w.id)
    setEditName(w.name)
    setEditTrigger(w.trigger || "inbound")
    setEditPriority(String(w.priority))
    setEditJson(w.definition_json)
    setEditCron(w.cron_expr ?? "")
    setEditScheduleAccountId(w.schedule_account_id ?? "")
    setEditEnabled(w.enabled === 1)
    setSelectedNodeId(null)

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
    if (!hasElectron()) return
    try {
      const res = await invokeIpc<{ success: boolean; id?: number }>(
        IPCChannels.Email.CreateWorkflow,
        {
          name: "Neuer Workflow",
          trigger: "inbound",
          priority: 100,
          definitionJson: EMPTY_DEF,
          enabled: true,
        },
      )
      if (res.id != null) {
        toast.success("Workflow angelegt.")
        await load()
        const created = await invokeIpc<FullWorkflowRow | null>(
          IPCChannels.Email.GetWorkflow,
          res.id,
        )
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
    if (!hasElectron() || selectedId == null) return
    setSaving(true)
    try {
      const graphDoc = useWorkflowEditorStore.getState().toGraphDocument()
      const compiled = await invokeIpc<{
        success: boolean
        definitionJson?: string
        error?: string
      }>(IPCChannels.Email.CompileWorkflowGraph, graphDoc)
      if (!compiled.success || !compiled.definitionJson) {
        throw new Error(compiled.error ?? "Graph-Compiler fehlgeschlagen")
      }
      const trig = editTrigger.trim() || triggerFromGraph(graphDoc)
      if (selectedId != null) {
        await invokeIpc(IPCChannels.Email.SaveWorkflowVersion, {
          workflowId: selectedId,
          label: "Vor Speichern",
        })
      }
      await invokeIpc(IPCChannels.Email.UpdateWorkflow, {
        id: selectedId,
        name: editName.trim(),
        trigger: trig,
        priority: parseInt(editPriority, 10) || 100,
        definitionJson: compiled.definitionJson,
        graphJson: JSON.stringify(graphDoc),
        cronExpr: editCron.trim() || null,
        scheduleAccountId: editScheduleAccountId === "" ? null : editScheduleAccountId,
        enabled: editEnabled,
      })
      setEditJson(compiled.definitionJson)
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

  const handleDelete = async () => {
    if (!hasElectron() || selectedId == null) return
    if (!window.confirm("Workflow wirklich löschen?")) return
    try {
      await invokeIpc(IPCChannels.Email.DeleteWorkflow, selectedId)
      toast.success("Gelöscht.")
      setSelectedId(null)
      await load()
    } catch (e) {
      logError("workflow-shell: delete", e)
      toast.error("Löschen fehlgeschlagen.")
    }
  }

  const handleBackfill = async () => {
    if (!hasElectron()) return
    setBackfilling(true)
    try {
      const res = await invokeIpc<{ success: boolean; processed?: number }>(
        IPCChannels.Email.BackfillInboundWorkflows,
      )
      toast.success(
        `Inbound-Workflows auf ${res.processed ?? 0} Nachrichten erneut ausgewertet (Weiterleitungen werden nicht doppelt gesendet).`,
      )
      await load()
    } catch (e) {
      logError("workflow-shell: backfill", e)
      toast.error("Backfill fehlgeschlagen.")
    } finally {
      setBackfilling(false)
    }
  }

  if (!hasElectron()) {
    return (
      <div className="container max-w-2xl py-10">
        <Card>
          <CardHeader>
            <CardTitle>E-Mail-Workflows</CardTitle>
            <CardDescription>Nur in der Desktop-App verfügbar.</CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex h-[calc(100vh-8rem)] min-h-0 flex-col overflow-hidden bg-background">
        {/* Topbar */}
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b bg-background/95 px-4">
          <div className="flex items-center gap-2">
            <Button type="button" size="icon" variant="ghost" asChild>
              <Link to="/email">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div className="flex items-center gap-2">
              <Workflow className="h-5 w-5 text-primary" />
              <h1 className="text-lg font-semibold tracking-tight">Workflows</h1>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void handleBackfill()}
              disabled={backfilling}
              className="gap-2"
            >
              {backfilling ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PlayCircle className="h-4 w-4" />
              )}
              Inbound auf bestehende Mails
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

        {/* Workflow properties row (only when a workflow is selected) */}
        {selectedId != null ? (
          <div className="flex shrink-0 flex-wrap items-end gap-3 border-b bg-muted/20 px-4 py-2.5">
            <div className="min-w-[180px] flex-1 space-y-1">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Name
              </Label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="h-8"
              />
            </div>
            <div className="min-w-[160px] space-y-1">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Auslöser (DB)
              </Label>
              <select
                className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                value={editTrigger}
                onChange={(e) => setEditTrigger(e.target.value)}
              >
                <option value="inbound">E-Mail eingehend</option>
                <option value="outbound">E-Mail ausgehend</option>
                <option value="draft_created">Entwurf erstellt</option>
                <option value="schedule">Zeitplan</option>
                <option value="manual">Manuell</option>
                <option value="crm.deal_stage_changed">Deal-Phase</option>
                <option value="task.due">Aufgabe fällig</option>
                <option value="calendar.event_start">Termin</option>
              </select>
            </div>
            <div className="w-[90px] space-y-1">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Priorität
              </Label>
              <Input
                value={editPriority}
                onChange={(e) => setEditPriority(e.target.value)}
                className="h-8"
              />
            </div>
            <div className="w-[160px] space-y-1">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Cron (nur Zeitplan)
              </Label>
              <Input
                value={editCron}
                onChange={(e) => setEditCron(e.target.value)}
                placeholder="*/15 * * * *"
                className="h-8 font-mono text-xs"
              />
            </div>
            <div className="min-w-[160px] space-y-1">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Geplantes Konto
              </Label>
              {/*
                Native <select> on purpose — shadcn/Radix Select forbids
                SelectItem with an empty-string value, but we need a
                "— keins —" entry that maps to null. Reverting to the same
                element the old workflows/page.tsx used.
              */}
              <select
                className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                value={editScheduleAccountId === "" ? "" : String(editScheduleAccountId)}
                onChange={(e) =>
                  setEditScheduleAccountId(
                    e.target.value ? parseInt(e.target.value, 10) : "",
                  )
                }
              >
                <option value="">— keins (nur Log) —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.display_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 self-center pb-1">
              <Switch id="wf-en" checked={editEnabled} onCheckedChange={setEditEnabled} />
              <Label htmlFor="wf-en" className="cursor-pointer text-xs font-normal">
                Aktiv
              </Label>
            </div>
            <div className="w-[100px] space-y-1">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Test-Nachricht-ID
              </Label>
              <Input
                value={testMessageId}
                onChange={(e) => setTestMessageId(e.target.value)}
                className="h-8 font-mono text-xs"
                placeholder="123"
              />
            </div>
            {(() => {
              const trimmed = testMessageId.trim()
              const parsedId = trimmed ? parseInt(trimmed, 10) : NaN
              const idValid = trimmed.length > 0 && Number.isFinite(parsedId) && parsedId > 0
              const testDisabled = selectedId == null || !idValid
              let testTooltip = "Workflow ohne Schreibzugriff an der gewählten Nachricht testen."
              if (!trimmed) {
                testTooltip =
                  "Bitte eine Nachrichten-ID eingeben (Zahl aus dem Postfach, Spalte in der Nachrichtenliste)."
              } else if (!idValid) {
                testTooltip = "Die Nachrichten-ID muss eine positive ganze Zahl sein."
              }
              return (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={testDisabled}
                        onClick={async () => {
                          if (!Number.isFinite(parsedId) || selectedId == null) return
                          const r = await invokeIpc<{
                            success: boolean
                            log?: string[]
                            error?: string
                          }>(IPCChannels.Email.TestWorkflowOnMessage, {
                            workflowId: selectedId,
                            messageId: parsedId,
                            dryRun: true,
                          })
                          if (r.success) {
                            toast.success(
                              `Dry-Run OK: ${(r.log ?? []).slice(-3).join(", ")}`,
                            )
                          } else {
                            toast.error(r.error ?? "Test fehlgeschlagen")
                          }
                        }}
                      >
                        Test (Dry-Run)
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">{testTooltip}</TooltipContent>
                </Tooltip>
              )
            })()}
            <div className="flex items-center gap-2 self-end pb-0.5">
              <Button
                type="button"
                size="sm"
                onClick={() => void handleSave()}
                disabled={saving}
                className="gap-2"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Speichern
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void handleDelete()}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1">
          <ResizablePanelGroup direction="horizontal" autoSaveId="email-workflow-panes">
            <ResizablePanel defaultSize={18} minSize={14} maxSize={28}>
              <WorkflowList
                rows={rows}
                selectedId={selectedId}
                loading={loading}
                onSelect={selectRowById}
                onCreate={() => void handleCreate()}
              />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize={58}>
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
                    <Suspense
                      fallback={
                        <div className="flex h-full items-center justify-center">
                          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                      }
                    >
                      <WorkflowCanvas onSelectionChange={setSelectedNodeId} />
                    </Suspense>
                  </>
                )}
              </div>
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize={24} minSize={18}>
              {selectedId != null ? (
                <div className="flex h-full min-h-0 flex-col">
                  <div className="flex min-h-0 flex-[3] flex-col overflow-hidden">
                    <NodePropertiesPanel
                      selectedNodeId={selectedNodeId}
                      onClearSelection={() => setSelectedNodeId(null)}
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
        <WorkflowTemplatesDialog
          open={templatesOpen}
          onOpenChange={setTemplatesOpen}
          onPick={(t: WorkflowTemplateDto) => {
            useWorkflowEditorStore.getState().resetFromGraph(t.graph)
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
