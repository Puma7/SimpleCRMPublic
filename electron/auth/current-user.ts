import type { IpcMainInvokeEvent } from 'electron';
import type Database from 'better-sqlite3';
import { LOCAL_OWNER_USER_ID, LOCAL_WORKSPACE_ID } from '../mail-roadmap-migrations';
import { getDb, getSyncInfo } from '../sqlite-service';
import { getSessionFromEvent, type AppSession } from './session-store';

function syntheticBootstrapSession(): AppSession {
  const now = new Date().toISOString();
  return {
    sessionId: 'bootstrap',
    userId: LOCAL_OWNER_USER_ID,
    username: 'local',
    displayName: 'Lokal',
    role: 'owner',
    workspaceId: LOCAL_WORKSPACE_ID,
    createdAt: now,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    lastActivityAt: now,
  };
}

/** IPC auth: real session, or bootstrap owner until `auth_middleware_v1` is enabled. */
export function resolveAuthContext(event: IpcMainInvokeEvent): AppSession | null {
  const session = getSessionFromEvent(event);
  if (session) return session;
  if (getSyncInfo('auth_middleware_v1') !== '1') {
    return syntheticBootstrapSession();
  }
  return null;
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
