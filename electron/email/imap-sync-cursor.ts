/** Whether IMAP last_uid can advance to `uid` after a successful fetch (no skipped failures in batch). */
export function canAdvanceImapSyncCursor(chainEnd: number, uid: number, sortedUids: number[]): boolean {
  if (uid <= chainEnd) return false;
  if (uid === chainEnd + 1) return true;
  for (let u = chainEnd + 1; u < uid; u++) {
    if (sortedUids.includes(u)) return false;
  }
  return true;
}
