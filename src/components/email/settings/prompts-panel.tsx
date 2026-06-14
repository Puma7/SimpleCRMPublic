"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { type AiPrompt } from "../types"
import {
  getRendererTransport,
  invokeRenderer,
  isMailComposeAuxDataRefreshEvent,
  subscribeServerEvents,
} from "@/services/transport"
import {
  AccountScopeToolbar,
  ScopeBadge,
  listPayloadForScope,
  mutationScopeFields,
  mutationScopeFieldsForRow,
  type AccountScopeValue,
} from "./account-scope-toolbar"
import { AccountOverrideActions } from "./account-override-actions"
import {
  createPromptAccountOverride,
  resetPromptAccountOverride,
} from "./account-override-mutations"

type SortMode = "manual" | "label-asc" | "label-desc" | "newest"

type AiProfileOption = {
  id: number
  label: string
  isDefault: boolean
}

const DEFAULT_PROFILE_VALUE = "__default__"

const PLACEHOLDERS = [
  "{{text}}",
  "{{customer.name}}",
  "{{customer.firstName}}",
  "{{customer.email}}",
]

function snippet(text: string, max = 72): string {
  const one = text.replace(/\s+/g, " ").trim()
  if (!one) return "(leer)"
  return one.length > max ? `${one.slice(0, max)}…` : one
}

