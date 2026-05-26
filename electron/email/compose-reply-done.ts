import { setSyncInfo, getSyncInfo } from '../sqlite-service';

const KEY_PREFIX = 'compose_mark_parent_done:';

/** Persist per-draft preference (e.g. for scheduled send). Default when unset: mark as done. */
export function setComposeMarkReplyParentDone(draftMessageId: number, mark: boolean): void {
  setSyncInfo(`${KEY_PREFIX}${draftMessageId}`, mark ? '1' : '0');
}

export function getComposeMarkReplyParentDone(draftMessageId: number): boolean {
  const v = getSyncInfo(`${KEY_PREFIX}${draftMessageId}`);
  return v !== '0';
}
