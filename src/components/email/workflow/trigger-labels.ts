/** Human-readable workflow trigger labels (shared by canvas and shell). */
export const WORKFLOW_TRIGGER_LABELS: Record<string, string> = {
  inbound: "E-Mail eingehend",
  outbound: "E-Mail ausgehend",
  draft_created: "Entwurf erstellt",
  schedule: "Zeitplan (Cron)",
  manual: "Manuell",
  "crm.deal_stage_changed": "Deal-Phase geändert",
  "task.due": "Aufgabe fällig",
  "calendar.event_start": "Termin beginnt",
  "webhook.incoming": "Webhook (eingehend)",
  "crm.customer_created": "Kunde angelegt",
  // Server-only: wird vom SMTP-Relay nach erfolgreichem Versand ausgelöst.
  relay: "SMTP-Relay (nach Versand)",
}

export function workflowTriggerLabel(kind: string | undefined): string {
  if (!kind) return WORKFLOW_TRIGGER_LABELS.inbound
  return WORKFLOW_TRIGGER_LABELS[kind] ?? kind
}

/**
 * Trigger, die nur die Desktop-Runtime auslöst (CRM-/Aufgaben-/Termin-
 * Ereignisse, Entwurf erstellt). Der Server reiht Workflows für inbound,
 * outbound, manual, relay, webhook.incoming und schedule (Zeitplan) ein.
 * Spiegel von packages/core/src/workflow/trigger-utils.ts.
 */
export const DESKTOP_ONLY_WORKFLOW_TRIGGERS: ReadonlySet<string> = new Set([
  "draft_created",
  "crm.deal_stage_changed",
  "task.due",
  "calendar.event_start",
  "crm.customer_created",
])

const WORKFLOW_TRIGGER_OPTION_ORDER = [
  "inbound",
  "outbound",
  "draft_created",
  "schedule",
  "manual",
  "relay",
  "crm.deal_stage_changed",
  "task.due",
  "calendar.event_start",
  "webhook.incoming",
  "crm.customer_created",
] as const

export type WorkflowTriggerOption = { value: string; label: string; desktopOnly?: true }

/**
 * Auswahl im Trigger-Knoten. Jede Edition bietet nur Trigger an, die sie auch
 * auslöst; ein bereits gespeicherter anderer Wert bleibt sichtbar (Import,
 * Editionswechsel) und ist in der Server-Edition als „nur Desktop“ markiert.
 */
export function workflowTriggerOptions(input: {
  serverClientMode: boolean
  current: string | undefined
}): WorkflowTriggerOption[] {
  const options: WorkflowTriggerOption[] = []
  for (const value of WORKFLOW_TRIGGER_OPTION_ORDER) {
    const isCurrent = value === input.current
    if (value === "relay" && !input.serverClientMode && !isCurrent) continue
    const desktopOnly = input.serverClientMode && DESKTOP_ONLY_WORKFLOW_TRIGGERS.has(value)
    if (desktopOnly && !isCurrent) continue
    const label = WORKFLOW_TRIGGER_LABELS[value] ?? value
    options.push(desktopOnly ? { value, label: `${label} (nur Desktop)`, desktopOnly: true } : { value, label })
  }
  return options
}
