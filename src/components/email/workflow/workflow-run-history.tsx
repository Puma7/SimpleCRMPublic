"use client"

import { useCallback, useEffect, useState } from "react"
import type { Node } from "@xyflow/react"
import { IPCChannels } from "@shared/ipc/channels"
import {
  humanizeWorkflowPort,
  humanizeWorkflowStepMessage,
  stepTone,
} from "@shared/workflow-run-humanize"
import { TONE_BORDER, TONE_TEXT } from "./run-tone-styles"
import { resolveRunStepNodeLabel } from "@shared/workflow-ui-labels"
import { Loader2 } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { toast } from "sonner"
import { invokeRenderer } from "@/services/transport"
import {
  getCachedWorkflowNodeCatalogEntry,
  useWorkflowNodeCatalog,
} from "./use-workflow-node-catalog"

type RunRow = {
  id: number
  status: string
  message_id: number | null
  started_at: string | null
  finished_at: string | null
}

type StepRow = {
  id: number
  node_id: string
  node_type: string
  status: string
  port: string | null
  duration_ms: number
  message: string | null
}

type Props = {
  workflowId: number | null
  graphNodes: Node[]
}


export function WorkflowRunHistory({ workflowId, graphNodes }: Props) {
  const { labelByType } = useWorkflowNodeCatalog()
  const [runs, setRuns] = useState<RunRow[]>([])
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null)
  const [steps, setSteps] = useState<StepRow[]>([])
  const [loading, setLoading] = useState(false)

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
  }, [loadRuns])

  const loadSteps = async (runId: number) => {
    setSelectedRunId(runId)
    try {
      const s = await invokeRenderer(IPCChannels.Email.ListWorkflowRunSteps, runId) as StepRow[]
      setSteps(s)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Workflow-Schritte konnten nicht geladen werden.")
      setSteps([])
    }
  }

  if (workflowId == null) {
    return (
      <p className="p-4 text-sm text-muted-foreground">Workflow auswählen, um Läufe anzuzeigen.</p>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Lauf-Historie
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
                    <div className="font-medium">Lauf #{r.id}</div>
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
                const portLabel = schemaPortLabel ?? humanizeWorkflowPort(s.port)
                return (
                  <li
                    key={s.id}
                    className={`rounded border bg-background px-2 py-1.5 ${TONE_BORDER[tone]}`}
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
    </div>
  )
}
