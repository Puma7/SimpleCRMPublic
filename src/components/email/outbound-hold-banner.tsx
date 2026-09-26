"use client"

import { toast } from "sonner"
import { IPCChannels } from "@shared/ipc/channels"
import { invokeRenderer } from "@/services/transport"
import { Button } from "@/components/ui/button"
import { OUTBOUND_HOLD_FALLBACK_REASON } from "../../../packages/core/src/email/outbound-review-parse"
import { OutboundReviewSkipButton } from "./outbound-review-skip-button"
import { useOutboundReviewSkipAllowed } from "./hooks/use-outbound-review-skip"
import type { EmailMessage } from "./types"

type Props = {
  message: Pick<EmailMessage, "id" | "outbound_block_reason">
  /** Die Run-Endpunkte verlangen workflows.view; ohne die Stufe endet der Diagnosepfad im 403. */
  canViewWorkflows: boolean
  onShowWorkflowRun: (runId: number) => void
  /** Nach „Ohne Ausgangsprüfung senden“: Liste/Auswahl aktualisieren. */
  onSent: () => void | Promise<void>
}

/**
 * Gelber Hinweis „Versand blockiert“ an einem vom Ausgang angehaltenen Entwurf:
 * Grund (leer ⇒ einheitlicher Fallback-Text), Workflow-Details und — wenn die
 * Einstellung es für die Rolle erlaubt — „Ohne Ausgangsprüfung senden“.
 */
export function OutboundHoldBanner({ message, canViewWorkflows, onShowWorkflowRun, onSent }: Props) {
  const skipAllowed = useOutboundReviewSkipAllowed()

  const showWorkflowDetails = async () => {
    try {
      const run = await invokeRenderer(IPCChannels.Email.GetLatestWorkflowRunForMessage, {
        messageId: message.id,
      }) as { id: number } | null
      if (run?.id) {
        onShowWorkflowRun(run.id)
      } else {
        toast.info("Kein Workflow-Lauf für diese Nachricht gefunden.")
      }
    } catch {
      toast.error("Workflow-Details konnten nicht geladen werden.")
    }
  }

  return (
    <div
      role="alert"
      className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200"
    >
      <p className="font-semibold">Ausgangsprüfung — Versand blockiert</p>
      <p className="mt-1 text-[13px] leading-snug">
        {message.outbound_block_reason || OUTBOUND_HOLD_FALLBACK_REASON}
      </p>
      {canViewWorkflows || skipAllowed ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {canViewWorkflows ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => void showWorkflowDetails()}
            >
              Workflow-Details ansehen
            </Button>
          ) : null}
          {skipAllowed ? (
            <OutboundReviewSkipButton
              draftId={message.id}
              className="h-7 text-xs"
              onSent={onSent}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
