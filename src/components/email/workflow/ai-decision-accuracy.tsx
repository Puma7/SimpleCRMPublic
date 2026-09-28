"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2, RefreshCw } from "lucide-react"
import { IPCChannels } from "@shared/ipc/channels"
import { invokeRenderer } from "@/services/transport"
import { Button } from "@/components/ui/button"
import { normalizeAiDecideThreshold } from "../../../../packages/core/src/workflow/ai-decide"
import {
  AI_DECISION_STATS_DAYS,
  normalizeAiDecisionFeedbackSignal,
  type AiDecisionStats,
} from "../../../../packages/core/src/workflow/ai-decision-accuracy"

/**
 * Plan 050: „Treffsicherheit (90 Tage)“ in den Einstellungen eines
 * `ai.decide`-Knotens. Nur Kennzahlen; „Übernehmen“ ändert allein die Schwelle
 * im Editor – gespeichert wird wie immer von Hand, nichts ändert das Routing
 * automatisch (docs/design/ai-decision-accuracy.md).
 */
export function AiDecisionAccuracyPanel({
  workflowId,
  nodeId,
  config,
  onApplyThreshold,
}: {
  /** Gespeicherter Workflow; ohne Id (neu, nie gespeichert) gibt es noch keine Zahlen. */
  workflowId: number | null
  nodeId: string
  config: Record<string, unknown>
  onApplyThreshold: (threshold: number) => void
}) {
  const [stats, setStats] = useState<AiDecisionStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const feedbackSignal = normalizeAiDecisionFeedbackSignal(config.feedbackSignal)
  const currentThreshold = normalizeAiDecideThreshold(config.threshold)

  const load = useCallback(async () => {
    if (workflowId == null || workflowId <= 0) {
      setStats(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await invokeRenderer(IPCChannels.Email.GetAiDecisionStats, {
        workflowId,
        nodeId,
        days: AI_DECISION_STATS_DAYS,
      }) as AiDecisionStats
      setStats(result)
    } catch (e) {
      setStats(null)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [workflowId, nodeId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-2 rounded-md border p-2 text-[11px] leading-relaxed" data-testid="ai-decision-accuracy">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium">Treffsicherheit ({AI_DECISION_STATS_DAYS} Tage)</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2"
          onClick={() => void load()}
          disabled={loading || workflowId == null || workflowId <= 0}
          aria-label="Treffsicherheit neu laden"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        </Button>
      </div>
      {feedbackSignal === "none" ? (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-1.5" data-testid="ai-decision-feedback-hint">
          Rückmeldung wählen, damit Korrekturen gezählt werden. Ohne „Rückmeldung für die Treffsicherheit“
          gibt es nur die Verteilung der Antworten, keine Übereinstimmung und keinen Schwellen-Vorschlag.
        </p>
      ) : null}
      {workflowId == null || workflowId <= 0 ? (
        <p className="text-muted-foreground">Zahlen gibt es, sobald der Workflow gespeichert ist und läuft.</p>
      ) : error ? (
        <p className="text-destructive">Kennzahlen nicht verfügbar: {error}</p>
      ) : stats ? (
        <AccuracyNumbers stats={stats} currentThreshold={currentThreshold} onApplyThreshold={onApplyThreshold} />
      ) : loading ? null : (
        <p className="text-muted-foreground">Noch keine Entscheidungen.</p>
      )}
    </div>
  )
}

function percent(value: number): string {
  return `${Math.round(value * 100)} %`
}

function AccuracyNumbers({
  stats,
  currentThreshold,
  onApplyThreshold,
}: {
  stats: AiDecisionStats
  currentThreshold: number
  onApplyThreshold: (threshold: number) => void
}) {
  if (stats.total === 0) {
    return <p className="text-muted-foreground">Noch keine Entscheidungen in diesem Zeitraum.</p>
  }
  const maxBucket = Math.max(1, ...stats.histogram)
  const suggestion = stats.suggestedThreshold
  return (
    <div className="space-y-1.5">
      <p>
        {stats.total} Entscheidungen · Ja {stats.byAnswer.ja} · Nein {stats.byAnswer.nein} · Unsicher{" "}
        {stats.byAnswer.unsicher} · KI-Fehler {stats.byAnswer.error}
      </p>
      <p data-testid="ai-decision-agreement">
        {stats.agreementRate === null
          ? "Übereinstimmung mit Menschen: noch keine abgeschlossenen Ja/Nein-Fälle (Korrektur oder 30 Tage ohne)."
          : `Übereinstimmung mit Menschen: ${percent(stats.agreementRate)} (${stats.agreed} bestätigt, ${stats.overridden} korrigiert)`}
      </p>
      <div aria-label="Verteilung der Ja-Wahrscheinlichkeit" className="space-y-0.5">
        <div className="flex h-10 items-end gap-0.5">
          {stats.histogram.map((count, index) => (
            <div
              key={index}
              title={`${index * 10}–${index === 9 ? 100 : index * 10 + 9} %: ${count}`}
              className="flex-1 rounded-sm bg-primary/60"
              style={{ height: `${Math.max(count > 0 ? 8 : 2, Math.round((count / maxBucket) * 100))}%` }}
            />
          ))}
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>0 %</span>
          <span>Ja-Wahrscheinlichkeit</span>
          <span>100 %</span>
        </div>
      </div>
      {suggestion === null ? (
        <p className="text-muted-foreground" data-testid="ai-decision-suggestion">
          {stats.labelled < stats.minSamples
            ? `Schwellen-Vorschlag ab ${stats.minSamples} Fällen mit bekannter Antwort (bisher ${stats.labelled}).`
            : "Keine Schwelle erreicht höchstens 5 % falsche automatische Antworten."}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2" data-testid="ai-decision-suggestion">
          <span>
            Vorschlag: Schwelle {suggestion} (aktuell {currentThreshold}; höchstens 5 % falsche automatische
            Antworten bei {stats.labelled} Fällen)
          </span>
          {suggestion !== currentThreshold ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px]"
              onClick={() => onApplyThreshold(suggestion)}
            >
              Übernehmen
            </Button>
          ) : null}
        </div>
      )}
      <p className="text-[10px] text-muted-foreground">
        „Übernehmen“ ändert nur die Einstellung im Editor; gespeichert wird wie immer mit „Speichern“.
      </p>
    </div>
  )
}
