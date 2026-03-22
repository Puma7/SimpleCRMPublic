"use client"

import { lazy, Suspense, useCallback, useEffect, useState } from "react"
import { Link } from "@tanstack/react-router"
import { IPCChannels } from "@shared/ipc/channels"
import type { WorkflowGraphDocument } from "@shared/email-workflow-graph"
import { useWorkflowEditorStore } from "../stores/workflow-editor-store"
const WorkflowFlowEditor = lazy(async () => {
  const m = await import("../workflow-flow-editor")
  return { default: m.WorkflowFlowEditor }
})
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import { ArrowLeft, Loader2, Plus, Trash2, Workflow } from "lucide-react"

type WorkflowRow = {
  id: number
  name: string
  trigger: string
  enabled: number
  priority: number
  definition_json: string
  graph_json: string | null
  cron_expr: string | null
  schedule_account_id: number | null
  created_at: string
  updated_at: string
}

type AccountOpt = { id: number; display_name: string }

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

export default function EmailWorkflowsPage() {
  const [rows, setRows] = useState<WorkflowRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [editName, setEditName] = useState("")
  const [editPriority, setEditPriority] = useState("100")
  const [editJson, setEditJson] = useState("")
  const [editCron, setEditCron] = useState("")
  const [editScheduleAccountId, setEditScheduleAccountId] = useState<number | "">("")
  const [accounts, setAccounts] = useState<AccountOpt[]>([])
  const [editEnabled, setEditEnabled] = useState(true)
  const [saving, setSaving] = useState(false)
  const [backfilling, setBackfilling] = useState(false)

  const hasElectron =
    typeof window !== "undefined" &&
    window.electronAPI &&
    typeof (window.electronAPI as { invoke?: unknown }).invoke === "function"

  const load = useCallback(async () => {
    if (!hasElectron) return
    setLoading(true)
    try {
      const list = (await (window.electronAPI as { invoke: (c: string) => Promise<WorkflowRow[]> }).invoke(
        IPCChannels.Email.ListWorkflows,
      )) as WorkflowRow[]
      setRows(list)
      const acc = (await (window.electronAPI as { invoke: (c: string) => Promise<AccountOpt[]> }).invoke(
        IPCChannels.Email.ListAccounts,
      )) as AccountOpt[]
      setAccounts(acc.map((a) => ({ id: a.id, display_name: a.display_name })))
    } catch (e) {
      console.error(e)
      toast.error("Workflows konnten nicht geladen werden.")
    } finally {
      setLoading(false)
    }
  }, [hasElectron])

  useEffect(() => {
    void load()
  }, [load])

  const selectRow = (w: WorkflowRow) => {
    setSelectedId(w.id)
    setEditName(w.name)
    setEditPriority(String(w.priority))
    setEditJson(w.definition_json)
    setEditCron(w.cron_expr ?? "")
    setEditScheduleAccountId(w.schedule_account_id ?? "")
    setEditEnabled(w.enabled === 1)
    let doc: WorkflowGraphDocument | null = null
    if (w.graph_json) {
      try {
        doc = JSON.parse(w.graph_json) as WorkflowGraphDocument
      } catch {
        doc = null
      }
    }
    useWorkflowEditorStore.getState().resetFromGraph(doc)
  }

  const triggerFromGraph = (doc: WorkflowGraphDocument): string => {
    const t = doc.nodes.find((n) => n.type === "trigger")
    if (t && t.data && typeof t.data === "object" && "kind" in t.data) {
      return String((t.data as { kind: string }).kind)
    }
    return "inbound"
  }

  const handleSave = async () => {
    if (!hasElectron || selectedId == null) return
    setSaving(true)
    try {
      JSON.parse(editJson)
      const graphDoc = useWorkflowEditorStore.getState().toGraphDocument()
      const compiled = (await (window.electronAPI as { invoke: (c: string, g: unknown) => Promise<{ success: boolean; definitionJson?: string; error?: string }> }).invoke(
        IPCChannels.Email.CompileWorkflowGraph,
        graphDoc,
      )) as { success: boolean; definitionJson?: string; error?: string }
      if (!compiled.success || !compiled.definitionJson) {
        throw new Error(compiled.error ?? "Graph-Compiler fehlgeschlagen")
      }
      const trig = triggerFromGraph(graphDoc)
      await (window.electronAPI as { invoke: (c: string, p: unknown) => Promise<{ success: boolean }> }).invoke(
        IPCChannels.Email.UpdateWorkflow,
        {
          id: selectedId,
          name: editName.trim(),
          trigger: trig,
          priority: parseInt(editPriority, 10) || 100,
          definitionJson: compiled.definitionJson,
          graphJson: JSON.stringify(graphDoc),
          cronExpr: editCron.trim() || null,
          scheduleAccountId: editScheduleAccountId === "" ? null : editScheduleAccountId,
          enabled: editEnabled,
        },
      )
      setEditJson(compiled.definitionJson)
      toast.success("Gespeichert.")
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ungültiges JSON oder Speichern fehlgeschlagen.")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!hasElectron || selectedId == null) return
    if (!confirm("Workflow wirklich löschen?")) return
    try {
      await (window.electronAPI as { invoke: (c: string, id: number) => Promise<unknown> }).invoke(
        IPCChannels.Email.DeleteWorkflow,
        selectedId,
      )
      toast.success("Gelöscht.")
      setSelectedId(null)
      await load()
    } catch (e) {
      toast.error("Löschen fehlgeschlagen.")
    }
  }

  const handleCreate = async () => {
    if (!hasElectron) return
    try {
      const res = (await (window.electronAPI as { invoke: (c: string, p: unknown) => Promise<{ success: boolean; id?: number }> }).invoke(
        IPCChannels.Email.CreateWorkflow,
        {
          name: "Neuer Workflow",
          trigger: "inbound",
          priority: 100,
          definitionJson: EMPTY_DEF,
          enabled: true,
        },
      )) as { success: boolean; id?: number }
      if (res.id != null) {
        toast.success("Workflow angelegt.")
        await load()
        const created = (await (window.electronAPI as { invoke: (c: string, id: number) => Promise<WorkflowRow | null> }).invoke(
          IPCChannels.Email.GetWorkflow,
          res.id,
        )) as WorkflowRow | null
        if (created) selectRow(created)
      }
    } catch (e) {
      toast.error("Anlegen fehlgeschlagen.")
    }
  }

  const handleBackfill = async () => {
    if (!hasElectron) return
    setBackfilling(true)
    try {
      const res = (await (window.electronAPI as { invoke: (c: string) => Promise<{ success: boolean; processed?: number }> }).invoke(
        IPCChannels.Email.BackfillInboundWorkflows,
      )) as { processed?: number }
      toast.success(`Inbound-Workflows auf ${res.processed ?? 0} Nachrichten angewendet (idempotent pro Workflow).`)
      await load()
    } catch (e) {
      toast.error("Backfill fehlgeschlagen.")
    } finally {
      setBackfilling(false)
    }
  }

  if (!hasElectron) {
    return (
      <div className="container max-w-2xl py-10">
        <Card>
          <CardHeader>
            <CardTitle>E-Mail-Workflows</CardTitle>
            <CardDescription>Nur in der Desktop-App verfügbar.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="container max-w-4xl space-y-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/email">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Posteingang
            </Link>
          </Button>
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <Workflow className="h-7 w-7" />
              E-Mail-Workflows
            </h1>
            <p className="text-sm text-muted-foreground">
              Visueller Editor (React Flow) kompiliert zu JSON <code className="rounded bg-muted px-1">version: 1</code>. Trigger im obersten
              Knoten; Zeitplan-Trigger nutzt Cron-Ausdruck unten. Entwurf-Trigger für neue Composer-Entwürfe.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => void handleBackfill()} disabled={backfilling}>
            {backfilling ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Inbound auf bestehende Mails
          </Button>
          <Button type="button" size="sm" onClick={() => void handleCreate()}>
            <Plus className="mr-2 h-4 w-4" />
            Neu
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Liste</CardTitle>
          </CardHeader>
          <CardContent className="max-h-[480px] space-y-1 overflow-y-auto">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              rows.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => selectRow(w)}
                  className={`w-full rounded-md border px-2 py-2 text-left text-sm ${
                    selectedId === w.id ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted/80"
                  }`}
                >
                  <div className="font-medium">{w.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {w.trigger} · P{w.priority} {w.enabled ? "" : "(aus)"}
                  </div>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bearbeiten</CardTitle>
            <CardDescription>
              Graph: Trigger → Bedingungen → Aktionen verbinden. JSON unten ist die kompilierte Engine-Definition (nach Speichern aktualisiert).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedId == null ? (
              <p className="text-sm text-muted-foreground">Workflow auswählen oder „Neu“ anlegen.</p>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Name</Label>
                    <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Priorität (niedrig = zuerst)</Label>
                    <Input value={editPriority} onChange={(e) => setEditPriority(e.target.value)} />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Switch id="wf-en" checked={editEnabled} onCheckedChange={setEditEnabled} />
                    <Label htmlFor="wf-en" className="cursor-pointer font-normal">
                      Aktiv
                    </Label>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Cron (nur bei Trigger „Zeitplan“)</Label>
                  <Input
                    value={editCron}
                    onChange={(e) => setEditCron(e.target.value)}
                    placeholder="z. B. */15 * * * * (alle 15 Min)"
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Konto für geplanten Sync (IMAP/POP3)</Label>
                  <select
                    className="flex h-10 w-full max-w-md rounded-md border border-input bg-background px-3 text-sm"
                    value={editScheduleAccountId === "" ? "" : String(editScheduleAccountId)}
                    onChange={(e) =>
                      setEditScheduleAccountId(e.target.value ? parseInt(e.target.value, 10) : "")
                    }
                  >
                    <option value="">— keins (nur Log) —</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.display_name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Wenn gesetzt, führt der Cron-Job einen Postfach-Sync für dieses Konto aus und wendet danach eingehende Workflows auf neue Mails an.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Visueller Workflow</Label>
                  <Suspense fallback={<p className="text-sm text-muted-foreground">Editor lädt…</p>}>
                    <WorkflowFlowEditor />
                  </Suspense>
                </div>
                <div className="space-y-1.5">
                  <Label>Definition (JSON, kompiliert)</Label>
                  <Textarea value={editJson} onChange={(e) => setEditJson(e.target.value)} className="min-h-[200px] font-mono text-xs" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={() => void handleSave()} disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Speichern
                  </Button>
                  <Button type="button" variant="destructive" onClick={() => void handleDelete()}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Löschen
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
