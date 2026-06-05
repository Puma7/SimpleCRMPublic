import { getSyncInfo, setSyncInfo } from '../sqlite-service';
import {
  parseScheduledSendDraftStateFromValues,
  scheduledSendFailuresKey,
  scheduledSendLastErrorKey,
  scheduledSendStatusKey,
  scheduledSendSyncInfoKeys,
  truncateScheduledSendError,
  type ScheduledSendDraftState,
} from '../../packages/core/src/email';

export type { ScheduledSendDraftState } from '../../packages/core/src/email';

export function clearScheduledSendDraftMeta(draftId: number): void {
  setSyncInfo(scheduledSendFailuresKey(draftId), '0');
  setSyncInfo(scheduledSendStatusKey(draftId), '');
  setSyncInfo(scheduledSendLastErrorKey(draftId), '');
}

export function recordScheduledSendAttemptFailure(draftId: number, error: string): number {
  const fails = parseInt(getSyncInfo(scheduledSendFailuresKey(draftId)) ?? '0', 10) + 1;
  setSyncInfo(scheduledSendFailuresKey(draftId), String(fails));
  setSyncInfo(scheduledSendLastErrorKey(draftId), truncateScheduledSendError(error));
  setSyncInfo(scheduledSendStatusKey(draftId), 'pending');
  return fails;
}

export function markScheduledSendDraftFailed(draftId: number, error: string): void {
  setSyncInfo(scheduledSendLastErrorKey(draftId), truncateScheduledSendError(error));
  setSyncInfo(scheduledSendStatusKey(draftId), 'failed');
  setSyncInfo(scheduledSendFailuresKey(draftId), '0');
}

export function getScheduledSendDraftState(draftId: number): ScheduledSendDraftState {
  const values = new Map(scheduledSendSyncInfoKeys(draftId).map((key) => [key, getSyncInfo(key)]));
  return parseScheduledSendDraftStateFromValues(values, draftId);
}
