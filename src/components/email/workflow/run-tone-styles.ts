import type { WorkflowStepTone } from "@shared/workflow-run-humanize"

// Farbgebung nach stepTone: ok = Standard, warn = Amber, error = Rose.
// Gemeinsame Quelle für Lauf-Historie und Lauf-Detail-Dialog.
export const TONE_BORDER: Record<WorkflowStepTone, string> = {
  ok: "",
  warn: "border-amber-500/50",
  error: "border-rose-500/50",
}

export const TONE_TEXT: Record<WorkflowStepTone, string> = {
  ok: "text-muted-foreground",
  warn: "text-amber-700 dark:text-amber-400",
  error: "text-rose-700 dark:text-rose-400",
}
