import cron, { type ScheduledTask } from 'node-cron';
import { ImapFlow } from 'imapflow';
import { listEmailAccounts } from './email-store';
import { resolveImapAuth } from './email-imap-auth';
import { syncInboxImap } from './email-imap-sync';
import { syncInboxPop3 } from './email-pop3-sync';
import { runScheduledWorkflowFire } from './email-workflow-engine';
import { listWorkflowsWithCron } from './email-workflow-store';

let idleClients: Map<number, ImapFlow> = new Map();
let globalCron: ScheduledTask | null = null;
const workflowCrons: Map<number, ScheduledTask> = new Map();

/** Avoid stacking global cron ticks when sync is still running. */
const syncInFlight = new Set<number>();
const lastScheduledSyncAt = new Map<number, number>();
const MIN_SYNC_GAP_MS = 45_000;

async function startIdleForAccount(
  acc: ReturnType<typeof listEmailAccounts>[number],
  logger: Pick<typeof console, 'warn' | 'error' | 'debug'>,
  retryCount = 0,
): Promise<void> {
  try {
    const auth = await resolveImapAuth(acc);
    if ('accessToken' in auth) return;
    const client = new ImapFlow({
      host: acc.imap_host,
      port: acc.imap_port,
      secure: Boolean(acc.imap_tls),
      auth: { user: auth.user, pass: auth.pass },
      logger: false,
      connectionTimeout: 90_000,
      socketTimeout: 120_000,
    });
    await client.connect();
    await client.mailboxOpen('INBOX');
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
      const delay = Math.min(30_000, 5_000 * Math.pow(2, Math.min(retryCount, 4)));
      logger.debug(`[email] idle closed for account ${acc.id}, reconnecting in ${delay}ms`);
      setTimeout(() => {
        if (!globalCron) return;
        void startIdleForAccount(acc, logger, retryCount + 1);
      }, delay);
    });
    void client.idle().catch(() => undefined);
    idleClients.set(acc.id, client);
  } catch (e) {
    logger.debug(`[email] idle start skip account ${acc.id}`, e);
    const delay = Math.min(60_000, 10_000 * Math.pow(2, Math.min(retryCount, 4)));
    setTimeout(() => {
      if (!globalCron) return;
      void startIdleForAccount(acc, logger, retryCount + 1);
    }, delay);
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

  globalCron = cron.schedule(
    '*/2 * * * *',
    () => {
      const now = Date.now();
      const accounts = listEmailAccounts();
      for (const acc of accounts) {
        if (syncInFlight.has(acc.id)) continue;
        const last = lastScheduledSyncAt.get(acc.id) ?? 0;
        if (now - last < MIN_SYNC_GAP_MS) continue;
        syncInFlight.add(acc.id);
        lastScheduledSyncAt.set(acc.id, now);
        const run =
          (acc.protocol || 'imap') === 'pop3'
            ? syncInboxPop3(acc.id)
            : syncInboxImap(acc.id);
        void run
          .catch((e) => logger.debug(`[email] sync ${acc.id}`, e))
          .finally(() => {
            syncInFlight.delete(acc.id);
          });
      }
    },
    { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' },
  );

  for (const wf of listWorkflowsWithCron()) {
    const expr = (wf.cron_expr ?? '').trim();
    if (!expr || !cron.validate(expr)) continue;
    const task = cron.schedule(
      expr,
      () => {
        try {
          void runScheduledWorkflowFire(wf.id).catch((e) => logger.warn(`[email] workflow cron ${wf.id}`, e));
        } catch (e) {
          logger.warn(`[email] workflow cron ${wf.id}`, e);
        }
      },
      { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' },
    );
    workflowCrons.set(wf.id, task);
  }

  const accounts = listEmailAccounts();
  for (const acc of accounts) {
    if ((acc.protocol || 'imap') !== 'imap' || acc.oauth_provider === 'google' || acc.oauth_provider === 'microsoft') {
      continue;
    }
    void startIdleForAccount(acc, logger);
  }
}

export function stopEmailBackgroundServices(): void {
  if (globalCron) {
    globalCron.stop();
    globalCron = null;
  }
  for (const t of workflowCrons.values()) {
    t.stop();
  }
  workflowCrons.clear();
  for (const id of [...idleClients.keys()]) {
    stopIdleForAccount(id);
  }
  idleClients = new Map();
}

/** Reload only per-workflow cron jobs (e.g. after saving workflows in UI). */
export function restartEmailWorkflowCrons(logger: Pick<typeof console, 'warn' | 'debug'>): void {
  for (const t of workflowCrons.values()) {
    t.stop();
  }
  workflowCrons.clear();
  for (const wf of listWorkflowsWithCron()) {
    const expr = (wf.cron_expr ?? '').trim();
    if (!expr || !cron.validate(expr)) continue;
    const task = cron.schedule(
      expr,
      () => {
        try {
          void runScheduledWorkflowFire(wf.id).catch((e) => logger.warn(`[email] workflow cron ${wf.id}`, e));
        } catch (e) {
          logger.warn(`[email] workflow cron ${wf.id}`, e);
        }
      },
      { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' },
    );
    workflowCrons.set(wf.id, task);
  }
}
