"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  getRendererTransport,
  invokeRenderer,
  isMailComposeAuxDataRefreshEvent,
  subscribeServerEvents,
} from "@/services/transport"
import type { CannedResponse } from "../types"

export function CannedPanel() {
  const [items, setItems] = useState<CannedResponse[]>([])

  const load = useCallback(async () => {
    setItems(await invokeRenderer(IPCChannels.Email.ListCannedResponses) as CannedResponse[])
  }, [])

  const save = useCallback(async (id: number) => {
    const title = (document.getElementById(`ct-${id}`) as HTMLInputElement | null)?.value ?? ""
    const body = (document.getElementById(`cb-${id}`) as HTMLTextAreaElement | null)?.value ?? ""
    try {
      await invokeRenderer(IPCChannels.Email.SaveCannedResponse, { id, title, body })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Textbaustein konnte nicht gespeichert werden.")
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (getRendererTransport().kind !== "http") return
    const subscription = subscribeServerEvents({
      onEvent(event) {
        if (isMailComposeAuxDataRefreshEvent(event)) void load()
      },
    })
    return () => subscription.unsubscribe()
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
              onBlur={() => void save(c.id)}
            />
            <Textarea
              defaultValue={c.body}
              id={`cb-${c.id}`}
              className="min-h-[80px] font-mono text-sm"
              onBlur={() => void save(c.id)}
            />
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={async () => {
          try {
            // The server requires a non-empty body; seed a placeholder the user then edits.
            await invokeRenderer(IPCChannels.Email.SaveCannedResponse, { title: "Neuer Baustein", body: "Neuer Textbaustein" })
            await load()
            toast.success("Baustein angelegt")
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Baustein konnte nicht angelegt werden.")
          }
        }}
      >
        <Plus className="mr-2 h-4 w-4" />
        Neuer Baustein
      </Button>
    </div>
  )
}
