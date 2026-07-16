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

export function workflowTriggerNeedsMessage(trigger: WorkflowTriggerKind): boolean {
  // 'relay' needs the persisted message: the follow-up graph reads its
  // tracking evidence (email.read_tracking_evidence).
  return trigger === 'inbound' || trigger === 'outbound' || trigger === 'draft_created' || trigger === 'relay';
}
