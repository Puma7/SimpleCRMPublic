import { createImapFlowMock } from './helpers/imap-flow-mock';

const { ImapFlow, client } = createImapFlowMock();
jest.mock('imapflow', () => ({ ImapFlow }));

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
const {
  restartEmailWorkflowCrons,
  startEmailBackgroundServices,
  stopEmailBackgroundServices,
  getEmailBackgroundSyncSnapshot,
  isEmailBackgroundSyncBusy,
} = require('../../electron/email/email-imap-services') as typeof import('../../electron/email/email-imap-services');

const logger = { warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

describe('email-imap-services', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    client.idle.mockResolvedValue(undefined);
    stopEmailBackgroundServices();
  });

  test('start and stop background services', async () => {
    await startEmailBackgroundServices(logger);
    await new Promise((resolve) => setImmediate(resolve));
    expect(getEmailBackgroundSyncSnapshot()).toMatchObject({ cronScheduled: true, idleImapAccountIds: [1] });
    stopEmailBackgroundServices();
    expect(client.logout).toHaveBeenCalled();
    expect(getEmailBackgroundSyncSnapshot()).toMatchObject({ cronScheduled: false, idleImapAccountIds: [] });
    expect(isEmailBackgroundSyncBusy()).toBe(false);
  });

  test('restart workflow crons after start', async () => {
    await startEmailBackgroundServices(logger);
    restartEmailWorkflowCrons(logger);
    stopEmailBackgroundServices();
  });

  test('global cron tick runs sync for imap and pop3 accounts', async () => {
    // In der Vergangenheit starten: die Entprellung je Konto merkt sich den Zeitpunkt
    // (spätere Tests mit echter Uhr sollen nicht gebremst werden).
    jest.useFakeTimers({ now: Date.now() - 10 * 60_000 });
    try {
      await startEmailBackgroundServices(logger);
      expect(syncAccountImap).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(120_000);
      expect(syncAccountImap).toHaveBeenCalledWith(1);
      expect(syncInboxPop3).toHaveBeenCalledWith(2);
    } finally {
      stopEmailBackgroundServices();
      jest.useRealTimers();
    }
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

  test('overlapping idle notifications cannot start duplicate account syncs', async () => {
    await startEmailBackgroundServices(logger);
    await new Promise((resolve) => setImmediate(resolve));
    const existsHandler = client.on.mock.calls.find((call) => call[0] === 'exists')![1] as () => void;
    let finishSync!: () => void;
    (syncAccountImap as jest.Mock).mockImplementationOnce(() => new Promise<void>((resolve) => { finishSync = resolve; }));
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 120_000);
    try {
      existsHandler();
      expect(isEmailBackgroundSyncBusy()).toBe(true);
      expect(getEmailBackgroundSyncSnapshot().syncInFlightAccountIds).toEqual([1]);
      existsHandler();
      expect(syncAccountImap).toHaveBeenCalledTimes(1);
      finishSync();
      await new Promise((resolve) => setImmediate(resolve));
      expect(isEmailBackgroundSyncBusy()).toBe(false);
      existsHandler();
      expect(syncAccountImap).toHaveBeenCalledTimes(1);
    } finally {
      finishSync?.();
      jest.restoreAllMocks();
      stopEmailBackgroundServices();
    }
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

  // Plan 045: ungültige Zeitpläne laufen nicht und werden einmal gemeldet.
  test('skips invalid workflow cron expressions and warns once', async () => {
    const { listWorkflowsWithCron } = await import('../../electron/email/email-workflow-store');
    const { runScheduledWorkflowFire } = await import('../../electron/email/email-workflow-engine');
    (listWorkflowsWithCron as jest.Mock).mockReturnValue([
      { id: 1, cron_expr: '0 6 L * *' },
      { id: 2, cron_expr: '' },
    ]);
    jest.useFakeTimers();
    try {
      await startEmailBackgroundServices(logger);
      restartEmailWorkflowCrons(logger);
      await jest.advanceTimersByTimeAsync(3 * 60_000);
      const warnings = logger.warn.mock.calls.filter((call) => String(call[0]).includes('Zeitplan von Workflow 1'));
      expect(warnings).toHaveLength(1);
      expect(String(warnings[0]![0])).toContain('0 6 L * *');
      expect(runScheduledWorkflowFire).not.toHaveBeenCalled();
    } finally {
      stopEmailBackgroundServices();
      jest.useRealTimers();
      (listWorkflowsWithCron as jest.Mock).mockReturnValue([{ id: 9, cron_expr: '*/5 * * * *' }]);
    }
  });

  test('scheduled workflow fires at its minute via the shared schedule logic', async () => {
    const { listWorkflowsWithCron } = await import('../../electron/email/email-workflow-store');
    const { runScheduledWorkflowFire } = await import('../../electron/email/email-workflow-engine');
    (listWorkflowsWithCron as jest.Mock).mockReturnValue([{ id: 5, cron_expr: '0 0 */6 * * *' }]);
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date(Date.UTC(2028, 4, 10, 11, 58, 30)));
      await startEmailBackgroundServices(logger);
      // 6-Felder-Ausdruck (festes Sekundenfeld) läuft wie „0 */6 * * *“ in der Zeitzone des Rechners.
      await jest.advanceTimersByTimeAsync(6 * 60 * 60_000);
      expect(runScheduledWorkflowFire).toHaveBeenCalledWith(5);
      expect((runScheduledWorkflowFire as jest.Mock).mock.calls.length).toBeLessThanOrEqual(2);
    } finally {
      stopEmailBackgroundServices();
      jest.useRealTimers();
      (listWorkflowsWithCron as jest.Mock).mockReturnValue([{ id: 9, cron_expr: '*/5 * * * *' }]);
    }
  });
});
