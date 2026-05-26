import type { WorkflowTriggerKind } from '../../shared/workflow-types';
import type { WorkflowContext } from './types';

/** Maps stored workflow trigger to runtime execution direction. */
export function workflowDirectionForTrigger(trigger: WorkflowTriggerKind): WorkflowContext['direction'] {
  if (trigger === 'outbound') return 'outbound';
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
  return trigger === 'inbound' || trigger === 'outbound' || trigger === 'draft_created';
}
