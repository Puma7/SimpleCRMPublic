import type Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { hashPassword } from './auth/password-hash';
import { setStoredOneTimeSetupToken } from './auth/setup-token';
import os from 'os';
import { setSyncInfo } from './sqlite-service';
import {
  AUTH_AUDIT_LOG_TABLE,
  createAuthAuditLogTable,
  createEmailReadReceiptLogTable,
  createEmailRemoteContentAllowlistTable,
  createEmailThreadAliasesTable,
  createEmailThreadEdgesTable,
  createPgpIdentitiesTable,
  createPgpPeerKeysTable,
  createUserAccountAccessTable,
  createUsersTable,
  createWorkspaceMembersTable,
  createWorkspacesTable,
  CUSTOMERS_TABLE,
  EMAIL_ACCOUNTS_TABLE,
  EMAIL_MESSAGES_TABLE,
  EMAIL_READ_RECEIPT_LOG_TABLE,
  EMAIL_REMOTE_CONTENT_ALLOWLIST_TABLE,
  EMAIL_THREAD_ALIASES_TABLE,
  EMAIL_THREAD_EDGES_TABLE,
  EMAIL_THREADS_TABLE,
  EMAIL_WORKFLOWS_TABLE,
  PGP_IDENTITIES_TABLE,
  PGP_PEER_KEYS_TABLE,
  USERS_TABLE,
  USER_ACCOUNT_ACCESS_TABLE,
  WORKSPACES_TABLE,
  WORKSPACE_MEMBERS_TABLE,
} from './database-schema';

const LOCAL_WORKSPACE_ID = 'local-default';
const LOCAL_OWNER_USER_ID = 'local-owner';

function colExists(conn: Database.Database, table: string, col: string): boolean {
  const cols = conn.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === col);
}

function addCol(conn: Database.Database, table: string, col: string, sql: string): void {
  if (!colExists(conn, table, col)) {
    console.log(`[roadmap] Adding ${table}.${col}`);
    conn.exec(sql);
  }
}

function ensureTable(conn: Database.Database, name: string, createSql: string, indexes: string[] = []): void {
  const exists = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
  if (!exists) {
    console.log(`[roadmap] Creating table ${name}`);
    conn.exec(createSql);
    for (const idx of indexes) conn.exec(idx);
  }
}

function bootstrapLocalOwner(conn: Database.Database): void {
  const owner = conn.prepare(`SELECT id FROM ${USERS_TABLE} WHERE id = ?`).get(LOCAL_OWNER_USER_ID);
  if (owner) return;

  const username = os.userInfo().username || 'owner';
  const oneTimePass = randomBytes(24).toString('base64url');
  const hash = hashPassword(oneTimePass);
  const now = new Date().toISOString();
  setStoredOneTimeSetupToken(oneTimePass);

  conn.prepare(
    `INSERT INTO ${WORKSPACES_TABLE} (id, name) VALUES (?, ?)`,
  ).run(LOCAL_WORKSPACE_ID, 'Lokal');

  conn.prepare(
    `INSERT INTO ${USERS_TABLE} (id, username, display_name, role, password_hash, password_updated_at, is_active, must_set_password)
     VALUES (?, ?, ?, 'owner', ?, ?, 1, 1)`,
  ).run(LOCAL_OWNER_USER_ID, username, username, hash, now);

  conn.prepare(
    `INSERT INTO ${WORKSPACE_MEMBERS_TABLE} (workspace_id, user_id, role) VALUES (?, ?, 'owner')`,
  ).run(LOCAL_WORKSPACE_ID, LOCAL_OWNER_USER_ID);

  const accounts = conn.prepare(`SELECT id FROM ${EMAIL_ACCOUNTS_TABLE}`).all() as { id: number }[];
  const ins = conn.prepare(
    `INSERT OR IGNORE INTO ${USER_ACCOUNT_ACCESS_TABLE} (user_id, account_id, access_level) VALUES (?, ?, 'rw')`,
  );
  for (const a of accounts) {
    ins.run(LOCAL_OWNER_USER_ID, a.id);
  }
  console.log('[roadmap] Bootstrapped local-owner user (one-time setup password stored; use Auth.GetOneTimeSetupPassword once)');
}

