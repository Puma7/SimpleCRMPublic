export type LoginPenalty =
  | { kind: 'none' }
  | { kind: 'temporary'; lockSeconds: number }
  | { kind: 'permanent' };

export const LOGIN_BACKOFF_SECONDS = [30, 300, 3600, 86400] as const;
export const LOGIN_PERMANENT_LOCK_AFTER_FAILURES = 50;

export function calculateLoginPenalty(failedAttempts: number): LoginPenalty {
  if (!Number.isInteger(failedAttempts) || failedAttempts < 0) {
    throw new Error('failedAttempts must be a non-negative integer');
  }

  if (failedAttempts === 0) {
    return { kind: 'none' };
  }

  if (failedAttempts >= LOGIN_PERMANENT_LOCK_AFTER_FAILURES) {
    return { kind: 'permanent' };
  }

  const index = Math.min(failedAttempts - 1, LOGIN_BACKOFF_SECONDS.length - 1);
  return { kind: 'temporary', lockSeconds: LOGIN_BACKOFF_SECONDS[index] };
}

export function shouldResetFailureCounterAfterSuccess(): false {
  return false;
}
