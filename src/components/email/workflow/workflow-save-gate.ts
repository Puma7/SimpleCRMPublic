/**
 * Entscheidet, welche Felder ein Workflow-Speichern an den Server schicken darf.
 *
 * Hintergrund: Die API behandelt `triggerName`, `graph`, `enabled`,
 * `executionMode`, `cronExpr`, `scheduleAccountId` und `accountId` als
 * ausfuehrungsrelevant (`patchTouchesOutbound` in workflow-routes). Enthaelt ein
 * PATCH eines AKTIVEN Seiteneffekt-Workflows auch nur eines dieser Felder,
 * verlangt der Server `workflows.manage` — unabhaengig davon, ob sich der Wert
 * tatsaechlich geaendert hat. Ein Nutzer mit `workflows.edit` konnte deshalb an
 * so einem Workflow nicht einmal den Namen anpassen.
 *
 * Regel: unveraenderte ausfuehrungsrelevante Felder gar nicht erst senden
 * (die API patcht per hasOwnProperty, ein fehlendes Feld bleibt unangetastet);
 * bei einer echten Aenderung ohne `workflows.manage` lokal blocken, statt in den
 * 403 zu laufen.
 */
export type WorkflowSaveBaseline = {
  enabled: boolean
  graphJson: string
  cronExpr: string | null
  scheduleAccountId: number | null
  /**
   * Die Prioritaet bestimmt die Ausfuehrungsreihenfolge (und beim Ausgang, wer
   * das Limit pro Versand noch erreicht). Der Server prueft sie deshalb — anders
   * als die uebrigen Felder — auf eine TATSAECHLICHE Aenderung, weil der Editor
   * sie bei jedem Speichern mitsendet.
   */
  priority: number
}

export type WorkflowSaveCandidate = {
  enabled: boolean
  graphJson: string
  cronExpr: string | null
  scheduleAccountId: number | null
  priority: number
}

export type WorkflowSaveGateDecision = {
  /** Mindestens ein ausfuehrungsrelevantes Feld weicht von der Baseline ab. */
  executionChanged: boolean
  /** Ausfuehrungsrelevante Felder aus dem PATCH weglassen (unveraendert). */
  omitExecutionFields: boolean
  /** Speichern lokal abweisen: echte Aenderung ohne workflows.manage. */
  blocked: boolean
}

export function decideWorkflowSaveGate(
  baseline: WorkflowSaveBaseline | null,
  next: WorkflowSaveCandidate,
  options: { canManageWorkflows: boolean; hasSideEffects: boolean },
): WorkflowSaveGateDecision {
  const executionChanged =
    !baseline
    || baseline.graphJson !== next.graphJson
    || baseline.enabled !== next.enabled
    || baseline.cronExpr !== next.cronExpr
    || baseline.scheduleAccountId !== next.scheduleAccountId
    || baseline.priority !== next.priority
  // Spiegelt rejectUnlessSideEffectWorkflowManage: nur aktive Workflows mit
  // Seiteneffekt-Knoten brauchen manage.
  const needsManage = next.enabled && options.hasSideEffects
  const gated = !options.canManageWorkflows && needsManage
  return {
    executionChanged,
    // Nur wenn der Workflow schon AKTIV war, ist ein Weglassen korrekt: sonst
    // wuerde ein Aktivieren stillschweigend verschluckt.
    omitExecutionFields: gated && baseline?.enabled === true && !executionChanged,
    blocked: gated && executionChanged,
  }
}
