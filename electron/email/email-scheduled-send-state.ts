import { getSyncInfo, setSyncInfo } from '../sqlite-service';

export type ScheduledSendDraftState = {
  failureCount: number;
  status: 'ok' | 'pending' | 'failed';
  lastError: string | null;
};

function failuresKey(draftId: number): string {
  return `scheduled_send_failures:${draftId}`;
}

function statusKey(draftId: number): string {
  return `scheduled_send_status:${draftId}`;
}

function errorKey(draftId: number): string {
  return `scheduled_send_last_error:${draftId}`;
}

export function clearScheduledSendDraftMeta(draftId: number): void {
  setSyncInfo(failuresKey(draftId), '0');
  setSyncInfo(statusKey(draftId), '');
  setSyncInfo(errorKey(draftId), '');
}

export function recordScheduledSendAttemptFailure(draftId: number, error: string): number {
  const fails = parseInt(getSyncInfo(failuresKey(draftId)) ?? '0', 10) + 1;
  setSyncInfo(failuresKey(draftId), String(fails));
  setSyncInfo(errorKey(draftId), error.slice(0, 2000));
  setSyncInfo(statusKey(draftId), 'pending');
  return fails;
}

export function markScheduledSendDraftFailed(draftId: number, error: string): void {
  setSyncInfo(errorKey(draftId), error.slice(0, 2000));
  setSyncInfo(statusKey(draftId), 'failed');
  setSyncInfo(failuresKey(draftId), '0');
}

export function getScheduledSendDraftState(draftId: number): ScheduledSendDraftState {
  const statusRaw = getSyncInfo(statusKey(draftId));
  const status: ScheduledSendDraftState['status'] =
    statusRaw === 'failed' ? 'failed' : statusRaw === 'pending' ? 'pending' : 'ok';
  return {
    failureCount: parseInt(getSyncInfo(failuresKey(draftId)) ?? '0', 10) || 0,
    status,
    lastError: getSyncInfo(errorKey(draftId)) || null,
  };
}
