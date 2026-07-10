"use client"

import { AlertTriangle } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

type Props = {
  enabled: boolean
  onEnabledChange: (enabled: boolean) => void
  /** Als String, damit das Feld beim Tippen leer sein darf — geparst wird beim Speichern. */
  maxPerDay: string
  onMaxPerDayChange: (value: string) => void
  disabled?: boolean
}

/**
 * Hauptschalter für automatische KI-Antworten (sync_info: auto_reply_enabled).
 * Wird über die Get/SetWorkflowAutomationSettings-Aufrufe des Automatisierung-
 * Panels geladen und gespeichert ("Workflow-Optionen speichern").
 */
export function AutoReplySettingsSection({
  enabled,
  onEnabledChange,
  maxPerDay,
  onMaxPerDayChange,
  disabled,
}: Props) {
  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <Label htmlFor="auto-reply-enabled" className="text-sm font-semibold">
            Automatische KI-Antworten erlauben
          </Label>
          <p className="text-xs text-muted-foreground">
            Hauptschalter für alle automatischen Antworten aus Workflows (Knoten
            „Auto-Antwort (Gate)“ und „Entwurf versenden (vollautomatisch)“). Solange er aus
            ist (Standard), erstellen Workflows höchstens Entwürfe — es wird nichts automatisch
            versendet.
          </p>
        </div>
        <Switch
          id="auto-reply-enabled"
          checked={enabled}
          disabled={disabled}
          onCheckedChange={onEnabledChange}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="auto-reply-max-per-day">
          Max. automatische Antworten pro Absender und Tag
        </Label>
        <p className="text-xs text-muted-foreground">
          Schutz vor Antwort-Schleifen: Erhält dieselbe Absenderadresse an einem Tag schon so
          viele automatische Antworten, wird keine weitere verschickt — sonst könnten sich zwei
          automatische Systeme endlos gegenseitig antworten. Erlaubt sind 1 bis 50, Standard ist 1.
        </p>
        <Input
          id="auto-reply-max-per-day"
          type="number"
          min={1}
          max={50}
          className="w-32"
          value={maxPerDay}
          disabled={disabled}
          onChange={(e) => onMaxPerDayChange(e.target.value)}
        />
      </div>

      {enabled ? (
        <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-xs text-amber-800 dark:text-amber-200">
            Achtung: Auf dem „senden“-Pfad gehen automatische Antworten ohne menschliche Prüfung
            raus. Empfehlung: die Workflow-Vorlage „KI-Antwort mit Gegenprüfung“ verwenden — dort
            prüft eine zweite KI jeden Entwurf, bevor er versendet wird.
          </p>
        </div>
      ) : null}
    </div>
  )
}
