import { randomUUID } from 'node:crypto';

import type { JobQueuePort } from './types';
import type { JobHandlerRegistry } from './worker';
import { runJobQueueOnce } from './worker';

export type PostgresJobQueueWorkerRuntime = Readonly<{
  stop(): Promise<void>;
}>;

export type PostgresJobQueueWorkerOptions = Readonly<{
  queue: JobQueuePort;
  handlers: JobHandlerRegistry;
  workerId?: string;
  pollIntervalMs?: number;
  staleLockIntervalMs?: number;
  staleLockAgeMs?: number;
  now?: () => Date;
}>;

const DEFAULT_POLL_INTERVAL_MS = 750;
const DEFAULT_STALE_LOCK_INTERVAL_MS = 60_000;
const DEFAULT_STALE_LOCK_AGE_MS = 15 * 60_000;

/** Polls the legacy `job_queue` table and executes handlers in-process.
 *
 * Workflow side-effects (forward_copy, http_request, AI continuations, etc.)
 * enqueue rows into `job_queue` during graph execution. Graphile Worker only
 * consumes its own schema, so this loop is required for those jobs to run.
 */
export function startPostgresJobQueueWorker(
  options: PostgresJobQueueWorkerOptions,
): PostgresJobQueueWorkerRuntime {
  const workerId = options.workerId ?? `pg-job-worker-${randomUUID()}`;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const staleLockIntervalMs = options.staleLockIntervalMs ?? DEFAULT_STALE_LOCK_INTERVAL_MS;
  const staleLockAgeMs = options.staleLockAgeMs ?? DEFAULT_STALE_LOCK_AGE_MS;
  const now = options.now ?? (() => new Date());

  let stopped = false;
  let pollPromise: Promise<void> | null = null;
  let staleLockTimer: NodeJS.Timeout | null = null;

  const sleep = (ms: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

  async function pollLoop(): Promise<void> {
    while (!stopped) {
      try {
        const result = await runJobQueueOnce({
          queue: options.queue,
          handlers: options.handlers,
          workerId,
          now: now(),
        });
        if (result.status === 'idle') {
          await sleep(pollIntervalMs);
        }
      } catch {
        await sleep(pollIntervalMs);
      }
    }
  }

  async function releaseStaleLocks(): Promise<void> {
    if (stopped) return;
    try {
      await options.queue.releaseStaleLocks({
        staleBefore: new Date(now().getTime() - staleLockAgeMs),
        limit: 100,
      });
    } catch {
      /* best effort */
    }
  }

  pollPromise = pollLoop();
  staleLockTimer = setInterval(() => {
    void releaseStaleLocks();
  }, staleLockIntervalMs);
  staleLockTimer.unref?.();

  return {
    async stop() {
      stopped = true;
      if (staleLockTimer) {
        clearInterval(staleLockTimer);
        staleLockTimer = null;
      }
      if (pollPromise) {
        await pollPromise.catch(() => undefined);
        pollPromise = null;
      }
    },
  };
}
