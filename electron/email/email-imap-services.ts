import cron, { type ScheduledTask } from 'node-cron';
import { ImapFlow } from 'imapflow';
import { listEmailAccounts } from './email-store';
import { resolveImapAuth } from './email-imap-auth';
import { syncInboxImap } from './email-imap-sync';
import { syncInboxPop3 } from './email-pop3-sync';
import { runScheduledWorkflowFire } from './email-workflow-engine';
import { listWorkflowsWithCron } from './email-workflow-store';
import { processDueDelayedJobs } from '../workflow/delayed-jobs';
import {
  scanDueTasksAndFireWorkflows,
  scanUpcomingCalendarEventsAndFireWorkflows,
} from '../workflow/workflow-trigger-dispatch';

let idleClients: Map<number, ImapFlow> = new Map();
let globalCron: ScheduledTask | null = null;
const workflowCrons: Map<number, ScheduledTask> = new Map();
const workflowCronInFlight = new Set<number>();

/** Avoid stacking global 2-min cron ticks when a previous tick is still running. */
let globalCronTickInFlight = false;

/** Avoid stacking global cron ticks when sync is still running. */
const syncInFlight = new Set<number>();
const lastScheduledSyncAt = new Map<number, number>();
const MIN_SYNC_GAP_MS = 45_000;
/** Pending reconnect timers per account — cleared on stop to prevent ghost clients. */
const pendingReconnectTimers = new Map<number, ReturnType<typeof setTimeout>>();

async function startIdleForAccount(
  acc: ReturnType<typeof listEmailAccounts>[number],
  logger: Pick<typeof console, 'warn' | 'error' | 'debug'>,
  retryCount = 0,
): Promise<void> {
  pendingReconnectTimers.delete(acc.id);
  try {
    // OAuth access tokens are refreshed on each connect (resolveImapAuth), including IDLE reconnects.
    const auth = await resolveImapAuth(acc);
    const client = new ImapFlow({
      host: acc.imap_host,
      port: acc.imap_port,
      secure: Boolean(acc.imap_tls),
      auth:
        'accessToken' in auth
          ? { user: auth.user, accessToken: auth.accessToken }
          : { user: auth.user, pass: auth.pass },
      logger: false,
      connectionTimeout: 90_000,
      socketTimeout: 120_000,
    });
    await client.connect();
    await client.mailboxOpen('INBOX');
    const connectedAt = Date.now();
    client.on('exists', () => {
      if (syncInFlight.has(acc.id)) return;
      const now = Date.now();
      const last = lastScheduledSyncAt.get(acc.id) ?? 0;
      if (now - last < MIN_SYNC_GAP_MS) return;
      syncInFlight.add(acc.id);
      lastScheduledSyncAt.set(acc.id, now);
      void syncInboxImap(acc.id)
        .catch((e) => logger.debug(`[email] idle sync ${acc.id}`, e))
        .finally(() => {
          syncInFlight.delete(acc.id);
        });
    });
    client.on('close', () => {
      idleClients.delete(acc.id);
      const livedMs = Date.now() - connectedAt;
      const nextRetry =
        livedMs >= 30_000 ? 0 : Math.min(retryCount + 1, 4);
      const delay = Math.min(60_000, 5_000 * Math.pow(2, nextRetry));
      logger.debug(
        `[email] idle closed for account ${acc.id} (lived ${livedMs}ms), reconnecting in ${delay}ms`,
      );
      const timer = setTimeout(() => {
        pendingReconnectTimers.delete(acc.id);
        if (!globalCron) return;
        void startIdleForAccount(acc, logger, nextRetry);
      }, delay);
      pendingReconnectTimers.set(acc.id, timer);
    });
    void client.idle().catch(() => undefined);
    idleClients.set(acc.id, client);
  } catch (e) {
    logger.debug(`[email] idle start skip account ${acc.id}`, e);
    const delay = Math.min(60_000, 5_000 * Math.pow(2, Math.min(retryCount, 4)));
    const timer = setTimeout(() => {
      pendingReconnectTimers.delete(acc.id);
      if (!globalCron) return;
      void startIdleForAccount(acc, logger, retryCount + 1);
    }, delay);
    pendingReconnectTimers.set(acc.id, timer);
  }
}

function stopIdleForAccount(accountId: number): void {
  const c = idleClients.get(accountId);
  if (c) {
    void c.logout().catch(() => undefined);
    idleClients.delete(accountId);
  }
}

