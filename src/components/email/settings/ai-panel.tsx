"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { hasElectron, invokeIpc } from "../types"

export function AiPanel() {
  const [aiBase, setAiBase] = useState("https://api.openai.com/v1")
  const [aiModel, setAiModel] = useState("gpt-4o-mini")
  const [aiKey, setAiKey] = useState("")

  const load = useCallback(async () => {
    if (!hasElectron()) return
    const s = await invokeIpc<{ baseUrl: string; model: string }>(
      IPCChannels.Email.GetAiSettings,
    )
    setAiBase(s.baseUrl)
    setAiModel(s.model)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    if (!hasElectron()) return
    await invokeIpc(IPCChannels.Email.SetAiSettings, {
      baseUrl: aiBase,
      model: aiModel,
    })
    if (aiKey.trim()) {
      await invokeIpc(IPCChannels.Email.SetAiApiKey, aiKey.trim())
      setAiKey("")
    }
    toast.success("KI-Einstellungen gespeichert.")
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">KI (OpenAI-kompatibel)</h3>
        <p className="text-sm text-muted-foreground">
          API-Key wird im System-Schlüsselbund gespeichert. Base-URL kann auf einen kompatiblen Proxy zeigen.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label>Base URL</Label>
        <Input value={aiBase} onChange={(e) => setAiBase(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label>Modell</Label>
        <Input value={aiModel} onChange={(e) => setAiModel(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label>API-Key setzen</Label>
        <Input
          type="password"
          value={aiKey}
          onChange={(e) => setAiKey(e.target.value)}
          placeholder="sk-…"
        />
      </div>
      <div className="flex gap-2">
        <Button type="button" onClick={() => void save()}>
          Speichern
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            void invokeIpc(IPCChannels.Email.ClearAiApiKey).then(() =>
              toast.success("API-Key entfernt"),
            )
          }
        >
          Key löschen
        </Button>
      </div>
    </div>
  )
}
