/**
 * Serializes mail sync (IMAP/POP3) per account so cron, manual sync, and IDLE
 * cannot overlap (SQLite + IMAP session safety).
 */
const tails = new Map<number, Promise<unknown>>();

export function withEmailAccountSyncLock<T>(accountId: number, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(accountId) ?? Promise.resolve();
  const run = prev.then(() => fn());
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  tails.set(accountId, tail);
  return run;
}
