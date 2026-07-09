"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  getTranslationSettings,
  saveTranslationSettings,
  DEFAULT_TRANSLATION_SETTINGS,
} from "@/lib/translation-settings"

/** Configure the local language (incoming → read) and the frequent target
 *  languages (outgoing → send) used by the AI translate actions. */
export function TranslationSettingsSection() {
  const initial = getTranslationSettings()
  const [localLanguage, setLocalLanguage] = useState(initial.localLanguage)
  const [targets, setTargets] = useState<string[]>(initial.targetLanguages)
  const [newTarget, setNewTarget] = useState("")

  const addTarget = () => {
    const value = newTarget.trim()
    if (!value) return
    if (targets.some((t) => t.toLowerCase() === value.toLowerCase())) {
      setNewTarget("")
      return
    }
    setTargets((prev) => [...prev, value])
    setNewTarget("")
  }

  const removeTarget = (value: string) => {
    setTargets((prev) => prev.filter((t) => t !== value))
  }

  const save = () => {
    const local = localLanguage.trim() || DEFAULT_TRANSLATION_SETTINGS.localLanguage
    const list = targets.length > 0 ? targets : DEFAULT_TRANSLATION_SETTINGS.targetLanguages
    saveTranslationSettings({ localLanguage: local, targetLanguages: list })
    setLocalLanguage(local)
    setTargets(list)
    toast.success("Übersetzungs-Einstellungen gespeichert")
  }

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      <div>
        <h4 className="text-sm font-semibold">Übersetzung</h4>
        <p className="text-xs text-muted-foreground">
          Sprachen für die KI-Übersetzung. Eingehende Kundentexte werden in deine lokale Sprache
          übersetzt; für ausgehende Texte kannst du aus den Zielsprachen wählen.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="translate-local">Meine Sprache (eingehend)</Label>
        <Input
          id="translate-local"
          className="max-w-xs"
          value={localLanguage}
          onChange={(e) => setLocalLanguage(e.target.value)}
          placeholder="z. B. Deutsch"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Zielsprachen (ausgehend)</Label>
        <div className="flex flex-wrap gap-1.5">
          {targets.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2 py-0.5 text-[11px]"
            >
              {t}
              <button
                type="button"
                className="text-muted-foreground hover:text-destructive"
                aria-label={`${t} entfernen`}
                onClick={() => removeTarget(t)}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {targets.length === 0 ? (
            <span className="text-[11px] text-muted-foreground">— keine —</span>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          <Input
            className="h-8 max-w-xs"
            value={newTarget}
            onChange={(e) => setNewTarget(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                addTarget()
              }
            }}
            placeholder="Sprache hinzufügen (z. B. Portugiesisch)"
          />
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1" onClick={addTarget}>
            <Plus className="h-3.5 w-3.5" />
            Hinzufügen
          </Button>
        </div>
      </div>

      <Button type="button" size="sm" onClick={save}>
        Speichern
      </Button>
    </div>
  )
}
