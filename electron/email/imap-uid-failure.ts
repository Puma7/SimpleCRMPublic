import { deleteSyncInfo, getSyncInfo, setSyncInfo } from '../sqlite-service';

const MAX_IMAP_UID_FAILURES = 5;

function failureKey(folderId: number, uid: number): string {
  return `imap_uid_fail:${folderId}:${uid}`;
}

export function recordImapUidFetchFailure(folderId: number, uid: number): number {
  const key = failureKey(folderId, uid);
  const prev = parseInt(getSyncInfo(key) ?? '0', 10);
  const next = Number.isNaN(prev) ? 1 : prev + 1;
  setSyncInfo(key, String(next));
  return next;
}

export function clearImapUidFetchFailure(folderId: number, uid: number): void {
  deleteSyncInfo(failureKey(folderId, uid));
}

export function shouldSkipImapUidAfterFailures(folderId: number, uid: number): boolean {
  const n = parseInt(getSyncInfo(failureKey(folderId, uid)) ?? '0', 10);
  return !Number.isNaN(n) && n >= MAX_IMAP_UID_FAILURES;
}

export const IMAP_UID_MAX_FAILURES = MAX_IMAP_UID_FAILURES;
