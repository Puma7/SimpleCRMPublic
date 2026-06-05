export type ScheduledSendDraftState = {
  failureCount: number;
  status: 'ok' | 'pending' | 'failed';
  lastError: string | null;
};

export function scheduledSendFailuresKey(messageId: number): string {
  return `scheduled_send_failures:${messageId}`;
}

export function scheduledSendStatusKey(messageId: number): string {
  return `scheduled_send_status:${messageId}`;
}

export function scheduledSendLastErrorKey(messageId: number): string {
  return `scheduled_send_last_error:${messageId}`;
}

export function scheduledSendSyncInfoKeys(messageId: number): readonly [string, string, string] {
  return [
    scheduledSendFailuresKey(messageId),
    scheduledSendStatusKey(messageId),
    scheduledSendLastErrorKey(messageId),
  ];
}

export function truncateScheduledSendError(error: string): string {
  return error.slice(0, 2000);
}

export function normalizeScheduledSendStatus(rawStatus: string | null | undefined): ScheduledSendDraftState['status'] {
  if (rawStatus === 'failed') return 'failed';
  if (rawStatus === 'pending') return 'pending';
  return 'ok';
}

export function normalizeScheduledSendFailureCount(rawCount: string | null | undefined): number {
  const failures = Number.parseInt(rawCount ?? '0', 10);
  return Number.isSafeInteger(failures) && failures > 0 ? failures : 0;
}

export function parseScheduledSendDraftStateFromValues(
  values: ReadonlyMap<string, string | null | undefined>,
  messageId: number,
): ScheduledSendDraftState {
  return {
    failureCount: normalizeScheduledSendFailureCount(values.get(scheduledSendFailuresKey(messageId))),
    status: normalizeScheduledSendStatus(values.get(scheduledSendStatusKey(messageId))),
    lastError: values.get(scheduledSendLastErrorKey(messageId)) || null,
  };
}
