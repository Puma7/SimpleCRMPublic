"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { hasElectron, invokeIpc, type CannedResponse } from "../types"

export function CannedPanel() {
  const [items, setItems] = useState<CannedResponse[]>([])

  const load = useCallback(async () => {
    if (!hasElectron()) return
    setItems(await invokeIpc<CannedResponse[]>(IPCChannels.Email.ListCannedResponses))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">Textbausteine</h3>
        <p className="text-sm text-muted-foreground">
          Vorlagen für wiederkehrende Antworten. Platzhalter: {"{{customer.name}}"}, {"{{customer.firstName}}"}, {"{{customer.email}}"}.
        </p>
      </div>
      <div className="space-y-3">
        {items.map((c) => (
          <div key={c.id} className="space-y-2 rounded border p-3">
            <Input
              defaultValue={c.title}
              id={`ct-${c.id}`}
              onBlur={async (e) => {
                const body = (
                  document.getElementById(`cb-${c.id}`) as HTMLTextAreaElement
                ).value
                await invokeIpc(IPCChannels.Email.SaveCannedResponse, {
                  id: c.id,
                  title: e.target.value,
                  body,
                })
              }}
            />
            <Textarea
              defaultValue={c.body}
              id={`cb-${c.id}`}
              className="min-h-[80px] font-mono text-sm"
            />
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={async () => {
          await invokeIpc(IPCChannels.Email.SaveCannedResponse, { title: "Neu", body: "" })
          await load()
          toast.success("Baustein angelegt")
        }}
      >
        <Plus className="mr-2 h-4 w-4" />
        Neuer Baustein
      </Button>
    </div>
  )
}
