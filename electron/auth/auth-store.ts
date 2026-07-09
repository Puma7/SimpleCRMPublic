import type Database from 'better-sqlite3';
import { randomBytes, randomUUID } from 'crypto';
import { USERS_TABLE } from '../database-schema';
import { LOCAL_OWNER_USER_ID } from '../mail-roadmap-migrations';
import { getDb, getSyncInfo, setSyncInfo } from '../sqlite-service';
import {
  listAuditLog,
  logAuthAction,
  verifyAuditLogChain,
  type AuditLogRow,
} from './audit-log';
import { hashPassword, verifyPassword } from './password-hash';
import { getPasswordTooShortMessage, isPasswordLengthValid } from '../../shared/auth-password-policy';
import {
  clearOneTimeSetupToken,
  hasActiveOneTimeSetupToken,
  readOneTimeSetupToken,
  setStoredOneTimeSetupToken,
  validateOneTimeSetupToken,
} from './setup-token';
import type { SessionRole } from './session-store';
import { canAccessAccount, type AccountAccessLevel } from './account-access';

const AUTH_MIDDLEWARE_SYNC_KEY = 'auth_middleware_v1';

export type LocalLoginUser = {
  id: string;
  username: string;
  display_name: string;
  role: string;
  password_hash: string;
  is_active: number;
  must_set_password: number;
};

export type LocalAuthUser = {
  id: string;
  username: string;
  display_name: string;
  role: string;
  is_active: number;
  last_login_at: string | null;
  created_at: string | null;
};

export type LocalSetupState = {
  needsInitialPassword: boolean;
  hasOneTimeToken?: boolean;
  setupUsername?: string | null;
  setupDisplayName?: string | null;
};

export type SaveLocalAuthUserInput = {
  id?: string;
  username: string;
  displayName: string;
  role: SessionRole;
  passphrase?: string;
  isActive?: boolean;
};

export type AuthMutationResult =
  | { success: true; id?: string }
  | { success: false; error: string };

function optionalLocalAuthDb(): Database.Database | null {
  try {
    return (getDb() as Database.Database | null) ?? null;
  } catch {
    return null;
  }
}

function requireLocalAuthDb(): Database.Database {
  const db = getDb() as Database.Database | null;
  if (!db) throw new Error('Database not initialized');
  return db;
}

export function getLocalAuthDbOrThrow(): Database.Database {
  return requireLocalAuthDb();
}

export function isAuthMiddlewareEnabled(): boolean {
  return getSyncInfo(AUTH_MIDDLEWARE_SYNC_KEY) === '1';
}

export function enableAuthMiddleware(): void {
  setSyncInfo(AUTH_MIDDLEWARE_SYNC_KEY, '1');
}

export function findLocalLoginUser(username: string): LocalLoginUser | undefined {
  return requireLocalAuthDb()
    .prepare(
      `SELECT id, username, display_name, role, password_hash, is_active, must_set_password FROM ${USERS_TABLE}
       WHERE username = ? COLLATE NOCASE`,
    )
    .get(username) as LocalLoginUser | undefined;
}

export function recordLocalLoginFailure(username: string): void {
  logAuthAction(requireLocalAuthDb(), {
    action: 'login.fail',
    detail: { username },
  });
}

