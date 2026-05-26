"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import type { ReplySuggestionSettings } from "@shared/reply-suggestion-settings"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { hasElectron, invokeIpc } from "../types"

type CategoryRow = { id: number; name: string }

type Props = {
  /** Fehlt = globale Standardwerte für alle Postfächer. */
  accountId?: number
}

export function ReplySuggestionSettingsSection({ accountId }: Props) {
  const [settings, setSettings] = useState<ReplySuggestionSettings | null>(null)
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const perAccount = accountId != null

  const load = useCallback(async () => {
    if (!hasElectron()) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [s, cats] = await Promise.all([
        invokeIpc<ReplySuggestionSettings>(IPCChannels.Email.GetReplySuggestionSettings, {
          accountId,
        }),
        invokeIpc<CategoryRow[]>(IPCChannels.Email.ListCategories),
      ])
      setSettings(s)
      setCategories(cats ?? [])
    } catch (e) {
      console.error(e)
      toast.error("Einstellungen für Antwortvorschläge konnten nicht geladen werden.")
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    void load()
  }, [load])

  const patch = (partial: Partial<ReplySuggestionSettings>) => {
    setSettings((prev) => (prev ? { ...prev, ...partial } : prev))
  }

  const toggleCategory = (categoryId: number, checked: boolean) => {
    setSettings((prev) => {
      if (!prev) return prev
      const ids = new Set(prev.categoryIds)
      if (checked) ids.add(categoryId)
      else ids.delete(categoryId)
      return { ...prev, categoryIds: [...ids] }
    })
  }

  const save = async () => {
    if (!hasElectron() || !settings || saving) return
    setSaving(true)
    try {
      const saved = await invokeIpc<ReplySuggestionSettings>(
        IPCChannels.Email.SetReplySuggestionSettings,
        { ...settings, accountId },
      )
      setSettings(saved)
      toast.success(
        perAccount
          ? "Konto-Einstellungen für Antwortvorschläge gespeichert."
          : "Globale Antwortvorschläge-Einstellungen gespeichert.",
      )
    } catch (e) {
      console.error(e)
      toast.error("Speichern fehlgeschlagen.")
    } finally {
      setSaving(false)
    }
  }

  if (!settings) {
    return (
      <section className="space-y-3 rounded-lg border p-4">
        <h3 className="text-base font-semibold">KI-Antwortvorschläge</h3>
        <p className="text-sm text-muted-foreground">
          {loading ? "Lade Einstellungen…" : "Einstellungen nicht verfügbar."}
        </p>
      </section>
    )
  }

  const manualOnly =
    !settings.autoEnabled || (!settings.triggerOnInbound && !settings.triggerOnOpen)

  return (
    <section className="space-y-4 rounded-lg border p-4">
      <div>
        <h3 className="text-base font-semibold">KI-Antwortvorschläge</h3>
        <p className="text-sm text-muted-foreground">
          {perAccount ? (
            <>
              Gilt nur für dieses Postfach und überschreibt die globalen Standardwerte unter{" "}
              <strong>KI &amp; Automation → KI</strong>, sobald Sie hier speichern. API-Profile und
              Modelle legen Sie global fest.
            </>
          ) : (
            <>
              Globale Standardwerte für alle Postfächer. Pro Posteingang können Sie unter{" "}
              <strong>Konten → KI</strong> abweichende Auslöser und Kategorie-Filter setzen.
            </>
          )}{" "}
          Jede Hintergrund-Generierung verursacht API-Kosten. Manuelles „Antwort entwerfen“ im
          Lesefenster bleibt unabhängig.
        </p>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <Label htmlFor="reply-suggestion-auto">Automatische Vorschläge</Label>
          <p className="text-xs text-muted-foreground">
            Master-Schalter für Hintergrund-Jobs. Aus = nur manuell per Button.
          </p>
        </div>
        <Switch
          id="reply-suggestion-auto"
          checked={settings.autoEnabled}
          disabled={loading}
          onCheckedChange={(v) => patch({ autoEnabled: v })}
        />
      </div>

      <div className="space-y-3 rounded-md bg-muted/40 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Auslöser
        </p>
        <label className="flex items-start gap-3 text-sm">
          <Checkbox
            className="mt-0.5"
            checked={settings.triggerOnInbound}
            disabled={loading || !settings.autoEnabled}
            onCheckedChange={(c) => patch({ triggerOnInbound: c === true })}
          />
          <span>
            <span className="font-medium">Nach Eingang (Sync &amp; Workflows)</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Nach dem Abrufen und den eingehenden Workflows — z. B. wenn eine Mail in eine
              Kategorie sortiert wurde.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <Checkbox
            className="mt-0.5"
            checked={settings.triggerOnOpen}
            disabled={loading || !settings.autoEnabled}
            onCheckedChange={(c) => patch({ triggerOnOpen: c === true })}
          />
          <span>
            <span className="font-medium">Beim Öffnen im Posteingang</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Startet nur, wenn noch kein fertiger Vorschlag existiert (Status „bereit“ wird
              übersprungen).
            </span>
          </span>
        </label>
        {manualOnly ? (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Aktuell nur manuelle Erzeugung über „Antwort entwerfen“ in der Nachricht.
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label>Kategorie-Filter (optional)</Label>
        <Select
          value={settings.categoryMode}
          disabled={loading || !settings.autoEnabled}
          onValueChange={(v) =>
            patch({ categoryMode: v === "only_listed" ? "only_listed" : "any" })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Alle passenden Posteingangs-Mails</SelectItem>
            <SelectItem value="only_listed">Nur ausgewählte Kategorien</SelectItem>
          </SelectContent>
        </Select>
        {settings.categoryMode === "only_listed" ? (
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
            {categories.length === 0 ? (
              <p className="text-xs text-muted-foreground">Keine Kategorien angelegt.</p>
            ) : (
              categories.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={settings.categoryIds.includes(c.id)}
                    disabled={loading || !settings.autoEnabled}
                    onCheckedChange={(checked) => toggleCategory(c.id, checked === true)}
                  />
                  {c.name}
                </label>
              ))
            )}
          </div>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        Unabhängig davon werden keine Vorschläge für Spam, Entwürfe, automatische Absender oder sehr
        kurze Texte erzeugt.
      </p>

      <Button type="button" disabled={loading || saving} onClick={() => void save()}>
        {saving ? "Speichern…" : perAccount ? "Konto-Einstellungen speichern" : "Globale Einstellungen speichern"}
      </Button>
    </section>
  )
}
