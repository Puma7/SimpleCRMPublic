"use client"

import { IPCChannels } from "@shared/ipc/channels"
import type { WorkflowTemplateDto } from "@shared/workflow-types"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { invokeRenderer } from "@/services/transport"
import { useEffect, useState } from "react"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (template: WorkflowTemplateDto) => void
}

export function WorkflowTemplatesDialog({ open, onOpenChange, onPick }: Props) {
  const [templates, setTemplates] = useState<WorkflowTemplateDto[]>([])

  useEffect(() => {
    if (!open) return
    void invokeRenderer(IPCChannels.Email.ListWorkflowTemplates).then((items) => {
      setTemplates(items as WorkflowTemplateDto[])
    })
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Workflow-Vorlagen</DialogTitle>
          <DialogDescription>
            Fertige Flows für typische Szenarien — im Editor anpassbar.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[360px] pr-3">
          <ul className="space-y-2">
            {templates.map((t) => (
              <li key={t.id} className="rounded-lg border p-3">
                <div className="font-medium">{t.name}</div>
                <p className="text-sm text-muted-foreground">{t.description}</p>
                <Button
                  type="button"
                  size="sm"
                  className="mt-2"
                  onClick={() => {
                    onPick(t)
                    onOpenChange(false)
                  }}
                >
                  Vorlage laden
                </Button>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
