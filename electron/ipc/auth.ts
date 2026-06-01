import { IPCChannels } from '../../shared/ipc/channels';
import { registerIpcHandler } from './register';
import { getDb, getSyncInfo, setSyncInfo } from '../sqlite-service';
import { verifyPassword, hashPassword } from '../auth/password-hash';
import {
  createSession,
  revokeSession,
  getSessionFromEvent,
  type SessionRole,
} from '../auth/session-store';
import { logAuthAction } from '../auth/audit-log';
import { LOCAL_OWNER_USER_ID, LOCAL_WORKSPACE_ID } from '../mail-roadmap-migrations';
import { USERS_TABLE, USER_ACCOUNT_ACCESS_TABLE } from '../database-schema';
import { randomUUID } from 'crypto';

interface AuthRouterOptions {
  logger: Pick<typeof console, 'debug' | 'info' | 'warn' | 'error'>;
}

export function registerAuthHandlers(options: AuthRouterOptions): () => void {
  const { logger } = options;
  const disposers: Array<() => void> = [];

  disposers.push(
    registerIpcHandler(IPCChannels.Auth.Login, async (event, payload: { username: string; passphrase: string }) => {
      const db = getDb();
      if (!db) throw new Error('Database not initialized');
      const row = db
        .prepare(
          `SELECT id, username, display_name, role, password_hash, is_active FROM ${USERS_TABLE}
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
          }
        | undefined;
      if (!row || row.is_active !== 1) {
        logAuthAction(db, { action: 'login.fail', detail: { username: payload.username } });
        return { success: false as const, error: 'Ungültige Anmeldedaten' };
      }
      if (!verifyPassword(row.password_hash, payload.passphrase)) {
        logAuthAction(db, { action: 'login.fail', detail: { username: payload.username } });
        return { success: false as const, error: 'Ungültige Anmeldedaten' };
      }
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
      { logger, requireAuth: true, requireRole: ['owner', 'admin'] },
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
      { logger, requireAuth: true, requireRole: ['owner', 'admin'] },
    ),
  );

  return () => disposers.forEach((d) => d());
}

export function enableAuthMiddleware(): void {
  setSyncInfo('auth_middleware_v1', '1');
}
