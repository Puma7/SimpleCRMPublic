import {
  createProductionJobHandlers,
  startPostgresJobQueueWorker,
  type JobHandlerRegistry,
  type JobQueuePort,
  type QueuedJob,
} from '../../packages/server/src/jobs';

describe('startPostgresJobQueueWorker', () => {
  test('processes legacy job_queue rows with registered handlers', async () => {
    const jobs: QueuedJob[] = [{
      id: 1,
      type: 'workflow.forward_copy',
      payload: {
        workspaceId: 'ws-1',
        workflowId: 2,
        messageId: 3,
        to: 'audit@example.com',
      },
      runAfter: new Date(0).toISOString(),
      attempts: 0,
      maxAttempts: 5,
      lockedAt: null,
      lockedBy: null,
      lastError: null,
      workspaceId: 'ws-1',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }];
    const calls: string[] = [];
    const queue: JobQueuePort = {
      async enqueue() {
        throw new Error('not used');
      },
      async claimNext({ workerId }) {
        const next = jobs.shift();
        if (!next) return null;
        return {
          ...next,
          lockedAt: new Date().toISOString(),
          lockedBy: workerId,
        };
      },
      async complete(job) {
        calls.push(`complete:${job.type}:${job.id}`);
        return true;
      },
      async fail() {
        return null;
      },
      async releaseStaleLocks() {
        return [];
      },
    };
    const handlers: JobHandlerRegistry = createProductionJobHandlers({
      workflowForwardCopy: {
        async forwardCopy(input) {
          calls.push(`forward:${input.messageId}:${input.to}`);
        },
      },
    });

    const worker = startPostgresJobQueueWorker({
      queue,
      handlers,
      pollIntervalMs: 5,
    });

    await waitFor(() => calls.includes('complete:workflow.forward_copy:1'));
    await worker.stop();

    expect(calls).toEqual([
      'forward:3:audit@example.com',
      'complete:workflow.forward_copy:1',
    ]);
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('timed out waiting for worker');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
