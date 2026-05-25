import { getWorkflowById, listAllWorkflows } from '../email/email-workflow-store';
import { getEmailMessageById } from '../email/email-store';
import { executeWorkflowForTrigger } from '../workflow/workflow-executor';
import { listRecentWorkflowRuns } from '../workflow/run-steps';
import type { WorkflowTriggerKind } from '../../shared/workflow-types';

export const WorkflowApiService = {
  list() {
    return listAllWorkflows().map((w) => ({
      id: w.id,
      name: w.name,
      trigger: w.trigger,
      priority: w.priority,
      enabled: w.enabled,
      execution_mode: w.execution_mode,
      cron_expr: w.cron_expr,
      schedule_account_id: w.schedule_account_id,
      updated_at: w.updated_at,
    }));
  },

  getById(id: number) {
    const w = getWorkflowById(id);
    if (!w) return null;
    return {
      id: w.id,
      name: w.name,
      trigger: w.trigger,
      priority: w.priority,
      enabled: w.enabled,
      execution_mode: w.execution_mode,
      cron_expr: w.cron_expr,
      schedule_account_id: w.schedule_account_id,
      graph_json: w.graph_json,
      definition_json: w.definition_json,
      updated_at: w.updated_at,
    };
  },

  listRuns(workflowId: number, limit = 20) {
    return listRecentWorkflowRuns(workflowId, Math.min(limit, 100));
  },

  async execute(
    workflowId: number,
    opts: {
      dryRun?: boolean;
      messageId?: number;
      variables?: Record<string, string | number | boolean | null>;
    },
  ) {
    const wf = getWorkflowById(workflowId);
    if (!wf) return { success: false as const, error: 'Workflow nicht gefunden' };
    if (wf.enabled !== 1) {
      return { success: false as const, error: 'Workflow ist deaktiviert' };
    }

    let message = null;
    if (opts.messageId != null) {
      message = getEmailMessageById(opts.messageId) ?? null;
      if (!message) return { success: false as const, error: 'Nachricht nicht gefunden' };
    }

    const trigger = (wf.trigger as WorkflowTriggerKind) || 'manual';
    const direction =
      trigger === 'outbound' ? 'outbound' : trigger === 'schedule' ? 'schedule' : 'manual';

    const result = await executeWorkflowForTrigger({
      workflow: wf,
      trigger,
      direction,
      message,
      dryRun: opts.dryRun !== false,
      initialVariables: opts.variables,
    });

    return {
      success: true as const,
      runId: result.runId,
      status: result.status,
      blocked: result.blocked,
      blockReason: result.blockReason,
      log: result.log,
      dryRun: opts.dryRun !== false,
    };
  },
};
