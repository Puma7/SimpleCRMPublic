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
import {
  DEFAULT_SNOOZE_SETTINGS,
  type SnoozeSettings,
} from "@shared/snooze-settings"
import { hasElectron, invokeIpc } from "../types"

const WEEKDAYS = [
  { value: "1", label: "Montag" },
  { value: "2", label: "Dienstag" },
  { value: "3", label: "Mittwoch" },
  { value: "4", label: "Donnerstag" },
  { value: "5", label: "Freitag" },
  { value: "6", label: "Samstag" },
  { value: "0", label: "Sonntag" },
]

function timeInputValue(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

function parseTimeInput(value: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour, minute }
}

export function SnoozeSettingsSection() {
  const [settings, setSettings] = useState<SnoozeSettings>(DEFAULT_SNOOZE_SETTINGS)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!hasElectron()) return
    try {
      const s = await invokeIpc<SnoozeSettings>(IPCChannels.Email.GetSnoozeSettings)
      setSettings(s)
    } catch {
      toast.error("Snooze-Einstellungen konnten nicht geladen werden.")
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    if (!hasElectron()) return
    setSaving(true)
    try {
      const r = await invokeIpc<{ success: boolean }>(
        IPCChannels.Email.SetSnoozeSettings,
        settings,
      )
      if (r.success) toast.success("Snooze-Zeiten gespeichert")
      else toast.error("Speichern fehlgeschlagen")
    } catch {
      toast.error("Speichern fehlgeschlagen")
    } finally {
      setSaving(false)
    }
  }

  const setEvening = (raw: string) => {
    const t = parseTimeInput(raw)
    if (!t) return
    setSettings((s) => ({ ...s, eveningHour: t.hour, eveningMinute: t.minute }))
  }

  const setMorning = (raw: string) => {
    const t = parseTimeInput(raw)
    if (!t) return
    setSettings((s) => ({ ...s, morningHour: t.hour, morningMinute: t.minute }))
  }

  const setNextWeek = (raw: string) => {
    const t = parseTimeInput(raw)
    if (!t) return
    setSettings((s) => ({ ...s, nextWeekHour: t.hour, nextWeekMinute: t.minute }))
  }

  return (
    <section className="space-y-4 rounded-lg border p-4">
      <div>
        <h3 className="text-sm font-semibold">Snooze (Zurückstellen)</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Standardzeiten für E-Mail und Nachverfolgung („Heute Abend“, „Morgen“, „Nächste Woche“).
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="snooze-evening">Heute Abend</Label>
          <Input
            id="snooze-evening"
            type="time"
            value={timeInputValue(settings.eveningHour, settings.eveningMinute)}
            onChange={(e) => setEvening(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="snooze-morning">Morgen</Label>
          <Input
            id="snooze-morning"
            type="time"
            value={timeInputValue(settings.morningHour, settings.morningMinute)}
            onChange={(e) => setMorning(e.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Nächste Woche (Wochentag)</Label>
          <Select
            value={String(settings.nextWeekWeekday)}
            onValueChange={(v) =>
              setSettings((s) => ({ ...s, nextWeekWeekday: Number(v) }))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEEKDAYS.map((d) => (
                <SelectItem key={d.value} value={d.value}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="snooze-next-week-time">Nächste Woche (Uhrzeit)</Label>
          <Input
            id="snooze-next-week-time"
            type="time"
            value={timeInputValue(settings.nextWeekHour, settings.nextWeekMinute)}
            onChange={(e) => setNextWeek(e.target.value)}
          />
        </div>
      </div>

      <Button type="button" size="sm" disabled={saving} onClick={() => void save()}>
        {saving ? "Speichern…" : "Snooze-Zeiten speichern"}
      </Button>
    </section>
  )
}