export function PromptsPanel() {
  const [prompts, setPrompts] = useState<AiPrompt[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [search, setSearch] = useState("")
  const [sortMode, setSortMode] = useState<SortMode>("manual")
  const [label, setLabel] = useState("")
  const [userTemplate, setUserTemplate] = useState("")
  const [profileId, setProfileId] = useState<number | null>(null)
  const [aiProfiles, setAiProfiles] = useState<AiProfileOption[]>([])
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [scope, setScope] = useState<AccountScopeValue>("all")

  const loadProfiles = useCallback(async () => {
    try {
      const profiles = await invokeRenderer(IPCChannels.Email.ListAiProfiles) as AiProfileOption[]
      setAiProfiles(
        profiles.map((p) => ({
          id: p.id,
          label: p.label,
          isDefault: p.isDefault,
        })),
      )
    } catch {
      setAiProfiles([])
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      await loadProfiles()
      const rows = await invokeRenderer(
        IPCChannels.Email.ListAiPrompts,
        listPayloadForScope(scope),
      ) as AiPrompt[]
      setPrompts(rows)
      return rows
    } catch (e) {
      console.error(e)
      toast.error("KI-Prompts konnten nicht geladen werden.")
      return []
    } finally {
      setLoading(false)
    }
  }, [loadProfiles, scope])

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

  const filteredSorted = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = prompts.filter((p) => {
      if (!q) return true
      return (
        p.label.toLowerCase().includes(q) ||
        p.user_template.toLowerCase().includes(q)
      )
    })
    switch (sortMode) {
      case "label-asc":
        list = [...list].sort((a, b) => a.label.localeCompare(b.label, "de"))
        break
      case "label-desc":
        list = [...list].sort((a, b) => b.label.localeCompare(a.label, "de"))
        break
      case "newest":
        list = [...list].sort((a, b) => b.id - a.id)
        break
      default:
        list = [...list].sort(
          (a, b) =>
            (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id,
        )
    }
    return list
  }, [prompts, search, sortMode])

  const selected = useMemo(
    () => prompts.find((p) => p.id === selectedId) ?? null,
    [prompts, selectedId],
  )

  const selectPrompt = useCallback((p: AiPrompt) => {
    setSelectedId(p.id)
    setLabel(p.label)
    setUserTemplate(p.user_template)
    setProfileId(
      p.profile_id != null && p.profile_id > 0 ? p.profile_id : null,
    )
    setDirty(false)
  }, [])

  useEffect(() => {
    if (selectedId != null && !prompts.some((p) => p.id === selectedId)) {
      setSelectedId(null)
      setLabel("")
      setUserTemplate("")
      setDirty(false)
    }
  }, [prompts, selectedId])

  const saveCurrent = async () => {
    if (selectedId == null || !selected) return
    if (!label.trim()) {
      toast.error("Bitte eine Bezeichnung eingeben.")
      return
    }
    setSaving(true)
    try {
      await invokeRenderer(IPCChannels.Email.SaveAiPrompt, {
        id: selectedId,
        label: label.trim(),
        userTemplate,
        profileId,
        ...mutationScopeFieldsForRow(scope, selected, selected.override_key),
      })
      setDirty(false)
      toast.success("Prompt gespeichert.")
      const rows = await load()
      const updated = rows?.find((p) => p.id === selectedId)
      if (updated) selectPrompt(updated)
    } catch (e) {
      console.error(e)
      toast.error("Speichern fehlgeschlagen.")
    } finally {
      setSaving(false)
    }
  }

  const createNew = async () => {
    try {
      const r = await invokeRenderer(
        IPCChannels.Email.SaveAiPrompt,
        {
          label: "Neuer Prompt",
          userTemplate: "{{text}}",
          ...mutationScopeFields(scope),
        },
      ) as { success: boolean; id?: number }
      const rows = await load()
      const id = r.id ?? rows?.[rows.length - 1]?.id
      const created = rows?.find((p) => p.id === id) ?? rows?.[0]
      if (created) {
        selectPrompt(created)
        setSearch("")
        setSortMode("manual")
      }
      toast.success("Prompt angelegt.")
    } catch (e) {
      console.error(e)
      toast.error("Anlegen fehlgeschlagen.")
    }
  }

  const deleteCurrent = async () => {
    if (selectedId == null || !selected) return
    if (!window.confirm(`Prompt „${selected.label}" wirklich löschen?`)) return
    try {
      await invokeRenderer(IPCChannels.Email.DeleteAiPrompt, selectedId)
      toast.success("Prompt gelöscht.")
      const rows = await load()
      const next = rows?.[0]
      if (next) selectPrompt(next)
      else {
        setSelectedId(null)
        setLabel("")
        setUserTemplate("")
      }
    } catch (e) {
      console.error(e)
      toast.error("Löschen fehlgeschlagen.")
    }
  }

  const duplicateCurrent = async () => {
    if (!selected) return
    try {
      const r = await invokeRenderer(IPCChannels.Email.SaveAiPrompt, {
        label: `${selected.label} (Kopie)`,
        userTemplate: userTemplate,
        ...mutationScopeFields(scope, selected.override_key),
      }) as { id?: number }
      const rows = await load()
      const copy = rows?.find((p) => p.id === r.id)
      if (copy) selectPrompt(copy)
      toast.success("Prompt dupliziert.")
    } catch (e) {
      console.error(e)
      toast.error("Duplizieren fehlgeschlagen.")
    }
  }

  const move = async (direction: "up" | "down") => {
    if (selectedId == null || sortMode !== "manual") return
    try {
      const r = await invokeRenderer(
        IPCChannels.Email.ReorderAiPrompt,
        { id: selectedId, direction },
      ) as { success: boolean; error?: string }
      if (!r.success) {
        toast.error(r.error ?? "Verschieben nicht möglich.")
        return
      }
      await load()
    } catch (e) {
      console.error(e)
      toast.error("Verschieben fehlgeschlagen.")
    }
  }

  const manualIndex =
    sortMode === "manual" && selectedId != null
      ? filteredSorted.findIndex((p) => p.id === selectedId)
      : -1

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden p-6">
      <div className="shrink-0">
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <Sparkles className="h-4 w-4" />
          KI-Prompts (Composer)
        </h3>
        <p className="text-sm text-muted-foreground">
          Vorlagen für „KI auf Text…“ im Composer. Jedem Prompt kann ein KI-Profil zugewiesen werden;
          ohne Zuweisung wird das Standard-Profil genutzt. Reihenfolge bei „Manuell“ = Dropdown im
          Composer.
        </p>
      </div>

      <AccountScopeToolbar
        value={scope}
        onChange={(next) => {
          setScope(next)
          setSelectedId(null)
        }}
      />

      <div className="flex min-h-0 flex-1 gap-4 rounded-lg border">
        <div className="flex w-[min(100%,280px)] shrink-0 flex-col border-r bg-muted/20">
          <div className="space-y-2 border-b p-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Suchen…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={sortMode} onValueChange={(v) => setSortMode(v as SortMode)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Sortierung: Manuell</SelectItem>
                <SelectItem value="label-asc">Name A–Z</SelectItem>
                <SelectItem value="label-desc">Name Z–A</SelectItem>
                <SelectItem value="newest">Neueste zuerst</SelectItem>
              </SelectContent>
            </Select>
            <Button type="button" size="sm" variant="secondary" className="w-full" onClick={() => void createNew()}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Neuer Prompt
            </Button>
            <p className="text-[10px] text-muted-foreground">
              {filteredSorted.length} von {prompts.length} Prompt(s)
            </p>
          </div>
          <ScrollArea className="flex-1">
            {loading ? (
              <p className="p-4 text-sm text-muted-foreground">Lädt…</p>
            ) : filteredSorted.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                {prompts.length === 0 ? "Noch keine Prompts." : "Keine Treffer."}
              </p>
            ) : (
              <ul className="p-1">
                {filteredSorted.map((p) => {
                  const active = p.id === selectedId
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => selectPrompt(p)}
                        className={cn(
                          "w-full rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                          active
                            ? "bg-background font-medium shadow-sm"
                            : "hover:bg-background/70",
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate font-medium">{p.label}</span>
                          <ScopeBadge row={p} />
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {snippet(p.user_template)}
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </ScrollArea>
        </div>

        <div className="flex min-w-0 flex-1 flex-col p-4">
          {selectedId == null ? (
            <div className="flex flex-1 flex-col items-center justify-center text-center text-sm text-muted-foreground">
              <p>Links einen Prompt wählen oder „Neuer Prompt“ anlegen.</p>
            </div>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={saving || !dirty}
                  onClick={() => void saveCurrent()}
                >
                  {saving ? "Speichern…" : "Speichern"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void duplicateCurrent()}
                >
                  <Copy className="mr-1 h-3.5 w-3.5" />
                  Duplizieren
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={sortMode !== "manual" || manualIndex <= 0}
                  onClick={() => void move("up")}
                  title={sortMode !== "manual" ? "Nur bei Sortierung „Manuell“" : undefined}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={
                    sortMode !== "manual" ||
                    manualIndex < 0 ||
                    manualIndex >= filteredSorted.length - 1
                  }
                  onClick={() => void move("down")}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={() => void deleteCurrent()}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  Löschen
                </Button>
                {dirty ? (
                  <span className="text-xs text-amber-600 dark:text-amber-400">Ungespeichert</span>
                ) : null}
              </div>

              {selected ? (
                <AccountOverrideActions
                  row={selected}
                  scope={scope}
                  onCreateOverride={async (row, accountId) => {
                    const id = await createPromptAccountOverride(selected, accountId)
                    const rows = await load()
                    const created = rows?.find((p) => p.id === id)
                    if (created) selectPrompt(created)
                    toast.success("Konto-Override angelegt.")
                  }}
                  onResetOverride={async (row) => {
                    await resetPromptAccountOverride(row.id)
                    toast.success("Auf globalen Eintrag zurückgesetzt.")
                    const rows = await load()
                    const next = rows?.[0]
                    if (next) selectPrompt(next)
                    else setSelectedId(null)
                  }}
                />
              ) : null}

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
                <div className="space-y-1.5">
                  <Label htmlFor="prompt-label">Bezeichnung</Label>
                  <Input
                    id="prompt-label"
                    value={label}
                    onChange={(e) => {
                      setLabel(e.target.value)
                      setDirty(true)
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>KI-Profil</Label>
                  <Select
                    value={
                      profileId != null && profileId > 0
                        ? String(profileId)
                        : DEFAULT_PROFILE_VALUE
                    }
                    onValueChange={(v) => {
                      setProfileId(
                        v === DEFAULT_PROFILE_VALUE ? null : Number(v),
                      )
                      setDirty(true)
                    }}
                  >
                    <SelectTrigger id="prompt-profile">
                      <SelectValue placeholder="Standard-Profil" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={DEFAULT_PROFILE_VALUE}>
                        Standard-Profil (Standard)
                      </SelectItem>
                      {aiProfiles.map((pr) => (
                        <SelectItem key={pr.id} value={String(pr.id)}>
                          {pr.label}
                          {pr.isDefault ? " · Standard" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    API-Key und Modell kommen aus dem gewählten Profil (Tab „KI-Profil“).
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="prompt-template">Prompt-Text</Label>
                  <Textarea
                    id="prompt-template"
                    value={userTemplate}
                    onChange={(e) => {
                      setUserTemplate(e.target.value)
                      setDirty(true)
                    }}
                    className="min-h-[280px] font-mono text-sm"
                    spellCheck={false}
                  />
                </div>
                <div className="rounded-md border bg-muted/30 p-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Platzhalter</p>
                  <div className="flex flex-wrap gap-1.5">
                    {PLACEHOLDERS.map((ph) => (
                      <button
                        key={ph}
                        type="button"
                        className="rounded bg-background px-2 py-0.5 font-mono text-[11px] shadow-sm hover:bg-muted"
                        onClick={() => {
                          setUserTemplate((t) => (t ? `${t} ${ph}` : ph))
                          setDirty(true)
                        }}
                      >
                        {ph}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
