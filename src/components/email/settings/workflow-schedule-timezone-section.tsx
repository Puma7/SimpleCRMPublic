"use client"

import { useMemo } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Props = {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

/**
 * Zeitzone der Zeitplan-Workflows (nur Server; sync_info
 * workflow_schedule_timezone, Standard Europe/Berlin). Der Server-Container
 * laeuft in UTC — ohne diese Einstellung liefe „0 6 * * *" dort um 06:00 UTC.
 * Der Desktop plant in der Zeitzone des Rechners und zeigt das Feld nicht.
 * Gespeichert wird ueber „Workflow-Optionen speichern" des Automatisierung-Panels.
 */
export function WorkflowScheduleTimezoneSection({ value, onChange, disabled }: Props) {
  const zones = useMemo(() => {
    try {
      return typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : []
    } catch {
      return []
    }
  }, [])
  return (
    <div className="space-y-1.5 rounded-lg border p-4">
      <Label htmlFor="workflow-schedule-timezone">Zeitzone für Zeitplan-Workflows</Label>
      <p className="text-xs text-muted-foreground">
        Cron-Ausdrücke der Zeitplan-Workflows gelten in dieser Zeitzone, inklusive Sommer- und
        Winterzeit (z. B. Europe/Berlin). Verpasste Zeitpunkte holt der Server nur bis 15 Minuten
        nach.
      </p>
      <Input
        id="workflow-schedule-timezone"
        value={value}
        disabled={disabled}
        list="workflow-schedule-timezones"
        onChange={(event) => onChange(event.target.value)}
        placeholder="Europe/Berlin"
        className="max-w-xs"
      />
      <datalist id="workflow-schedule-timezones">
        {zones.map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>
    </div>
  )
}
