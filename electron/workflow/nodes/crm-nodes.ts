import { tryLinkMessageToCustomer } from '../../email/email-crm-store';
import { getDb } from '../../sqlite-service';
import { TASKS_TABLE, ACTIVITY_LOG_TABLE, DEALS_TABLE } from '../../database-schema';
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

  register({
    type: 'crm.update_deal',
    label: 'Deal aktualisieren',
    category: 'crm',
    canvasType: 'registry',
    defaultConfig: { dealId: 0, stage: '' },
    execute: async (ctx, config) => {
      // dealId 0 (Katalog-Default) heißt "nimm den verknüpften Deal" — der
      // Fallback auf die deal.id-Variable darf nicht an 0 ?? scheitern.
      const configuredId = Number(config.dealId ?? 0);
      const dealId = configuredId > 0 ? configuredId : Number(ctx.variables['deal.id'] ?? 0);
      const stage = String(config.stage ?? '').trim();
      if (!dealId) return { status: 'skipped', message: 'Keine Deal-ID' };
      if (ctx.dryRun) return { status: 'ok', message: 'dry-run deal update' };
      if (stage) {
        const { updateDealStage } = await import('../../sqlite-service');
        const r = updateDealStage(dealId, stage);
        if (!r.success) return { status: 'error', message: r.error ?? 'Deal-Update fehlgeschlagen' };
        const vars: Record<string, string | number | boolean | null> = {
          'deal.id': dealId,
          'deal.stage': stage,
        };
        return { status: 'ok', variables: vars };
      }
      const title = config.title != null ? String(config.title) : null;
      if (title) {
        getDb()
          .prepare(`UPDATE ${DEALS_TABLE} SET title = ?, last_modified = ? WHERE id = ?`)
          .run(title, new Date().toISOString(), dealId);
      }
      const vars: Record<string, string | number | boolean | null> = { 'deal.id': dealId };
      return { status: 'ok', variables: vars };
    },
  });
}
