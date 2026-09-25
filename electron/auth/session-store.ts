import { randomUUID } from 'crypto';
import type { WebContents } from 'electron';

export type SessionRole = 'owner' | 'admin' | 'agent' | 'viewer';

export type AppSession = {
  sessionId: string;
  userId: string;
  username: string;
  displayName: string;
  role: SessionRole;
  workspaceId: string;
  createdAt: string;
  expiresAt: string;
  lastActivityAt: string;
};

const sessionsByWebContents = new Map<number, AppSession>();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
/** Auto-lock after idle (plan: explicit idle lock). */
export const SESSION_IDLE_MS = 30 * 60 * 1000;

export function createSession(
  webContentsId: number,
  user: {
    id: string;
    username: string;
    displayName: string;
    role: SessionRole;
    workspaceId: string;
  },
): AppSession {
  const now = Date.now();
  const session: AppSession = {
    sessionId: randomUUID(),
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    workspaceId: user.workspaceId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
    lastActivityAt: new Date(now).toISOString(),
  };
  sessionsByWebContents.set(webContentsId, session);
  return session;
}

/** Legacy name: only refreshes idle activity, not absolute session expiry. */
export function touchSession(webContentsId: number): void {
  touchSessionActivity(webContentsId);
}

/** IPC activity: extend idle window only, not absolute session TTL. */
export function touchSessionActivity(webContentsId: number): void {
  const s = sessionsByWebContents.get(webContentsId);
  if (!s) return;
  s.lastActivityAt = new Date().toISOString();
}

export function getSessionForWebContents(webContentsId: number): AppSession | null {
  const s = sessionsByWebContents.get(webContentsId);
  if (!s) return null;
  const now = Date.now();
  if (Date.parse(s.expiresAt) < now) {
    sessionsByWebContents.delete(webContentsId);
    return null;
  }
  if (Date.parse(s.lastActivityAt) + SESSION_IDLE_MS < now) {
    sessionsByWebContents.delete(webContentsId);
    return null;
  }
  return s;
}

export function getSessionFromEvent(event: { sender: WebContents }): AppSession | null {
  return getSessionForWebContents(event.sender.id);
}

export function revokeSession(webContentsId: number): void {
  sessionsByWebContents.delete(webContentsId);
}

/**
 * Revoke every active session belonging to a user. `getSessionForWebContents`
 * only checks idle/TTL, not the DB, so a deleted (or hard-deactivated) account
 * would otherwise keep authenticated IPC access from an already-open window
 * until the idle timeout. `keepWebContentsId` spares the caller's own window on
 * a change to its own account (like keepSessionId on the server). Returns the
 * number of sessions dropped.
 */
export function revokeSessionsForUser(userId: string, keepWebContentsId?: number): number {
  let revoked = 0;
  for (const [webContentsId, session] of sessionsByWebContents) {
    if (session.userId === userId && webContentsId !== keepWebContentsId) {
      sessionsByWebContents.delete(webContentsId);
      revoked += 1;
    }
  }
  return revoked;
}

/** Apply a changed role to a window that keeps its session (the server re-reads the role per request). */
export function setSessionRole(webContentsId: number, role: SessionRole): void {
  const session = sessionsByWebContents.get(webContentsId);
  if (session) session.role = role;
}

export function clearAllSessions(): void {
  sessionsByWebContents.clear();
}
