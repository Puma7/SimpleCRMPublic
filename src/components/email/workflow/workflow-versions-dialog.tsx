"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { invokeIpc } from "../types"

type VersionRow = {
  id: number
  workflow_id: number
  label: string
  created_at: string
}

type Props = {
  workflowId: number | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onRestored: () => void
}

export function WorkflowVersionsDialog({
  workflowId,
  open,
  onOpenChange,
  onRestored,
}: Props) {
  const [rows, setRows] = useState<VersionRow[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (workflowId == null) {
      setRows([])
      return
    }
    setLoading(true)
    try {
      const list = await invokeIpc<VersionRow[]>(
        IPCChannels.Email.ListWorkflowVersions,
        workflowId,
      )
      setRows(list)
    } finally {
      setLoading(false)
    }
  }, [workflowId])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const restore = async (versionId: number) => {
    const r = await invokeIpc<{ success: boolean; error?: string }>(
      IPCChannels.Email.RestoreWorkflowVersion,
      { versionId },
    )
    if (r.success) {
      toast.success("Version wiederhergestellt.")
      onRestored()
      onOpenChange(false)
    } else {
      toast.error(r.error ?? "Wiederherstellung fehlgeschlagen")
    }
  }

  const snapshot = async () => {
    if (workflowId == null) return
    await invokeIpc(IPCChannels.Email.SaveWorkflowVersion, { workflowId })
    toast.success("Version gespeichert.")
    void load()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Workflow-Versionen</DialogTitle>
        </DialogHeader>
        <div className="flex justify-end">
          <Button type="button" size="sm" variant="outline" onClick={() => void snapshot()}>
            Snapshot jetzt
          </Button>
        </div>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ScrollArea className="max-h-[320px]">
            <ul className="space-y-1 pr-2">
              {rows.map((v) => (
                <li
                  key={v.id}
                  className="flex items-center justify-between gap-2 rounded border px-2 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{v.label}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {new Date(v.created_at).toLocaleString("de-DE")}
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => void restore(v.id)}
                  >
                    Laden
                  </Button>
                </li>
              ))}
              {rows.length === 0 ? (
                <li className="py-4 text-center text-sm text-muted-foreground">
                  Noch keine Versionen.
                </li>
              ) : null}
            </ul>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  )
}
