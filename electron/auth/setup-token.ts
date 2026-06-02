import { SYNC_INFO_TABLE } from '../database-schema';
import { deleteSyncInfo, getSyncInfo, setSyncInfo } from '../sqlite-service';

export const SETUP_TOKEN_SYNC_KEY = 'local_owner_one_time_pass';
const SETUP_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

type StoredSetupToken = { v: 1; token: string; expiresAt: number };

function parseStored(raw: string | null): StoredSetupToken | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as StoredSetupToken;
    if (o?.v === 1 && typeof o.token === 'string' && typeof o.expiresAt === 'number') {
      return o;
    }
  } catch {
    /* legacy plain token */
  }
  if (raw.length > 0) {
    return { v: 1, token: raw, expiresAt: Date.now() + SETUP_TOKEN_TTL_MS };
  }
  return null;
}

export function setStoredOneTimeSetupToken(token: string): void {
  const payload: StoredSetupToken = {
    v: 1,
    token,
    expiresAt: Date.now() + SETUP_TOKEN_TTL_MS,
  };
  setSyncInfo(SETUP_TOKEN_SYNC_KEY, JSON.stringify(payload));
}

export function hasActiveOneTimeSetupToken(): boolean {
  const row = parseStored(getSyncInfo(SETUP_TOKEN_SYNC_KEY));
  if (!row) return false;
  if (row.expiresAt <= Date.now()) {
    deleteSyncInfo(SETUP_TOKEN_SYNC_KEY);
    return false;
  }
  return true;
}

export function validateOneTimeSetupToken(candidate: string): boolean {
  const row = parseStored(getSyncInfo(SETUP_TOKEN_SYNC_KEY));
  if (!row || row.expiresAt <= Date.now()) {
    if (row) deleteSyncInfo(SETUP_TOKEN_SYNC_KEY);
    return false;
  }
  return row.token === candidate;
}

/** Read and delete the one-time setup token (GetOneTimeSetupPassword). */
export function consumeOneTimeSetupToken(): string | null {
  const row = parseStored(getSyncInfo(SETUP_TOKEN_SYNC_KEY));
  deleteSyncInfo(SETUP_TOKEN_SYNC_KEY);
  if (!row || row.expiresAt <= Date.now()) return null;
  return row.token;
}

export function clearOneTimeSetupToken(): void {
  deleteSyncInfo(SETUP_TOKEN_SYNC_KEY);
}

/** Remove setup token from a SQLite file copy (mail backup export). */
export function redactOneTimeSetupTokenInDatabase(db: import('better-sqlite3').Database): void {
  db.prepare(`DELETE FROM ${SYNC_INFO_TABLE} WHERE key = ?`).run(SETUP_TOKEN_SYNC_KEY);
}
