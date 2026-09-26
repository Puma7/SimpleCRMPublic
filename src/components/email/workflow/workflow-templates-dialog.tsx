"use client"

import { IPCChannels } from "@shared/ipc/channels"
import type { WorkflowTemplateDto } from "@shared/workflow-types"
import { AlertTriangle, ArrowRight, CheckCircle2, XCircle } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { getRendererTransport, invokeRenderer } from "@/services/transport"
import { useEffect, useMemo, useState } from "react"
import { useWorkflowNodeCatalog } from "./use-workflow-node-catalog"
import { workflowTriggerLabel } from "./trigger-labels"
import {
  aiProfileReadiness,
  learningsCollectEnabled,
  templateCheckRows,
  templatePickEdits,
  UNKNOWN_TEMPLATE_LIVE_CHECKS,
  type TemplateLiveChecks,
} from "./workflow-template-checks"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (template: WorkflowTemplateDto) => void
}

const TEMPLATE_PORT_NOTES: Record<string, string> = {
  "outbound-quality-check":
    "OK → Versand freigeben (autoSend). BLOCK/FEHLER → Entwurf bleibt mit Banner; Tags ki-review-block bzw. ki-review-error.",
  "inbound-spam-ai":
    "Spam-Pipeline: Priorität 1–9 empfohlen. Nach mark_spam → Stopp — Agent-/Antwort-Workflows (ab 50) laufen nicht auf Spam-Mails.",
  "agent-retoure":
    "Nur wenn nicht Spam. Agent-Workflows bitte mit Priorität 50+ hinter Spam-Pipelines (1–9) anlegen.",
  // Teilautomatisierung (TA-P6)
  "inbound-spam-decision":
    "Ja → Spam + Verschieben in den Ordner „Spam“ auf dem Mail-Server + Stopp (klappt das Verschieben nicht, z. B. bei POP3, bleibt die Mail trotzdem Spam). Unsicher → „Spam prüfen“ + Stopp. Nein → keine Kante: Lauf endet, nachfolgende Workflows laufen weiter. KI-Fehler → Tag ki-fehler.",
  "inbound-human-or-ai-reply":
    "Ja/Unsicher/KI-Fehler → Tag manuell. Nein → Gate: Erlaubt → Entwurf → Gegenprüfung (Senden → Versand mit Ausgangsprüfung; Prüfen → Tag ki-freigabe + Aufgabe); Blockiert → Tag ki-manuell. Spam-Mails werden übersprungen.",
  "outbound-decision-before-send":
    "Ja → Versand freigeben (autoSend). Nein/Unsicher/KI-Fehler → Versand bleibt angehalten (Hinweis „Versand blockiert“), zusätzlich Tag ausgang-blockiert.",
  "learnings-weekly-digest":
    "Zeitplan Mo 06:00 (0 6 * * 1) wird beim Laden unter „Erweitert → Cron“ eingetragen. Ergebnis: Vorschlag unter Einstellungen → Learnings.",
}

function CheckRow({
  id,
  ok,
  label,
  hint,
}: {
  id: string
  ok: boolean | null
  label: string
  hint: string
}) {
  return (
    <li
      className="flex items-start gap-1.5 text-[11px]"
      data-check={id}
      data-state={ok === true ? "ok" : ok === false ? "missing" : "unknown"}
    >
      {ok === true ? (
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
      ) : ok === false ? (
        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-600" />
      ) : (
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      )}
      <span>
        <span className={ok === false ? "font-medium text-rose-700 dark:text-rose-400" : ""}>
          {label}
        </span>{" "}
        <span className="text-muted-foreground">{hint}</span>
      </span>
    </li>
  )
}