export async function startEmailBackgroundServices(logger: Pick<typeof console, 'warn' | 'error' | 'debug'>): Promise<void> {
  stopEmailBackgroundServices();

  try {
    const { recoverStaleReplySuggestions } = await import('./email-reply-ai');
    const { clearStaleComposeSendingLocks } = await import('./email-compose-send');
    const { recoverStaleDelayedJobs } = await import('../workflow/delayed-jobs');
    const { sweepStaleInlineImageTempFiles } = await import('./email-inline-images');
    const { ensureVacationDedupTable } = await import('./email-vacation');
    ensureVacationDedupTable();
    recoverStaleReplySuggestions();
    clearStaleComposeSendingLocks();
    recoverStaleDelayedJobs();
    sweepStaleInlineImageTempFiles(undefined, logger);
    const { sweepStaleSyncInfoKeys } = await import('../sync-info-maintenance');
    const swept = sweepStaleSyncInfoKeys();
    if (swept.removed > 0) {
      logger.debug(`[sync_info] boot sweep removed ${swept.removed} stale keys`);
    }
  } catch (e) {
    logger.warn('[email] startup recovery', e);
  }

  globalCron = cron.schedule(
    '*/2 * * * *',
    () => {
      if (globalCronTickInFlight) return;
      globalCronTickInFlight = true;
      void (async () => {
        try {
          await processDueDelayedJobs(logger);
        } catch (e) {
          logger.debug('[workflow] delayed jobs', e);
        }
        try {
          const { processDueScheduledSends } = await import('./email-scheduled-send');
          await processDueScheduledSends(logger);
        } catch (e) {
          logger.debug('[email] scheduled send', e);
        }
        try {
          await scanDueTasksAndFireWorkflows();
        } catch (e) {
          logger.debug('[workflow] task due scan', e);
        }
        try {
          await scanUpcomingCalendarEventsAndFireWorkflows();
        } catch (e) {
          logger.debug('[workflow] calendar scan', e);
        }
        const now = Date.now();
        const accounts = listEmailAccounts();
        for (const acc of accounts) {
          if (syncInFlight.has(acc.id)) continue;
          const last = lastScheduledSyncAt.get(acc.id) ?? 0;
          if (now - last < MIN_SYNC_GAP_MS) continue;
          syncInFlight.add(acc.id);
          lastScheduledSyncAt.set(acc.id, now);
          try {
            if ((acc.protocol || 'imap') === 'pop3') {
              await syncInboxPop3(acc.id);
            } else {
              await syncInboxImap(acc.id);
            }
          } catch (e) {
            logger.debug(`[email] sync ${acc.id}`, e);
          } finally {
            syncInFlight.delete(acc.id);
          }
        }
      })().finally(() => {
        globalCronTickInFlight = false;
      });
    },
    { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' },
  );

  scheduleWorkflowCrons(logger);

  const accounts = listEmailAccounts();
  for (const acc of accounts) {
    if ((acc.protocol || 'imap') !== 'imap') {
      continue;
    }
    void startIdleForAccount(acc, logger);
  }
}

export function stopEmailBackgroundServices(): void {
  globalCronTickInFlight = false;
  if (globalCron) {
    globalCron.stop();
    globalCron = null;
  }
  for (const t of workflowCrons.values()) {
    t.stop();
  }
  workflowCrons.clear();
  workflowCronInFlight.clear();
  for (const id of [...idleClients.keys()]) {
    stopIdleForAccount(id);
  }
  idleClients = new Map();
  for (const timer of pendingReconnectTimers.values()) {
    clearTimeout(timer);
  }
  pendingReconnectTimers.clear();
}

/** Reload only per-workflow cron jobs (e.g. after saving workflows in UI). */
function scheduleWorkflowCrons(logger: Pick<typeof console, 'warn' | 'debug'>): void {
  for (const wf of listWorkflowsWithCron()) {
    const expr = (wf.cron_expr ?? '').trim();
    if (!expr || !cron.validate(expr)) continue;
    const wfId = wf.id;
    const task = cron.schedule(
      expr,
      () => {
        if (workflowCronInFlight.has(wfId)) return;
        workflowCronInFlight.add(wfId);
        void runScheduledWorkflowFire(wfId)
          .catch((e) => logger.warn(`[email] workflow cron ${wfId}`, e))
          .finally(() => {
            workflowCronInFlight.delete(wfId);
          });
      },
      { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' },
    );
    workflowCrons.set(wfId, task);
  }
}

export function restartEmailWorkflowCrons(logger: Pick<typeof console, 'warn' | 'debug'>): void {
  for (const t of workflowCrons.values()) {
    t.stop();
  }
  workflowCrons.clear();
  workflowCronInFlight.clear();
  scheduleWorkflowCrons(logger);
}
