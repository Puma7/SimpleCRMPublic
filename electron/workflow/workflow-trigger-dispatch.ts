import { getDb, getSyncInfo, setSyncInfo } from '../sqlite-service';
import { CUSTOMERS_TABLE, DEALS_TABLE, TASKS_TABLE, CALENDAR_EVENTS_TABLE } from '../database-schema';
import { listWorkflowsByTrigger } from '../email/email-workflow-store';
import { getEmailMessageById } from '../email/email-store';
import { executeWorkflowForTrigger } from './workflow-executor';
import type { WorkflowTriggerKind } from '../../shared/workflow-types';
import { buildStringContextFromMessage } from './context';

/** Prevent duplicate fires from overlapping cron ticks (not permanent). */
const SCAN_TRIGGER_DEDUP_MS = 90_000;
/** Debounce rapid duplicate deal-stage dispatches (double-save). */
const DEAL_STAGE_DEBOUNCE_MS = 5_000;

export type CrmWorkflowEvent =
  | {
      trigger: 'crm.customer_created';
      customerId: number;
      name: string;
      email: string | null;
    }
  | {
      trigger: 'crm.deal_stage_changed';
      dealId: number;
      customerId: number;
      oldStage: string;
      newStage: string;
    }
  | {
      trigger: 'task.due';
      taskId: number;
      customerId: number | null;
      title: string;
      dueDate: string;
    }
  | {
      trigger: 'calendar.event_start';
      eventId: number;
      customerId: number | null;
      title: string;
      startDate: string;
    };

function workflowTriggerDedupKey(event: CrmWorkflowEvent): string {
  switch (event.trigger) {
    case 'crm.customer_created':
      return `workflow_trigger_fired:crm.customer_created:${event.customerId}`;
    case 'crm.deal_stage_changed':
      return `workflow_trigger_fired:crm.deal_stage_changed:${event.dealId}:${event.oldStage}:${event.newStage}`;
    case 'task.due':
      return `workflow_trigger_fired:task.due:${event.taskId}:${event.dueDate}`;
    case 'calendar.event_start':
      return `workflow_trigger_fired:calendar.event_start:${event.eventId}:${event.startDate}`;
    default: {
      const _exhaustive: never = event;
      return `workflow_trigger_fired:${String(_exhaustive)}`;
    }
  }
}

function dedupStillActive(raw: string | null, ttlMs: number): boolean {
  if (!raw) return false;
  const t = Number(raw);
  if (!Number.isNaN(t) && t > 1_000_000_000_000) {
    return Date.now() - t < ttlMs;
  }
  return raw === '1';
}

function shouldFireWorkflowTrigger(event: CrmWorkflowEvent): boolean {
  const key = workflowTriggerDedupKey(event);
  const raw = getSyncInfo(key);

  if (event.trigger === 'crm.customer_created') {
    return raw !== '1';
  }

  if (event.trigger === 'crm.deal_stage_changed') {
    if (dedupStillActive(raw, DEAL_STAGE_DEBOUNCE_MS)) return false;
    setSyncInfo(key, String(Date.now()));
    return true;
  }

  if (event.trigger === 'task.due' || event.trigger === 'calendar.event_start') {
    return raw !== '1';
  }

  if (dedupStillActive(raw, SCAN_TRIGGER_DEDUP_MS)) return false;
  setSyncInfo(key, String(Date.now()));
  return true;
}

function markWorkflowTriggerFired(event: CrmWorkflowEvent): void {
  setSyncInfo(workflowTriggerDedupKey(event), '1');
}

function stringsForEvent(event: CrmWorkflowEvent): Record<string, string> {
  if (event.trigger === 'crm.customer_created') {
    return {
      subject: `Neuer Kunde: ${event.name}`,
      body_text: event.name,
      snippet: event.email ?? '',
      from_address: event.email ?? '',
      to_address: '',
      cc_address: '',
      combined_text: `customer:${event.customerId} ${event.name} ${event.email ?? ''}`,
      has_attachments: 'false',
      attachment_names: '',
      attachment_types: '',
    };
  }
  if (event.trigger === 'crm.deal_stage_changed') {
    const customer = getDb()
      .prepare(`SELECT name, email FROM ${CUSTOMERS_TABLE} WHERE id = ?`)
      .get(event.customerId) as { name?: string; email?: string } | undefined;
    const name = customer?.name ?? '';
    const email = customer?.email ?? '';
    return {
      subject: `Deal-Stufe: ${event.newStage}`,
      body_text: `${event.oldStage} → ${event.newStage}`,
      snippet: name,
      from_address: email,
      to_address: '',
      cc_address: '',
      combined_text: `deal:${event.dealId} stage:${event.newStage} customer:${event.customerId} ${name}`,
      has_attachments: 'false',
      attachment_names: '',
      attachment_types: '',
    };
  }
  if (event.trigger === 'task.due') {
    return {
      subject: `Aufgabe fällig: ${event.title}`,
      body_text: event.title,
      snippet: event.dueDate,
      from_address: '',
      to_address: '',
      cc_address: '',
      combined_text: `task:${event.taskId} due:${event.dueDate}`,
      has_attachments: 'false',
      attachment_names: '',
      attachment_types: '',
    };
  }
  const customer = event.customerId
    ? (getDb()
        .prepare(`SELECT name, email FROM ${CUSTOMERS_TABLE} WHERE id = ?`)
        .get(event.customerId) as { name?: string; email?: string } | undefined)
    : undefined;
  return {
    subject: `Termin: ${event.title}`,
    body_text: event.title,
    snippet: event.startDate,
    from_address: customer?.email ?? '',
    to_address: '',
    cc_address: '',
    combined_text: `event:${event.eventId} start:${event.startDate}`,
    has_attachments: 'false',
    attachment_names: '',
    attachment_types: '',
  };
}

