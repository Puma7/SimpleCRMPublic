import { IPCChannels } from '../../shared/ipc/channels';
import { registerIpcHandler } from './register';
import { verifyPassword } from '../auth/password-hash';
import {
  createSession,
  revokeSession,
  revokeSessionsForUser,
  getSessionFromEvent,
  touchSession,
  type SessionRole,
} from '../auth/session-store';
import { LOCAL_OWNER_USER_ID, LOCAL_WORKSPACE_ID } from '../mail-roadmap-migrations';
import {
  changeLocalAuthPassword,
  deleteLocalAuthUser,
  enableAuthMiddleware as enableLocalAuthMiddleware,
  findLocalLoginUser,
  isAuthMiddlewareEnabled,
  listLocalAuthAuditLog,
  listLocalAuthUsers,
  readLocalSetupState,
  readOrCreateOneTimeSetupPassword,
  recordLocalLoginFailure,
  recordLocalLoginSuccess,
  recordLocalLogout,
  saveLocalAuthUser,
  setInitialOwnerPassword,
  verifyLocalAuthAuditChain,
} from '../auth/auth-store';
import { checkLoginAllowed, recordLoginFailure, clearLoginFailures } from '../auth/login-guard';

interface AuthRouterOptions {
  logger: Pick<typeof console, 'debug' | 'info' | 'warn' | 'error'>;
  getMainWindow?: () => import('electron').BrowserWindow | null;
}

const sessionCleanupSenders = new WeakSet<object>();

function isMainRenderer(
  event: { sender: { id: number } },
  getMainWindow?: () => import('electron').BrowserWindow | null,
): boolean {
  const win = getMainWindow?.();
  return Boolean(win && event.sender.id === win.webContents.id);
}

export function registerAuthHandlers(options: AuthRouterOptions): () => void {
  const { logger, getMainWindow } = options;
  const disposers: Array<() => void> = [];

  disposers.push(
    registerIpcHandler(IPCChannels.Auth.Login, async (event, payload: { username: string; passphrase: string }) => {
      const row = findLocalLoginUser(payload.username);
      const allowed = checkLoginAllowed(payload.username);
      if (!allowed.ok) {
        const sec = Math.ceil(allowed.waitMs / 1000);
        return { success: false as const, error: `Zu viele Versuche. Bitte ${sec}s warten.` };
      }
      if (!row || row.is_active !== 1) {
        recordLoginFailure(payload.username);
        recordLocalLoginFailure(payload.username);
        return { success: false as const, error: 'Ungültige Anmeldedaten' };
      }
      if (row.must_set_password === 1) {
        return {
          success: false as const,
          error: 'Bitte zuerst das Administrator-Passwort in der Einrichtung setzen.',
          needsInitialPassword: true as const,
        };
      }
      if (!verifyPassword(row.password_hash, payload.passphrase)) {
        recordLoginFailure(payload.username);
        recordLocalLoginFailure(payload.username);
        return { success: false as const, error: 'Ungültige Anmeldedaten' };
      }
      clearLoginFailures(payload.username);
      const session = createSession(event.sender.id, {
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        role: row.role as SessionRole,
        workspaceId: LOCAL_WORKSPACE_ID,
      });
      recordLocalLoginSuccess(row.id);
      touchSession(event.sender.id);
      if (!sessionCleanupSenders.has(event.sender)) {
        sessionCleanupSenders.add(event.sender);
        event.sender.once('destroyed', () => {
          sessionCleanupSenders.delete(event.sender);
          revokeSession(event.sender.id);
        });
      }
      return {
        success: true as const,
        user: {
          id: row.id,
          username: row.username,
          displayName: row.display_name,
          role: row.role,
        },
        expiresAt: session.expiresAt,
      };
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Auth.Logout, async (event) => {
      const session = getSessionFromEvent(event);
      recordLocalLogout(session?.userId ?? null);
      revokeSession(event.sender.id);
      return { success: true as const };
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Auth.GetSession, async (event) => {
      const session = getSessionFromEvent(event);
      const middlewareOn = isAuthMiddlewareEnabled();
      if (!session && !middlewareOn) {
        return {
          authenticated: true as const,
          user: {
            id: LOCAL_OWNER_USER_ID,
            username: 'local',
            displayName: 'Lokal',
            role: 'owner',
          },
          authRequired: false,
        };
      }
      if (!session) {
        return { authenticated: false as const, authRequired: middlewareOn };
      }
      return {
        authenticated: true as const,
        authRequired: middlewareOn,
        user: {
          id: session.userId,
          username: session.username,
          displayName: session.displayName,
          role: session.role,
        },
        expiresAt: session.expiresAt,
      };
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Auth.ListUsers,
      async () => {
        return listLocalAuthUsers();
      },
      { logger, requireAuth: true, requireRealSession: true, requireRole: ['owner', 'admin'] },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Auth.GetSetupState, async () => {
      return readLocalSetupState();
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Auth.SetInitialPassword,
      async (event, payload: { passphrase: string; setupToken: string; username?: string }) => {
        if (!isMainRenderer(event, getMainWindow)) {
          return { success: false as const, error: 'Nur aus dem Hauptfenster erlaubt' };
        }
        return setInitialOwnerPassword(payload);
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Auth.GetOneTimeSetupPassword,
      async (event) => {
        if (!isMainRenderer(event, getMainWindow)) {
          return { success: false as const, error: 'Nur aus dem Hauptfenster erlaubt' };
        }
        return readOrCreateOneTimeSetupPassword();
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Auth.SaveUser,
      async (
        _event,
        payload: {
          id?: string;
          username: string;
          displayName: string;
          role: SessionRole;
          passphrase?: string;
          isActive?: boolean;
        },
      ) => {
        return saveLocalAuthUser(payload);
      },
      { logger, requireAuth: true, requireRealSession: true, requireRole: ['owner', 'admin'] },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Auth.DeleteUser,
      async (event, payload: { id: string }) => {
        const session = getSessionFromEvent(event);
        if (session && session.userId === payload.id) {
          return { success: false as const, error: 'Sie können sich nicht selbst löschen' };
        }
        const result = deleteLocalAuthUser(payload);
        // Drop any open sessions for the deleted user so an already-authenticated
        // window loses IPC access immediately instead of at the idle timeout.
        if (result.success) revokeSessionsForUser(payload.id);
        return result;
      },
      { logger, requireAuth: true, requireRealSession: true, requireRole: ['owner', 'admin'] },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Auth.ChangePassword,
      async (event, payload: { currentPassword: string; newPassword: string }) => {
        const session = getSessionFromEvent(event);
        if (!session) {
          return { success: false as const, error: 'Nicht angemeldet' };
        }
        return changeLocalAuthPassword({
          userId: session.userId,
          currentPassword: payload.currentPassword,
          newPassword: payload.newPassword,
        });
      },
      { logger, requireAuth: true, requireRealSession: true },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Auth.ListAuditLog,
      async (_event, payload: { limit?: number; offset?: number }) => {
        return listLocalAuthAuditLog(payload);
      },
      { logger, requireAuth: true, requireRealSession: true, requireRole: ['owner', 'admin'] },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Auth.VerifyAuditChain,
      async () => {
        return verifyLocalAuthAuditChain();
      },
      { logger, requireAuth: true, requireRealSession: true, requireRole: ['owner', 'admin'] },
    ),
  );

  return () => disposers.forEach((d) => d());
}

export function enableAuthMiddleware(): void {
  enableLocalAuthMiddleware();
}
