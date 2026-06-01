"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import {
  AI_PROVIDER_PRESETS,
  AI_PROVIDER_PRESET_IDS,
  type AiProviderPresetId,
} from "@shared/ai-provider-presets"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
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
import { ReplySuggestionSettingsSection } from "./reply-suggestion-settings-section"

type AiProfile = {
  id: number
  label: string
  provider: string
  baseUrl: string
  model: string
  embeddingModel: string | null
  isDefault: boolean
  hasApiKey?: boolean
}

type ProviderPreset = {
  label: string
  baseUrl: string
  defaultModel: string
  defaultEmbeddingModel?: string
}

function mergePresets(
  fromIpc?: Record<string, ProviderPreset>,
): Record<string, ProviderPreset> {
  return { ...AI_PROVIDER_PRESETS, ...(fromIpc ?? {}) }
}

export function AiPanel() {
  const [profiles, setProfiles] = useState<AiProfile[]>([])
  const [presets, setPresets] = useState<Record<string, ProviderPreset>>(
    () => mergePresets(),
  )
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [label, setLabel] = useState("")
  const [provider, setProvider] = useState<AiProviderPresetId>("openai")
  const [baseUrl, setBaseUrl] = useState(AI_PROVIDER_PRESETS.openai.baseUrl)
  const [model, setModel] = useState(AI_PROVIDER_PRESETS.openai.defaultModel)
  const [embeddingModel, setEmbeddingModel] = useState(
    AI_PROVIDER_PRESETS.openai.defaultEmbeddingModel ?? "",
  )
  const [apiKey, setApiKey] = useState("")
  const [saving, setSaving] = useState(false)

  const applyPreset = useCallback(
    (p: AiProviderPresetId, presetMap: Record<string, ProviderPreset>) => {
      setProvider(p)
      const preset = presetMap[p]
      if (!preset) return
      if (p === "custom") {
        return
      }
      setBaseUrl(preset.baseUrl)
      setModel(preset.defaultModel)
      if (preset.defaultEmbeddingModel) {
        setEmbeddingModel(preset.defaultEmbeddingModel)
      }
    },
    [],
  )

  const load = useCallback(async (preferProfileId?: number | null) => {
    if (!hasElectron()) return
    try {
      const s = await invokeIpc<{
        profiles?: AiProfile[]
        providerPresets?: Record<string, ProviderPreset>
      }>(IPCChannels.Email.GetAiSettings)
      const merged = mergePresets(s.providerPresets)
      setPresets(merged)
      const list = s.profiles ?? []
      setProfiles(list)
      const active =
        (preferProfileId != null
          ? list.find((p) => p.id === preferProfileId)
          : undefined) ??
        list.find((p) => p.isDefault) ??
        list[0]
      if (active) {
        setSelectedId(active.id)
        setLabel(active.label)
        setProvider(active.provider as AiProviderPresetId)
        setBaseUrl(active.baseUrl)
        setModel(active.model)
        setEmbeddingModel(active.embeddingModel ?? "")
      } else {
        setSelectedId(null)
        setLabel("Neues Profil")
        applyPreset("openai", merged)
      }
    } catch (e) {
      console.error(e)
      toast.error("KI-Einstellungen konnten nicht geladen werden.")
      setPresets(mergePresets())
    }
  }, [applyPreset])

  useEffect(() => {
    void load()
  }, [load])

  const selectedProfile = profiles.find((p) => p.id === selectedId)

  const selectProfile = (p: AiProfile) => {
    setSelectedId(p.id)
    setLabel(p.label)
    setProvider(p.provider as AiProviderPresetId)
    setBaseUrl(p.baseUrl)
    setModel(p.model)
    setEmbeddingModel(p.embeddingModel ?? "")
    setApiKey("")
  }

  const save = async () => {
    if (saving) return
    if (!hasElectron() || !label.trim()) {
      toast.error("Bitte eine Bezeichnung eingeben.")
      return
    }
    if (!baseUrl.trim() || !model.trim()) {
      toast.error("Base-URL und Chat-Modell sind erforderlich.")
      return
    }
    const isNew = selectedId == null
    setSaving(true)
    try {
      const r = await invokeIpc<{ success: boolean; id?: number; error?: string }>(
        IPCChannels.Email.SaveAiProfile,
        {
          id: selectedId ?? undefined,
          label: label.trim(),
          provider,
          baseUrl: baseUrl.trim(),
          model: model.trim(),
          embeddingModel: embeddingModel.trim() || null,
          isDefault:
            profiles.length === 0 ||
            Boolean(profiles.find((p) => p.id === selectedId)?.isDefault),
          apiKey: apiKey.trim() || undefined,
        },
      )
      if (r && "success" in r && r.success === false) {
        toast.error(r.error ?? "Speichern fehlgeschlagen.")
        return
      }
      const savedId = r?.id ?? selectedId
      if (savedId != null) {
        setSelectedId(savedId)
      }
      setApiKey("")
      toast.success(isNew ? "Neues KI-Profil angelegt." : "KI-Profil gespeichert.")
      await load(savedId ?? undefined)
    } catch (e) {
      console.error(e)
      toast.error("KI-Profil konnte nicht gespeichert werden.")
    } finally {
      setSaving(false)
    }
  }

  const addNew = () => {
    setSelectedId(null)
    setLabel("Neues Profil")
    setApiKey("")
    applyPreset("openai", presets)
  }

  return (
    <div className="space-y-8">
      <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Globale KI-Konfiguration</p>
        <p className="mt-1">
          Hier legen Sie <strong>Anbieter, Modelle und API-Keys</strong> fest. Automatische
          Antwortvorschläge pro Postfach steuern Sie unter{" "}
          <strong>Konten → KI</strong>; die globalen Voreinstellungen dafür unter{" "}
          <strong>Antwortvorschläge (Standard)</strong> unten.
        </p>
      </div>

      <ReplySuggestionSettingsSection />

      <Separator />

      <div>
        <h3 className="text-base font-semibold">KI-Profile (Anbieter &amp; Modelle)</h3>
        <p className="text-sm text-muted-foreground">
          Ein Profil = ein Anbieter mit API-Key. Das <strong>Chat-Modell</strong> nutzen Composer
          und Workflow-KI-Knoten. Das optionale <strong>Embedding-Modell</strong> nur für die
          Wissensbasis (semantische Suche) — nicht gleichzeitig als Chat-Modell gedacht, sondern
          als zweiter Endpunkt desselben Anbieters.
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
      {selectedId == null ? (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Neues Profil: Bezeichnung eintragen und <strong>Speichern</strong> — jeder Speichern-Klick
          ohne ausgewähltes Profil legt sonst ein weiteres Profil an.
        </p>
      ) : null}

      <div className="grid gap-3 rounded-lg border p-4">
        <div className="space-y-1.5">
          <Label>Bezeichnung</Label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Anbieter-Vorlage</Label>
          <Select
            value={provider}
            onValueChange={(v) => applyPreset(v as AiProviderPresetId, presets)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AI_PROVIDER_PRESET_IDS.map((id) => (
                <SelectItem key={id} value={id}>
                  {presets[id]?.label ?? id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            OpenAI, Open Router usw. füllen Base-URL und Standardmodelle vor. Bei „frei“ alles
            manuell eintragen.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Base URL (OpenAI-kompatibel)</Label>
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Chat-Modell</Label>
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="z. B. gpt-4o-mini"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Embedding-Modell (optional, Wissensbasis)</Label>
          <Input
            value={embeddingModel}
            onChange={(e) => setEmbeddingModel(e.target.value)}
            placeholder="z. B. text-embedding-3-small"
          />
        </div>
        <div className="space-y-1.5">
          <Label>API-Key (nur bei Speichern setzen)</Label>
          {selectedId != null ? (
            <p
              className={
                selectedProfile?.hasApiKey
                  ? "text-xs text-green-700 dark:text-green-400"
                  : "text-xs text-amber-700 dark:text-amber-400"
              }
            >
              {selectedProfile?.hasApiKey
                ? "Für dieses Profil ist ein API-Key hinterlegt. Neues Feld leer lassen, um den bestehenden Key zu behalten."
                : "Für dieses Profil ist noch kein API-Key hinterlegt — bitte eintragen und Speichern."}
            </p>
          ) : null}
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-… / or-…"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={saving} onClick={() => void save()}>
            {saving ? "Speichern…" : selectedId == null ? "Profil anlegen" : "Speichern"}
          </Button>
          {selectedId != null ? (
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                void invokeIpc(IPCChannels.Email.ClearAiProfileApiKey, selectedId)
                  .then(() => toast.success("API-Key des Profils entfernt"))
                  .catch(() => toast.error("API-Key konnte nicht entfernt werden."))
              }
            >
              Key löschen
            </Button>
          ) : null}
          {selectedId != null ? (
            <Button
              type="button"
              variant="destructive"
              onClick={() =>
                void invokeIpc(IPCChannels.Email.DeleteAiProfile, selectedId)
                  .then(async () => {
                    toast.success("Profil gelöscht")
                    await load()
                  })
                  .catch(() => toast.error("Profil konnte nicht gelöscht werden."))
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
