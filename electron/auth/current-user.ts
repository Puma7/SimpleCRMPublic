import type { IpcMainInvokeEvent } from 'electron';
import type Database from 'better-sqlite3';
import { getDb } from '../sqlite-service';
import { getSessionFromEvent, type AppSession } from './session-store';

/** UI/bootstrap only — not for privileged IPC. */
export function resolveAuthContext(event: IpcMainInvokeEvent): AppSession | null {
  return getSessionFromEvent(event);
}

export function requireAuthSession(event: IpcMainInvokeEvent): AppSession {
  const ctx = resolveAuthContext(event);
  if (!ctx) throw new Error('Nicht angemeldet');
  return ctx;
}

/** Privileged handlers: never accept synthetic owner without login. */
export function requireRealAuthSession(event: IpcMainInvokeEvent): AppSession {
  const session = getSessionFromEvent(event);
  if (session) return session;
  throw new Error('Nicht angemeldet');
}

export function getDbOrThrow(): Database.Database {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');
  return db;
}