export async function dispatchCustomerCreatedWorkflow(input: {
  customerId: number;
  name: string;
  email: string | null;
}): Promise<void> {
  await dispatchCrmWorkflowEvent({
    trigger: 'crm.customer_created',
    customerId: input.customerId,
    name: input.name,
    email: input.email,
  });
}

export async function dispatchCrmWorkflowEvent(event: CrmWorkflowEvent): Promise<void> {
  if (!shouldFireWorkflowTrigger(event)) return;

  const workflows = listWorkflowsByTrigger(event.trigger);
  if (workflows.length === 0) return;

  const strings = stringsForEvent(event);
  const variables: Record<string, string | number | boolean | null> = {};
  if (event.trigger === 'crm.customer_created') {
    variables['customer.id'] = event.customerId;
    variables['customer.name'] = event.name;
    if (event.email) variables['customer.email'] = event.email;
  } else if (event.trigger === 'crm.deal_stage_changed') {
    variables['deal.id'] = event.dealId;
    variables['deal.stage'] = event.newStage;
    variables['deal.old_stage'] = event.oldStage;
    variables['customer.id'] = event.customerId;
  } else if (event.trigger === 'task.due') {
    variables['task.id'] = event.taskId;
    variables['task.title'] = event.title;
    if (event.customerId != null) variables['customer.id'] = event.customerId;
  } else {
    variables['calendar.event_id'] = event.eventId;
    variables['calendar.title'] = event.title;
    if (event.customerId != null) variables['customer.id'] = event.customerId;
  }

  let firedOk = false;
  for (const wf of workflows) {
    try {
      const r = await executeWorkflowForTrigger({
        workflow: wf,
        trigger: event.trigger as WorkflowTriggerKind,
        direction: 'crm_event',
        message: null,
        dryRun: false,
        eventStrings: strings,
        eventVariables: variables,
      });
      if (r.status === 'ok') firedOk = true;
    } catch (e) {
      console.warn(`[workflow] CRM trigger ${event.trigger} wf ${wf.id}`, e);
    }
  }
  if (firedOk) markWorkflowTriggerFired(event);
}

export async function fireDealStageChangedWorkflows(
  dealId: number,
  customerId: number,
  oldStage: string,
  newStage: string,
): Promise<void> {
  if (oldStage === newStage) return;
  await dispatchCrmWorkflowEvent({
    trigger: 'crm.deal_stage_changed',
    dealId,
    customerId,
    oldStage,
    newStage,
  });
}

export async function scanDueTasksAndFireWorkflows(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const rows = getDb()
    .prepare(
      `SELECT id, customer_id, title, due_date FROM ${TASKS_TABLE}
       WHERE completed = 0 AND due_date IS NOT NULL AND date(due_date) <= date(?)
       ORDER BY due_date ASC LIMIT 50`,
    )
    .all(today) as { id: number; customer_id: number | null; title: string; due_date: string }[];
  let n = 0;
  for (const t of rows) {
    await dispatchCrmWorkflowEvent({
      trigger: 'task.due',
      taskId: t.id,
      customerId: t.customer_id,
      title: t.title,
      dueDate: t.due_date,
    });
    n += 1;
  }
  return n;
}

export async function scanUpcomingCalendarEventsAndFireWorkflows(): Promise<number> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + 15 * 60_000).toISOString();
  const nowIso = now.toISOString();
  const rows = getDb()
    .prepare(
      `SELECT ce.id, ce.title, ce.start_date, t.customer_id
       FROM ${CALENDAR_EVENTS_TABLE} ce
       LEFT JOIN ${TASKS_TABLE} t ON ce.task_id = t.id
       WHERE ce.start_date >= ? AND ce.start_date <= ?
       ORDER BY ce.start_date ASC LIMIT 50`,
    )
    .all(nowIso, windowEnd) as {
    id: number;
    customer_id: number | null;
    title: string;
    start_date: string;
  }[];
  let n = 0;
  for (const e of rows) {
    await dispatchCrmWorkflowEvent({
      trigger: 'calendar.event_start',
      eventId: e.id,
      customerId: e.customer_id,
      title: e.title,
      startDate: e.start_date,
    });
    n += 1;
  }
  return n;
}

/** Build minimal context when resuming delayed jobs with message */
export function contextStringsFromMessageId(messageId: number): ReturnType<typeof buildStringContextFromMessage> | null {
  const msg = getEmailMessageById(messageId);
  if (!msg) return null;
  return buildStringContextFromMessage(msg);
}
