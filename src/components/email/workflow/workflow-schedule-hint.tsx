"use client"

import { useMemo } from "react"
import { validateServerWorkflowCronExpr } from "@shared/cron-validate"
import { nextCronSlotAfter } from "../../../../packages/core/src/workflow/cron-schedule"

/**
 * Hinweis unter dem Cron-Feld in der Server-Edition: Fehler im Ausdruck
 * (dieselbe Pruefung wie die Server-Route) oder die naechste Ausfuehrung in
 * der Workspace-Zeitzone. Der Desktop plant mit node-cron in der Zeitzone
 * des Rechners und zeigt den Hinweis nicht.
 */
export function WorkflowScheduleHint({
  cronExpr,
  timeZone,
  now,
}: {
  cronExpr: string
  timeZone: string
  /** Nur fuer Tests; sonst der Zeitpunkt des Renderns. */
  now?: Date
}) {
  const trimmed = cronExpr.trim()
  const hint = useMemo(() => {
    if (!trimmed) {
      return { kind: "info" as const, text: "Ohne Cron-Ausdruck läuft der Zeitplan nicht." }
    }
    const problem = validateServerWorkflowCronExpr(trimmed)
    if (problem) return { kind: "error" as const, text: problem }
    try {
      const next = nextCronSlotAfter(trimmed, now ?? new Date(), timeZone)
      if (!next) return { kind: "info" as const, text: "Keine Ausführung absehbar." }
      const formatted = new Intl.DateTimeFormat("de-DE", {
        timeZone,
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(next)
      return { kind: "info" as const, text: `Nächste Ausführung: ${formatted}` }
    } catch {
      return { kind: "error" as const, text: `Zeitzone „${timeZone}“ ist ungültig.` }
    }
  }, [now, timeZone, trimmed])

  return (
    <div className="space-y-0.5" data-testid="workflow-schedule-hint">
      <p
        className={
          hint.kind === "error"
            ? "text-[11px] text-destructive"
            : "text-[11px] text-muted-foreground"
        }
      >
        {hint.text}
      </p>
      <p className="text-[10px] text-muted-foreground">
        Zeitzone {timeZone} (Einstellungen → Automatisierung). Verpasste Zeitpunkte werden nur
        bis 15 Minuten nachgeholt.
      </p>
    </div>
  )
}
