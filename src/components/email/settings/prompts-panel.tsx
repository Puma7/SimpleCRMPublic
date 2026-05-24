"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { hasElectron, invokeIpc, type AiPrompt } from "../types"

export function PromptsPanel() {
  const [prompts, setPrompts] = useState<AiPrompt[]>([])

  const load = useCallback(async () => {
    if (!hasElectron()) return
    setPrompts(await invokeIpc<AiPrompt[]>(IPCChannels.Email.ListAiPrompts))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">KI-Prompts (Composer)</h3>
        <p className="text-sm text-muted-foreground">
          Vorlagen für den Composer. Platzhalter: {"{{text}}"}, {"{{customer.name}}"} …
        </p>
      </div>
      <div className="space-y-3">
        {prompts.map((p) => (
          <div key={p.id} className="space-y-2 rounded border p-3">
            <Input defaultValue={p.label} id={`pl-${p.id}`} />
            <Textarea
              defaultValue={p.user_template}
              id={`pt-${p.id}`}
              className="min-h-[100px] font-mono text-sm"
            />
            <Button
              type="button"
              size="sm"
              onClick={async () => {
                const label = (document.getElementById(`pl-${p.id}`) as HTMLInputElement).value
                const userTemplate = (
                  document.getElementById(`pt-${p.id}`) as HTMLTextAreaElement
                ).value
                await invokeIpc(IPCChannels.Email.SaveAiPrompt, {
                  id: p.id,
                  label,
                  userTemplate,
                })
                toast.success("Gespeichert")
              }}
            >
              Speichern
            </Button>
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={async () => {
          await invokeIpc(IPCChannels.Email.SaveAiPrompt, {
            label: "Neu",
            userTemplate: "{{text}}",
          })
          await load()
        }}
      >
        <Plus className="mr-2 h-4 w-4" />
        Neuer Prompt
      </Button>
    </div>
  )
}