export function WorkflowTemplatesDialog({ open, onOpenChange, onPick }: Props) {
  const [templates, setTemplates] = useState<WorkflowTemplateDto[]>([])
  const [checks, setChecks] = useState<TemplateLiveChecks>(UNKNOWN_TEMPLATE_LIVE_CHECKS)
  const { labelByType } = useWorkflowNodeCatalog()
  const serverClientMode = getRendererTransport().kind === "http"

  useEffect(() => {
    if (!open) return
    void invokeRenderer(IPCChannels.Email.ListWorkflowTemplates).then((items) => {
      setTemplates(items as WorkflowTemplateDto[])
    })
    // Live-Checks für die Voraussetzungs-Anzeige (best effort).
    void invokeRenderer(IPCChannels.Email.ListAiProfiles)
      .then((rows) => setChecks((c) => ({ ...c, ...aiProfileReadiness(rows) })))
      .catch(() => setChecks((c) => ({ ...c, chatProfileReady: null, decideProfileReady: null })))
    void invokeRenderer(IPCChannels.Email.ListKnowledgeBases)
      .then((rows) => setChecks((c) => ({ ...c, knowledgeBaseReady: Array.isArray(rows) && rows.length > 0 })))
      .catch(() => setChecks((c) => ({ ...c, knowledgeBaseReady: null })))
    void invokeRenderer(IPCChannels.Email.GetLearningsOverview)
      .then((overview) => setChecks((c) => ({ ...c, learningsCollectEnabled: learningsCollectEnabled(overview) })))
      .catch(() => setChecks((c) => ({ ...c, learningsCollectEnabled: null })))
    void invokeRenderer(IPCChannels.Email.ListCannedResponses)
      .then((rows) => setChecks((c) => ({ ...c, cannedReady: Array.isArray(rows) && rows.length > 0 })))
      .catch(() => setChecks((c) => ({ ...c, cannedReady: null })))
    void invokeRenderer(IPCChannels.Email.GetWorkflowAutomationSettings)
      .then((s) =>
        setChecks((c) => ({
          ...c,
          autoReplyEnabled: Boolean((s as { autoReplyEnabled?: boolean })?.autoReplyEnabled),
        })),
      )
      .catch(() => setChecks((c) => ({ ...c, autoReplyEnabled: null })))
  }, [open])

  const nodeChain = useMemo(
    () =>
      (t: WorkflowTemplateDto): string[] => {
        return t.graph.nodes.map((n) => {
          if (n.type === "trigger") {
            return workflowTriggerLabel((n.data as { kind?: string })?.kind)
          }
          if (n.type === "condition") return "Bedingung"
          const nt = (n.data as { nodeType?: string; actionType?: string })?.nodeType
          if (nt) return labelByType.get(nt) ?? nt
          return "Aktion"
        })
      },
    [labelByType],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Workflow-Vorlagen</DialogTitle>
          <DialogDescription>
            Fertige Flows für typische Szenarien — im Editor anpassbar. Die Checkliste zeigt,
            was vor dem ersten Lauf eingerichtet sein muss.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[420px] pr-3">
          <ul className="space-y-2">
            {templates.map((t) => {
              const checkRows = templateCheckRows(t, checks, { serverClientMode })
              const pickEdits = templatePickEdits(t)
              return (
                <li key={t.id} className="rounded-lg border p-3" data-template-id={t.id}>
                  <div className="font-medium">{t.name}</div>
                  <p className="text-sm text-muted-foreground">{t.description}</p>
                  {pickEdits.priority || pickEdits.cronExpr ? (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Beim Laden eingetragen:{" "}
                      {[
                        pickEdits.priority ? `Priorität ${pickEdits.priority}` : null,
                        pickEdits.cronExpr ? `Zeitplan ${pickEdits.cronExpr}` : null,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                  ) : null}
                  {TEMPLATE_PORT_NOTES[t.id] ? (
                    <p className="mt-1 text-[11px] text-muted-foreground">{TEMPLATE_PORT_NOTES[t.id]}</p>
                  ) : null}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                    {nodeChain(t).map((label, i) => (
                      <span key={i} className="flex items-center gap-1">
                        {i > 0 ? <ArrowRight className="h-3 w-3 shrink-0" /> : null}
                        <span className="rounded bg-muted px-1.5 py-0.5">{label}</span>
                      </span>
                    ))}
                  </div>
                  {checkRows.length > 0 ? (
                    <ul className="mt-2 space-y-1 border-t pt-2">
                      {checkRows.map((row) => (
                        <CheckRow key={row.id} id={row.id} ok={row.ok} label={row.label} hint={row.hint} />
                      ))}
                    </ul>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    className="mt-2"
                    onClick={() => {
                      onPick(t)
                      onOpenChange(false)
                    }}
                  >
                    Vorlage laden
                  </Button>
                </li>
              )
            })}
          </ul>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
