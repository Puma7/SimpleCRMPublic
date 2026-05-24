import type { EmailMessageRow } from '../email/email-store';
import type { OutboundDraftPayload } from '../email/email-workflow-engine';
import { parseWorkflowDefinition } from '../email/email-workflow-types';
import type { EmailWorkflowRow } from '../email/email-workflow-store';
import {
  runCompiledInboundRules,
  runCompiledOutboundRules,
} from '../email/email-workflow-engine';

export async function runCompiledWorkflow(input: {
  workflow: EmailWorkflowRow;
  runId: number;
  message?: EmailMessageRow | null;
  outbound?: OutboundDraftPayload | null;
  direction: string;
}): Promise<{
  status: 'ok' | 'error' | 'blocked';
  log: string[];
  blocked: boolean;
  blockReason: string | null;
}> {
  const log: string[] = ['compiled_mode'];
  try {
    const def = parseWorkflowDefinition(input.workflow.definition_json);
    if (input.direction === 'outbound' && input.outbound) {
      const r = await runCompiledOutboundRules(def, input.outbound);
      return {
        status: r.blocked ? 'blocked' : 'ok',
        log: [...log, ...r.log],
        blocked: r.blocked,
        blockReason: r.blocked ? 'Outbound blockiert' : null,
      };
    }
    if (input.message) {
      const r = await runCompiledInboundRules(
        def,
        input.message.id,
        input.message,
        input.workflow.id,
      );
      return {
        status: 'ok',
        log: [...log, ...r],
        blocked: false,
        blockReason: null,
      };
    }
    return { status: 'ok', log, blocked: false, blockReason: null };
  } catch (e) {
    return {
      status: 'error',
      log: [...log, `error:${e instanceof Error ? e.message : String(e)}`],
      blocked: false,
      blockReason: null,
    };
  }
}
