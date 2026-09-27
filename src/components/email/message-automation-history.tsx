"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, RefreshCw } from "lucide-react"
import { IPCChannels } from "@shared/ipc/channels"
import { stepTone } from "@shared/workflow-run-humanize"
import {
  groupRunsWithContinuations,
  type MessageWorkflowRunSummary,
} from "@shared/workflow-run-message-history"
import { workflowStepPortLabel } from "../../../packages/core/src/workflow/run-step-detail"
import { Button } from "@/components/ui/button"
import { invokeRenderer } from "@/services/transport"
import { TONE_TEXT } from "./workflow/run-tone-styles"
import { WorkflowRunDetailDialog } from "./workflow/workflow-run-detail-dialog"

const STATUS_LABELS: Record<string, string> = {
  completed: "abgeschlossen",
  succeeded: "abgeschlossen",
  ok: "abgeschlossen",
  running: "läuft",
  queued: "wartet",
  blocked: "angehalten",
  error: "Fehler",
  failed: "Fehler",
  skipped: "übersprungen",
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status.trim().toLowerCase()] ?? status
}

function decisionText(decision: NonNullable<MessageWorkflowRunSummary["decision"]>): string {
  const parts = [decision.answer ?? "?"]
  if (decision.probability !== null) parts.push(`${Math.round(decision.probability)} %`)
  const head = `KI: ${parts.join(" · ")}`
  if (!decision.summary) return head
  const summary = decision.summary.length > 120 ? `${decision.summary.slice(0, 120)}…` : decision.summary
  return `${head} — ${summary}`
}

/**
 * „Was ist mit dieser Mail passiert?“ – alle Automatik-Läufe der Mail
 * (Details → Automatik). Fortsetzungen (Server: Folge einer KI-Entscheidung)
 * stehen eingerückt unter ihrem Ursprungslauf; ein Klick öffnet die Schritte.
 */
export function MessageAutomationHistory({ messageId }: { messageId: number }) {
  const [runs, setRuns] = useState<MessageWorkflowRunSummary[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [openRunId, setOpenRunId] = useState<number | null>(null)
  // Späte Antworten für eine vorher gewählte Mail verwerfen.
  const messageIdRef = useRef(messageId)

  const load = useCallback(async () => {
    messageIdRef.current = messageId
    setLoading(true)
    setFailed(false)
    try {
      const result = await invokeRenderer(IPCChannels.Email.ListWorkflowRunsForMessage, { messageId }) as MessageWorkflowRunSummary[]
      if (messageIdRef.current !== messageId) return
      setRuns(result)
    } catch {
      if (messageIdRef.current !== messageId) return
      setRuns(null)
      setFailed(true)
    } finally {
      if (messageIdRef.current === messageId) setLoading(false)
    }
  }, [messageId])

  useEffect(() => {
    setRuns(null)
    void load()
  }, [load])

  const renderRun = (run: MessageWorkflowRunSummary, parent: MessageWorkflowRunSummary | null) => {
    const tone = stepTone(run.status, run.last_step?.port ?? null)
    return (
      <button
        key={`${run.server_id}:${run.id}`}
        type="button"
        className={`w-full rounded-md border px-2 py-1.5 text-left text-xs hover:bg-muted/60 ${parent ? "ml-3 w-[calc(100%-0.75rem)] border-dashed" : ""}`}
        onClick={() => setOpenRunId(run.id)}
        data-testid="automation-run"
      >
        {parent ? (
          <p className="text-[11px] text-muted-foreground">Fortsetzung von Lauf #{parent.id}</p>
        ) : null}
        <p className="flex items-center justify-between gap-2">
          <span className="truncate font-medium">
            {run.workflow_name}
            {run.dry_run ? (
              <span
                className="ml-1.5 rounded border px-1 text-[10px] font-normal text-muted-foreground"
                title="Testlauf – ohne Seiteneffekte, zählt nicht in Statistiken"
              >
                Test
              </span>
            ) : null}
          </span>
          <span className={`shrink-0 ${TONE_TEXT[tone]}`}>{statusLabel(run.status)}</span>
        </p>
        {run.last_step ? (
          <p className="text-muted-foreground">
            Ausgang: {workflowStepPortLabel(run.last_step.port, run.last_step.node_type)}
          </p>
        ) : null}
        {run.decision ? <p className="text-muted-foreground">{decisionText(run.decision)}</p> : null}
      </button>
    )
  }

  return (
    <div className="space-y-2" data-testid="message-automation-history">
      <div className="flex justify-end">
        <Button type="button" size="sm" variant="ghost" className="h-6 gap-1 px-2 text-[11px]" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="h-3 w-3" />
          Aktualisieren
        </Button>
      </div>
      {loading && runs === null ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Wird geladen …
        </p>
      ) : failed ? (
        <p className="text-xs text-muted-foreground">Automatik-Läufe konnten nicht geladen werden.</p>
      ) : runs && runs.length === 0 ? (
        <p className="text-xs text-muted-foreground">Noch keine Automatik-Läufe für diese Mail.</p>
      ) : runs ? (
        <div className="space-y-1.5">
          {groupRunsWithContinuations(runs).map((group) => (
            <div key={`group-${group.run.server_id}`} className="space-y-1">
              {renderRun(group.run, null)}
              {group.continuations.map((continuation) => renderRun(continuation, group.run))}
            </div>
          ))}
        </div>
      ) : null}
      {/* Erst beim Öffnen einhängen: der Dialog lädt beim Einhängen den Knotenkatalog. */}
      {openRunId !== null ? (
        <WorkflowRunDetailDialog
          runId={openRunId}
          open
          onOpenChange={(open) => {
            if (!open) setOpenRunId(null)
          }}
        />
      ) : null}
    </div>
  )
}
