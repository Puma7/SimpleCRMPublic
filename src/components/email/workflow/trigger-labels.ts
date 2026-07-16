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
