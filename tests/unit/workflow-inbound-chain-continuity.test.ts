import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  inboundChainFieldsFromRecord,
  parseInboundWorkflowChain,
  resumeContextInboundChainFields,
} from '../../packages/server/src/workflow-inbound-chain-context';

const repoRoot = join(__dirname, '..', '..');

function readRepoFile(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('workflow inbound chain continuity', () => {
  test('parseInboundWorkflowChain validates index bounds', () => {
    expect(parseInboundWorkflowChain({ workflowIds: [1, 2], index: 0 })).toEqual({
      workflowIds: [1, 2],
      index: 0,
    });
    expect(parseInboundWorkflowChain({ workflowIds: [1], index: 1 })).toBeNull();
    expect(parseInboundWorkflowChain({ workflowIds: [], index: 0 })).toBeNull();
  });

  test('resumeContextInboundChainFields restamps chain onto continuation context', () => {
    const fields = inboundChainFieldsFromRecord({
      inboundWorkflowChain: { workflowIds: [10, 20], index: 0 },
      skipIfMessageSpamOrReview: true,
    });
    expect(resumeContextInboundChainFields(fields)).toEqual({
      inboundWorkflowChain: { workflowIds: [10, 20], index: 0 },
      skipIfMessageSpamOrReview: true,
    });
  });

  test('AI/HTTP/delay continuations and terminal success path plumb the chain', () => {
    const execution = readRepoFile('packages/server/src/workflow-execution.ts');
    const ai = readRepoFile('packages/server/src/ai-classification.ts');
    const http = readRepoFile('packages/server/src/workflow-http-request.ts');
    const injections = execution.split('...inboundChainFieldsFromContext(context)').length - 1;
    expect(injections).toBeGreaterThanOrEqual(9); // 8 continuations + delay context
    expect(execution.split('continuation:terminal_success')[1] ?? '')
      .toContain('maybeEnqueueNextInboundWorkflow');
    expect(ai).toContain('resumeContextInboundChainFields(input.continuation)');
    expect(http).toContain('resumeContextInboundChainFields(continuation)');
  });
});