export function recordLocalLoginSuccess(userId: string): void {
  const db = requireLocalAuthDb();
  db.prepare(`UPDATE ${USERS_TABLE} SET last_login_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    userId,
  );
  logAuthAction(db, { userId, action: 'login.success' });
  clearOneTimeSetupToken();
}

export function recordLocalLogout(userId?: string | null): void {
  const db = getDb() as Database.Database | null;
  if (userId && db) {
    logAuthAction(db, { userId, action: 'logout' });
  }
}

export function listLocalAuthUsers(): LocalAuthUser[] {
  const db = optionalLocalAuthDb();
  if (!db) return [];
  return db
    .prepare(
      `SELECT id, username, display_name, role, is_active, last_login_at, created_at FROM ${USERS_TABLE} ORDER BY username`,
    )
    .all() as LocalAuthUser[];
}

export function canUseSyntheticBootstrapAuthSession(): boolean {
  if (isAuthMiddlewareEnabled()) return false;
  const db = optionalLocalAuthDb();
  if (!db) return true;
  const userCount = (db.prepare(`SELECT COUNT(*) AS c FROM ${USERS_TABLE}`).get() as { c: number }).c;
  if (userCount > 1) return false;
  const owner = db
    .prepare(`SELECT id FROM ${USERS_TABLE} WHERE id = ? AND is_active = 1`)
    .get(LOCAL_OWNER_USER_ID) as { id: string } | undefined;
  return Boolean(owner);
}

export function canAccessLocalAccount(input: {
  userId: string;
  accountId: number;
  access: AccountAccessLevel;
  role: SessionRole;
}): boolean {
  return canAccessAccount(
    requireLocalAuthDb(),
    input.userId,
    input.accountId,
    input.access,
    input.role,
  );
}

export function readLocalSetupState(): LocalSetupState {
  const db = optionalLocalAuthDb();
  if (!db) return { needsInitialPassword: false };
  const owner = db
    .prepare(`SELECT username, display_name, must_set_password, last_login_at FROM ${USERS_TABLE} WHERE id = ?`)
    .get(LOCAL_OWNER_USER_ID) as
    | { username: string; display_name: string; must_set_password: number; last_login_at: string | null }
    | undefined;
  const needs = Boolean(owner && owner.must_set_password === 1);
  return {
    needsInitialPassword: needs,
    hasOneTimeToken: needs && hasActiveOneTimeSetupToken(),
    setupUsername: owner?.username ?? null,
    setupDisplayName: owner?.display_name ?? null,
  };
}

export function setInitialOwnerPassword(payload: {
  passphrase: string;
  setupToken: string;
  username?: string;
}): AuthMutationResult {
  const db = requireLocalAuthDb();
  if (!isPasswordLengthValid(payload.passphrase)) {
    return { success: false, error: getPasswordTooShortMessage() };
  }
  const owner = db
    .prepare(`SELECT must_set_password FROM ${USERS_TABLE} WHERE id = ?`)
    .get(LOCAL_OWNER_USER_ID) as { must_set_password: number } | undefined;
  if (!owner || owner.must_set_password !== 1) {
    return { success: false, error: 'Einrichtung bereits abgeschlossen' };
  }
  const setupUsername = payload.username?.trim();
  if (!setupUsername) {
    return { success: false, error: 'Benutzername erforderlich' };
  }
  if (setupUsername.length > 80) {
    return { success: false, error: 'Benutzername maximal 80 Zeichen' };
  }
  const duplicate = db
    .prepare(`SELECT id FROM ${USERS_TABLE} WHERE username = ? COLLATE NOCASE AND id != ?`)
    .get(setupUsername, LOCAL_OWNER_USER_ID) as { id: string } | undefined;
  if (duplicate) {
    return { success: false, error: 'Benutzername ist bereits vergeben' };
  }
  if (!validateOneTimeSetupToken(payload.setupToken)) {
    return { success: false, error: 'Ungültiges Setup-Token' };
  }
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE ${USERS_TABLE}
     SET username = ?, display_name = ?, password_hash = ?, password_updated_at = ?, must_set_password = 0
     WHERE id = ?`,
  ).run(setupUsername, setupUsername, hashPassword(payload.passphrase), now, LOCAL_OWNER_USER_ID);
  clearOneTimeSetupToken();
  enableAuthMiddleware();
  logAuthAction(db, { userId: LOCAL_OWNER_USER_ID, action: 'user.password.initial_set' });
  return { success: true };
}

