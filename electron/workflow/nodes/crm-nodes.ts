import { tryLinkMessageToCustomer } from '../../email/email-crm-store';
import { getDb } from '../../sqlite-service';
import { TASKS_TABLE, ACTIVITY_LOG_TABLE } from '../../database-schema';
import type { RegisteredWorkflowNode, WorkflowContext } from '../types';

type Reg = (def: RegisteredWorkflowNode) => void;

export function registerCrmNodes(register: Reg): void {
  register({
    type: 'crm.link_customer',
    label: 'Kunde verknüpfen',
    category: 'crm',
    canvasType: 'action',
    execute: async (ctx) => {
      if (ctx.messageId == null) return { status: 'skipped' };
      if (!ctx.dryRun) tryLinkMessageToCustomer(ctx.messageId);
      return { status: 'ok' };
    },
  });

  register({
    type: 'crm.create_task',
    label: 'Aufgabe anlegen',
    category: 'crm',
    canvasType: 'registry',
    defaultConfig: { title: 'E-Mail bearbeiten', priority: 'medium', daysUntilDue: 3 },
    execute: async (ctx, config) => {
      const customerId = ctx.message?.customer_id ?? Number(config.customerId ?? 0);
      if (!customerId) return { status: 'skipped', message: 'Kein Kunde verknüpft' };
      const title = String(config.title ?? 'E-Mail bearbeiten');
      const priority = String(config.priority ?? 'medium');
      const days = Number(config.daysUntilDue ?? 3);
      const due = new Date();
      due.setDate(due.getDate() + days);
      if (ctx.dryRun) return { status: 'ok', message: 'dry-run task' };
      const r = getDb()
        .prepare(
          `INSERT INTO ${TASKS_TABLE} (customer_id, title, description, due_date, priority, completed)
           VALUES (?, ?, ?, ?, ?, 0)`,
        )
        .run(customerId, title, ctx.strings.snippet ?? null, due.toISOString(), priority);
      return { status: 'ok', variables: { 'task.id': Number(r.lastInsertRowid) } };
    },
  });

  register({
    type: 'crm.log_activity',
    label: 'Aktivität protokollieren',
    category: 'crm',
    canvasType: 'registry',
    defaultConfig: { activityType: 'email', title: 'Workflow' },
    execute: async (ctx, config) => {
      const customerId = ctx.message?.customer_id ?? null;
      if (!customerId) return { status: 'skipped' };
      if (ctx.dryRun) return { status: 'ok' };
      getDb()
        .prepare(
          `INSERT INTO ${ACTIVITY_LOG_TABLE} (customer_id, activity_type, title, description, metadata)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          customerId,
          String(config.activityType ?? 'email'),
          String(config.title ?? 'Workflow'),
          ctx.strings.subject ?? null,
          JSON.stringify({ messageId: ctx.messageId, workflowId: ctx.workflowId }),
        );
      return { status: 'ok' };
    },
  });
}
