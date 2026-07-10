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
import { invokeRenderer } from "@/services/transport"
import { useEffect, useMemo, useState } from "react"
import { useWorkflowNodeCatalog } from "./use-workflow-node-catalog"
import { workflowTriggerLabel } from "./trigger-labels"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (template: WorkflowTemplateDto) => void
}

type LiveChecks = {
  aiProfileReady: boolean | null
  cannedReady: boolean | null
  autoReplyEnabled: boolean | null
}

/** Welche Live-Voraussetzungen betreffen dieses Template? (aus den Node-Typen abgeleitet) */
function requiredChecksFor(template: WorkflowTemplateDto): {
  needsAi: boolean
  needsCanned: boolean
  needsAutoReplySwitch: boolean
} {
  const types = new Set(
    template.graph.nodes
      .map((n) => (n.data as { nodeType?: string })?.nodeType)
      .filter((t): t is string => typeof t === "string"),
  )
  const needsAi = [...types].some((t) => t.startsWith("ai."))
  const needsCanned = types.has("ai.pick_canned")
  const needsAutoReplySwitch = types.has("email.auto_reply") || types.has("email.send_draft")
  return { needsAi, needsCanned, needsAutoReplySwitch }
}

function CheckRow({
  ok,
  label,
  hint,
}: {
  ok: boolean | null
  label: string
  hint: string
}) {
  return (
    <li className="flex items-start gap-1.5 text-[11px]">
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
  const [checks, setChecks] = useState<LiveChecks>({
    aiProfileReady: null,
    cannedReady: null,
    autoReplyEnabled: null,
  })
  const { labelByType } = useWorkflowNodeCatalog()

  useEffect(() => {
    if (!open) return
    void invokeRenderer(IPCChannels.Email.ListWorkflowTemplates).then((items) => {
      setTemplates(items as WorkflowTemplateDto[])
    })
    // Live-Checks für die Voraussetzungs-Anzeige (best effort).
    void invokeRenderer(IPCChannels.Email.ListAiProfiles)
      .then((rows) => setChecks((c) => ({ ...c, aiProfileReady: Array.isArray(rows) && rows.length > 0 })))
      .catch(() => setChecks((c) => ({ ...c, aiProfileReady: null })))
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
              const req = requiredChecksFor(t)
              const hasChecks = req.needsAi || req.needsCanned || req.needsAutoReplySwitch
              return (
                <li key={t.id} className="rounded-lg border p-3">
                  <div className="font-medium">{t.name}</div>
                  <p className="text-sm text-muted-foreground">{t.description}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                    {nodeChain(t).map((label, i) => (
                      <span key={i} className="flex items-center gap-1">
                        {i > 0 ? <ArrowRight className="h-3 w-3 shrink-0" /> : null}
                        <span className="rounded bg-muted px-1.5 py-0.5">{label}</span>
                      </span>
                    ))}
                  </div>
                  {hasChecks ? (
                    <ul className="mt-2 space-y-1 border-t pt-2">
                      {req.needsAi ? (
                        <CheckRow
                          ok={checks.aiProfileReady}
                          label="KI-Profil mit API-Schlüssel"
                          hint="(Einstellungen → E-Mail → KI)"
                        />
                      ) : null}
                      {req.needsCanned ? (
                        <CheckRow
                          ok={checks.cannedReady}
                          label="Mindestens ein Textbaustein"
                          hint="(Einstellungen → E-Mail → Textbausteine)"
                        />
                      ) : null}
                      {req.needsAutoReplySwitch ? (
                        <CheckRow
                          ok={checks.autoReplyEnabled}
                          label="Auto-Antwort-Schalter aktiviert"
                          hint="(Einstellungen → Automatisierung — sonst wird nie automatisch gesendet)"
                        />
                      ) : null}
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