export function readOrCreateOneTimeSetupPassword():
  | { success: true; passphrase: string }
  | { success: false; error: string } {
  const db = optionalLocalAuthDb();
  if (!db) return { success: false, error: 'Database not initialized' };
  const owner = db
    .prepare(`SELECT last_login_at FROM ${USERS_TABLE} WHERE id = ?`)
    .get(LOCAL_OWNER_USER_ID) as { last_login_at: string | null } | undefined;
  if (!owner || owner.last_login_at) {
    return { success: false, error: 'Setup-Passwort nicht verfügbar' };
  }
  let pass = readOneTimeSetupToken();
  if (!pass) {
    pass = randomBytes(24).toString('base64url');
    setStoredOneTimeSetupToken(pass);
  }
  return { success: true, passphrase: pass };
}

export function saveLocalAuthUser(payload: SaveLocalAuthUserInput): AuthMutationResult {
  const db = requireLocalAuthDb();
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
    return { success: true, id: payload.id };
  }
  const id = randomUUID();
  if (!payload.passphrase) {
    return { success: false, error: 'Passphrase erforderlich' };
  }
  db.prepare(
    `INSERT INTO ${USERS_TABLE} (id, username, display_name, role, password_hash, password_updated_at, is_active)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
  ).run(id, payload.username, payload.displayName, payload.role, hashPassword(payload.passphrase), now);
  logAuthAction(db, { action: 'user.create', resourceId: id });
  return { success: true, id };
}

export function deleteLocalAuthUser(payload: { id: string }): AuthMutationResult {
  const db = requireLocalAuthDb();
  const target = db
    .prepare(`SELECT id, role FROM ${USERS_TABLE} WHERE id = ?`)
    .get(payload.id) as { id: string; role: string } | undefined;
  if (!target) {
    return { success: false, error: 'Benutzer nicht gefunden' };
  }
  if (target.role === 'owner') {
    const otherOwners = (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM ${USERS_TABLE} WHERE role = 'owner' AND is_active = 1 AND id != ?`,
        )
        .get(payload.id) as { c: number }
    ).c;
    if (otherOwners === 0) {
      return { success: false, error: 'Mindestens ein Eigentümer muss bestehen bleiben' };
    }
  }
  db.prepare(`DELETE FROM ${USERS_TABLE} WHERE id = ?`).run(payload.id);
  logAuthAction(db, { action: 'user.delete', resourceId: payload.id });
  return { success: true, id: payload.id };
}

export function changeLocalAuthPassword(payload: {
  userId: string;
  currentPassword: string;
  newPassword: string;
}): AuthMutationResult {
  const db = requireLocalAuthDb();
  if (!isPasswordLengthValid(payload.newPassword)) {
    return { success: false, error: getPasswordTooShortMessage() };
  }
  const user = db
    .prepare(`SELECT id, password_hash FROM ${USERS_TABLE} WHERE id = ?`)
    .get(payload.userId) as { id: string; password_hash: string } | undefined;
  if (!user) {
    return { success: false, error: 'Benutzer nicht gefunden' };
  }
  if (!verifyPassword(user.password_hash, payload.currentPassword)) {
    return { success: false, error: 'Aktuelles Passwort ist falsch' };
  }
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE ${USERS_TABLE} SET password_hash = ?, password_updated_at = ? WHERE id = ?`,
  ).run(hashPassword(payload.newPassword), now, payload.userId);
  logAuthAction(db, { userId: payload.userId, action: 'user.password.change', resourceId: payload.userId });
  return { success: true, id: payload.userId };
}

export function listLocalAuthAuditLog(payload: { limit?: number; offset?: number }): AuditLogRow[] {
  const db = optionalLocalAuthDb();
  if (!db) return [];
  return listAuditLog(db, payload);
}

export function verifyLocalAuthAuditChain(): {
  valid: boolean;
  checked: number;
  firstBrokenId?: number;
} {
  const db = optionalLocalAuthDb();
  if (!db) return { valid: false, checked: 0 };
  return verifyAuditLogChain(db);
}
