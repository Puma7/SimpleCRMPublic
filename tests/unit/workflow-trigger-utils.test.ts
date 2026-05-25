import {
  workflowDirectionForTrigger,
  workflowTriggerNeedsMessage,
} from '../../electron/workflow/workflow-trigger-utils';

describe('workflow-trigger-utils', () => {
  test('workflowDirectionForTrigger maps CRM triggers to crm_event', () => {
    expect(workflowDirectionForTrigger('crm.deal_stage_changed')).toBe('crm_event');
    expect(workflowDirectionForTrigger('task.due')).toBe('crm_event');
    expect(workflowDirectionForTrigger('calendar.event_start')).toBe('crm_event');
  });

  test('workflowDirectionForTrigger maps mail triggers', () => {
    expect(workflowDirectionForTrigger('outbound')).toBe('outbound');
    expect(workflowDirectionForTrigger('schedule')).toBe('schedule');
    expect(workflowDirectionForTrigger('manual')).toBe('manual');
    expect(workflowDirectionForTrigger('inbound')).toBe('inbound');
  });

  test('workflowTriggerNeedsMessage', () => {
    expect(workflowTriggerNeedsMessage('inbound')).toBe(true);
    expect(workflowTriggerNeedsMessage('manual')).toBe(false);
    expect(workflowTriggerNeedsMessage('schedule')).toBe(false);
  });
});
