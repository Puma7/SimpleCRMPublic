/**
 * Serializes mail sync (IMAP/POP3) per account so cron, manual sync, and IDLE
 * cannot overlap (SQLite + IMAP session safety).
 */
const tails = new Map<number, Promise<unknown>>();
const inFlightAbort = new Map<number, AbortController>();

export class EmailSyncAbortedError extends Error {
  constructor(message = 'E-Mail-Synchronisation abgebrochen') {
    super(message);
    this.name = 'EmailSyncAbortedError';
  }
}

export function isEmailSyncAbortedError(err: unknown): boolean {
  return err instanceof EmailSyncAbortedError;
}

/** Drop queued sync chain and abort the in-flight run for this account. */
export function clearEmailAccountSyncLock(accountId: number): void {
  tails.delete(accountId);
  const ctrl = inFlightAbort.get(accountId);
  if (ctrl) {
    ctrl.abort();
    inFlightAbort.delete(accountId);
  }
}

/** AbortSignal for the active sync on this account (if any). */
export function getEmailAccountSyncAbortSignal(accountId: number): AbortSignal | undefined {
  return inFlightAbort.get(accountId)?.signal;
}

export function assertSyncNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new EmailSyncAbortedError();
  }
}

export function withEmailAccountSyncLock<T>(
  accountId: number,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const prev = tails.get(accountId) ?? Promise.resolve();
  const controller = new AbortController();
  inFlightAbort.set(accountId, controller);

  const run = prev.then(() => {
    if (controller.signal.aborted) {
      throw new EmailSyncAbortedError();
    }
    return fn(controller.signal);
  });

  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  tails.set(accountId, tail);

  return run.finally(() => {
    if (inFlightAbort.get(accountId) === controller) {
      inFlightAbort.delete(accountId);
    }
  });
}
