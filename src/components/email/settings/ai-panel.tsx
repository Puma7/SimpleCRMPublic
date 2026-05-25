"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { hasElectron, invokeIpc } from "../types"

type AiProfile = {
  id: number
  label: string
  provider: string
  baseUrl: string
  model: string
  embeddingModel: string | null
  isDefault: boolean
}

type ProviderPreset = { label: string; baseUrl: string; defaultModel: string }

const PROVIDER_ORDER = [
  "openai",
  "openrouter",
  "anthropic",
  "google",
  "deepseek",
  "ollama",
  "custom",
] as const

export function AiPanel() {
  const [profiles, setProfiles] = useState<AiProfile[]>([])
  const [presets, setPresets] = useState<Record<string, ProviderPreset>>({})
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [label, setLabel] = useState("")
  const [provider, setProvider] = useState<string>("openai")
  const [baseUrl, setBaseUrl] = useState("")
  const [model, setModel] = useState("")
  const [embeddingModel, setEmbeddingModel] = useState("text-embedding-3-small")
  const [apiKey, setApiKey] = useState("")

  const load = useCallback(async () => {
    if (!hasElectron()) return
    const s = await invokeIpc<{
      profiles?: AiProfile[]
      providerPresets?: Record<string, ProviderPreset>
    }>(IPCChannels.Email.GetAiSettings)
    setProfiles(s.profiles ?? [])
    setPresets(s.providerPresets ?? {})
    const active = s.profiles?.find((p) => p.isDefault) ?? s.profiles?.[0]
    if (active) {
      setSelectedId(active.id)
      setLabel(active.label)
      setProvider(active.provider)
      setBaseUrl(active.baseUrl)
      setModel(active.model)
      setEmbeddingModel(active.embeddingModel ?? "text-embedding-3-small")
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const applyPreset = (p: string) => {
    setProvider(p)
    const preset = presets[p]
    if (preset) {
      setBaseUrl(preset.baseUrl)
      setModel(preset.defaultModel)
    }
  }

  const selectProfile = (p: AiProfile) => {
    setSelectedId(p.id)
    setLabel(p.label)
    setProvider(p.provider)
    setBaseUrl(p.baseUrl)
    setModel(p.model)
    setEmbeddingModel(p.embeddingModel ?? "text-embedding-3-small")
    setApiKey("")
  }

  const save = async () => {
    if (!hasElectron() || !label.trim()) return
    await invokeIpc(IPCChannels.Email.SaveAiProfile, {
      id: selectedId ?? undefined,
      label: label.trim(),
      provider,
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      embeddingModel: embeddingModel.trim() || null,
      isDefault: profiles.length === 0 || profiles.find((p) => p.id === selectedId)?.isDefault,
      apiKey: apiKey.trim() || undefined,
    })
    setApiKey("")
    toast.success("KI-Profil gespeichert.")
    await load()
  }

  const addNew = () => {
    setSelectedId(null)
    setLabel("Neues Profil")
    applyPreset("openai")
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">KI-Profile (Anbieter &amp; Modelle)</h3>
        <p className="text-sm text-muted-foreground">
          Jeder Eintrag hat einen eigenen API-Key (Keytar) und ein Modell. In Workflows wählen Sie
          das Profil am KI-Knoten (<code className="rounded bg-muted px-1">profileId</code> in den
          Experten-JSON-Einstellungen oder künftig per Dropdown). Keys und Modelle sind getrennt —
          ein Key kann mehrere Profile nutzen, typischerweise je ein Profil pro Anbieter/Modell.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {profiles.map((p) => (
          <Button
            key={p.id}
            type="button"
            size="sm"
            variant={selectedId === p.id ? "default" : "outline"}
            onClick={() => selectProfile(p)}
          >
            {p.label}
            {p.isDefault ? " · Standard" : ""}
          </Button>
        ))}
        <Button type="button" size="sm" variant="secondary" onClick={addNew}>
          + Profil
        </Button>
      </div>

      <div className="grid gap-3 rounded-lg border p-4">
        <div className="space-y-1.5">
          <Label>Bezeichnung</Label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Anbieter-Vorlage</Label>
          <Select value={provider} onValueChange={applyPreset}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROVIDER_ORDER.map((id) => (
                <SelectItem key={id} value={id}>
                  {presets[id]?.label ?? id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Base URL (OpenAI-kompatibel)</Label>
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Chat-Modell</Label>
          <Input value={model} onChange={(e) => setModel(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Embedding-Modell (Wissensbasis)</Label>
          <Input value={embeddingModel} onChange={(e) => setEmbeddingModel(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>API-Key (nur bei Speichern setzen)</Label>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-… / or-…"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void save()}>
            Speichern
          </Button>
          {selectedId != null ? (
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                void invokeIpc(IPCChannels.Email.ClearAiProfileApiKey, selectedId).then(() =>
                  toast.success("API-Key des Profils entfernt"),
                )
              }
            >
              Key löschen
            </Button>
          ) : null}
          {selectedId != null && profiles.length > 1 ? (
            <Button
              type="button"
              variant="destructive"
              onClick={() =>
                void invokeIpc(IPCChannels.Email.DeleteAiProfile, selectedId).then(async () => {
                  toast.success("Profil gelöscht")
                  await load()
                })
              }
            >
              Profil löschen
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
