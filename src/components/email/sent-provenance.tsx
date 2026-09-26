"use client"

import { Bot, ShieldOff } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  sentByBadgeLabel,
  sentByDescription,
} from "../../../packages/core/src/email/sent-provenance"
import type { EmailMessage } from "./types"

/**
 * Kennzeichnung „gesendet von“ (Teilautomatisierung P3). Eigene Bausteine,
 * damit Nachrichtenliste und Leseansicht nur je eine Zeile einbinden.
 */

type SentProvenanceFields = Pick<
  EmailMessage,
  "sent_by_kind" | "sent_by_label" | "sent_outbound_review_skipped"
>

const SKIPPED_LABEL = "ohne Prüfung"
const SKIPPED_DESCRIPTION = "Ausgangsprüfung übersprungen"

/** Kennzeichen in der Nachrichtenliste; von Menschen gesendete Mails bleiben unmarkiert. */
export function SentProvenanceBadges({ message }: { message: SentProvenanceFields }) {
  const badge = sentByBadgeLabel(message.sent_by_kind)
  const skipped = Boolean(message.sent_outbound_review_skipped)
  if (!badge && !skipped) return null
  const tooltip = message.sent_by_label?.trim() || undefined
  return (
    <>
      {badge ? (
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-medium",
            message.sent_by_kind === "relay"
              ? "bg-slate-500/10 text-slate-700 dark:text-slate-300"
              : "bg-violet-500/10 text-violet-700 dark:text-violet-300",
          )}
          title={tooltip}
          data-testid="sent-provenance-badge"
        >
          {badge}
        </span>
      ) : null}
      {skipped ? (
        <span
          className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:text-amber-300"
          title={SKIPPED_DESCRIPTION}
          data-testid="sent-provenance-skipped-badge"
        >
          {SKIPPED_LABEL}
        </span>
      ) : null}
    </>
  )
}

/** Zeile „Gesendet von …“ in der Leseansicht; Altbestand ohne Kennzeichnung zeigt nichts. */
export function SentProvenanceLine({ message }: { message: SentProvenanceFields }) {
  const description = sentByDescription({
    kind: message.sent_by_kind,
    label: message.sent_by_label,
  })
  const skipped = Boolean(message.sent_outbound_review_skipped)
  if (!description && !skipped) return null
  const automated = message.sent_by_kind != null && message.sent_by_kind !== "human"
  return (
    <p
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
      data-testid="sent-provenance-line"
    >
      {description ? (
        <span className="inline-flex items-center gap-1">
          {automated ? <Bot className="h-3.5 w-3.5" aria-hidden /> : null}
          {description}
        </span>
      ) : null}
      {skipped ? (
        <span className="inline-flex items-center gap-1 text-amber-800 dark:text-amber-300">
          <ShieldOff className="h-3.5 w-3.5" aria-hidden />
          {SKIPPED_DESCRIPTION}
        </span>
      ) : null}
    </p>
  )
}
