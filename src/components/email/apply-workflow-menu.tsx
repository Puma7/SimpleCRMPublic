"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { filterWorkflowsForMessage } from "@shared/workflow-applicable-for-message"
import { toast } from "sonner"
import { Loader2, Workflow } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { hasElectron, invokeIpc, type EmailMessage } from "./types"
import { workflowTriggerLabel } from "./workflow/trigger-labels"
import { WorkflowRunDetailDialog } from "./workflow/workflow-run-detail-dialog"

type WorkflowRow = {
  id: number
  name: string
  trigger: string
  enabled: number
  priority: number
}

type ExecuteResult = {
  success: boolean
  status?: string
  blocked?: boolean
  blockReason?: string | null
  runId?: number
  log?: string[]
  error?: string
}

type Props = {
  message: EmailMessage
  onApplied?: () => void | Promise<void>
  variant?: "ghost" | "outline"
  size?: "sm" | "default"
  className?: string
}

export function ApplyWorkflowMenu({
  message,
  onApplied,
  variant = "ghost",
  size = "sm",
  className,
}: Props) {
  const [open, setOpen] = useState(false)
  const [workflows, setWorkflows] = useState<WorkflowRow[]>([])
  const [loadingList, setLoadingList] = useState(false)
  const [runningId, setRunningId] = useState<number | null>(null)
  const [runDetailId, setRunDetailId] = useState<number | null>(null)
  const [runDetailOpen, setRunDetailOpen] = useState(false)

  const loadWorkflows = useCallback(async () => {
    if (!hasElectron()) return
    setLoadingList(true)
    try {
      const list = await invokeIpc<WorkflowRow[]>(IPCChannels.Email.ListWorkflows)
      setWorkflows(list)
    } catch {
      toast.error("Workflows konnten nicht geladen werden.")
    } finally {
      setLoadingList(false)
    }
  }, [])

  useEffect(() => {
    if (open) void loadWorkflows()
  }, [open, loadWorkflows])

  const applicable = useMemo(
    () =>
      filterWorkflowsForMessage(workflows, message).filter(
        (w) => w.trigger !== 'outbound' && w.trigger !== 'draft_created',
      ),
    [workflows, message],
  )

  const runWorkflow = async (workflowId: number, dryRun: boolean) => {
    if (!hasElectron() || runningId != null) return
    setRunningId(workflowId)
    try {
      if (dryRun) {
        const r = await invokeIpc<{ success: boolean; log?: string[]; error?: string }>(
          IPCChannels.Email.TestWorkflowOnMessage,
          { workflowId, messageId: message.id, dryRun: true },
        )
        if (r.success) {
          toast.success(`Dry-Run OK: ${(r.log ?? []).slice(-3).join(", ") || "fertig"}`)
        } else {
          toast.error(r.error ?? "Dry-Run fehlgeschlagen")
        }
        return
      }

      const r = await invokeIpc<ExecuteResult>(IPCChannels.Email.ExecuteWorkflowNow, {
        workflowId,
        messageId: message.id,
        dryRun: false,
      })
      if (!r.success) {
        toast.error(r.error ?? "Workflow konnte nicht ausgeführt werden.")
        return
      }
      if (r.blocked) {
        const reason = r.blockReason ?? "Workflow blockiert"
        if (r.runId) {
          toast.warning(reason, {
            action: {
              label: "Details",
              onClick: () => {
                setRunDetailId(r.runId!)
                setRunDetailOpen(true)
              },
            },
          })
        } else {
          toast.warning(reason)
        }
      } else {
        toast.success(
          `Workflow ausgeführt (${r.status ?? "ok"}): ${(r.log ?? []).slice(-2).join(", ") || "fertig"}`,
        )
      }
      await onApplied?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Fehler bei der Ausführung")
    } finally {
      setRunningId(null)
      setOpen(false)
    }
  }

  if (!hasElectron()) return null

  return (
    <>
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size={size}
          variant={variant}
          className={cn(
            "gap-1.5 bg-fuchsia-500/12 text-fuchsia-950 hover:bg-fuchsia-500/20 dark:text-fuchsia-100",
            className,
          )}
        >
          {runningId != null ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Workflow className="h-4 w-4" />
          )}
          <span className="hidden lg:inline">Workflow</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Workflow anwenden</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {loadingList ? (
          <DropdownMenuItem disabled className="gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Lädt…
          </DropdownMenuItem>
        ) : applicable.length === 0 ? (
          <DropdownMenuItem disabled>
            Keine passenden aktiven Workflows für diese Nachricht.
          </DropdownMenuItem>
        ) : (
          applicable.map((w) => (
            <DropdownMenuSub key={w.id}>
              <DropdownMenuSubTrigger disabled={runningId != null}>
                <span className="truncate">{w.name}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem
                  onClick={() => void runWorkflow(w.id, false)}
                  disabled={runningId != null}
                >
                  Jetzt ausführen
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => void runWorkflow(w.id, true)}
                  disabled={runningId != null}
                >
                  Dry-Run (ohne Änderungen)
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                  {workflowTriggerLabel(w.trigger)}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
      <WorkflowRunDetailDialog
        runId={runDetailId}
        open={runDetailOpen}
        onOpenChange={setRunDetailOpen}
      />
    </>
  )
}
