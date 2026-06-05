/** Whether IMAP last_uid can advance to `uid` after a successful fetch without skipping failed batch UIDs. */
export function canAdvanceImapSyncCursor(
  chainEnd: number,
  uid: number,
  sortedUids: number[] | Set<number>,
  skippedUids?: Set<number>,
): boolean {
  if (uid <= chainEnd) return false;
  if (uid === chainEnd + 1) return true;

  const inBatch =
    sortedUids instanceof Set
      ? (u: number) => sortedUids.has(u)
      : (u: number) => sortedUids.includes(u);

  for (let u = chainEnd + 1; u < uid; u++) {
    if (skippedUids?.has(u)) continue;
    if (inBatch(u)) return false;
  }

  return true;
}
