import { createJobWorkerLogger } from '../../packages/server/src/jobs/job-worker-log';
import { createServerLogStore } from '../../packages/server/src/diagnostics/server-log-store';

describe('createJobWorkerLogger', () => {
  test('captures entries into server log store with job-worker source', () => {
    const store = createServerLogStore();
    const log = createJobWorkerLogger(store);
    log({ level: 'info', message: 'Job gestartet: workflow.forward_copy #1' });
    log({ level: 'error', message: 'Job fehlgeschlagen' });
    const entries = store.recent({ level: 'info', limit: 10 });
    expect(entries.some((entry) => entry.source === 'job-worker' && entry.message.includes('forward_copy'))).toBe(true);
    expect(entries.some((entry) => entry.level === 'error')).toBe(true);
  });
});
