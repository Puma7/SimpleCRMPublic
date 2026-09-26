import { workflowTriggerOptions } from '../../src/components/email/workflow/trigger-labels';

// TA-P4: 'schedule' loest seit dem Server-Taktgeber auch der Server aus.
const DESKTOP_ONLY = [
  'draft_created',
  'crm.deal_stage_changed',
  'task.due',
  'calendar.event_start',
  'crm.customer_created',
];

// F-A9-01: the server edition offered triggers (schedule, CRM events, draft
// created …) that the server never fires; such workflows saved as active and
// silently never ran.
describe('workflow trigger options in the editor', () => {
  test('server edition offers only triggers the server fires', () => {
    const values = workflowTriggerOptions({ serverClientMode: true, current: 'inbound' }).map((option) => option.value);
    expect(values).toEqual(['inbound', 'outbound', 'schedule', 'manual', 'relay', 'webhook.incoming']);
    for (const trigger of DESKTOP_ONLY) expect(values).not.toContain(trigger);
  });

  test('server edition offers the schedule trigger without the desktop-only mark', () => {
    const options = workflowTriggerOptions({ serverClientMode: true, current: 'schedule' });
    expect(options).toContainEqual({ value: 'schedule', label: 'Zeitplan (Cron)' });
    expect(options.some((option) => option.desktopOnly)).toBe(false);
  });

  test('server edition keeps a stored desktop-only trigger visible and marks it', () => {
    const options = workflowTriggerOptions({ serverClientMode: true, current: 'task.due' });
    expect(options).toContainEqual({ value: 'task.due', label: 'Aufgabe fällig (nur Desktop)', desktopOnly: true });
    expect(options.map((option) => option.value)).not.toContain('calendar.event_start');
  });

  test('desktop offers every desktop trigger and hides relay unless it is set', () => {
    const values = workflowTriggerOptions({ serverClientMode: false, current: 'inbound' }).map((option) => option.value);
    expect(values).toEqual([
      'inbound',
      'outbound',
      'draft_created',
      'schedule',
      'manual',
      'crm.deal_stage_changed',
      'task.due',
      'calendar.event_start',
      'webhook.incoming',
      'crm.customer_created',
    ]);
    expect(workflowTriggerOptions({ serverClientMode: false, current: 'relay' }).map((option) => option.value))
      .toContain('relay');
  });
});
