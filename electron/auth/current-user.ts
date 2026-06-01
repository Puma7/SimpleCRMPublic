import type { IpcMainInvokeEvent } from 'electron';
import type Database from 'better-sqlite3';
import { LOCAL_OWNER_USER_ID } from '../mail-roadmap-migrations';
import { getDb, getSyncInfo } from '../sqlite-service';
import { getSessionFromEvent, type AppSession } from './session-store';

/** When auth middleware is off, treat as local owner. */
export function resolveAuthContext(event: IpcMainInvokeEvent): AppSession | null {
  const middlewareOn = getSyncInfo('auth_middleware_v1') === '1';
  const session = getSessionFromEvent(event);
  if (session) return session;
  if (!middlewareOn) {
    return {
      sessionId: 'bootstrap',
      userId: LOCAL_OWNER_USER_ID,
      username: 'local',
      displayName: 'Lokal',
      role: 'owner',
      workspaceId: 'local-default',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    };
  }
  return null;
}

export function requireAuthSession(event: IpcMainInvokeEvent): AppSession {
  const ctx = resolveAuthContext(event);
  if (!ctx) throw new Error('Nicht angemeldet');
  return ctx;
}

export function getDbOrThrow(): Database.Database {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');
  return db;
}
