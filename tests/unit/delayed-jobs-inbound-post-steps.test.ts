/**
 * @jest-environment node
 */
type JobRow = {
  id: number;
  workflow_id: number;
  message_id: number | null;
  resume_node_id: string | null;
  execute_at: string;
  context_json: string | null;
  status: string;
  created_at: string;
};

const jobs: JobRow[] = [];

function fakeStatement(sql: string) {
  return {
    all: (...args: unknown[]) => {
      if (/status = 'pending' AND execute_at <= \?/.test(sql)) {
        const now = String(args[0]);
        return jobs.filter((j) => j.status === 'pending' && j.execute_at <= now).map((j) => ({ ...j }));
      }
      return [];
    },
    get: (...args: unknown[]) => {
      if (/WHERE message_id = \? AND status IN \('pending', 'running'\)/.test(sql)) {
        return jobs.find((j) => j.message_id === args[0] && (j.status === 'pending' || j.status === 'running'));
      }
      return undefined;
    },
    run: (...args: unknown[]) => {
      if (/SET status = 'running' WHERE id = \? AND status = 'pending'/.test(sql)) {
        const job = jobs.find((j) => j.id === args[0] && j.status === 'pending');
        if (job) job.status = 'running';
        return { changes: job ? 1 : 0 };
      }
      if (/SET status = 'pending', execute_at = \?/.test(sql)) {
        const job = jobs.find((j) => j.id === args[1]);
        if (job) job.status = 'pending';
        return { changes: job ? 1 : 0 };
      }
      if (/SET status = \? WHERE id = \?/.test(sql)) {
        const job = jobs.find((j) => j.id === args[1]);
        if (job) job.status = String(args[0]);
        return { changes: job ? 1 : 0 };
      }
      return { changes: 0 };
    },
  };
}

jest.mock('../../electron/sqlite-service', () => ({
  getDb: jest.fn(() => ({ prepare: (sql: string) => fakeStatement(sql) })),
  getSyncInfo: jest.fn(() => null),
  setSyncInfo: jest.fn(),
}));

const mockGetWorkflowById = jest.fn();
jest.mock('../../electron/email/email-workflow-store', () => ({
  getWorkflowById: (...args: unknown[]) => mockGetWorkflowById(...args),
  releaseInboundWorkflowClaim: jest.fn(),
}));

jest.mock('../../electron/email/email-store', () => ({
  getEmailMessageById: jest.fn((id: number) => ({ id, account_id: 1, uid: 5 })),
}));

const mockExecuteWorkflowForTrigger = jest.fn();
jest.mock('../../electron/workflow/workflow-executor', () => ({
  executeWorkflowForTrigger: (...args: unknown[]) => mockExecuteWorkflowForTrigger(...args),
}));

const mockRunInboundPostWorkflowSteps = jest.fn(async () => undefined);
jest.mock('../../electron/email/email-workflow-engine', () => ({
  runInboundPostWorkflowSteps: (...args: unknown[]) => mockRunInboundPostWorkflowSteps(...args),
}));

import { processDueDelayedJobs } from '../../electron/workflow/delayed-jobs';

const graph = JSON.stringify({
  version: 1,
  nodes: [
    { id: 't', type: 'trigger', data: { kind: 'inbound' } },
    { id: 'tag', type: 'registry', data: { nodeType: 'email.tag', config: { tag: 'x' } } },
  ],
  edges: [],
});

function workflow(trigger = 'inbound') {
  return { id: 3, enabled: 1, trigger, execution_mode: 'graph', graph_json: graph };
}

function addJob(overrides: Partial<JobRow> = {}): JobRow {
  const job: JobRow = {
    id: jobs.length + 1,
    workflow_id: 3,
    message_id: 42,
    resume_node_id: 'tag',
    execute_at: new Date(Date.now() - 1000).toISOString(),
    context_json: JSON.stringify({ variables: {} }),
    status: 'pending',
    created_at: new Date().toISOString(),
    ...overrides,
  };
  jobs.push(job);
  return job;
}

const logger = { warn: jest.fn(), debug: jest.fn() };

describe('processDueDelayedJobs: inbound post-steps after a delay', () => {
  beforeEach(() => {
    jobs.length = 0;
    jest.clearAllMocks();
    mockGetWorkflowById.mockReturnValue(workflow());
    mockExecuteWorkflowForTrigger.mockResolvedValue({ runId: 1, status: 'ok', log: [], deferred: false });
  });

  // F-A9-14: runInboundWorkflowsForMessage überspringt Antwortvorschlag und
  // Abwesenheitsnotiz bei einer Verzögerung; nach der Fortsetzung holte sie niemand nach.
  test('runs reply suggestion / vacation reply once the last delayed inbound job finished', async () => {
    addJob();

    await processDueDelayedJobs(logger);

    expect(mockExecuteWorkflowForTrigger).toHaveBeenCalledTimes(1);
    expect(mockRunInboundPostWorkflowSteps).toHaveBeenCalledTimes(1);
    expect(mockRunInboundPostWorkflowSteps).toHaveBeenCalledWith(42);
  });

  test('waits while another delayed job for the same message is still open', async () => {
    addJob();
    addJob({ execute_at: new Date(Date.now() + 60_000).toISOString(), resume_node_id: 'later' });

    await processDueDelayedJobs(logger);

    expect(mockRunInboundPostWorkflowSteps).not.toHaveBeenCalled();
  });

  test('does not run post-steps while a failed job is requeued, nor for non-inbound triggers', async () => {
    addJob();
    mockExecuteWorkflowForTrigger.mockResolvedValueOnce({ runId: 1, status: 'error', log: ['boom'] });
    await processDueDelayedJobs(logger);
    expect(jobs[0]!.status).toBe('pending');
    expect(mockRunInboundPostWorkflowSteps).not.toHaveBeenCalled();

    jobs.length = 0;
    mockGetWorkflowById.mockReturnValue(workflow('outbound'));
    addJob();
    await processDueDelayedJobs(logger);
    expect(mockRunInboundPostWorkflowSteps).not.toHaveBeenCalled();
  });
});
