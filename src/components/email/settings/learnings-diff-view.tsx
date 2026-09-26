"use client"

import { useMemo } from "react"
import { diffText, summarizeTextDiff } from "@shared/ai-learnings"
import { cn } from "@/lib/utils"

type Props = {
  /** Aktueller Stand der Wissensbasis. */
  before: string
  /** Vorgeschlagene (ggf. bearbeitete) neue Fassung. */
  after: string
  className?: string
}

/**
 * Änderungsansicht der kompletten neuen Wissensbasis (TA-P5): Entferntes rot
 * durchgestrichen, Neues grün hinterlegt. Lesbar in Hell und Dunkel; ins/del
 * tragen die Bedeutung zusätzlich für Screenreader.
 */
export function LearningsDiffView({ before, after, className }: Props) {
  const segments = useMemo(() => diffText(before, after), [before, after])
  const summary = useMemo(() => summarizeTextDiff(segments), [segments])
  const unchanged = segments.every((segment) => segment.type === "equal")

  return (
    <div className={cn("space-y-2", className)}>
      <p className="text-xs text-muted-foreground" data-testid="learnings-diff-summary">
        {unchanged
          ? "Keine Änderungen gegenüber der aktuellen Wissensbasis."
          : `${summary.inserted} Wörter neu · ${summary.deleted} Wörter entfernt`}
      </p>
      <pre
        className="max-h-[min(480px,calc(100vh-18rem))] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-background p-3 font-mono text-[13px] leading-relaxed text-foreground"
        aria-label="Änderungen an der Wissensbasis"
      >
        {segments.map((segment, index) => {
          if (segment.type === "equal") return <span key={index}>{segment.text}</span>
          if (segment.type === "delete") {
            return (
              <del
                key={index}
                title="entfernt"
                className="rounded-sm bg-red-500/15 text-red-800 line-through decoration-red-600/70 dark:bg-red-500/20 dark:text-red-200 dark:decoration-red-300/70"
              >
                {segment.text}
              </del>
            )
          }
          return (
            <ins
              key={index}
              title="neu"
              className="rounded-sm bg-emerald-500/20 text-emerald-900 no-underline dark:bg-emerald-400/20 dark:text-emerald-100"
            >
              {segment.text}
            </ins>
          )
        })}
      </pre>
    </div>
  )
}