/** Phase 1–5 additive schema for mail security roadmap. */
export function runMailRoadmapMigrations(conn: Database.Database): void {
  ensureTable(conn, WORKSPACES_TABLE, createWorkspacesTable);
  ensureTable(conn, USERS_TABLE, createUsersTable);
  addCol(conn, USERS_TABLE, 'must_set_password', `ALTER TABLE ${USERS_TABLE} ADD COLUMN must_set_password INTEGER NOT NULL DEFAULT 0`);
  ensureTable(conn, WORKSPACE_MEMBERS_TABLE, createWorkspaceMembersTable);
  ensureTable(conn, USER_ACCOUNT_ACCESS_TABLE, createUserAccountAccessTable);
  ensureTable(conn, AUTH_AUDIT_LOG_TABLE, createAuthAuditLogTable, [
    `CREATE INDEX IF NOT EXISTS idx_audit_log_user_at ON ${AUTH_AUDIT_LOG_TABLE}(user_id, at DESC)`,
  ]);

  const msgExists = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(EMAIL_MESSAGES_TABLE);
  if (msgExists) {
    addCol(conn, EMAIL_MESSAGES_TABLE, 'remote_content_policy', `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN remote_content_policy TEXT NOT NULL DEFAULT 'blocked'`);
    addCol(conn, EMAIL_MESSAGES_TABLE, 'read_receipt_requested', `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN read_receipt_requested INTEGER NOT NULL DEFAULT 0`);
    addCol(conn, EMAIL_MESSAGES_TABLE, 'assigned_to_user_id', `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN assigned_to_user_id TEXT REFERENCES ${USERS_TABLE}(id) ON DELETE SET NULL`);
    addCol(conn, EMAIL_MESSAGES_TABLE, 'pgp_status', `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN pgp_status TEXT`);
    addCol(conn, EMAIL_MESSAGES_TABLE, 'pgp_signer_fingerprint', `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN pgp_signer_fingerprint TEXT`);
    addCol(conn, EMAIL_MESSAGES_TABLE, 'workspace_id', `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN workspace_id TEXT`);
    addCol(conn, EMAIL_MESSAGES_TABLE, 'thread_confidence', `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN thread_confidence TEXT`);
    addCol(conn, EMAIL_MESSAGES_TABLE, 'thread_resolver_version', `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN thread_resolver_version INTEGER NOT NULL DEFAULT 0`);
    addCol(conn, EMAIL_MESSAGES_TABLE, 'normalized_subject', `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN normalized_subject TEXT`);
    addCol(conn, EMAIL_MESSAGES_TABLE, 'server_thread_source', `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN server_thread_source TEXT`);
  }

  const accExists = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(EMAIL_ACCOUNTS_TABLE);
  if (accExists) {
    addCol(conn, EMAIL_ACCOUNTS_TABLE, 'default_remote_content_policy', `ALTER TABLE ${EMAIL_ACCOUNTS_TABLE} ADD COLUMN default_remote_content_policy TEXT NOT NULL DEFAULT 'blocked'`);
    addCol(conn, EMAIL_ACCOUNTS_TABLE, 'respond_to_read_receipts', `ALTER TABLE ${EMAIL_ACCOUNTS_TABLE} ADD COLUMN respond_to_read_receipts TEXT NOT NULL DEFAULT 'never'`);
    addCol(conn, EMAIL_ACCOUNTS_TABLE, 'read_receipt_trusted_domains', `ALTER TABLE ${EMAIL_ACCOUNTS_TABLE} ADD COLUMN read_receipt_trusted_domains TEXT`);
    addCol(conn, EMAIL_ACCOUNTS_TABLE, 'workspace_id', `ALTER TABLE ${EMAIL_ACCOUNTS_TABLE} ADD COLUMN workspace_id TEXT`);
  }

  const threadsExists = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(EMAIL_THREADS_TABLE);
  if (threadsExists) {
    addCol(conn, EMAIL_THREADS_TABLE, 'root_message_id', `ALTER TABLE ${EMAIL_THREADS_TABLE} ADD COLUMN root_message_id INTEGER`);
    addCol(conn, EMAIL_THREADS_TABLE, 'last_message_at', `ALTER TABLE ${EMAIL_THREADS_TABLE} ADD COLUMN last_message_at TEXT`);
    addCol(conn, EMAIL_THREADS_TABLE, 'message_count', `ALTER TABLE ${EMAIL_THREADS_TABLE} ADD COLUMN message_count INTEGER NOT NULL DEFAULT 0`);
    addCol(conn, EMAIL_THREADS_TABLE, 'has_unread', `ALTER TABLE ${EMAIL_THREADS_TABLE} ADD COLUMN has_unread INTEGER NOT NULL DEFAULT 0`);
    addCol(conn, EMAIL_THREADS_TABLE, 'has_attachments', `ALTER TABLE ${EMAIL_THREADS_TABLE} ADD COLUMN has_attachments INTEGER NOT NULL DEFAULT 0`);
    addCol(conn, EMAIL_THREADS_TABLE, 'subject_normalized', `ALTER TABLE ${EMAIL_THREADS_TABLE} ADD COLUMN subject_normalized TEXT`);
    addCol(conn, EMAIL_THREADS_TABLE, 'workspace_id', `ALTER TABLE ${EMAIL_THREADS_TABLE} ADD COLUMN workspace_id TEXT`);
  }

  const wfExists = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(EMAIL_WORKFLOWS_TABLE);
  if (wfExists) {
    addCol(conn, EMAIL_WORKFLOWS_TABLE, 'created_by_user_id', `ALTER TABLE ${EMAIL_WORKFLOWS_TABLE} ADD COLUMN created_by_user_id TEXT`);
    addCol(conn, EMAIL_WORKFLOWS_TABLE, 'workspace_id', `ALTER TABLE ${EMAIL_WORKFLOWS_TABLE} ADD COLUMN workspace_id TEXT`);
  }

  const custExists = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(CUSTOMERS_TABLE);
  if (custExists) {
    addCol(conn, CUSTOMERS_TABLE, 'workspace_id', `ALTER TABLE ${CUSTOMERS_TABLE} ADD COLUMN workspace_id TEXT`);
  }

  ensureTable(conn, EMAIL_REMOTE_CONTENT_ALLOWLIST_TABLE, createEmailRemoteContentAllowlistTable);
  ensureTable(conn, EMAIL_READ_RECEIPT_LOG_TABLE, createEmailReadReceiptLogTable);
  ensureTable(conn, EMAIL_THREAD_EDGES_TABLE, createEmailThreadEdgesTable, [
    `CREATE INDEX IF NOT EXISTS idx_thread_edges_child ON ${EMAIL_THREAD_EDGES_TABLE}(child_message_id)`,
  ]);
  ensureTable(conn, EMAIL_THREAD_ALIASES_TABLE, createEmailThreadAliasesTable);
  ensureTable(conn, PGP_IDENTITIES_TABLE, createPgpIdentitiesTable);
  ensureTable(conn, PGP_PEER_KEYS_TABLE, createPgpPeerKeysTable, [
    `CREATE INDEX IF NOT EXISTS idx_pgp_peer_email ON ${PGP_PEER_KEYS_TABLE}(email)`,
  ]);

  conn.exec(`CREATE INDEX IF NOT EXISTS idx_threads_last_at ON ${EMAIL_THREADS_TABLE}(last_message_at DESC)`);

  // Audit log immutability triggers
  const auditTriggers = conn
    .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='auth_audit_log_no_update'")
    .get();
  if (!auditTriggers) {
    conn.exec(`
      CREATE TRIGGER IF NOT EXISTS auth_audit_log_no_update
      BEFORE UPDATE ON ${AUTH_AUDIT_LOG_TABLE}
      BEGIN SELECT RAISE(ABORT, 'auth_audit_log is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS auth_audit_log_no_delete
      BEFORE DELETE ON ${AUTH_AUDIT_LOG_TABLE}
      BEGIN SELECT RAISE(ABORT, 'auth_audit_log is append-only'); END;
    `);
  }

  // Backfill workspace_id
  for (const table of [EMAIL_ACCOUNTS_TABLE, EMAIL_MESSAGES_TABLE, EMAIL_THREADS_TABLE, EMAIL_WORKFLOWS_TABLE, CUSTOMERS_TABLE]) {
    const t = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
    if (t && colExists(conn, table, 'workspace_id')) {
      conn.prepare(`UPDATE ${table} SET workspace_id = ? WHERE workspace_id IS NULL OR workspace_id = ''`).run(
        LOCAL_WORKSPACE_ID,
      );
    }
  }

  bootstrapLocalOwner(conn);
}

export { LOCAL_WORKSPACE_ID, LOCAL_OWNER_USER_ID };
