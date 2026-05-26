import { getWorkflowById } from '../../email/email-workflow-store';
import { executeWorkflowForTrigger } from '../workflow-executor';
import type { RegisteredWorkflowNode } from '../types';
import type { WorkflowTriggerKind } from '../../../shared/workflow-types';
import { workflowDirectionForTrigger } from '../workflow-trigger-utils';

type Reg = (def: RegisteredWorkflowNode) => void;

export function registerWorkflowMetaNodes(register: Reg): void {
  register({
    type: 'workflow.subflow',
    label: 'Subflow ausführen',
    category: 'logic',
    canvasType: 'registry',
    defaultConfig: { workflowId: 0 },
    execute: async (ctx, config) => {
      const subId = Number(config.workflowId ?? 0);
      if (!subId || subId === ctx.workflowId) {
        return { status: 'error', message: 'Ungültige Subflow-ID' };
      }
      const sub = getWorkflowById(subId);
      if (!sub?.enabled) return { status: 'error', message: 'Subflow nicht gefunden oder inaktiv' };
      if (ctx.dryRun) return { status: 'ok', message: `dry-run subflow ${subId}` };
      const trig = (sub.trigger as WorkflowTriggerKind) || 'manual';
      const r = await executeWorkflowForTrigger({
        workflow: sub,
        trigger: trig,
        direction: workflowDirectionForTrigger(trig),
        message: ctx.message,
        outbound: ctx.outbound,
        dryRun: false,
        initialVariables: { ...ctx.variables },
      });
      return {
        status: r.status === 'error' ? 'error' : 'ok',
        blocked: r.blocked,
        blockReason: r.blockReason ?? undefined,
        variables: { 'subflow.status': r.status },
      };
    },
  });
}
