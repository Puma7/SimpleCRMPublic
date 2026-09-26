export type WorkflowTriggerKind =
  | 'inbound'
  | 'outbound'
  | 'draft_created'
  | 'schedule'
  | 'manual'
  /**
   * Server-only: fired by the SMTP relay pipeline (relay-submission.ts) AFTER
   * a mail was successfully relayed. The desktop edition never emits it.
   */
  | 'relay'
  | 'crm.deal_stage_changed'
  | 'task.due'
  | 'calendar.event_start'
  | 'webhook.incoming'
  | 'crm.customer_created';

export type WorkflowDirection =
  | 'inbound'
  | 'outbound'
  | 'draft_created'
  | 'schedule'
  | 'manual'
  | 'crm_event';

/** Maps stored workflow trigger to runtime execution direction. */
export function workflowDirectionForTrigger(trigger: WorkflowTriggerKind): WorkflowDirection {
  // 'relay' runs the outbound follow-up graph on the already-sent message.
  if (trigger === 'outbound' || trigger === 'relay') return 'outbound';
  if (trigger === 'draft_created') return 'draft_created';
  if (trigger === 'schedule') return 'schedule';
  if (trigger === 'manual') return 'manual';
  if (
    trigger === 'crm.deal_stage_changed' ||
    trigger === 'task.due' ||
    trigger === 'calendar.event_start' ||
    trigger === 'crm.customer_created' ||
    trigger === 'webhook.incoming'
  ) {
    return 'crm_event';
  }

  return 'inbound';
}

/**
 * Trigger, die nur die Desktop-Runtime ausloest (Cron-Scheduler, Entwurf,
 * CRM-/Aufgaben-/Termin-Ereignisse). Die Server-Edition reiht Workflows nur
 * fuer inbound, outbound, manual, relay und webhook.incoming ein; unbekannte
 * Namen laufen dort als manual. Spiegel: src/components/email/workflow/trigger-labels.ts.
 */
export const DESKTOP_ONLY_WORKFLOW_TRIGGERS: ReadonlySet<string> = new Set([
  'draft_created',
  'schedule',
  'crm.deal_stage_changed',
  'task.due',
  'calendar.event_start',
  'crm.customer_created',
]);

export function isServerWorkflowTrigger(trigger: string | null | undefined): boolean {
  return typeof trigger === 'string' && !DESKTOP_ONLY_WORKFLOW_TRIGGERS.has(trigger);
}

export function workflowTriggerNeedsMessage(trigger: WorkflowTriggerKind): boolean {
  // 'relay' needs the persisted message: the follow-up graph reads its
  // tracking evidence (email.read_tracking_evidence).
  return trigger === 'inbound' || trigger === 'outbound' || trigger === 'draft_created' || trigger === 'relay';
}
