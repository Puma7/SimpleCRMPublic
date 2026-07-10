"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import {
  humanizeWorkflowPort,
  humanizeWorkflowStepMessage,
  stepTone,
} from "@shared/workflow-run-humanize"
import { TONE_BORDER, TONE_TEXT } from "./run-tone-styles"
import { resolveRegistryNodeLabel } from "@shared/workflow-ui-labels"
import { Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { toast } from "sonner"
import { invokeRenderer } from "@/services/transport"
import {
  getCachedWorkflowNodeCatalogEntry,
  useWorkflowNodeCatalog,
} from "./use-workflow-node-catalog"

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
  runId: number | null
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
}


export function WorkflowRunDetailDialog({ runId, open, onOpenChange, title }: Props) {
  const { labelByType } = useWorkflowNodeCatalog()
  const [steps, setSteps] = useState<StepRow[]>([])
  const [runLog, setRunLog] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (runId == null || !open) return
    setLoading(true)
    try {
      const [stepsResult, logResult] = await Promise.all([
        invokeRenderer(IPCChannels.Email.ListWorkflowRunSteps, runId) as Promise<StepRow[]>,
        invokeRenderer(IPCChannels.Email.GetWorkflowRunLog, runId) as Promise<string[]>,
      ])
      setSteps(stepsResult ?? [])
      setRunLog(Array.isArray(logResult) ? logResult : [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Workflow-Details konnten nicht geladen werden.")
      setSteps([])
      setRunLog([])
    } finally {
      setLoading(false)
    }
  }, [runId, open])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg">
        <DialogHeader>
          <DialogTitle>{title ?? `Workflow-Lauf #${runId ?? "—"}`}</DialogTitle>
          <DialogDescription>
            Schritte, Lauf-Log und Meldungen aus der letzten Ausführung.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : steps.length === 0 && runLog.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Schritte protokolliert.</p>
        ) : (
          <ScrollArea className="max-h-[50vh] pr-3">
            {runLog.length > 0 ? (
              <div className="mb-3 rounded-md border bg-muted/20 p-3">
                <p className="mb-1 text-xs font-medium">Lauf-Log</p>
                <ul className="space-y-0.5 font-mono text-[11px] text-muted-foreground">
                  {runLog.map((line, index) => (
                    <li key={`${index}-${line}`} className="whitespace-pre-wrap break-all">
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {steps.length > 0 ? (
              <ul className="space-y-2 text-xs">
                {steps.map((s) => {
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
                      className={`rounded-md border bg-muted/30 px-3 py-2 ${TONE_BORDER[tone]}`}
                    >
                      <div className="font-medium">
                        {resolveRegistryNodeLabel(s.node_type, labelByType)}
                        <span className={`ml-2 ${TONE_TEXT[tone]}`}>({s.status})</span>
                      </div>
                      {humanMessage ? (
                        <p
                          className={`mt-1 whitespace-pre-wrap ${TONE_TEXT[tone]}`}
                          title={s.message ?? undefined}
                        >
                          {humanMessage}
                        </p>
                      ) : null}
                      {humanMessage && s.message && humanMessage !== s.message ? (
                        <p className="mt-0.5 break-all font-mono text-[10px] text-muted-foreground/70">
                          {s.message}
                        </p>
                      ) : null}
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {s.duration_ms} ms
                        {portLabel ? (
                          <span title={s.port ?? undefined}> · Ergebnis: {portLabel}</span>
                        ) : null}
                      </p>
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  )
}
