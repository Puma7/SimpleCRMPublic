/**
 * Voraussetzungs-Checkliste im Vorlagen-Dialog: welche Prüfungen eine Vorlage
 * braucht (aus ihren Bausteinen und dem Auslöser abgeleitet) und wie die
 * Live-Werte aus den Einstellungen zu lesen sind. Rein, damit Desktop- und
 * Server-Edition (gleicher Renderer, anderer Transport) dieselbe Liste zeigen.
 */
import { isAiDecisionsPresetId } from "@shared/ai-provider-presets"
import type { WorkflowTemplateDto } from "@shared/workflow-types"
import { DESKTOP_ONLY_WORKFLOW_TRIGGERS } from "./trigger-labels"

export type TemplateCheckId =
  | "chatProfile"
  | "decideProfile"
  | "canned"
  | "autoReply"
  | "knowledgeBase"
  | "learningsCollect"
  | "scheduleTrigger"

/** Ein KI-Profil vom Typ Entscheidungsmodell, das „Vorlage laden“ eintragen kann. */
export type DecisionModelProfileRef = { id: number; label: string }

/** Live-Werte; null = unbekannt (Laden fehlgeschlagen oder keine Berechtigung). */
export type TemplateLiveChecks = {
  chatProfileReady: boolean | null
  decideProfileReady: boolean | null
  /** Erstes Entscheidungsmodell mit API-Schlüssel; null = keins (oder unbekannt). */
  decisionModelProfile: DecisionModelProfileRef | null
  cannedReady: boolean | null
  autoReplyEnabled: boolean | null
  knowledgeBaseReady: boolean | null
  learningsCollectEnabled: boolean | null
}

export const UNKNOWN_TEMPLATE_LIVE_CHECKS: TemplateLiveChecks = {
  chatProfileReady: null,
  decideProfileReady: null,
  decisionModelProfile: null,
  cannedReady: null,
  autoReplyEnabled: null,
  knowledgeBaseReady: null,
  learningsCollectEnabled: null,
}

export type TemplateCheckRow = {
  id: TemplateCheckId
  ok: boolean | null
  label: string
  hint: string
}

function templateNodeTypes(template: Pick<WorkflowTemplateDto, "graph">): Set<string> {
  return new Set(
    template.graph.nodes
      .map((n) => (n.data as { nodeType?: string })?.nodeType)
      .filter((t): t is string => typeof t === "string"),
  )
}

/** Welche Prüfungen betreffen diese Vorlage? Reihenfolge = Anzeige. */
export function requiredTemplateChecks(
  template: Pick<WorkflowTemplateDto, "graph" | "trigger">,
): TemplateCheckId[] {
  const types = templateNodeTypes(template)
  const checks: TemplateCheckId[] = []
  // „KI-Entscheidung“ kommt auch mit einem Entscheidungsmodell aus; alle
  // übrigen KI-Bausteine brauchen ein Chat-Modell.
  if ([...types].some((t) => t.startsWith("ai.") && t !== "ai.decide")) checks.push("chatProfile")
  if (types.has("ai.decide")) checks.push("decideProfile")
  if (types.has("ai.pick_canned")) checks.push("canned")
  if (types.has("email.auto_reply") || types.has("email.send_draft")) checks.push("autoReply")
  if (types.has("ai.draft_reply") || types.has("ai.agent")) checks.push("knowledgeBase")
  if (types.has("ai.learnings_digest")) checks.push("learningsCollect")
  if (template.trigger === "schedule") checks.push("scheduleTrigger")
  return checks
}

type AiProfileRowLike = { id?: unknown; label?: unknown; provider?: unknown; hasApiKey?: unknown }

function isDecisionModelRow(p: AiProfileRowLike): boolean {
  return isAiDecisionsPresetId(typeof p.provider === "string" ? p.provider : "")
}

/**
 * KI-Profile aus ListAiProfiles (Desktop-IPC und Server-Transport liefern
 * id, label, provider und hasApiKey). Ein Profil ohne Schlüssel zählt nicht;
 * fehlt das Feld (ältere Antwort), gilt das Profil als eingerichtet.
 */
export function aiProfileReadiness(
  rows: unknown,
): Pick<TemplateLiveChecks, "chatProfileReady" | "decideProfileReady" | "decisionModelProfile"> {
  const profiles = Array.isArray(rows) ? (rows as AiProfileRowLike[]) : []
  const usable = profiles.filter((p) => p && typeof p === "object" && p.hasApiKey !== false)
  // Reihenfolge der Liste (= Reihenfolge in Einstellungen → KI): das erste
  // Entscheidungsmodell mit Schlüssel. Eines ohne Schlüssel würde im Lauf
  // scheitern; leer (Standard-Profil) funktioniert dagegen.
  const decision = usable.find((p) => isDecisionModelRow(p) && Number.isInteger(p.id) && Number(p.id) > 0)
  return {
    chatProfileReady: usable.some((p) => !isDecisionModelRow(p)),
    // Entscheidungsmodell oder Chat-Modell — beide beantworten „KI-Entscheidung“.
    decideProfileReady: usable.length > 0,
    decisionModelProfile: decision
      ? { id: Number(decision.id), label: typeof decision.label === "string" ? decision.label : "" }
      : null,
  }
}

