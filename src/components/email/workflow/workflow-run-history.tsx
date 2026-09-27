"use client"

import { useCallback, useEffect, useState } from "react"
import type { Node } from "@xyflow/react"
import { IPCChannels } from "@shared/ipc/channels"
import {
  humanizeWorkflowPort,
  humanizeWorkflowStepMessage,
  isDeferredWorkflowStepMessage,
  stepTone,
} from "@shared/workflow-run-humanize"
import { TONE_BORDER, TONE_TEXT } from "./run-tone-styles"
import { resolveRunStepNodeLabel } from "@shared/workflow-ui-labels"
import { Loader2, RefreshCw } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import { invokeRenderer } from "@/services/transport"
import {
  getCachedWorkflowNodeCatalogEntry,
  useWorkflowNodeCatalog,
} from "./use-workflow-node-catalog"
import {
  WorkflowStepDetailView,
  WorkflowStepMailCard,
  firstStepMail,
  readWorkflowStepDetail,
} from "./workflow-step-detail"

type RunRow = {
  id: number
  status: string
  message_id: number | null
  started_at: string | null
  finished_at: string | null
  /** 1 = Testlauf (Plan 047), ohne Seiteneffekte. */
  dry_run?: number | boolean | null
}

type StepRow = {
  id: number
  node_id: string
  node_type: string
  status: string
  port: string | null
  duration_ms: number
  message: string | null
  /** Eingang/Ausgang (Server: jsonb-Objekt, Desktop: bereits geparst). */
  detail?: unknown
}

type Props = {
  workflowId: number | null
  graphNodes: Node[]
  /** Ändert sich nach einem Testlauf: Läufe neu laden. */
  refreshToken?: number
}


