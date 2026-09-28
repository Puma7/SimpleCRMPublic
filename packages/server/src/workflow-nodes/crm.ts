/**
 * Plan 043: CRM-Knoten (Aufgabe, Aktivität, Deal, Kunde verknüpfen).
 * Reine Verschiebung aus workflow-execution.ts; Verhalten unverändert.
 */
import { type WorkflowGraphNode, normalizeEmailAddress } from '@simplecrm/core';
import type { WorkspaceTransaction } from '../db/workspace-context';
import {
  firstWorkflowRecipientAddress,
  optionalPositiveIntegerConfig,
  positiveIntegerVariable,
  serverCreatedSourceSqliteId,
  serverWorkerSourceRow,
  workflowSideEffectExecutionIdentity,
} from './shared';
import type { NodeResult, ServerNodeHandler, ServerNodeHandlerArgs, ServerWorkflowContext } from './types';

/** Knoten crm.create_task. */
async function handleCrmCreateTask({ trx, context, node, config, now }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  return await createWorkflowTask(trx, context, node, config, now);
}

/** Knoten crm.log_activity. */
async function handleCrmLogActivity({ trx, context, node, config, now }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  return await createWorkflowActivityLog(trx, context, node, config, now);
}

/** Knoten crm.update_deal. */
async function handleCrmUpdateDeal({ trx, context, node, config, now }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  return await updateWorkflowDeal(trx, context, node, config, now);
}

/** Knoten crm.link_customer, link_customer. */
async function handleCrmLinkCustomer({ trx, context, now }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  return await linkWorkflowMessageCustomer(trx, context, now);
}

async function linkWorkflowMessageCustomer(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  now: Date,
): Promise<NodeResult> {
  if (context.messageId === null) {
    return { status: 'skipped', port: 'default' };
  }

  const message = await trx
    .selectFrom('email_messages')
    .select(['id', 'from_json', 'customer_id'])
    .where('workspace_id', '=', context.workspaceId)
    .where('id', '=', context.messageId)
    .executeTakeFirst();
  if (!message) return { status: 'error', port: 'error', message: 'Nachricht nicht gefunden' };

  if (message.customer_id !== null && message.customer_id !== undefined) {
    const customerId = Number(message.customer_id);
    return {
      status: 'ok',
      port: 'default',
      variables: { 'customer.id': customerId },
    };
  }

  const sender = firstWorkflowRecipientAddress(message.from_json);
  if (!sender) return { status: 'ok', port: 'default' };
  const normalizedSender = normalizeEmailAddress(sender);
  if (!normalizedSender) return { status: 'ok', port: 'default' };

  const customerRows = await trx
    .selectFrom('customers')
    .select(['id', 'source_sqlite_id', 'email'])
    .where('workspace_id', '=', context.workspaceId)
    .execute();
  const customer = customerRows.find((row) => normalizeEmailAddress(String(row.email ?? '')) === normalizedSender);
  if (!customer) return { status: 'ok', port: 'default' };

  const customerId = Number(customer.id);
  const customerSourceSqliteId = Number(customer.source_sqlite_id);
  await trx
    .updateTable('email_messages')
    .set({
      customer_id: customerId,
      customer_source_sqlite_id: customerSourceSqliteId,
      updated_at: now,
    })
    .where('workspace_id', '=', context.workspaceId)
    .where('id', '=', context.messageId)
    .execute();

  return {
    status: 'ok',
    port: 'default',
    variables: {
      'customer.id': customerId,
      'customer.source_sqlite_id': customerSourceSqliteId,
    },
  };
}

