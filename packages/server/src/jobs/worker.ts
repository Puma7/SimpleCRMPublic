import type { JobQueuePort, QueuedJob } from './types';
import type { JobWorkerLogFn } from './job-worker-log';

export type JobHandler = (job: QueuedJob) => Promise<void>;

export type JobHandlerRegistry = Readonly<Record<string, JobHandler | undefined>>;

export type JobWorkerRunResult = Readonly<
  | { status: 'idle' }
  | { status: 'completed'; job: QueuedJob; durationMs: number }
  | { status: 'failed'; job: QueuedJob; error: string; durationMs: number }
>;

export async function runJobQueueOnce(input: {
  queue: JobQueuePort;
  handlers: JobHandlerRegistry;
  workerId: string;
  now?: Date;
  log?: JobWorkerLogFn;
}): Promise<JobWorkerRunResult> {
  const job = await input.queue.claimNext({
    workerId: input.workerId,
    now: input.now,
  });
  if (!job) return { status: 'idle' };

  const started = Date.now();
  input.log?.({
    level: 'info',
    message: `Job gestartet: ${job.type} #${job.id} (Versuch ${job.attempts + 1}/${job.maxAttempts}, workspace=${job.workspaceId})`,
  });

  const handler = input.handlers[job.type];
  if (!handler) {
    const message = `No handler registered for job type ${job.type}`;
    await input.queue.fail({ job, error: message, now: input.now });
    input.log?.({ level: 'error', message: `Job fehlgeschlagen: ${job.type} #${job.id} — ${message}` });
    return { status: 'failed', job, error: message, durationMs: Date.now() - started };
  }

  try {
    await handler(job);
    await input.queue.complete(job);
    const durationMs = Date.now() - started;
    input.log?.({
      level: 'info',
      message: `Job abgeschlossen: ${job.type} #${job.id} in ${durationMs} ms`,
    });
    return { status: 'completed', job, durationMs };
  } catch (error) {
    const message = formatJobError(error);
    await input.queue.fail({ job, error, now: input.now });
    const durationMs = Date.now() - started;
    input.log?.({
      level: 'error',
      message: `Job fehlgeschlagen: ${job.type} #${job.id} nach ${durationMs} ms — ${message}`,
    });
    return { status: 'failed', job, error: message, durationMs };
  }
}

export function formatJobError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 4000);
  }
  return String(error).slice(0, 4000);
}
