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
      const accounts = listEmailAccounts();
      for (const acc of accounts) {
        if ((acc.protocol || 'imap') === 'pop3') {
          void syncInboxPop3(acc.id).catch((e) => logger.debug(`[email] pop3 sync ${acc.id}`, e));
        } else {
          void syncInboxImap(acc.id).catch((e) => logger.debug(`[email] imap sync ${acc.id}`, e));
        }
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
          runScheduledWorkflowFire(wf.id);
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
    if ((acc.protocol || 'imap') !== 'imap' || acc.oauth_provider === 'google') {
      continue;
    }
    void (async () => {
      try {
        const auth = await resolveImapAuth(acc);
        if ('accessToken' in auth) return;
        const client = new ImapFlow({
          host: acc.imap_host,
          port: acc.imap_port,
          secure: Boolean(acc.imap_tls),
          auth: { user: auth.user, pass: auth.pass },
          logger: false,
        });
        await client.connect();
        await client.mailboxOpen('INBOX');
        client.on('exists', () => {
          void syncInboxImap(acc.id).catch((e) => logger.debug(`[email] idle sync ${acc.id}`, e));
        });
        void client.idle().catch(() => undefined);
        idleClients.set(acc.id, client);
      } catch (e) {
        logger.debug(`[email] idle start skip account ${acc.id}`, e);
      }
    })();
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
