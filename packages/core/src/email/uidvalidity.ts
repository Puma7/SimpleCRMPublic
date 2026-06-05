export type FolderUidValidityRow = {
  uidvalidity: number | null;
  uidvalidity_str: string | null;
};

export function serverUidValidityToString(value: bigint | number | undefined | null): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return typeof value === 'bigint' ? value.toString() : BigInt(value).toString();
}

export function storedUidValidityString(row: FolderUidValidityRow): string | null {
  if (row.uidvalidity_str != null && row.uidvalidity_str !== '') {
    return row.uidvalidity_str;
  }
  if (row.uidvalidity != null) {
    return String(row.uidvalidity);
  }

  return null;
}

/** True if both values are known and differ. String comparison avoids float precision issues. */
export function uidValidityMismatch(stored: string | null, fromServer: string | null): boolean {
  if (stored == null || fromServer == null) {
    return false;
  }

  return stored !== fromServer;
}

/** Safe integer for the legacy `uidvalidity` column when it fits in JS number. */
export function uidValidityAsOptionalNumber(server: bigint | number | undefined | null): number | null {
  if (server === undefined || server === null) {
    return null;
  }

  const value = typeof server === 'bigint' ? server : BigInt(server);
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    return null;
  }

  return Number(value);
}
