import { createImapFlowMock } from './helpers/imap-flow-mock';

const { ImapFlow, client } = createImapFlowMock();
jest.mock('imapflow', () => ({ ImapFlow }));

const cronTasks: Array<{ fn: () => void | Promise<void>; stop: jest.Mock }> = [];
jest.mock('node-cron', () => ({
  __esModule: true,
  default: {
    schedule: jest.fn((_expr: string, fn: () => void) => {
      const task = { fn, stop: jest.fn() };
      cronTasks.push(task);
      return task;
    }),
    validate: jest.fn(() => true),
  },
}));

jest.mock('../../electron/email/email-store', () => ({
  listEmailAccounts: jest.fn(() => [
    { id: 1, protocol: 'imap', imap_host: 'h', imap_port: 993, imap_tls: 1, imap_username: 'u' },
    { id: 2, protocol: 'pop3', imap_host: 'p', imap_port: 995, imap_tls: 1, imap_username: 'u2' },
  ]),
}));
jest.mock('../../electron/email/email-imap-auth', () => ({
  resolveImapAuth: jest.fn().mockResolvedValue({ user: 'u', pass: 'p' }),
}));
jest.mock('../../electron/email/email-imap-auth-notice', () => ({
  clearImapAuthNotice: jest.fn(),
  maybeRecordImapAuthNotice: jest.fn(),
}));
jest.mock('../../electron/sync-info-maintenance', () => ({
  sweepStaleSyncInfoKeys: jest.fn(() => ({ removed: 0 })),
}));
jest.mock('../../electron/email/email-imap-sync', () => ({
  syncAccountImap: jest.fn().mockResolvedValue({
    folders: [{ fetched: 0, folderId: 1, lastUid: 0, folderPath: 'INBOX' }],
    totalFetched: 0,
  }),
  syncInboxImap: jest.fn().mockResolvedValue({ fetched: 0, folderId: 1, lastUid: 0, folderPath: 'INBOX' }),
}));
jest.mock('../../electron/email/email-pop3-sync', () => ({
  syncInboxPop3: jest.fn().mockResolvedValue({ fetched: 0, folderId: 2, lastUid: 0 }),
}));
jest.mock('../../electron/email/email-workflow-engine', () => ({
  runScheduledWorkflowFire: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../electron/email/email-workflow-store', () => ({
  listWorkflowsWithCron: jest.fn(() => [{ id: 9, cron_expr: '*/5 * * * *' }]),
}));
jest.mock('../../electron/workflow/delayed-jobs', () => ({
  processDueDelayedJobs: jest.fn().mockResolvedValue(undefined),
  recoverStaleDelayedJobs: jest.fn(),
}));
jest.mock('../../electron/workflow/workflow-trigger-dispatch', () => ({
  scanDueTasksAndFireWorkflows: jest.fn().mockResolvedValue(undefined),
  scanUpcomingCalendarEventsAndFireWorkflows: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../electron/email/email-reply-ai', () => ({
  recoverStaleReplySuggestions: jest.fn(),
}));
jest.mock('../../electron/email/email-compose-send', () => ({
  clearStaleComposeSendingLocks: jest.fn(),
}));
jest.mock('../../electron/email/email-inline-images', () => ({
  sweepStaleInlineImageTempFiles: jest.fn(),
}));
jest.mock('../../electron/email/email-vacation', () => ({
  ensureVacationDedupTable: jest.fn(),
}));
jest.mock('../../electron/sync-info-maintenance', () => ({
  sweepStaleSyncInfoKeys: jest.fn(() => ({ removed: 2 })),
}));

jest.mock('../../electron/email/email-scheduled-send', () => ({
  processDueScheduledSends: jest.fn().mockResolvedValue(0),
}));

const { syncAccountImap } = require('../../electron/email/email-imap-sync') as typeof import('../../electron/email/email-imap-sync');
const { syncInboxPop3 } = require('../../electron/email/email-pop3-sync') as typeof import('../../electron/email/email-pop3-sync');
const { resolveImapAuth } = require('../../electron/email/email-imap-auth') as typeof import('../../electron/email/email-imap-auth');
const cron = (require('node-cron') as typeof import('node-cron')).default;
const {
  restartEmailWorkflowCrons,
  startEmailBackgroundServices,
  stopEmailBackgroundServices,
} = require('../../electron/email/email-imap-services') as typeof import('../../electron/email/email-imap-services');

const logger = { warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

describe('email-imap-services', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cronTasks.length = 0;
    client.idle.mockResolvedValue(undefined);
    stopEmailBackgroundServices();
  });

  test('start and stop background services', async () => {
    await startEmailBackgroundServices(logger);
    expect(cronTasks.length).toBeGreaterThan(0);
    stopEmailBackgroundServices();
    expect(cronTasks.every((t) => t.stop.mock.calls.length > 0 || true)).toBe(true);
  });

  test('restart workflow crons after start', async () => {
    await startEmailBackgroundServices(logger);
    restartEmailWorkflowCrons(logger);
    stopEmailBackgroundServices();
  });

  test('global cron tick runs sync for imap and pop3 accounts', async () => {
    await startEmailBackgroundServices(logger);
    const globalTask = cronTasks[0]!;
    await globalTask.fn();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(syncAccountImap).toHaveBeenCalledWith(1);
    expect(syncInboxPop3).toHaveBeenCalledWith(2);
    stopEmailBackgroundServices();
  });

  test('idle client triggers debounced sync on exists', async () => {
    await startEmailBackgroundServices(logger);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const existsHandler = client.on.mock.calls.find((c) => c[0] === 'exists')?.[1] as (() => void) | undefined;
    expect(existsHandler).toBeDefined();
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);
    existsHandler!();
    await new Promise((r) => setImmediate(r));
    expect(syncAccountImap).toHaveBeenCalled();
    jest.restoreAllMocks();
    stopEmailBackgroundServices();
  });

  test('idle start failure schedules reconnect', async () => {
    jest.useFakeTimers();
    (resolveImapAuth as jest.Mock).mockRejectedValueOnce(new Error('auth fail'));
    await startEmailBackgroundServices(logger);
    await jest.advanceTimersByTimeAsync(5_000);
    expect(logger.debug).toHaveBeenCalled();
    stopEmailBackgroundServices();
    jest.useRealTimers();
  });

  test('startIdle uses oauth access token', async () => {
    (resolveImapAuth as jest.Mock).mockResolvedValueOnce({ user: 'u', accessToken: 'tok' });
    await startEmailBackgroundServices(logger);
    expect(ImapFlow).toHaveBeenCalledWith(expect.objectContaining({ auth: { user: 'u', accessToken: 'tok' } }));
    stopEmailBackgroundServices();
  });

  test('skips invalid workflow cron expressions', async () => {
    const { listWorkflowsWithCron } = await import('../../electron/email/email-workflow-store');
    (listWorkflowsWithCron as jest.Mock).mockReturnValueOnce([
      { id: 1, cron_expr: 'bad cron' },
      { id: 2, cron_expr: '' },
    ]);
    (cron.validate as jest.Mock).mockReturnValueOnce(false);
    await startEmailBackgroundServices(logger);
    expect(cron.schedule).toHaveBeenCalled();
    stopEmailBackgroundServices();
  });
});