export function WorkflowRunHistory({ workflowId, graphNodes, refreshToken = 0 }: Props) {
  const { labelByType } = useWorkflowNodeCatalog()
  const [runs, setRuns] = useState<RunRow[]>([])
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null)
  const [steps, setSteps] = useState<StepRow[]>([])
  const [loading, setLoading] = useState(false)
  const [openStepId, setOpenStepId] = useState<number | null>(null)

  const loadRuns = useCallback(async () => {
    if (workflowId == null) {
      setRuns([])
      return
    }
    setLoading(true)
    try {
      const list = await invokeRenderer(IPCChannels.Email.ListWorkflowRuns, workflowId) as RunRow[]
      setRuns(list)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Workflow-Läufe konnten nicht geladen werden.")
    } finally {
      setLoading(false)
    }
  }, [workflowId])

  useEffect(() => {
    void loadRuns()
    setSelectedRunId(null)
    setSteps([])
  }, [loadRuns, refreshToken])

  const loadSteps = async (runId: number) => {
    setSelectedRunId(runId)
    setOpenStepId(null)
    try {
      const s = await invokeRenderer(IPCChannels.Email.ListWorkflowRunSteps, runId) as StepRow[]
      setSteps(s)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Workflow-Schritte konnten nicht geladen werden.")
      setSteps([])
    }
  }

  const detailsById = new Map(steps.map((step) => [step.id, readWorkflowStepDetail(step.detail)]))
  const runMail = firstStepMail([...detailsById.values()])
  const openStep = steps.find((step) => step.id === openStepId) ?? null

  if (workflowId == null) {
    return (
      <p className="p-4 text-sm text-muted-foreground">Workflow auswählen, um Läufe anzuzeigen.</p>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span>Lauf-Historie</span>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded px-1 py-0.5 normal-case tracking-normal hover:bg-muted"
          title="Läufe neu laden – Ergebnisse von Hintergrund-Schritten (z. B. KI-Entscheidung) kommen einige Sekunden später"
          onClick={() => {
            void loadRuns()
            if (selectedRunId != null) void loadSteps(selectedRunId)
          }}
        >
          <RefreshCw className="h-3 w-3" />
          Aktualisieren
        </button>
      </div>
      {loading ? (
        <div className="flex flex-1 items-center justify-center p-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-2">
          <ScrollArea className="border-r">
            <ul className="divide-y text-xs">
              {runs.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className={`w-full px-3 py-2 text-left hover:bg-muted/60 ${selectedRunId === r.id ? "bg-muted" : ""}`}
                    onClick={() => void loadSteps(r.id)}
                  >
                    <div className="font-medium">
                      Lauf #{r.id}
                      {r.dry_run === 1 || r.dry_run === true ? (
                        <span
                          className="ml-1.5 rounded border px-1 text-[10px] font-normal text-muted-foreground"
                          title="Testlauf – ohne Seiteneffekte, zählt nicht in Statistiken"
                        >
                          Test
                        </span>
                      ) : null}
                    </div>
                    <div className={TONE_TEXT[stepTone(r.status, null)]}>
                      {r.status} ·{" "}
                      {r.finished_at ? new Date(r.finished_at).toLocaleString("de-DE") : "—"}
                    </div>
                  </button>
                </li>
              ))}
              {runs.length === 0 ? (
                <li className="p-4 text-muted-foreground">Noch keine Läufe.</li>
              ) : null}
            </ul>
          </ScrollArea>
          <ScrollArea>
            <ul className="space-y-1 p-2 text-xs">
              {runMail ? (
                <li>
                  <WorkflowStepMailCard mail={runMail} />
                </li>
              ) : null}
              {steps.map((s) => {
                const { title, subtitle } = resolveRunStepNodeLabel({
                  nodeId: s.node_id,
                  nodeType: s.node_type,
                  labelByType,
                  graphNodes: graphNodes.map((n) => ({
                    id: n.id,
                    type: n.type,
                    data: n.data as Record<string, unknown>,
                  })),
                })
                const tone = stepTone(s.status, s.port)
                const humanMessage = humanizeWorkflowStepMessage(s.message)
                // Port-Label bevorzugt aus dem Knoten-Schema (z. B. „Erlaubt“/„Prüfen“),
                // generische Übersetzung nur als Fallback.
                const schemaPortLabel = getCachedWorkflowNodeCatalogEntry(s.node_type)?.ports?.find(
                  (p) => p.id === s.port,
                )?.label
                // Ein eingereihter Hintergrund-Job hat keinen echten Ausgang („Standard“ verwirrt).
                const portLabel = isDeferredWorkflowStepMessage(s.message)
                  ? null
                  : schemaPortLabel ?? humanizeWorkflowPort(s.port)
                const detail = detailsById.get(s.id) ?? null
                return (
                  <li
                    key={s.id}
                    className={`cursor-pointer rounded border bg-background px-2 py-1.5 hover:bg-muted/40 ${TONE_BORDER[tone]}`}
                    role="button"
                    tabIndex={0}
                    title="Eingang und Ausgang anzeigen"
                    onClick={() => setOpenStepId(s.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        setOpenStepId(s.id)
                      }
                    }}
                  >
                    <div className="font-medium">{title}</div>
                    {subtitle ? (
                      <div className="font-mono text-[10px] text-muted-foreground">{subtitle}</div>
                    ) : null}
                    <div className={TONE_TEXT[tone]}>
                      {s.status}
                      {portLabel ? (
                        <span title={s.port ?? undefined}> · {portLabel}</span>
                      ) : null}{" "}
                      · {s.duration_ms} ms
                    </div>
                    {humanMessage ? (
                      <div className={TONE_TEXT[tone]} title={s.message ?? undefined}>
                        {humanMessage}
                      </div>
                    ) : null}
                    {humanMessage && s.message && humanMessage !== s.message ? (
                      <div className="break-all font-mono text-[10px] text-muted-foreground/70">
                        {s.message}
                      </div>
                    ) : null}
                    {detail?.output?.note && !(s.message ?? "").includes(detail.output.note) ? (
                      <div className="mt-0.5 text-amber-700 dark:text-amber-400">{detail.output.note}</div>
                    ) : null}
                  </li>
                )
              })}
              {selectedRunId != null && steps.length === 0 ? (
                <li className="text-muted-foreground">Keine Schritte protokolliert.</li>
              ) : null}
            </ul>
          </ScrollArea>
        </div>
      )}
      <Dialog open={openStep != null} onOpenChange={(open) => { if (!open) setOpenStepId(null) }}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          {openStep ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {resolveRunStepNodeLabel({
                    nodeId: openStep.node_id,
                    nodeType: openStep.node_type,
                    labelByType,
                    graphNodes: graphNodes.map((n) => ({
                      id: n.id,
                      type: n.type,
                      data: n.data as Record<string, unknown>,
                    })),
                  }).title}
                </DialogTitle>
                <DialogDescription>
                  Lauf #{selectedRunId} · {openStep.status} · {openStep.duration_ms} ms
                  {humanizeWorkflowStepMessage(openStep.message)
                    ? ` · ${humanizeWorkflowStepMessage(openStep.message)}`
                    : ""}
                </DialogDescription>
              </DialogHeader>
              <WorkflowStepDetailView
                detail={detailsById.get(openStep.id) ?? null}
                nodeType={openStep.node_type}
              />
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
