"use client"

import { Label } from "@/components/ui/label"
import type { OutboundReviewSkipPolicy } from "../../../../packages/core/src/email/outbound-review-skip"

const OPTIONS: ReadonlyArray<{ value: OutboundReviewSkipPolicy; label: string }> = [
  { value: "all", label: "Alle, die senden dürfen (Standard)" },
  { value: "admins", label: "Nur Owner und Admin" },
  { value: "none", label: "Niemand" },
]

type Props = {
  policy: OutboundReviewSkipPolicy
  onPolicyChange: (policy: OutboundReviewSkipPolicy) => void
  disabled?: boolean
}

/**
 * Wer darf einen vom Ausgang angehaltenen Entwurf „Ohne Ausgangsprüfung
 * senden“? Gespeichert über „Workflow-Optionen speichern“ (sync_info
 * outbound_review_skip_policy); Server und Desktop setzen es selbst durch.
 */
export function OutboundReviewSkipSettingsSection({ policy, onPolicyChange, disabled }: Props) {
  return (
    <div className="space-y-1.5 rounded-lg border p-4">
      <Label htmlFor="outbound-review-skip-policy" className="text-sm font-semibold">
        Ausgangsprüfung überspringen erlauben
      </Label>
      <p className="text-xs text-muted-foreground">
        Hält ein Ausgangs-Workflow eine E-Mail an, kann sie mit „Ohne Ausgangsprüfung senden“
        trotzdem verschickt werden. Jeder solche Versand wird protokolliert und an der Mail als
        „Ausgangsprüfung übersprungen“ gekennzeichnet.
      </p>
      <select
        id="outbound-review-skip-policy"
        className="h-9 w-full max-w-sm rounded-md border bg-background px-3 text-sm"
        value={policy}
        disabled={disabled}
        onChange={(event) => onPolicyChange(event.target.value as OutboundReviewSkipPolicy)}
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  )
}