/**
 * „Vorlage laden“: trägt in jeden Baustein „KI-Entscheidung“ ohne gewähltes
 * KI-Profil das Entscheidungsmodell ein. Nur beim Laden einer Vorlage —
 * gespeicherte Workflows bleiben unberührt. Ohne Profil bleibt alles leer
 * (Standard-Profil). Das Original wird nicht verändert.
 */
export function withDecisionModelProfile<T extends Pick<WorkflowTemplateDto, "graph">>(
  template: T,
  profile: DecisionModelProfileRef | null,
): { template: T; nodeIds: string[] } {
  if (!profile) return { template, nodeIds: [] }
  const nodeIds: string[] = []
  const nodes = template.graph.nodes.map((node) => {
    const data = node.data as { nodeType?: unknown; config?: Record<string, unknown> } | undefined
    if (data?.nodeType !== "ai.decide") return node
    const current = data.config?.profileId
    if (current !== null && current !== undefined && current !== "" && current !== 0) return node
    nodeIds.push(node.id)
    return { ...node, data: { ...data, config: { ...(data.config ?? {}), profileId: profile.id } } }
  })
  if (nodeIds.length === 0) return { template, nodeIds }
  return { template: { ...template, graph: { ...template.graph, nodes } }, nodeIds }
}

/** Learnings-Übersicht (GetLearningsOverview) → Schalter „Learnings sammeln“. */
export function learningsCollectEnabled(overview: unknown): boolean | null {
  const settings = (overview as { settings?: { collectEnabled?: unknown } } | null)?.settings
  return typeof settings?.collectEnabled === "boolean" ? settings.collectEnabled : null
}

export function templateCheckRows(
  template: Pick<WorkflowTemplateDto, "graph" | "trigger">,
  live: TemplateLiveChecks,
  opts: { serverClientMode: boolean },
): TemplateCheckRow[] {
  return requiredTemplateChecks(template).map((id): TemplateCheckRow => {
    switch (id) {
      case "chatProfile":
        return {
          id,
          ok: live.chatProfileReady,
          label: "KI-Profil mit API-Schlüssel",
          hint: "(Chat-Modell; Einstellungen → E-Mail → KI)",
        }
      case "decideProfile":
        return {
          id,
          ok: live.decideProfileReady,
          label: "KI-Profil vom Typ Entscheidungsmodell (oder Chat-Modell)",
          hint: live.decisionModelProfile
            ? `(„${live.decisionModelProfile.label || `Profil ${live.decisionModelProfile.id}`}“ wird beim Laden im Baustein „KI-Entscheidung“ eingetragen)`
            : live.decideProfileReady === true
              ? "(kein Entscheidungsmodell angelegt — der Baustein „KI-Entscheidung“ nutzt das Standard-Profil; Einstellungen → E-Mail → KI)"
              : "(Einstellungen → E-Mail → KI)",
        }
      case "canned":
        return {
          id,
          ok: live.cannedReady,
          label: "Mindestens ein Textbaustein",
          hint: "(Einstellungen → E-Mail → Textbausteine)",
        }
      case "autoReply":
        return {
          id,
          ok: live.autoReplyEnabled,
          label: "Auto-Antwort-Schalter aktiviert",
          hint: "(Einstellungen → Automatisierung — sonst wird nie automatisch gesendet)",
        }
      case "knowledgeBase":
        return {
          id,
          ok: live.knowledgeBaseReady,
          label: "Wissensbasis vorhanden",
          hint: "(Einstellungen → Wissensbasis — Grundlage für die KI-Antworten)",
        }
      case "learningsCollect":
        return {
          id,
          ok: live.learningsCollectEnabled,
          label: "Learnings sammeln aktiviert",
          hint: "(Einstellungen → Learnings — sonst gibt es nur notierte Learnings auszuwerten)",
        }
      case "scheduleTrigger":
        return {
          id,
          // Beide Editionen lösen Zeitpläne aus; die Liste bleibt die Quelle.
          ok: !DESKTOP_ONLY_WORKFLOW_TRIGGERS.has("schedule") || !opts.serverClientMode,
          label: "Auslöser Zeitplan verfügbar",
          hint: opts.serverClientMode
            ? "(Server: nach dem Laden einmal speichern, damit der Zeitplan scharf geschaltet ist)"
            : "(Desktop: läuft, solange SimpleCRM geöffnet ist)",
        }
    }
  })
}

/**
 * Was „Vorlage laden“ außer dem Graphen in den Editor übernimmt: empfohlene
 * Priorität und den Cron-Ausdruck einer Zeitplan-Vorlage.
 */
export function templatePickEdits(
  template: Pick<WorkflowTemplateDto, "priority" | "cronExpr" | "trigger">,
): { priority?: string; cronExpr?: string } {
  const edits: { priority?: string; cronExpr?: string } = {}
  if (typeof template.priority === "number" && Number.isInteger(template.priority) && template.priority > 0) {
    edits.priority = String(template.priority)
  }
  if (template.trigger === "schedule" && typeof template.cronExpr === "string" && template.cronExpr.trim()) {
    edits.cronExpr = template.cronExpr.trim()
  }
  return edits
}
