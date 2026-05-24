import { getDb } from '../../sqlite-service';
import { WORKFLOW_DELAYED_JOBS_TABLE } from '../../database-schema';
import type { RegisteredWorkflowNode } from '../types';

type Reg = (def: RegisteredWorkflowNode) => void;

export function registerLogicNodes(register: Reg): void {
  register({
    type: 'logic.stop',
    label: 'Stopp',
    category: 'logic',
    canvasType: 'action',
    execute: async () => ({ status: 'ok', stop: true }),
  });

  register({
    type: 'logic.set_variable',
    label: 'Variable setzen',
    category: 'logic',
    canvasType: 'registry',
    defaultConfig: { name: 'var', value: '' },
    execute: async (ctx, config) => {
      const name = String(config.name ?? 'var');
      const value = config.value;
      return {
        status: 'ok',
        variables: {
          [name]:
            typeof value === 'boolean' || typeof value === 'number'
              ? value
              : String(value ?? ''),
        },
      };
    },
  });

  register({
    type: 'logic.delay',
    label: 'Verzögerung',
    category: 'logic',
    canvasType: 'registry',
    defaultConfig: { minutes: 5 },
    execute: async (ctx, config) => {
      const minutes = Math.max(1, Number(config.minutes ?? 5));
      const executeAt = new Date(Date.now() + minutes * 60_000).toISOString();
      if (ctx.dryRun) return { status: 'ok', message: `delay ${minutes}m` };
      getDb()
        .prepare(
          `INSERT INTO ${WORKFLOW_DELAYED_JOBS_TABLE}
           (workflow_id, message_id, resume_node_id, execute_at, context_json, status, created_at)
           VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
        )
        .run(
          ctx.workflowId,
          ctx.messageId,
          String(config.resumeNodeId ?? ''),
          executeAt,
          JSON.stringify({ variables: ctx.variables }),
          new Date().toISOString(),
        );
      return { status: 'ok', stop: true, message: `delayed_until:${executeAt}` };
    },
  });
}
