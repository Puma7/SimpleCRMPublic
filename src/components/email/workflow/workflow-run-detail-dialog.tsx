"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
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
import { useWorkflowNodeCatalog } from "./use-workflow-node-catalog"

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
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (runId == null || !open) return
    setLoading(true)
    try {
      const s = await invokeRenderer(IPCChannels.Email.ListWorkflowRunSteps, runId) as StepRow[]
      setSteps(s ?? [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Workflow-Schritte konnten nicht geladen werden.")
      setSteps([])
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
            Schritte und Meldungen aus der letzten Ausführung.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : steps.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Schritte protokolliert.</p>
        ) : (
          <ScrollArea className="max-h-[50vh] pr-3">
            <ul className="space-y-2 text-xs">
              {steps.map((s) => (
                <li key={s.id} className="rounded-md border bg-muted/30 px-3 py-2">
                  <div className="font-medium">
                    {resolveRegistryNodeLabel(s.node_type, labelByType)}
                    <span className="ml-2 text-muted-foreground">({s.status})</span>
                  </div>
                  {s.message ? (
                    <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{s.message}</p>
                  ) : null}
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {s.duration_ms} ms{s.port ? ` · Port ${s.port}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  )
}