async function createWorkflowTask(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  node: WorkflowGraphNode,
  config: Record<string, unknown>,
  now: Date,
): Promise<NodeResult> {
  const configuredCustomerId = optionalPositiveIntegerConfig(config.customerId, 'customerId');
  if (!configuredCustomerId.ok) return { status: 'error', port: 'error', message: configuredCustomerId.message };
  // Opt-in: allow a task without any linked customer (e.g. DMARC-report alerts,
  // where the report mail comes from a mailbox provider, not a CRM customer).
  // Default false preserves the historic skip-when-no-customer behaviour.
  const allowWithoutCustomer = config.allowWithoutCustomer === true;
  const customerId = configuredCustomerId.value ?? positiveIntegerVariable(context.variables['customer.id']);
  if (customerId === null && !allowWithoutCustomer) {
    return { status: 'skipped', port: 'default', message: 'Kein Kunde verknuepft' };
  }

  let customer: { id: number; sourceSqliteId: number } | null = null;
  if (customerId !== null) {
    if (!Number.isSafeInteger(customerId) || customerId <= 0) {
      return { status: 'error', port: 'error', message: 'customerId ungueltig' };
    }
    customer = await resolveWorkflowCustomerReference(trx, context.workspaceId, customerId);
    if (!customer) return { status: 'error', port: 'error', message: 'Kunde nicht gefunden' };
  }

  const title = String(config.title ?? 'E-Mail bearbeiten').trim() || 'E-Mail bearbeiten';
  const priority = String(config.priority ?? 'medium').trim() || 'medium';
  const dueDate = workflowTaskDueDate(config.daysUntilDue, now);
  if (!dueDate) return { status: 'error', port: 'error', message: 'daysUntilDue ungueltig' };
  const description = String(context.strings.snippet ?? '').trim() || null;
  // customerId 0 marks the customerless task in the idempotency key so retries
  // of the same (workflow, message, node) dedup instead of duplicating.
  const sourceSqliteId = serverCreatedWorkflowTaskSourceSqliteId(context, node.id, customer?.id ?? 0);

  const existing = await trx
    .selectFrom('tasks')
    .select('id')
    .where('workspace_id', '=', context.workspaceId)
    .where('source_sqlite_id', '=', sourceSqliteId)
    .executeTakeFirst();
  if (existing) {
    const taskId = Number(existing.id);
    return {
      status: 'ok',
      port: 'default',
      message: `task_exists:${taskId}`,
      variables: {
        'task.id': taskId,
        'task.customer_id': customer?.id ?? null,
      },
    };
  }

  const row = await trx
    .insertInto('tasks')
    .values({
      workspace_id: context.workspaceId,
      source_sqlite_id: sourceSqliteId,
      customer_source_sqlite_id: customer?.sourceSqliteId ?? null,
      customer_id: customer?.id ?? null,
      title,
      description,
      due_date: dueDate,
      priority,
      completed: false,
      calendar_event_source_sqlite_id: null,
      snoozed_until: null,
      created_date: now,
      last_modified: now,
      source_row: serverWorkerSourceRow(),
      imported_in_run_id: null,
      created_at: now,
      updated_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const taskId = Number(row.id);

  return {
    status: 'ok',
    port: 'default',
    variables: {
      'task.id': taskId,
      'task.customer_id': customer?.id ?? null,
    },
  };
}

async function createWorkflowActivityLog(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  node: WorkflowGraphNode,
  config: Record<string, unknown>,
  now: Date,
): Promise<NodeResult> {
  const customerId = positiveIntegerVariable(context.variables['customer.id']);
  if (customerId === null) {
    return { status: 'skipped', port: 'default', message: 'Kein Kunde verknuepft' };
  }
  if (!Number.isSafeInteger(customerId) || customerId <= 0) {
    return { status: 'error', port: 'error', message: 'customerId ungueltig' };
  }

  const customer = await resolveWorkflowCustomerReference(trx, context.workspaceId, customerId);
  if (!customer) return { status: 'error', port: 'error', message: 'Kunde nicht gefunden' };

  const activityType = String(config.activityType ?? 'email').trim() || 'email';
  const title = String(config.title ?? 'Workflow').trim() || 'Workflow';
  const description = String(context.strings.subject ?? '').trim() || null;
  const sourceSqliteId = serverCreatedWorkflowActivityLogSourceSqliteId(context, node.id, customer.id);

  const existing = await trx
    .selectFrom('activity_log')
    .select('id')
    .where('workspace_id', '=', context.workspaceId)
    .where('source_sqlite_id', '=', sourceSqliteId)
    .executeTakeFirst();
  if (existing) {
    const activityLogId = Number(existing.id);
    return {
      status: 'ok',
      port: 'default',
      message: `activity_log_exists:${activityLogId}`,
      variables: {
        'activity_log.id': activityLogId,
        'activity_log.customer_id': customer.id,
      },
    };
  }

  const row = await trx
    .insertInto('activity_log')
    .values({
      workspace_id: context.workspaceId,
      source_sqlite_id: sourceSqliteId,
      customer_source_sqlite_id: customer.sourceSqliteId,
      deal_source_sqlite_id: null,
      task_source_sqlite_id: null,
      customer_id: customer.id,
      deal_id: null,
      task_id: null,
      activity_type: activityType,
      title,
      description,
      metadata: {
        messageId: context.messageId,
        workflowId: context.workflowId,
      },
      source_row: serverWorkerSourceRow(),
      imported_in_run_id: null,
      created_at: now,
      updated_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const activityLogId = Number(row.id);

  return {
    status: 'ok',
    port: 'default',
    variables: {
      'activity_log.id': activityLogId,
      'activity_log.customer_id': customer.id,
    },
  };
}

async function updateWorkflowDeal(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  node: WorkflowGraphNode,
  config: Record<string, unknown>,
  now: Date,
): Promise<NodeResult> {
  const configuredDealId = optionalPositiveIntegerConfig(config.dealId, 'dealId');
  if (!configuredDealId.ok) return { status: 'error', port: 'error', message: configuredDealId.message };
  const dealId = configuredDealId.value ?? positiveIntegerVariable(context.variables['deal.id']);
  if (dealId === null) return { status: 'skipped', port: 'default', message: 'Keine Deal-ID' };
  if (!Number.isSafeInteger(dealId) || dealId <= 0) {
    return { status: 'error', port: 'error', message: 'dealId ungueltig' };
  }

  const deal = await resolveWorkflowDealReference(trx, context.workspaceId, dealId);
  if (!deal) return { status: 'error', port: 'error', message: 'Deal nicht gefunden' };

  const stage = String(config.stage ?? '').trim();
  if (stage) {
    await trx
      .updateTable('deals')
      .set({ stage, last_modified: now, updated_at: now })
      .where('workspace_id', '=', context.workspaceId)
      .where('id', '=', deal.id)
      .execute();
    await insertWorkflowDealStageActivityLog(trx, context, node, deal, stage, now);
    return {
      status: 'ok',
      port: 'default',
      variables: {
        'deal.id': deal.id,
        'deal.stage': stage,
      },
    };
  }

  const title = config.title === null || config.title === undefined ? '' : String(config.title).trim();
  if (title) {
    await trx
      .updateTable('deals')
      .set({ name: title, last_modified: now, updated_at: now })
      .where('workspace_id', '=', context.workspaceId)
      .where('id', '=', deal.id)
      .execute();
  }

  return {
    status: 'ok',
    port: 'default',
    variables: { 'deal.id': deal.id },
  };
}

async function resolveWorkflowCustomerReference(
  trx: WorkspaceTransaction,
  workspaceId: string,
  customerId: number,
): Promise<{ id: number; sourceSqliteId: number } | null> {
  const row = await trx
    .selectFrom('customers')
    .select(['id', 'source_sqlite_id'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', customerId)
    .executeTakeFirst();
  if (!row) return null;
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
  };
}

type WorkflowDealReference = {
  id: number;
  sourceSqliteId: number;
  customerId: number | null;
  customerSourceSqliteId: number | null;
  stage: string;
};

async function resolveWorkflowDealReference(
  trx: WorkspaceTransaction,
  workspaceId: string,
  dealId: number,
): Promise<WorkflowDealReference | null> {
  const row = await trx
    .selectFrom('deals')
    .select(['id', 'source_sqlite_id', 'customer_id', 'customer_source_sqlite_id', 'stage'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', dealId)
    .executeTakeFirst();
  if (!row) return null;
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
    customerId: row.customer_id === null || row.customer_id === undefined ? null : Number(row.customer_id),
    customerSourceSqliteId: row.customer_source_sqlite_id === null || row.customer_source_sqlite_id === undefined
      ? null
      : Number(row.customer_source_sqlite_id),
    stage: String(row.stage ?? ''),
  };
}

async function insertWorkflowDealStageActivityLog(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  node: WorkflowGraphNode,
  deal: WorkflowDealReference,
  newStage: string,
  now: Date,
): Promise<void> {
  const sourceSqliteId = serverCreatedWorkflowDealStageActivitySourceSqliteId(
    context,
    node.id,
    deal.id,
    deal.stage,
    newStage,
  );
  const existing = await trx
    .selectFrom('activity_log')
    .select('id')
    .where('workspace_id', '=', context.workspaceId)
    .where('source_sqlite_id', '=', sourceSqliteId)
    .executeTakeFirst();
  if (existing) return;

  await trx
    .insertInto('activity_log')
    .values({
      workspace_id: context.workspaceId,
      source_sqlite_id: sourceSqliteId,
      customer_source_sqlite_id: deal.customerSourceSqliteId,
      deal_source_sqlite_id: deal.sourceSqliteId,
      task_source_sqlite_id: null,
      customer_id: deal.customerId,
      deal_id: deal.id,
      task_id: null,
      activity_type: 'stage_change',
      title: `Deal-Phase geaendert: ${deal.stage} -> ${newStage}`,
      description: null,
      metadata: { old_stage: deal.stage, new_stage: newStage },
      source_row: serverWorkerSourceRow(),
      imported_in_run_id: null,
      created_at: now,
      updated_at: now,
    })
    .execute();
}

function workflowTaskDueDate(value: unknown, now: Date): Date | null {
  const raw = value === undefined || value === null || value === '' ? 3 : Number(value);
  if (!Number.isFinite(raw)) return null;
  const days = Math.trunc(raw);
  const due = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  return Number.isFinite(due.getTime()) ? due : null;
}

function serverCreatedWorkflowTaskSourceSqliteId(
  context: ServerWorkflowContext,
  nodeId: string,
  customerId: number,
): number {
  return serverCreatedSourceSqliteId(
    'tasks',
    context.workspaceId,
    String(context.workflowSourceSqliteId),
    workflowSideEffectExecutionIdentity(context),
    nodeId,
    String(customerId),
  );
}

function serverCreatedWorkflowActivityLogSourceSqliteId(
  context: ServerWorkflowContext,
  nodeId: string,
  customerId: number,
): number {
  return serverCreatedSourceSqliteId(
    'activity_log',
    context.workspaceId,
    String(context.workflowSourceSqliteId),
    workflowSideEffectExecutionIdentity(context),
    nodeId,
    String(customerId),
  );
}

function serverCreatedWorkflowDealStageActivitySourceSqliteId(
  context: ServerWorkflowContext,
  nodeId: string,
  dealId: number,
  oldStage: string,
  newStage: string,
): number {
  return serverCreatedSourceSqliteId(
    'activity_log',
    context.workspaceId,
    'deal_stage_change',
    String(context.workflowSourceSqliteId),
    String(context.runSourceSqliteId),
    nodeId,
    String(dealId),
    oldStage,
    newStage,
  );
}

/** Knoten dieser Kategorie nach dem Dry-Run-Schutz. */
export const CRM_NODE_HANDLERS: Readonly<Record<string, ServerNodeHandler>> = {
  'crm.create_task': handleCrmCreateTask,
  'crm.log_activity': handleCrmLogActivity,
  'crm.update_deal': handleCrmUpdateDeal,
  'crm.link_customer': handleCrmLinkCustomer,
  link_customer: handleCrmLinkCustomer,
};
