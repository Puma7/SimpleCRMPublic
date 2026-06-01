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
};

const sessionsByWebContents = new Map<number, AppSession>();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

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
  };
  sessionsByWebContents.set(webContentsId, session);
  return session;
}

export function getSessionForWebContents(webContentsId: number): AppSession | null {
  const s = sessionsByWebContents.get(webContentsId);
  if (!s) return null;
  if (Date.parse(s.expiresAt) < Date.now()) {
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

export function clearAllSessions(): void {
  sessionsByWebContents.clear();
}
