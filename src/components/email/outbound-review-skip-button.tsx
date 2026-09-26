"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { IPCChannels } from "@shared/ipc/channels"
import { invokeRenderer } from "@/services/transport"
import { Button, type ButtonProps } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

export const OUTBOUND_REVIEW_SKIP_LABEL = "Ohne Ausgangsprüfung senden"
export const OUTBOUND_REVIEW_SKIP_CONFIRM_TEXT =
  "Die Ausgangs-Workflows werden für diese E-Mail übersprungen. Der Versand wird protokolliert."

export type OutboundReviewSkipResult = {
  success: boolean
  error?: string
  warning?: string
  recoveredSentAppend?: boolean
}

type Props = {
  draftId: number
  /** Vor dem Versand ausführen (Entwurfsfenster: Entwurf speichern). false = abbrechen. */
  beforeSend?: () => Promise<boolean>
  onSent?: (result: OutboundReviewSkipResult) => void | Promise<void>
  disabled?: boolean
  size?: ButtonProps["size"]
  variant?: ButtonProps["variant"]
  className?: string
}

/**
 * Knopf „Ohne Ausgangsprüfung senden“ mit Rückfrage. Sichtbarkeit (Einstellung,
 * Rolle, angehaltener Entwurf) entscheidet der Aufrufer.
 */
export function OutboundReviewSkipButton({
  draftId,
  beforeSend,
  onSent,
  disabled,
  size = "sm",
  variant = "outline",
  className,
}: Props) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const send = async () => {
    if (busy) return
    setBusy(true)
    try {
      if (beforeSend && !(await beforeSend())) return
      const result = await invokeRenderer(IPCChannels.Email.SendDraftSkipOutboundReview, {
        draftId,
      }) as OutboundReviewSkipResult
      if (!result?.success) {
        toast.error(result?.error ?? "Versand fehlgeschlagen.")
        return
      }
      if (result.recoveredSentAppend) {
        toast.success("Nachricht wurde nachträglich in „Gesendet“ übernommen.")
      } else if (result.warning) {
        toast.warning(result.warning)
      } else {
        toast.success("E-Mail ohne Ausgangsprüfung gesendet.")
      }
      setOpen(false)
      await onSent?.(result)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Versand fehlgeschlagen.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        size={size}
        variant={variant}
        className={className}
        disabled={disabled || busy}
        onClick={() => setOpen(true)}
      >
        {busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
        {OUTBOUND_REVIEW_SKIP_LABEL}
      </Button>
      <AlertDialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ohne Ausgangsprüfung senden?</AlertDialogTitle>
            <AlertDialogDescription>{OUTBOUND_REVIEW_SKIP_CONFIRM_TEXT}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                // Dialog erst nach dem Versand schließen (Fehler bleiben sichtbar).
                event.preventDefault()
                void send()
              }}
            >
              {busy ? "Wird gesendet …" : "Senden"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
