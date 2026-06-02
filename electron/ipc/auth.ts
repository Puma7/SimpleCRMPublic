import { IPCChannels } from '../../shared/ipc/channels';
import { registerIpcHandler } from './register';
import { getDb, getSyncInfo, setSyncInfo, deleteSyncInfo } from '../sqlite-service';
import { verifyPassword, hashPassword } from '../auth/password-hash';
import {
  createSession,
  revokeSession,
  getSessionFromEvent,
  touchSession,
  type SessionRole,
} from '../auth/session-store';
import { listAuditLog, logAuthAction, verifyAuditLogChain } from '../auth/audit-log';
import { LOCAL_OWNER_USER_ID, LOCAL_WORKSPACE_ID } from '../mail-roadmap-migrations';
import { USERS_TABLE, USER_ACCOUNT_ACCESS_TABLE } from '../database-schema';
import { randomUUID } from 'crypto';
import { checkLoginAllowed, recordLoginFailure, clearLoginFailures } from '../auth/login-guard';

interface AuthRouterOptions {
  logger: Pick<typeof console, 'debug' | 'info' | 'warn' | 'error'>;
  getMainWindow?: () => import('electron').BrowserWindow | null;
}

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
      const db = getDb();
      if (!db) throw new Error('Database not initialized');
      const allowed = checkLoginAllowed(payload.username);
      if (!allowed.ok) {
        const sec = Math.ceil(allowed.waitMs / 1000);
        return { success: false as const, error: `Zu viele Versuche. Bitte ${sec}s warten.` };
      }
      const row = db
        .prepare(
          `SELECT id, username, display_name, role, password_hash, is_active, must_set_password FROM ${USERS_TABLE}
           WHERE username = ? COLLATE NOCASE`,
        )
        .get(payload.username) as
        | {
            id: string;
            username: string;
            display_name: string;
            role: string;
            password_hash: string;
            is_active: number;
            must_set_password: number;
          }
        | undefined;
      if (!row || row.is_active !== 1) {
        recordLoginFailure(payload.username);
        logAuthAction(db, { action: 'login.fail', detail: { username: payload.username } });
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
        logAuthAction(db, { action: 'login.fail', detail: { username: payload.username } });
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
      db.prepare(`UPDATE ${USERS_TABLE} SET last_login_at = ? WHERE id = ?`).run(
        new Date().toISOString(),
        row.id,
      );
      logAuthAction(db, { userId: row.id, action: 'login.success' });
      deleteSyncInfo('local_owner_one_time_pass');
      touchSession(event.sender.id);
      event.sender.once('destroyed', () => revokeSession(event.sender.id));
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
      const db = getDb();
      const session = getSessionFromEvent(event);
      if (session && db) {
        logAuthAction(db, { userId: session.userId, action: 'logout' });
      }
      revokeSession(event.sender.id);
      return { success: true as const };
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Auth.GetSession, async (event) => {
      const session = getSessionFromEvent(event);
      const middlewareOn = getSyncInfo('auth_middleware_v1') === '1';
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
        const db = getDb();
        if (!db) return [];
        return db
          .prepare(
            `SELECT id, username, display_name, role, is_active, last_login_at, created_at FROM ${USERS_TABLE} ORDER BY username`,
          )
          .all();
      },
      { logger, requireAuth: true, requireRealSession: true, requireRole: ['owner', 'admin'] },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Auth.GetSetupState, async () => {
      const db = getDb();
      if (!db) return { needsInitialPassword: false as const };
      const owner = db
        .prepare(`SELECT must_set_password, last_login_at FROM ${USERS_TABLE} WHERE id = ?`)
        .get(LOCAL_OWNER_USER_ID) as
        | { must_set_password: number; last_login_at: string | null }
        | undefined;
      const needs = Boolean(owner && owner.must_set_password === 1);
      return {
        needsInitialPassword: needs,
        hasOneTimeToken: needs && Boolean(getSyncInfo('local_owner_one_time_pass')),
      };
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Auth.SetInitialPassword,
      async (event, payload: { passphrase: string; setupToken: string }) => {
        if (!isMainRenderer(event, getMainWindow)) {
          return { success: false as const, error: 'Nur aus dem Hauptfenster erlaubt' };
        }
        const db = getDb();
        if (!db) throw new Error('Database not initialized');
        if (!payload.passphrase || payload.passphrase.length < 10) {
          return { success: false as const, error: 'Passwort mindestens 10 Zeichen' };
        }
        const owner = db
          .prepare(`SELECT must_set_password FROM ${USERS_TABLE} WHERE id = ?`)
          .get(LOCAL_OWNER_USER_ID) as { must_set_password: number } | undefined;
        if (!owner || owner.must_set_password !== 1) {
          return { success: false as const, error: 'Einrichtung bereits abgeschlossen' };
        }
        const token = getSyncInfo('local_owner_one_time_pass');
        if (!token || payload.setupToken !== token) {
          return { success: false as const, error: 'Ungültiges Setup-Token' };
        }
        const now = new Date().toISOString();
        db.prepare(
          `UPDATE ${USERS_TABLE} SET password_hash = ?, password_updated_at = ?, must_set_password = 0 WHERE id = ?`,
        ).run(hashPassword(payload.passphrase), now, LOCAL_OWNER_USER_ID);
        deleteSyncInfo('local_owner_one_time_pass');
        setSyncInfo('auth_middleware_v1', '1');
        logAuthAction(db, { userId: LOCAL_OWNER_USER_ID, action: 'user.password.initial_set' });
        return { success: true as const };
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
        const db = getDb();
        if (!db) return { success: false as const, error: 'Database not initialized' };
        const owner = db
          .prepare(`SELECT last_login_at FROM ${USERS_TABLE} WHERE id = ?`)
          .get(LOCAL_OWNER_USER_ID) as { last_login_at: string | null } | undefined;
        if (!owner || owner.last_login_at) {
          return { success: false as const, error: 'Setup-Passwort nicht verfügbar' };
        }
        const pass = getSyncInfo('local_owner_one_time_pass');
        if (!pass) return { success: false as const, error: 'Setup-Passwort nicht verfügbar' };
        deleteSyncInfo('local_owner_one_time_pass');
        return { success: true as const, passphrase: pass };
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
        const db = getDb();
        if (!db) throw new Error('Database not initialized');
        const now = new Date().toISOString();
        if (payload.id) {
          const sets = ['display_name = ?', 'role = ?', 'is_active = ?'];
          const vals: unknown[] = [payload.displayName, payload.role, payload.isActive === false ? 0 : 1];
          if (payload.passphrase) {
            sets.push('password_hash = ?', 'password_updated_at = ?');
            vals.push(hashPassword(payload.passphrase), now);
          }
          vals.push(payload.id);
          db.prepare(`UPDATE ${USERS_TABLE} SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
          logAuthAction(db, { action: 'user.update', resourceId: payload.id });
          return { success: true as const, id: payload.id };
        }
        const id = randomUUID();
        if (!payload.passphrase) {
          return { success: false as const, error: 'Passphrase erforderlich' };
        }
        db.prepare(
          `INSERT INTO ${USERS_TABLE} (id, username, display_name, role, password_hash, password_updated_at, is_active)
           VALUES (?, ?, ?, ?, ?, ?, 1)`,
        ).run(id, payload.username, payload.displayName, payload.role, hashPassword(payload.passphrase), now);
        logAuthAction(db, { action: 'user.create', resourceId: id });
        return { success: true as const, id };
      },
      { logger, requireAuth: true, requireRealSession: true, requireRole: ['owner', 'admin'] },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Auth.ListAuditLog,
      async (_event, payload: { limit?: number; offset?: number }) => {
        const db = getDb();
        if (!db) return [];
        return listAuditLog(db, payload);
      },
      { logger, requireAuth: true, requireRealSession: true, requireRole: ['owner', 'admin'] },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Auth.VerifyAuditChain,
      async () => {
        const db = getDb();
        if (!db) return { valid: false, checked: 0 };
        return verifyAuditLogChain(db);
      },
      { logger, requireAuth: true, requireRealSession: true, requireRole: ['owner', 'admin'] },
    ),
  );

  return () => disposers.forEach((d) => d());
}

export function enableAuthMiddleware(): void {
  setSyncInfo('auth_middleware_v1', '1');
}
