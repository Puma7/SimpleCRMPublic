const mockRun = jest.fn();

jest.mock('../../electron/sqlite-service', () => ({
  getDb: jest.fn(() => ({
    prepare: (sql: string) => ({
      run: (...args: unknown[]) => {
        mockRun(sql, ...args);
        return { lastInsertRowid: 1 };
      },
      all: jest.fn(() => []),
      get: jest.fn(),
    }),
  })),
}));

jest.mock('../../electron/email/email-workflow-store', () => ({
  getWorkflowById: jest.fn(),
}));

jest.mock('../../electron/email/email-store', () => ({
  getEmailMessageById: jest.fn(),
}));

jest.mock('../../electron/workflow/workflow-executor', () => ({
  executeWorkflowForTrigger: jest.fn(),
}));

import { recoverStaleDelayedJobs } from '../../electron/workflow/delayed-jobs';

describe('delayed-jobs recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('recoverStaleDelayedJobs resets all running jobs to pending', () => {
    recoverStaleDelayedJobs();

    expect(mockRun).toHaveBeenCalledTimes(1);
    const sql = String(mockRun.mock.calls[0]?.[0]);
    expect(sql).toContain("status = 'pending'");
    expect(sql).toContain("status = 'running'");
    expect(sql).not.toContain('created_at');
  });
});
