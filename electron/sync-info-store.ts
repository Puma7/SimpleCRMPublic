import { getSyncInfo, setSyncInfo } from './sqlite-service';

export function readSyncInfo(key: string): string | null {
  return getSyncInfo(key);
}

export function writeSyncInfo(key: string, value: string): void {
  setSyncInfo(key, value);
}
