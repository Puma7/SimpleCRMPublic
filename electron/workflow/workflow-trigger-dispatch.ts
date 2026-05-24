import { getDb } from '../sqlite-service';
import { CUSTOMERS_TABLE, DEALS_TABLE, TASKS_TABLE, CALENDAR_EVENTS_TABLE } from '../database-schema';
import { listWorkflowsByTrigger } from '../email/email-workflow-store';
import { getEmailMessageById } from '../email/email-store';
import { executeWorkflowForTrigger } from './workflow-executor';
import type { WorkflowTriggerKind } from '../../shared/workflow-types';
import { buildStringContextFromMessage } from './context';

export type CrmWorkflowEvent =
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

const firedDedup = new Map<string, number>();
const DEDUP_MS = 60_000;

function shouldFireOnce(key: string): boolean {
  const now = Date.now();
  const last = firedDedup.get(key) ?? 0;
  if (now - last < DEDUP_MS) return false;
  firedDedup.set(key, now);
  if (firedDedup.size > 5000) {
    const cutoff = now - DEDUP_MS * 2;
    for (const [k, t] of firedDedup) {
      if (t < cutoff) firedDedup.delete(k);
    }
  }
  return true;
}

function stringsForEvent(event: CrmWorkflowEvent): Record<string, string> {
  if (event.trigger === 'crm.deal_stage_changed') {
    const customer = getDb()
      .prepare(`SELECT name, email FROM ${CUSTOMERS_TABLE} WHERE id = ?`)
      .get(event.customerId) as { name?: string; email?: string } | undefined;
    return {
      subject: `Deal-Phase: ${event.newStage}`,
      body_text: `Deal #${event.dealId}: ${event.oldStage} → ${event.newStage}`,
      snippet: `Kunde: ${customer?.name ?? ''}`,
      from_address: customer?.email ?? '',
      to_address: '',
      cc_address: '',
      combined_text: `deal:${event.dealId} stage:${event.newStage} customer:${customer?.name ?? ''}`,
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
      combined_text: `task:${event.taskId} ${event.title} due:${event.dueDate}`,
      has_attachments: 'false',
      attachment_names: '',
      attachment_types: '',
    };
  }
  return {
    subject: `Termin: ${event.title}`,
    body_text: event.title,
    snippet: event.startDate,
    from_address: '',
    to_address: '',
    cc_address: '',
    combined_text: `event:${event.eventId} ${event.title} start:${event.startDate}`,
    has_attachments: 'false',
    attachment_names: '',
    attachment_types: '',
  };
}

export async function dispatchCrmWorkflowEvent(event: CrmWorkflowEvent): Promise<void> {
  const dedupKey = `${event.trigger}:${'dealId' in event ? event.dealId : 'taskId' in event ? event.taskId : event.eventId}`;
  if (!shouldFireOnce(dedupKey)) return;

  const workflows = listWorkflowsByTrigger(event.trigger);
  if (workflows.length === 0) return;

  const strings = stringsForEvent(event);
  const variables: Record<string, string | number | boolean | null> = {};
  if (event.trigger === 'crm.deal_stage_changed') {
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

  for (const wf of workflows) {
    try {
      await executeWorkflowForTrigger({
        workflow: wf,
        trigger: event.trigger as WorkflowTriggerKind,
        direction: 'crm_event',
        message: null,
        dryRun: false,
        eventStrings: strings,
        eventVariables: variables,
      });
    } catch (e) {
      console.warn(`[workflow] CRM trigger ${event.trigger} wf ${wf.id}`, e);
    }
  }
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
      `SELECT id, customer_id, title, start_date FROM ${CALENDAR_EVENTS_TABLE}
       WHERE start_date >= ? AND start_date <= ?
       ORDER BY start_date ASC LIMIT 50`,
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
