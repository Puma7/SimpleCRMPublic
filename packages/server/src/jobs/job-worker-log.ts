import type { ServerLogStore } from '../diagnostics/server-log-store';

export type JobWorkerLogFn = (entry: {
  level: 'info' | 'warn' | 'error';
  message: string;
}) => void;

export function createJobWorkerLogger(store?: ServerLogStore): JobWorkerLogFn {
  return (entry) => {
    const message = entry.message.trim();
    if (!message) return;
    if (store) {
      store.capture({ level: entry.level, message, source: 'job-worker' });
      return;
    }
    if (entry.level === 'error') console.error(`[job-worker] ${message}`);
    else if (entry.level === 'warn') console.warn(`[job-worker] ${message}`);
    else console.info(`[job-worker] ${message}`);
  };
}
