import type { JobQueuePort, QueuedJob } from './types';

export type JobHandler = (job: QueuedJob) => Promise<void>;

export type JobHandlerRegistry = Readonly<Record<string, JobHandler | undefined>>;

export type JobWorkerRunResult = Readonly<
  | { status: 'idle' }
  | { status: 'completed'; job: QueuedJob }
  | { status: 'failed'; job: QueuedJob; error: string }
>;

export async function runJobQueueOnce(input: {
  queue: JobQueuePort;
  handlers: JobHandlerRegistry;
  workerId: string;
  now?: Date;
}): Promise<JobWorkerRunResult> {
  const job = await input.queue.claimNext({
    workerId: input.workerId,
    now: input.now,
  });
  if (!job) return { status: 'idle' };

  const handler = input.handlers[job.type];
  if (!handler) {
    const message = `No handler registered for job type ${job.type}`;
    await input.queue.fail({ job, error: message, now: input.now });
    return { status: 'failed', job, error: message };
  }

  try {
    await handler(job);
    await input.queue.complete(job);
    return { status: 'completed', job };
  } catch (error) {
    const message = formatJobError(error);
    await input.queue.fail({ job, error, now: input.now });
    return { status: 'failed', job, error: message };
  }
}

export function formatJobError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 4000);
  }
  return String(error).slice(0, 4000);
}
